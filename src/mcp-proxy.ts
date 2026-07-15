/**
 * MCP 桥接代理脚本
 * 负责在标准 MCP 客户端 (stdin/stdout) 与 Cocos Creator 插件 (HTTP) 之间转发请求。
 * 内建离线场景/预制体编辑能力，无需 Cocos Creator 运行即可修改 .prefab/.fire 文件。
 */

import * as http from "http";
import * as pathModule from "path";
import * as fs from "fs";
import { OfflinePrefabEditor } from "./utils/OfflinePrefabEditor";

/**
 * 当前 Cocos Creator 插件监听的端口
 * 支持通过环境变量 MCP_BRIDGE_PORT 或命令行参数指定端口
 * @type {number}
 */
const COCOS_PORT = parseInt(process.env.MCP_BRIDGE_PORT || process.argv[2] || "8200", 10);
let globalActivePort: number | null = null;
const START_PORT = 8200;
const END_PORT = 8210;

/** 从扫描到的实例缓存的项目物理路径，用于 db:// URL → 绝对路径 转换 */
let cachedProjectPath: string | null = process.env.MCP_BRIDGE_PROJECT_PATH || null;

// ── 离线工具定义 ──────────────────────────────────────────────────────────

const operationsSchema = {
	type: "array",
	items: {
		type: "object",
		properties: {
			action: {
				type: "string",
				enum: [
					"update_property", "add_component", "remove_component",
					"add_node", "remove_node", "clone_node",
					"reorder_child", "set_reference"
				]
			},
			targetPath: { type: "string", description: "节点相对根节点的查找路径" },
			componentType: { type: "string", description: "组件类名，如 'cc.Label'" },
			properties: { type: "object", description: "属性键值对" },
			nodeName: { type: "string", description: "新节点或克隆后节点的名称" },
			newParentPath: { type: "string", description: "克隆节点要挂载的父节点路径" },
			childOrder: { type: "array", items: { type: "string" }, description: "子节点名称排序数组" },
			propertyName: { type: "string", description: "要绑定引用的组件属性名。支持数组索引语法如 clickEvents[0].target" },
			elementType: { type: "string", description: "数组元素类型，用于自动创建嵌套数组中的引用对象（如 cc.ClickEvent）。与 propertyName 的数组索引语法配合使用" },
			referenceValue: {
				type: "object",
				description: "绑定的引用的目标值",
				properties: {
					uuid: { type: "string", description: "外部资源的 UUID" },
					path: { type: "string", description: "内部节点路径" },
					componentType: { type: "string", description: "特定组件类名" }
				}
			}
		},
		required: ["action"]
	}
};

const OFFLINE_TOOLS = [
	{
		name: "modify_prefab_offline",
		description: `【离线高效预制体修改】在不打开编辑器预制体窗口的情况下，直接通过底层的 JSON 结构修改预制体数据，并刷新 AssetDB。支持 update_property, add_component, remove_component, add_node, remove_node, clone_node, reorder_child, set_reference 操作。如果预制体文件本身不存在且第一个基动作为 add_node 且 targetPath 为空，则工具将无中生有自动初始化空预制体。`,
		inputSchema: {
			type: "object",
			properties: {
				prefabUrl: { type: "string", description: "预制体在项目中的相对路径，如 db://assets/prefabs/MyPrefab.prefab" },
				operations: operationsSchema
			},
			required: ["prefabUrl", "operations"]
		}
	},
	{
		name: "modify_scene_offline",
		description: `【离线高效场景修改】在不打开编辑器场景窗口的情况下，直接通过底层的 JSON 结构修改场景数据，并刷新 AssetDB。支持 update_property, add_component, remove_component, add_node, remove_node, clone_node, reorder_child, set_reference 操作。与 modify_prefab_offline 共享完全相同的 operations 参数结构。如果场景文件不存在且第一个操作为 add_node 且 targetPath 为空，则自动创建空场景。注意：场景中新增的节点不会携带 PrefabInfo。`,
		inputSchema: {
			type: "object",
			properties: {
				sceneUrl: { type: "string", description: "场景在项目中的相对路径，如 db://assets/scenes/MyScene.fire" },
				operations: operationsSchema
			},
			required: ["sceneUrl", "operations"]
		}
	}
];
const OFFLINE_TOOL_NAMES = new Set(OFFLINE_TOOLS.map(t => t.name));

