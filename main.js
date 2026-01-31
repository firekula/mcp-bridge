"use strict";

const http = require("http");
const path = require("path");

let logBuffer = []; // 存储所有日志
let mcpServer = null;
let serverConfig = {
	port: 3456,
	active: false,
};

// 封装日志函数，同时发送给面板和编辑器控制台
function addLog(type, message) {
	const logEntry = {
		time: new Date().toLocaleTimeString(),
		type: type,
		content: message,
	};
	logBuffer.push(logEntry);
	Editor.Ipc.sendToPanel("mcp-bridge", "mcp-bridge:on-log", logEntry);
	// 【修改】移除 Editor.log，保持编辑器控制台干净
	// 仅在非常严重的系统错误时才输出到编辑器
	if (type === "error") {
		Editor.error(`[MCP] ${message}`); // 如果你完全不想在编辑器看，可以注释掉
	}
}

const getNewSceneTemplate = () => {
	// 尝试获取 UUID 生成函数
	let newId = "";
	if (Editor.Utils && Editor.Utils.uuid) {
		newId = Editor.Utils.uuid();
	} else if (Editor.Utils && Editor.Utils.UuidUtils && Editor.Utils.UuidUtils.uuid) {
		newId = Editor.Utils.UuidUtils.uuid();
	} else {
		// 兜底方案：如果找不到编辑器 API，生成一个随机字符串
		newId = Math.random().toString(36).substring(2, 15);
	}

	const sceneData = [
		{
			__type__: "cc.SceneAsset",
			_name: "",
			_objFlags: 0,
			_native: "",
			scene: { __id__: 1 },
		},
		{
			__id__: 1,
			__type__: "cc.Scene",
			_name: "",
			_objFlags: 0,
			_parent: null,
			_children: [],
			_active: true,
			_level: 0,
			_components: [],
			autoReleaseAssets: false,
			_id: newId,
		},
	];
	return JSON.stringify(sceneData);
};

const getToolsList = () => {
	return [
		{
			name: "get_selected_node",
			description: "获取当前编辑器中选中的节点 ID",
			inputSchema: { type: "object", properties: {} },
		},
		{
			name: "set_node_name",
			description: "修改指定节点的名称",
			inputSchema: {
				type: "object",
				properties: {
					id: { type: "string", description: "节点的 UUID" },
					newName: { type: "string", description: "新的节点名称" },
				},
				required: ["id", "newName"],
			},
		},
		{
			name: "save_scene",
			description: "保存当前场景的修改",
			inputSchema: { type: "object", properties: {} },
		},
		{
			name: "get_scene_hierarchy",
			description: "获取当前场景的完整节点树结构（包括 UUID、名称和层级关系）",
			inputSchema: { type: "object", properties: {} },
		},
		{
			name: "update_node_transform",
			description: "修改节点的坐标、缩放或颜色",
			inputSchema: {
				type: "object",
				properties: {
					id: { type: "string", description: "节点 UUID" },
					x: { type: "number" },
					y: { type: "number" },
					scaleX: { type: "number" },
					scaleY: { type: "number" },
					color: { type: "string", description: "HEX 颜色代码如 #FF0000" },
				},
				required: ["id"],
			},
		},
		{
			name: "create_scene",
			description: "在 assets 目录下创建一个新的场景文件",
			inputSchema: {
				type: "object",
				properties: {
					sceneName: { type: "string", description: "场景名称" },
				},
				required: ["sceneName"],
			},
		},
		{
			name: "create_prefab",
			description: "将场景中的某个节点保存为预制体资源",
			inputSchema: {
				type: "object",
				properties: {
					nodeId: { type: "string", description: "节点 UUID" },
					prefabName: { type: "string", description: "预制体名称" },
				},
				required: ["nodeId", "prefabName"],
			},
		},
		{
			name: "open_scene",
			description: "打开场景文件。注意：这是一个异步且耗时的操作，打开后请等待几秒再进行节点创建或保存操作。",
			inputSchema: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description: "场景资源路径，如 db://assets/NewScene.fire",
					},
				},
				required: ["url"],
			},
		},
		{
			name: "create_node",
			description: "在当前场景中创建一个新节点",
			inputSchema: {
				type: "object",
				properties: {
					name: { type: "string", description: "节点名称" },
					parentId: {
						type: "string",
						description: "父节点 UUID (可选，不传则挂在场景根部)",
					},
					type: {
						type: "string",
						enum: ["empty", "sprite", "label"],
						description: "节点预设类型",
					},
				},
				required: ["name"],
			},
		},
		{
			name: "manage_components",
			description: "管理节点组件",
			inputSchema: {
				type: "object",
				properties: {
					nodeId: { type: "string", description: "节点 UUID" },
					action: { type: "string", enum: ["add", "remove", "get"], description: "操作类型" },
					componentType: { type: "string", description: "组件类型，如 cc.Sprite" },
					componentId: { type: "string", description: "组件 ID (用于 remove 操作)" },
					properties: { type: "object", description: "组件属性 (用于 add 操作)" },
				},
				required: ["nodeId", "action"],
			},
		},
		{
			name: "manage_script",
			description: "管理脚本文件",
			inputSchema: {
				type: "object",
				properties: {
					action: { type: "string", enum: ["create", "delete", "read", "write"], description: "操作类型" },
					path: { type: "string", description: "脚本路径，如 db://assets/scripts/NewScript.js" },
					content: { type: "string", description: "脚本内容 (用于 create 和 write 操作)" },
					name: { type: "string", description: "脚本名称 (用于 create 操作)" },
				},
				required: ["action", "path"],
			},
		},
		{
			name: "batch_execute",
			description: "批处理执行多个操作",
			inputSchema: {
				type: "object",
				properties: {
					operations: {
						type: "array",
						items: {
							type: "object",
							properties: {
								tool: { type: "string", description: "工具名称" },
								params: { type: "object", description: "工具参数" },
							},
							required: ["tool", "params"],
						},
						description: "操作列表",
					},
				},
				required: ["operations"],
			},
		},
		{
			name: "manage_asset",
			description: "管理资源",
			inputSchema: {
				type: "object",
				properties: {
					action: { type: "string", enum: ["create", "delete", "move", "get_info"], description: "操作类型" },
					path: { type: "string", description: "资源路径，如 db://assets/textures" },
					targetPath: { type: "string", description: "目标路径 (用于 move 操作)" },
					content: { type: "string", description: "资源内容 (用于 create 操作)" },
				},
				required: ["action", "path"],
			},
		},
	];
};
let isSceneBusy = false;

