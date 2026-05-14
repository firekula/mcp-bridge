/**
 * MCP 桥接代理脚本
 * 负责在标准 MCP 客户端 (stdin/stdout) 与 Cocos Creator 插件 (HTTP) 之间转发请求。
 */

import * as http from "http";

/**
 * 当前 Cocos Creator 插件监听的端口
 * 支持通过环境变量 MCP_BRIDGE_PORT 或命令行参数指定端口
 * @type {number}
 */
const COCOS_PORT = parseInt(process.env.MCP_BRIDGE_PORT || process.argv[2] || "3456", 10);
let globalActivePort: number | null = null;
const START_PORT = 3456;
const END_PORT = 3466;

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

/**
 * 发送调试日志到标准的错误输出流水
 * @param {string} msg 日志消息
 */
function debugLog(msg: string) {
    process.stderr.write(`[代理调试] ${msg}\n`);
}

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
 * @param {Object} req RPC 请求对象
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

    // 获取工具列表
    if (method === "tools/list") {
        scanActiveInstances().then(instances => {
            const dynamicTools = [
                {
                    name: "get_active_instances",
                    description: "Scan local ports (3456-3466) to find all running Cocos Creator instances and return their project paths and connection ports.",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "set_active_instance",
                    description: "Manually bind the MCP client to a specific Cocos Creator instance's port. Call this before using other tools when multiple instances are running.",
                    inputSchema: { type: "object", properties: { port: { description: "The port number of the target instance to connect to.", type: "number" } }, required: ["port"] }
                }
            ];

            const targetPort = globalActivePort || (instances.length > 0 ? instances[0].port : COCOS_PORT);
            
            if (instances.length > 0 || globalActivePort) {
                // 向目标引擎层请求内部工具组并拼接我们注入的联机管理工具
                forwardToCocos("/list-tools", null, id, "GET", targetPort, (cocosRes) => {
                    if (cocosRes && cocosRes.tools) {
                        cocosRes.tools = cocosRes.tools.concat(dynamicTools);
                    } else if (cocosRes && !cocosRes.tools) {
                        cocosRes.tools = dynamicTools;
                    }
                    sendToAI({ jsonrpc: "2.0", id: id, result: cocosRes });
                });
            } else {
                // 如果毫无存活项目，只返回我们拥有的两个排查管理工具
                sendToAI({ jsonrpc: "2.0", id: id, result: { tools: dynamicTools } });
            }
        });
        return;
    }

    // 执行具体工具
    if (method === "tools/call") {
        if (params.name === "get_active_instances") {
            scanActiveInstances().then(list => {
                sendToAI({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] }});
            });
            return;
        }
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

        scanActiveInstances().then(onlineEngines => {
            // 防错离断机制触发：如果要执行常规节点操作，必须有唯一绑定或者自动兜底 1 个情况！
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

/**
 * 将请求通过 HTTP 转发给 Cocos Creator 插件
 * @param {string} path API 路径
 * @param {Object|null} payload 发送的数据体
 * @param {string|number} id RPC 请求标识符
 * @param {string} method HTTP 方法 (默认 POST)
 */
function forwardToCocos(path: string, payload: any, id: string | number | undefined, method = "POST", overridePort?: number, onSuccess?: (res: any) => void) {
    const postData = payload ? JSON.stringify(payload) : "";
    const targetPort = overridePort || COCOS_PORT;

    const options: http.RequestOptions = {
        hostname: "127.0.0.1",
        port: targetPort,
        path: path,
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

                // 检查关键字段，确保 Cocos 插件返回了期望的数据格式
                if (path === "/list-tools" && !cocosRes.tools) {
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

/**
 * 将结果发送给 AI (通过标准输出)
 * @param {Object} obj 结果对象
 */
function sendToAI(obj: any) {
    process.stdout.write(JSON.stringify(obj) + "\n");
}

/**
 * 发送 RPC 错误响应
 * @param {string|number} id RPC 请求标识符
 * @param {number} code 错误码
 * @param {string} message 错误消息
 */
function sendError(id: string | number | undefined, code: number, message: string) {
    sendToAI({ jsonrpc: "2.0", id: id, error: { code, message } });
}