// ── URL 解析 ──────────────────────────────────────────────────────────────

/**
 * 将 db://assets/xxx 映射为绝对文件系统路径。
 * 需要先通过扫描 Cocos 实例或 MCP_BRIDGE_PROJECT_PATH 环境变量设置项目根目录。
 */
function resolveDbUrl(url: string): string {
	if (!url.startsWith("db://")) return url;
	if (!cachedProjectPath) {
		throw new Error(
			`无法解析路径 "${url}"，因为尚未检测到 Cocos Creator 项目路径。\n` +
			`解决办法：① 启动 Cocos Creator 编辑器并确保 MCP 插件的 HTTP 服务已开启；\n` +
			`② 或在启动代理前设置环境变量 MCP_BRIDGE_PROJECT_PATH=C:/你的项目路径。`
		);
	}
	const relative = url.replace(/^db:\/\//, "");
	return pathModule.join(cachedProjectPath, relative);
}

// ── 扫描存活实例 ──────────────────────────────────────────────────────────

async function scanActiveInstances(): Promise<{port: number, projectName: string, projectPath: string}[]> {
    const instances: {port: number, projectName: string, projectPath: string}[] = [];
    const promises = [];
    for (let p = START_PORT; p <= END_PORT; p++) {
        promises.push(new Promise<void>((resolve) => {
            const options: http.RequestOptions = {
                hostname: "127.0.0.1",
                port: p,
                path: "/mcp-status",
                method: "GET",
                timeout: 200,
            };
            const req = http.request(options, (res) => {
                let data = "";
                res.on("data", (d) => data += d);
                res.on("end", () => {
                    try {
                        const info = JSON.parse(data);
                        if (info && info.projectPath) {
                            instances.push(info);
                        }
                    } catch(e) {}
                    resolve();
                });
            });
            req.on("error", () => resolve());
            req.on("timeout", () => { req.destroy(); resolve(); });
            req.end();
        }));
    }
    await Promise.all(promises);
    return instances;
}

// ── 日志 ──────────────────────────────────────────────────────────────────

function debugLog(msg: string) {
    process.stderr.write(`[代理调试] ${msg}\n`);
}

// ── 离线编辑处理 ──────────────────────────────────────────────────────────

/**
 * 创建最简场景骨架 JSON（空 cc.SceneAsset + cc.Scene）
 */
function makeEmptySceneSkeleton(): string {
	return `[
  {
    "__type__": "cc.SceneAsset",
    "_name": "",
    "_objFlags": 0,
    "_native": "",
    "scene": { "__id__": 1 }
  },
  {
    "__type__": "cc.Scene",
    "_objFlags": 0,
    "_parent": null,
    "_children": [],
    "_active": true,
    "_components": [],
    "_prefab": null,
    "_opacity": 255,
    "_color": { "__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255 },
    "_contentSize": { "__type__": "cc.Size", "width": 0, "height": 0 },
    "_anchorPoint": { "__type__": "cc.Vec2", "x": 0, "y": 0 },
    "_trs": { "__type__": "TypedArray", "ctor": "Float64Array", "array": [0,0,0,0,0,0,1,1,1,1] },
    "_is3DNode": true,
    "_groupIndex": 0,
    "groupIndex": 0,
    "autoReleaseAssets": false,
    "_id": ""
  }
]`;
}

/**
 * 创建最简预制体骨架 JSON（cc.Prefab + cc.Node + cc.PrefabInfo）
 */
function makeEmptyPrefabSkeleton(): string {
	const fileId = OfflinePrefabEditor.generateFileId();
	return `[
  {
    "__type__": "cc.Prefab",
    "_name": "",
    "_objFlags": 0,
    "_native": "",
    "data": { "__id__": 1 }
  },
  {
    "__type__": "cc.Node",
    "_name": "Root",
    "_objFlags": 0,
    "_parent": null,
    "_children": [],
    "_components": [],
    "_active": true,
    "_prefab": { "__id__": 2 },
    "_opacity": 255,
    "_color": { "__type__": "cc.Color", "r": 255, "g": 255, "b": 255, "a": 255 },
    "_contentSize": { "__type__": "cc.Size", "width": 100, "height": 100 },
    "_anchorPoint": { "__type__": "cc.Vec2", "x": 0.5, "y": 0.5 },
    "_trs": { "__type__": "TypedArray", "ctor": "Float64Array", "array": [0,0,0,0,0,0,1,1,1,1] },
    "_eulerAngles": { "__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0 },
    "_skewX": 0, "_skewY": 0,
    "_is3DNode": false,
    "_groupIndex": 0,
    "groupIndex": 0,
    "_id": ""
  },
  {
    "__type__": "cc.PrefabInfo",
    "root": { "__id__": 1 },
    "asset": { "__id__": 0 },
    "fileId": "${fileId}",
    "sync": false
  }
]`;
}

/**
 * 在代理进程中直接执行离线修改，不依赖 Cocos Creator 插件。
 * 支持预制体文件自动初始化（无中生有）。
 */
function executeOfflineEdit(name: string, args: any, id: string | number | undefined) {
	try {
		const isPrefab = name === "modify_prefab_offline";
		const url = isPrefab ? args.prefabUrl : args.sceneUrl;
		if (!url) return sendError(id, -32602, `缺少参数: ${isPrefab ? 'prefabUrl' : 'sceneUrl'}`);

		const fsPath = resolveDbUrl(url);
		const firstOp = args.operations?.[0];

		// 无中生有：文件不存在且条件满足时自动创建骨架
		if (!fs.existsSync(fsPath)) {
			if (firstOp && firstOp.action === "add_node" && (!firstOp.targetPath || firstOp.targetPath === "" || firstOp.targetPath === "/")) {
				const parentDir = pathModule.dirname(fsPath);
				if (!fs.existsSync(parentDir)) {
					fs.mkdirSync(parentDir, { recursive: true });
				}
				const skeleton = isPrefab ? makeEmptyPrefabSkeleton() : makeEmptySceneSkeleton();
				fs.writeFileSync(fsPath, skeleton, "utf8");
				debugLog(`离线：自动创建空 ${isPrefab ? '预制体' : '场景'} ${fsPath}`);
			} else {
				return sendError(id, -32602,
					`文件不存在: ${url}，且不满足离线自动新建条件（首个操作需为 add_node 且 targetPath 为空）`);
			}
		}

		const result = OfflinePrefabEditor.modify(fsPath, args.operations);
		if (!result.success) {
			return sendError(id, -32603, `离线修改${isPrefab ? '预制体' : '场景'}失败: ${result.error}`);
		}

		sendToAI({
			jsonrpc: "2.0",
			id,
			result: {
				content: [{
					type: "text",
					text: `✅ 成功离线修改${isPrefab ? '预制体' : '场景'}: ${url}，物理数据已安全落盘。`
				}]
			}
		});
	} catch (e: any) {
		sendError(id, -32603, `离线编辑异常: ${e.message}`);
	}
}

// ── MCP 请求处理 ──────────────────────────────────────────────────────────

// 监听标准输入以获取 MCP 请求
process.stdin.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n");
    lines.forEach((line) => {
        if (!line.trim()) return;
        try {
            const request = JSON.parse(line);
            handleRequest(request);
        } catch (e) {
            // 忽略非 JSON 输入
        }
    });
});

