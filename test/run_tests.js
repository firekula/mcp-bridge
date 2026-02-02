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

    async testScriptOperations() {
        log('group', '脚本读写与验证测试 (FS Mode)');
        const scriptPath = 'db://assets/auto_test_script.js';
        const initialContent = 'cc.log("Initial Content");';
        const updatedContent = 'cc.log("Updated Content");';

        // 1. 创建脚本
        try {
            log('info', `创建脚本: ${scriptPath}`);
            await callTool('manage_script', {
                action: 'create',
                path: scriptPath,
                content: initialContent
            });
            log('success', `脚本已创建`);
        } catch (e) {
            if (e.message.includes('exists')) {
                log('warn', `脚本已存在，尝试删除重建...`);
                await callTool('manage_asset', { action: 'delete', path: scriptPath });
                await callTool('manage_script', { action: 'create', path: scriptPath, content: initialContent });
            } else {
                throw e;
            }
        }

        // 等待资源导入
        await new Promise(r => setTimeout(r, 2000));

        // 2. 验证读取 (FS Read)
        log('info', `验证读取内容...`);
        const readContent = await callTool('manage_script', { action: 'read', path: scriptPath });
        // 注意：Content 可能会包含一些编辑器自动添加的 meta 信息或者换行，可以宽松匹配
        assert(readContent && readContent.includes("Initial Content"), `读取内容不匹配。实际: ${readContent}`);
        log('success', `脚本读取成功`);

        // 3. 验证写入 (FS Write + Refresh)
        log('info', `验证写入内容...`);
        await callTool('manage_script', { action: 'write', path: scriptPath, content: updatedContent });

        // 等待刷新
        await new Promise(r => setTimeout(r, 1000));

        const readUpdated = await callTool('manage_script', { action: 'read', path: scriptPath });
        assert(readUpdated && readUpdated.includes("Updated Content"), `写入后读取内容不匹配。实际: ${readUpdated}`);
        log('success', `脚本写入成功`);

        // 4. 验证脚本语法 (Validation)
        log('info', `验证脚本语法...`);
        const validation = await callTool('validate_script', { filePath: scriptPath });
        log('info', `验证结果: ${JSON.stringify(validation)}`);
        assert(validation && validation.valid === true, "脚本验证失败");
        log('success', `脚本语法验证通过`);

        // 5. 清理
        await callTool('manage_asset', { action: 'delete', path: scriptPath });
        log('success', `清理临时脚本`);
    },

    async testPrefabOperations(sourceNodeId) {
        log('group', '预制体管理测试 (UUID Mode)');
        const prefabPath = 'db://assets/AutoTestPrefab.prefab';

        // 确保清理旧的
        try {
            await callTool('manage_asset', { action: 'delete', path: prefabPath });
        } catch (e) { }

        // 1. 创建预制体
        log('info', `从节点 ${sourceNodeId} 创建预制体: ${prefabPath}`);
        await callTool('prefab_management', {
            action: 'create',
            path: prefabPath,
            nodeId: sourceNodeId
        });

        // 等待预制体生成和导入 (使用轮询机制)
        log('info', '等待预制体生成...');
        let prefabInfo = null;

        // 每 200ms 检查一次，最多尝试 30 次 (6秒)
        for (let i = 0; i < 30; i++) {
            try {
                prefabInfo = await callTool('prefab_management', { action: 'get_info', path: prefabPath });
                if (prefabInfo && prefabInfo.exists) {
                    break;
                }
            } catch (e) { }
            await new Promise(r => setTimeout(r, 200));
        }

        // 最终断言
        assert(prefabInfo && prefabInfo.exists, "预制体创建失败或未找到 (超时)");
        log('success', `预制体创建成功: ${prefabInfo.uuid}`);

        // 2. 实例化预制体 (使用 UUID 加载)
        log('info', `尝试实例化预制体 (UUID: ${prefabInfo.uuid})`);
        const result = await callTool('prefab_management', {
            action: 'instantiate',
            path: prefabPath
        });
        log('info', `实例化结果: ${JSON.stringify(result)}`);
        // 结果通常是一条成功消息字符串
        assert(result && result.toLowerCase().includes('success'), "实例化失败");
        log('success', `预制体实例化成功`);

        // 3. 清理预制体
        await callTool('manage_asset', { action: 'delete', path: prefabPath });
        log('success', `清理临时预制体`);
    },

    async testResources() {
        log('group', 'MCP Resource 协议测试');

        // 1. 列出资源
        log('info', '请求资源列表 (/list-resources)');
        const listRes = await request('POST', '/list-resources');
        log('info', `资源列表响应: ${JSON.stringify(listRes)}`);
        assert(listRes && listRes.resources && Array.isArray(listRes.resources), "资源列表格式错误");
        const hasHierarchy = listRes.resources.find(r => r.uri === 'cocos://hierarchy');
        assert(hasHierarchy, "未找到 cocos://hierarchy 资源");
        log('success', `成功获取资源列表 (包含 ${listRes.resources.length} 个资源)`);

        // 2. 读取资源: Hierarchy
        log('info', '读取资源: cocos://hierarchy');
        const hierarchyRes = await request('POST', '/read-resource', { uri: 'cocos://hierarchy' });
        assert(hierarchyRes && hierarchyRes.contents && hierarchyRes.contents.length > 0, "读取 Hierarchy 失败");
        const hierarchyContent = hierarchyRes.contents[0].text;
        assert(hierarchyContent && hierarchyContent.startsWith('['), "Hierarchy 内容应该是 JSON 数组");
        log('success', `成功读取场景层级数据`);

        // 3. 读取资源: Logs
        log('info', '读取资源: cocos://logs/latest');
        const logsRes = await request('POST', '/read-resource', { uri: 'cocos://logs/latest' });
        assert(logsRes && logsRes.contents && logsRes.contents.length > 0, "读取 Logs 失败");
        const logsContent = logsRes.contents[0].text;
        assert(typeof logsContent === 'string', "日志内容应该是字符串");
        log('success', `成功读取编辑器日志`);
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

        await tests.testEditorSelection(nodeId);

        await tests.testScriptOperations();

        await tests.testPrefabOperations(nodeId);

        await tests.testResources();

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