module.exports = {
	"scene-script": "scene-script.js",
	load() {
		addLog("info", "MCP Bridge Plugin Loaded");
		// 读取配置
		let profile = this.getProfile();
		serverConfig.port = profile.get("last-port") || 3456;
		let autoStart = profile.get("auto-start");

		if (autoStart) {
			addLog("info", "Auto-start is enabled. Initializing server...");
			// 延迟一点启动，确保编辑器环境完全就绪
			setTimeout(() => {
				this.startServer(serverConfig.port);
			}, 1000);
		}
	},
	// 获取配置文件的辅助函数
	getProfile() {
		// 'local' 表示存储在项目本地（local/mcp-bridge.json）
		return Editor.Profile.load("profile://local/mcp-bridge.json", "mcp-bridge");
	},

	unload() {
		this.stopServer();
	},
	startServer(port) {
		if (mcpServer) this.stopServer();

		try {
			mcpServer = http.createServer((req, res) => {
				res.setHeader("Content-Type", "application/json");
				res.setHeader("Access-Control-Allow-Origin", "*");

				let body = "";
				req.on("data", (chunk) => {
					body += chunk;
				});
				req.on("end", () => {
					const url = req.url;
					if (url === "/list-tools") {
						const tools = getToolsList();
						addLog("info", `AI Client requested tool list`);
						// 明确返回成功结构
						res.writeHead(200);
						return res.end(JSON.stringify({ tools: tools }));
					}
					if (url === "/call-tool") {
						try {
							const { name, arguments: args } = JSON.parse(body || "{}");
							addLog("mcp", `REQ -> [${name}]`);

							this.handleMcpCall(name, args, (err, result) => {
								const response = {
									content: [
										{
											type: "text",
											text: err
												? `Error: ${err}`
												: typeof result === "object"
													? JSON.stringify(result, null, 2)
													: result,
										},
									],
								};
								addLog(err ? "error" : "success", `RES <- [${name}]`);
								res.writeHead(200);
								res.end(JSON.stringify(response));
							});
						} catch (e) {
							addLog("error", `JSON Parse Error: ${e.message}`);
							res.writeHead(400);
							res.end(JSON.stringify({ error: "Invalid JSON" }));
						}
						return;
					}

					// --- 兜底处理 (404) ---
					res.writeHead(404);
					res.end(JSON.stringify({ error: "Not Found", url: url }));
				});
			});

			mcpServer.on("error", (e) => {
				addLog("error", `Server Error: ${e.message}`);
			});
			mcpServer.listen(port, () => {
				serverConfig.active = true;
				addLog("success", `MCP Server running at http://127.0.0.1:${port}`);
				Editor.Ipc.sendToPanel("mcp-bridge", "mcp-bridge:state-changed", serverConfig);
			});
			// 启动成功后顺便存一下端口
			this.getProfile().set("last-port", port);
			this.getProfile().save();
		} catch (e) {
			addLog("error", `Failed to start server: ${e.message}`);
		}
	},

	stopServer() {
		if (mcpServer) {
			mcpServer.close();
			mcpServer = null;
			serverConfig.active = false;
			addLog("warn", "MCP Server stopped");
			Editor.Ipc.sendToPanel("mcp-bridge", "mcp-bridge:state-changed", serverConfig);
		}
	},

	// 统一处理逻辑，方便日志记录
	handleMcpCall(name, args, callback) {
		if (isSceneBusy && (name === "save_scene" || name === "create_node")) {
			return callback("Editor is busy (Processing Scene), please wait a moment.");
		}
		switch (name) {
			case "get_selected_node":
				const ids = Editor.Selection.curSelection("node");
				callback(null, ids);
				break;

			case "set_node_name":
				Editor.Scene.callSceneScript(
					"mcp-bridge",
					"set-property",
					{
						id: args.id,
						path: "name",
						value: args.newName,
					},
					callback,
				);
				break;

			case "save_scene":
				isSceneBusy = true;
				addLog("info", "Preparing to save scene... Waiting for UI sync.");
				// 强制延迟保存，防止死锁
				setTimeout(() => {
					Editor.Ipc.sendToMain("scene:save-scene");
					addLog("info", "Executing Safe Save...");
					setTimeout(() => {
						isSceneBusy = false;
						addLog("info", "Safe Save completed.");
						callback(null, "Scene saved successfully.");
					}, 1000);
				}, 500);
				break;

			case "get_scene_hierarchy":
				Editor.Scene.callSceneScript("mcp-bridge", "get-hierarchy", callback);
				break;

			case "update_node_transform":
				Editor.Scene.callSceneScript("mcp-bridge", "update-node-transform", args, callback);
				break;

			case "create_scene":
				const sceneUrl = `db://assets/${args.sceneName}.fire`;
				if (Editor.assetdb.exists(sceneUrl)) {
					return callback("Scene already exists");
				}
				Editor.assetdb.create(sceneUrl, getNewSceneTemplate(), (err) => {
					callback(err, err ? null : `Standard Scene created at ${sceneUrl}`);
				});
				break;

			case "create_prefab":
				const prefabUrl = `db://assets/${args.prefabName}.prefab`;
				Editor.Ipc.sendToMain("scene:create-prefab", args.nodeId, prefabUrl);
				callback(null, `Command sent: Creating prefab '${args.prefabName}'`);
				break;

			case "open_scene":
				isSceneBusy = true; // 锁定
				const openUuid = Editor.assetdb.urlToUuid(args.url);
				if (openUuid) {
					Editor.Ipc.sendToMain("scene:open-by-uuid", openUuid);
					setTimeout(() => {
						isSceneBusy = false;
						callback(null, `Success: Opening scene ${args.url}`);
					}, 2000);
				} else {
					isSceneBusy = false;
					callback(`Could not find asset with URL ${args.url}`);
				}
				break;

			case "create_node":
				Editor.Scene.callSceneScript("mcp-bridge", "create-node", args, callback);
				break;

			case "manage_components":
				Editor.Scene.callSceneScript("mcp-bridge", "manage-components", args, callback);
				break;

			case "manage_script":
				this.manageScript(args, callback);
				break;

			case "batch_execute":
				this.batchExecute(args, callback);
				break;

			case "manage_asset":
				this.manageAsset(args, callback);
				break;

			default:
				callback(`Unknown tool: ${name}`);
				break;
		}
	},

	// 管理脚本文件
	manageScript(args, callback) {
		const { action, path, content } = args;

		switch (action) {
			case "create":
				if (Editor.assetdb.exists(path)) {
					return callback(`Script already exists at ${path}`);
				}
				// 确保父目录存在
				const fs = require('fs');
				const pathModule = require('path');
				const absolutePath = Editor.assetdb.urlToFspath(path);
				const dirPath = pathModule.dirname(absolutePath);
				if (!fs.existsSync(dirPath)) {
					fs.mkdirSync(dirPath, { recursive: true });
				}
				Editor.assetdb.create(path, content || `const { ccclass, property } = cc._decorator;

@ccclass
export default class NewScript extends cc.Component {
    @property(cc.Label)
    label: cc.Label = null;

    @property
    text: string = 'hello';

    // LIFE-CYCLE CALLBACKS:

    onLoad () {}

    start () {}

    update (dt) {}
}`, (err) => {
					callback(err, err ? null : `Script created at ${path}`);
				});
				break;

			case "delete":
				if (!Editor.assetdb.exists(path)) {
					return callback(`Script not found at ${path}`);
				}
				Editor.assetdb.delete([path], (err) => {
					callback(err, err ? null : `Script deleted at ${path}`);
				});
				break;

			case "read":
				Editor.assetdb.queryInfoByUuid(Editor.assetdb.urlToUuid(path), (err, info) => {
					if (err) {
						return callback(`Failed to get script info: ${err}`);
					}
					Editor.assetdb.loadAny(path, (err, content) => {
						callback(err, err ? null : content);
					});
				});
				break;

			case "write":
				Editor.assetdb.create(path, content, (err) => {
					callback(err, err ? null : `Script updated at ${path}`);
				});
				break;

			default:
				callback(`Unknown script action: ${action}`);
				break;
		}
	},

	// 批处理执行
	batchExecute(args, callback) {
		const { operations } = args;
		const results = [];
		let completed = 0;

		if (!operations || operations.length === 0) {
			return callback("No operations provided");
		}

		operations.forEach((operation, index) => {
			this.handleMcpCall(operation.tool, operation.params, (err, result) => {
				results[index] = { tool: operation.tool, error: err, result: result };
				completed++;

				if (completed === operations.length) {
					callback(null, results);
				}
			});
		});
	},

	// 管理资源
	manageAsset(args, callback) {
		const { action, path, targetPath, content } = args;

		switch (action) {
			case "create":
				if (Editor.assetdb.exists(path)) {
					return callback(`Asset already exists at ${path}`);
				}
				// 确保父目录存在
				const fs = require('fs');
				const pathModule = require('path');
				const absolutePath = Editor.assetdb.urlToFspath(path);
				const dirPath = pathModule.dirname(absolutePath);
				if (!fs.existsSync(dirPath)) {
					fs.mkdirSync(dirPath, { recursive: true });
				}
				Editor.assetdb.create(path, content || '', (err) => {
					callback(err, err ? null : `Asset created at ${path}`);
				});
				break;

			case "delete":
				if (!Editor.assetdb.exists(path)) {
					return callback(`Asset not found at ${path}`);
				}
				Editor.assetdb.delete([path], (err) => {
					callback(err, err ? null : `Asset deleted at ${path}`);
				});
				break;

			case "move":
				if (!Editor.assetdb.exists(path)) {
					return callback(`Asset not found at ${path}`);
				}
				if (Editor.assetdb.exists(targetPath)) {
					return callback(`Target asset already exists at ${targetPath}`);
				}
				Editor.assetdb.move(path, targetPath, (err) => {
					callback(err, err ? null : `Asset moved from ${path} to ${targetPath}`);
				});
				break;

			case "get_info":
				Editor.assetdb.queryInfoByUuid(Editor.assetdb.urlToUuid(path), (err, info) => {
					callback(err, err ? null : info);
				});
				break;

			default:
				callback(`Unknown asset action: ${action}`);
				break;
		}
	},
	// 暴露给 MCP 或面板的 API 封装
	messages: {
		"open-test-panel"() {
			Editor.Panel.open("mcp-bridge");
		},
		"get-server-state"(event) {
			event.reply(null, { config: serverConfig, logs: logBuffer });
		},
		"toggle-server"(event, port) {
			if (serverConfig.active) this.stopServer();
			else this.startServer(port);
		},
		"clear-logs"() {
			logBuffer = [];
			addLog("info", "Logs cleared");
		},

		// 修改场景中的节点（需要通过 scene-script）
		"set-node-property"(event, args) {
			addLog("mcp", `Creating node: ${args.name} (${args.type})`);
			// 确保第一个参数 'mcp-bridge' 和 package.json 的 name 一致
			Editor.Scene.callSceneScript("mcp-bridge", "set-property", args, (err, result) => {
				if (err) {
					Editor.error("Scene Script Error:", err);
				}
				if (event && event.reply) {
					event.reply(err, result);
				}
			});
		},
		"create-node"(event, args) {
			addLog("mcp", `Creating node: ${args.name} (${args.type})`);
			Editor.Scene.callSceneScript("mcp-bridge", "create-node", args, (err, result) => {
				if (err) addLog("error", `CreateNode Failed: ${err}`);
				else addLog("success", `Node Created: ${result}`);
				event.reply(err, result);
			});
		},
		"get-server-state"(event) {
			let profile = this.getProfile();
			event.reply(null, {
				config: serverConfig,
				logs: logBuffer,
				autoStart: profile.get("auto-start"), // 返回自动启动状态
			});
		},

		"set-auto-start"(event, value) {
			this.getProfile().set("auto-start", value);
			this.getProfile().save();
			addLog("info", `Auto-start set to: ${value}`);
		},
	},
};
