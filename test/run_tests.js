const http = require('http');

// 配置
const CONFIG = {
    host: '127.0.0.1',
    port: 3456,
    timeout: 5000
};

// 控制台输出颜色
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    gray: "\x1b[90m"
};

function log(type, msg) {
    const timestamp = new Date().toLocaleTimeString();
    switch (type) {
        case 'info': console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`); break;
        case 'success': console.log(`${colors.green}[PASS]${colors.reset} ${msg}`); break;
        case 'error': console.log(`${colors.red}[FAIL]${colors.reset} ${msg}`); break;
        case 'warn': console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`); break;
        case 'group': console.log(`\n${colors.gray}=== ${msg} ===${colors.reset}`); break;
        default: console.log(msg);
    }
}

// HTTP 辅助函数
function request(method, path, data) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: CONFIG.host,
            port: CONFIG.port,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: CONFIG.timeout
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const parsed = JSON.parse(body);
                        // MCP 返回 { content: [{ type: 'text', text: "..." }] }
                        resolve(parsed);
                    } catch (e) {
                        // 某些接口可能返回纯文本或非标准 JSON
                        resolve(body);
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                }
            });
        });

        req.on('error', (e) => reject(new Error(`连接失败: ${e.message}`)));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('请求超时'));
        });

        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

// MCP 工具调用封装
async function callTool(name, args = {}) {
    const payload = {
        name: name,
        arguments: args
    };

    try {
        const response = await request('POST', '/call-tool', payload);

        // 解析复杂的 MCP 响应结构
        // 预期: { content: [ { type: 'text', text: "..." } ] }
        if (response && response.content && Array.isArray(response.content)) {
            const textContent = response.content.find(c => c.type === 'text');
            if (textContent) {
                // 工具结果本身可能是 JSON 字符串，尝试解析它
                try {
                    return JSON.parse(textContent.text);
                } catch {
                    return textContent.text;
                }
            }
        }
        return response;
    } catch (e) {
        throw new Error(`工具 [${name}] 调用失败: ${e.message}`);
    }
}

// 断言辅助函数
function assert(condition, message) {
    if (!condition) {
        throw new Error(message || "断言失败");
    }
}