/**
 * 处理 JSON-RPC 请求
 */
function handleRequest(req: any) {
    const { method, id, params } = req;

    // 处理握手初始化
    if (method === "initialize") {
        sendToAI({
            jsonrpc: "2.0",
            id: id,
            result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "cocos-bridge", version: "1.0.0" },
            },
        });
        return;
    }

    // 获取工具列表 — 未激活项目时只返回基础管理工具，激活后才返回全部工具
    if (method === "tools/list") {
        scanActiveInstances().then(instances => {
            // 缓存项目路径供离线 URL 解析使用
            if (instances.length > 0 && !cachedProjectPath) {
                cachedProjectPath = instances[0].projectPath;
            }

            const dynamicTools = [
                {
                    name: "get_active_instances",
                    description: "Scan local ports (8200-8210) to find all running Cocos Creator instances and return their project paths and connection ports.",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "set_active_instance",
                    description: "Manually bind the MCP client to a specific Cocos Creator instance's port. Call this before using other tools when multiple instances are running.",
                    inputSchema: { type: "object", properties: { port: { description: "The port number of the target instance to connect to.", type: "number" } }, required: ["port"] }
                }
            ];

            const isActivated = instances.length > 0 || globalActivePort !== null;

            if (isActivated) {
                // 已激活项目：向目标引擎层请求内部工具组，合并离线工具和动态管理工具
                const targetPort = globalActivePort || (instances.length > 0 ? instances[0].port : COCOS_PORT);
                forwardToCocos("/list-tools", null, id, "GET", targetPort, (cocosRes) => {
                    if (cocosRes && cocosRes.tools) {
                        // 去重：如果 Cocos 插件已经返回了同名的离线工具，用代理版的替代
                        const filteredCocos = cocosRes.tools.filter((t: any) => !OFFLINE_TOOL_NAMES.has(t.name));
                        cocosRes.tools = [...OFFLINE_TOOLS, ...filteredCocos, ...dynamicTools];
                    } else if (cocosRes && !cocosRes.tools) {
                        cocosRes.tools = [...OFFLINE_TOOLS, ...dynamicTools];
                    }
                    sendToAI({ jsonrpc: "2.0", id: id, result: cocosRes });
                });
            } else {
                // 未激活项目：只返回基础管理工具（get_active_instances + set_active_instance）
                sendToAI({
                    jsonrpc: "2.0",
                    id: id,
                    result: {
                        tools: [...dynamicTools]
                    }
                });
            }
        });
        return;
    }

    // 执行具体工具
    if (method === "tools/call") {
        // 内建工具：get_active_instances
        if (params.name === "get_active_instances") {
            scanActiveInstances().then(list => {
                sendToAI({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] }});
            });
            return;
        }

        // 内建工具：set_active_instance
        if (params.name === "set_active_instance") {
            const p = params.arguments ? params.arguments.port : null;
            if (typeof p === "number") {
                globalActivePort = p;
                sendToAI({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Active instance successfully set to port ${globalActivePort}. Subsequent commands will be routed here.` }] }});
            } else {
                sendError(id, -32602, "Invalid port parameter");
            }
            return;
        }

        // 离线编辑工具：需要先激活项目
        if (OFFLINE_TOOL_NAMES.has(params.name)) {
            scanActiveInstances().then(onlineEngines => {
                if (onlineEngines.length > 0 || globalActivePort) {
                    // 已激活项目：如果 Cocos Creator 在线则优先转发（获得 AssetDB 刷新），否则在本进程处理
                    if (onlineEngines.length > 0) {
                        const finalPort = globalActivePort || onlineEngines[0].port;
                        if (cachedProjectPath) {
                            // 同步项目路径到引擎层
                        }
                        forwardToCocos(
                            "/call-tool",
                            { name: params.name, arguments: params.arguments },
                            id, "POST", finalPort
                        );
                    } else {
                        executeOfflineEdit(params.name, params.arguments, id);
                    }
                } else {
                    sendError(id, -32000, "未激活任何 Cocos 项目实例。请先调用 `get_active_instances` 查看可用的实例，然后使用 `set_active_instance` 激活目标项目。\nNo active Cocos project instance. Please call `get_active_instances` first, then activate a project via `set_active_instance`.");
                }
            });
            return;
        }

        // 其它工具需要转发到 Cocos Creator 插件
        scanActiveInstances().then(onlineEngines => {
            if (!globalActivePort && onlineEngines.length === 0) {
                sendError(id, -32000, "未激活任何 Cocos 项目实例，无法执行编辑器工具。请先调用 `get_active_instances` 查看可用的实例，然后使用 `set_active_instance` 激活目标项目。\nNo active Cocos project instance. Please call `get_active_instances` first, then activate a project via `set_active_instance`.");
                return;
            }
            if (!globalActivePort && onlineEngines.length > 1) {
                sendError(id, -32600, "检测到多个 Cocos 实例运行中，指令下发被安全锁截停。请必须先调用 `get_active_instances` 并随后执行 `set_active_instance` 指定唯一的实例端口。 \nMultiple Cocos instances detected. Please call `get_active_instances` and then `set_active_instance` to bind port.");
                return;
            }
            const finalPort = globalActivePort || (onlineEngines[0] ? onlineEngines[0].port : COCOS_PORT);
            forwardToCocos(
                "/call-tool",
                {
                    name: params.name,
                    arguments: params.arguments,
                },
                id,
                "POST",
                finalPort
            );
        });
        return;
    }

    // 默认空响应
    if (id !== undefined) sendToAI({ jsonrpc: "2.0", id: id, result: {} });
}

// ── HTTP 转发 ─────────────────────────────────────────────────────────────

/**
 * 将请求通过 HTTP 转发给 Cocos Creator 插件
 */
function forwardToCocos(path_: string, payload: any, id: string | number | undefined, method = "POST", overridePort?: number, onSuccess?: (res: any) => void) {
    const postData = payload ? JSON.stringify(payload) : "";
    const targetPort = overridePort || COCOS_PORT;

    const options: http.RequestOptions = {
        hostname: "127.0.0.1",
        port: targetPort,
        path: path_,
        method: method,
        headers: { "Content-Type": "application/json" },
    };

    if (postData && options.headers) {
        options.headers["Content-Length"] = Buffer.byteLength(postData);
    }

    const request = http.request(options, (res) => {
        let resData = "";
        res.on("data", (d) => (resData += d));
        res.on("end", () => {
            try {
                const cocosRes = JSON.parse(resData);

                if (path_ === "/list-tools" && !cocosRes.tools) {
                    debugLog(`致命错误: Cocos 未返回工具列表。接收内容: ${resData}`);
                    sendError(id, -32603, "Cocos 响应无效：缺少 tools 数组");
                } else {
                    if (onSuccess) {
                        onSuccess(cocosRes);
                    } else {
                        sendToAI({ jsonrpc: "2.0", id: id, result: cocosRes });
                    }
                }
            } catch (e) {
                debugLog(`JSON 解析错误。Cocos 发送内容: ${resData}`);
                sendError(id, -32603, "Cocos 返回了非 JSON 数据");
            }
        });
    });

    request.on("error", (e) => {
        debugLog(`Cocos 插件已离线: ${e.message}`);
        sendError(id, -32000, "Cocos 插件离线");
    });

    if (postData) request.write(postData);
    request.end();
}

// ── 响应输出 ──────────────────────────────────────────────────────────────

function sendToAI(obj: any) {
    process.stdout.write(JSON.stringify(obj) + "\n");
}

function sendError(id: string | number | undefined, code: number, message: string) {
    sendToAI({ jsonrpc: "2.0", id: id, error: { code, message } });
}
