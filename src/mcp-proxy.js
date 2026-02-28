/**
 * MCP 桥接代理脚本
 * 负责在标准 MCP 客户端 (stdin/stdout) 与 Cocos Creator 插件 (HTTP) 之间转发请求。
 */

const http = require("http");

/**
 * 当前 Cocos Creator 插件监听的端口
 * 支持通过环境变量 MCP_BRIDGE_PORT 或命令行参数指定端口
 * @type {number}
 */
const COCOS_PORT = parseInt(process.env.MCP_BRIDGE_PORT || process.argv[2] || "3456", 10);

/**
 * 发送调试日志到标准的错误输出流水
 * @param {string} msg 日志消息
 */
function debugLog(msg) {
    process.stderr.write(`[代理调试] ${msg}\n`);
}

// 监听标准输入以获取 MCP 请求
process.stdin.on("data", (data) => {
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
function handleRequest(req) {
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
        forwardToCocos("/list-tools", null, id, "GET");
        return;
    }

    // 执行具体工具
    if (method === "tools/call") {
        forwardToCocos(
            "/call-tool",
            {
                name: params.name,
                arguments: params.arguments,
            },
            id,
            "POST",
        );
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
function forwardToCocos(path, payload, id, method = "POST") {
    const postData = payload ? JSON.stringify(payload) : "";

    const options = {
        hostname: "127.0.0.1",
        port: COCOS_PORT,
        path: path,
        method: method,
        headers: { "Content-Type": "application/json" },
    };

    if (postData) {
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
                    sendToAI({ jsonrpc: "2.0", id: id, result: cocosRes });
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
function sendToAI(obj) {
    process.stdout.write(JSON.stringify(obj) + "\n");
}

/**
 * 发送 RPC 错误响应
 * @param {string|number} id RPC 请求标识符
 * @param {number} code 错误码
 * @param {string} message 错误消息
 */
function sendError(id, code, message) {
    sendToAI({ jsonrpc: "2.0", id: id, error: { code, message } });
}