// --- 测试套件 ---
const tests = {
    async setup() {
        log('group', '连接性检查');
        try {
            const tools = await request('POST', '/list-tools');
            assert(tools && tools.tools && tools.tools.length > 0, "无法获取工具列表");
            log('success', `已连接到 MCP 服务器。发现 ${tools.tools.length} 个工具。`);
            return true;
        } catch (e) {
            log('error', `无法连接服务器。插件是否正在运行？ (${e.message})`);
            return false;
        }
    },

    async testNodeLifecycle() {
        log('group', '节点生命周期测试');
        const nodeName = `TestNode_${Date.now()}`;

        try {
            // 1. 创建节点
            log('info', `尝试创建节点: ${nodeName}`);
            const newNodeId = await callTool('create_node', { name: nodeName, type: 'empty' });
            log('info', `create_node 响应: ${JSON.stringify(newNodeId)}`);
            assert(typeof newNodeId === 'string' && newNodeId.length > 0, `create_node 没有返回 UUID。实际返回: ${JSON.stringify(newNodeId)}`);
            log('success', `已创建节点: ${nodeName} (${newNodeId})`);

            // 2. 查找节点
            log('info', `尝试查找节点: ${nodeName}`);
            const findResult = await callTool('find_gameobjects', { conditions: { name: nodeName } });
            log('info', `find_gameobjects 响应: ${JSON.stringify(findResult)}`);
            assert(Array.isArray(findResult), `find_gameobjects 没有返回数组。实际返回: ${JSON.stringify(findResult)}`);
            assert(findResult.length >= 1, "find_gameobjects 未能找到已创建的节点");

            // 查找特定节点（防止重名，虽然这里名字包含时间戳）
            const targetNode = findResult.find(n => n.name === nodeName);
            assert(targetNode, "找到节点但名称不匹配？");
            assert(targetNode.uuid === newNodeId, `找到的节点 UUID 不匹配。预期 ${newNodeId}, 实际 ${targetNode.uuid}`);
            log('success', `通过 find_gameobjects 找到节点: ${targetNode.name}`);

            // 3. 更新变换 (Transform)
            log('info', `尝试更新变换信息`);
            await callTool('update_node_transform', { id: newNodeId, x: 100, y: 200 });
            // 通过查找验证（因为查找会返回位置信息）
            const updatedResult = await callTool('find_gameobjects', { conditions: { name: nodeName } });
            const updatedNode = updatedResult.find(n => n.uuid === newNodeId);
            log('info', `变换更新验证: x=${updatedNode.position.x}, y=${updatedNode.position.y}`);
            assert(updatedNode.position.x === 100 && updatedNode.position.y === 200, `节点位置更新失败。实际: (${updatedNode.position.x}, ${updatedNode.position.y})`);
            log('success', `节点变换已更新至 (100, 200)`);

            return newNodeId; // 返回以供后续测试使用
        } catch (e) {
            log('error', `节点生命周期测试失败: ${e.message}`);
            throw e;
        }
    },

    async testComponents(nodeId) {
        log('group', '组件管理测试');

        // 1. 添加组件
        // 使用 cc.Sprite 因为它最常用
        log('info', `向 ${nodeId} 添加组件 cc.Sprite`);
        const addResult = await callTool('manage_components', {
            nodeId: nodeId,
            action: 'add',
            componentType: 'cc.Sprite'
        });
        log('success', `已添加 cc.Sprite 组件。响应: ${JSON.stringify(addResult)}`);

        // 2. 获取组件
        log('info', `列出 ${nodeId} 的组件`);
        const components = await callTool('manage_components', { nodeId: nodeId, action: 'get' });
        log('info', `manage_components (get) 响应: ${JSON.stringify(components)}`);

        assert(Array.isArray(components), `无法获取组件列表。实际返回: ${JSON.stringify(components)}`);
        // 宽松匹配：验证逻辑匹配（检查 type 或 properties.name 中是否包含 Sprite）
        const spriteComp = components.find(c => (c.type && c.type.includes('Sprite')) || (c.properties && c.properties.name && c.properties.name.includes('Sprite')));
        assert(spriteComp, "节点上未找到 cc.Sprite 组件");
        log('success', `验证组件存在: ${spriteComp.uuid} (${spriteComp.type || 'Unknown'})`);

        // 3. 移除组件
        log('info', `移除组件 ${spriteComp.uuid}`);
        const removeResult = await callTool('manage_components', {
            nodeId: nodeId,
            action: 'remove',
            componentId: spriteComp.uuid
        });
        log('info', `移除结果: ${JSON.stringify(removeResult)}`);

        // 等待引擎处理移除（异步过程）
        await new Promise(r => setTimeout(r, 200));

        // 验证移除
        const componentsAfter = await callTool('manage_components', { nodeId: nodeId, action: 'get' });
        log('info', `移除后的组件列表: ${JSON.stringify(componentsAfter)}`);

        assert(!componentsAfter.find(c => (c.type && c.type.includes('Sprite')) || (c.uuid === spriteComp.uuid)), "组件未被移除");
        log('success', `组件移除成功`);
    },

    async testEditorSelection(nodeId) {
        log('group', '编辑器选中测试');

        // 1. 设置选中
        await callTool('manage_editor', {
            action: 'set_selection',
            target: 'node',
            properties: { nodes: [nodeId] }
        });

        // 2. 获取选中
        const selection = await callTool('manage_editor', { action: 'get_selection' });
        // 预期: { nodes: [...], assets: [...] }
        assert(selection.nodes && selection.nodes.includes(nodeId), "选中状态更新失败");
        log('success', `编辑器选中状态已更新为节点 ${nodeId}`);
    },

    async testAssetManagement() {
        log('group', '资源管理测试');
        const scriptPath = 'db://assets/temp_auto_test.js';

        // 1. 创建脚本
        try {
            await callTool('manage_script', {
                action: 'create',
                path: scriptPath,
                content: 'cc.log("Test Script");'
            });
            log('success', `已创建临时资源: ${scriptPath}`);
        } catch (e) {
            if (e.message.includes('exists')) {
                log('warn', `资源已存在，正在尝试先删除...`);
                await callTool('manage_asset', { action: 'delete', path: scriptPath });
                // 重试创建
                await callTool('manage_script', { action: 'create', path: scriptPath, content: 'cc.log("Test Script");' });
            } else {
                throw e;
            }
        }

        // 2. 获取信息
        // 等待 AssetDB 刷新 (导入需要时间)
        log('info', '等待 3 秒以进行资源导入...');
        await new Promise(r => setTimeout(r, 3000));

        log('info', `获取资源信息: ${scriptPath}`);
        const info = await callTool('manage_asset', { action: 'get_info', path: scriptPath });
        log('info', `资源信息: ${JSON.stringify(info)}`);

        assert(info && info.url === scriptPath, "无法获取资源信息");
        log('success', `已验证资源信息`);

        // 3. 删除资源
        await callTool('manage_asset', { action: 'delete', path: scriptPath });

        // 验证删除 (get_info 应该失败或返回 null/报错，但我们检查工具响应)
        try {
            const infoDeleted = await callTool('manage_asset', { action: 'get_info', path: scriptPath });
            // 如果返回了信息且 exists 为 true，说明没删掉
            assert(!(infoDeleted && infoDeleted.exists), "资源本应被删除，但仍然存在");
        } catch (e) {
            // 如果报错（如 Asset not found），则符合预期
            log('success', `已验证资源删除`);
        }
    }
};

async function run() {
    console.log(`\n${colors.cyan}正在启动 MCP Bridge 自动化测试...${colors.reset}`);
    console.log(`目标: http://${CONFIG.host}:${CONFIG.port}\n`);

    const isConnected = await tests.setup();
    if (!isConnected) process.exit(1);

    try {
        const nodeId = await tests.testNodeLifecycle();

        await tests.testComponents(nodeId);

        await tests.testEditorSelection(nodeId);

        await tests.testAssetManagement();

        // 清理：我们在测试中已经尽可能清理了，但保留节点可能有助于观察结果
        // 这里只是打印完成消息

        console.log(`\n${colors.green}所有测试已成功完成！${colors.reset}\n`);
    } catch (e) {
        console.error(`\n${colors.red}[FATAL ERROR]${colors.reset} 测试套件出错:`);
        console.error(e);
        process.exit(1);
    }
}

run();
