const http = require('http');
const COCOS_PORT = 3456; 

function debugLog(msg) {
    process.stderr.write(`[Proxy Debug] ${msg}\n`);
}

process.stdin.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
        if (!line.trim()) return;
        try {
            const request = JSON.parse(line);
            handleRequest(request);
        } catch (e) {}
    });
});

function handleRequest(req) {
    const { method, id, params } = req;

    if (method === 'initialize') {
        sendToAI({
            jsonrpc: "2.0", id: id,
            result: {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "cocos-bridge", version: "1.0.0" }
            }
        });
        return;
    }

    if (method === 'tools/list') {
        // 使用 GET 获取列表
        forwardToCocos('/list-tools', null, id, 'GET');
        return;
    }

    if (method === 'tools/call') {
        // 使用 POST 执行工具
        forwardToCocos('/call-tool', {
            name: params.name,
            arguments: params.arguments
        }, id, 'POST');
        return;
    }

    if (id !== undefined) sendToAI({ jsonrpc: "2.0", id: id, result: {} });
}

function forwardToCocos(path, payload, id, method = 'POST') {
    const postData = payload ? JSON.stringify(payload) : '';
    
    const options = {
        hostname: '127.0.0.1',
        port: COCOS_PORT,
        path: path,
        method: method,
        headers: { 'Content-Type': 'application/json' }
    };

    if (postData) {
        options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const request = http.request(options, (res) => {
        let resData = '';
        res.on('data', d => resData += d);
        res.on('end', () => {
            try {
                const cocosRes = JSON.parse(resData);
                
                // 检查关键字段
                if (path === '/list-tools' && !cocosRes.tools) {
                    // 如果报错，把 Cocos 返回的所有内容打印到 Trae 的 stderr 日志里
                    debugLog(`CRITICAL: Cocos returned no tools. Received: ${resData}`);
                    sendError(id, -32603, "Invalid Cocos response: missing tools array");
                } else {
                    sendToAI({ jsonrpc: "2.0", id: id, result: cocosRes });
                }
            } catch (e) {
                debugLog(`JSON Parse Error. Cocos Sent: ${resData}`);
                sendError(id, -32603, "Cocos returned non-JSON data");
            }
        });
    });

    request.on('error', (e) => {
        debugLog(`Cocos is offline: ${e.message}`);
        sendError(id, -32000, "Cocos Plugin Offline");
    });

    if (postData) request.write(postData);
    request.end();
}

function sendToAI(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function sendError(id, code, message) {
    sendToAI({ jsonrpc: "2.0", id: id, error: { code, message } });
}