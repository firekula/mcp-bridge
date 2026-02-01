const http = require('http');

const CONFIG = {
    host: '127.0.0.1',
    port: 3456,
    timeout: 5000
};

// HTTP Helper
function request(method, path, data) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: CONFIG.host,
            port: CONFIG.port,
            path: path,
            method: method,
            headers: { 'Content-Type': 'application/json' },
            timeout: CONFIG.timeout
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                }
            });
        });

        req.on('error', (e) => reject(new Error(`Connection failed: ${e.message}`)));
        req.end(data ? JSON.stringify(data) : undefined);
    });
}

async function callTool(name, args = {}) {
    const payload = { name: name, arguments: args };
    const response = await request('POST', '/call-tool', payload);
    if (response && response.content && Array.isArray(response.content)) {
        const textContent = response.content.find(c => c.type === 'text');
        if (textContent) {
            try { return JSON.parse(textContent.text); } catch { return textContent.text; }
        }
    }
    return response;
}

// Helper to wait
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function run() {
    console.log("Testing manage_undo...");

    try {
        // 1. Create a node
        const nodeName = "UndoTestNode_" + Date.now();
        console.log(`Creating node: ${nodeName}`);
        const nodeId = await callTool('create_node', { name: nodeName, type: 'empty' });

        if (!nodeId || typeof nodeId !== 'string') {
            console.error("FAILED: Could not create node.", nodeId);
            return;
        }
        console.log(`Node created: ${nodeId}`);

        // Wait to ensure creation is fully processed
        await wait(500);

        // 2. Modify node (Change Name)
        console.log("Modifying node name (Action to undo)...");
        const newName = "RenamedNode_" + Date.now();
        await callTool('set_node_name', { id: nodeId, newName: newName });

        await wait(2000);

        // Verify modification
        let nodes = await callTool('find_gameobjects', { conditions: { name: newName } });
        let node = nodes.find(n => n.uuid === nodeId);

        if (!node) {
            console.error(`FAILED: Node not found with new name ${newName}. Name update failed.`);
            // Try to read console logs to see why
            const logs = await callTool('read_console', { limit: 10, type: 'error' });
            console.log("Recent Error Logs:", JSON.stringify(logs, null, 2));
            return;
        }
        console.log(`Node renamed to ${node.name}.`);

        // 3. Perform UNDO
        console.log("Executing UNDO...");
        await callTool('manage_undo', { action: 'undo' });

        await wait(2000);

        // Verify UNDO
        nodes = await callTool('find_gameobjects', { conditions: { name: nodeName } });
        // The original name was in variable nodeName
        node = nodes.find(n => n.uuid === nodeId);

        if (node && node.name === nodeName) {
            console.log(`PASS: Undo successful. Node name returned to ${nodeName}.`);
        } else {
            console.error(`FAILED: Undo failed? Node name is ${node ? node.name : 'Unknown'}`);
        }

        // 4. Perform REDO
        console.log("Executing REDO...");
        await callTool('manage_undo', { action: 'redo' });

        await wait(2000);

        // Verify REDO
        nodes = await callTool('find_gameobjects', { conditions: { name: newName } });
        node = nodes.find(n => n.uuid === nodeId);

        if (node && node.name === newName) {
            console.log("PASS: Redo successful. Node name returned to " + newName + ".");
        } else {
            console.error(`FAILED: Redo failed? Node name is ${node ? node.name : 'Unknown'}`);
        }

        // Cleanup
        // await callTool('manage_undo', { action: 'begin_group', description: 'Delete Node' }); // Optional
        // Node deletion tool... wait, we don't have delete_node tool exposed yet? 
        // Ah, 'scene:delete-nodes' is internal.
        // We can use 'batch_execute' if we had a delete tool.
        // Checking available tools... we assume we can manually delete or leave it.
        // Actually, let's construct a delete call if possible via existing tools?
        // create_node, manage_components... 
        // Wait, DEVELOPMENT_PLAN says 'batch_execute' exists. 
        // But we don't have a direct 'delete_node' in getToolsList(). 
        // Oh, we missed implementing 'delete_node' in the previous phases? 
        // Let's check main.js getToolsList again.
        // ... It has 'create_node', 'manage_components', ... 'scene_management'...
        // 'scene_management' has 'delete'? -> "场景管理" -> create, delete (scene file), duplicate.
        // It seems we lack `delete_node`. 
        // Nevermind, letting the test node stay is fine for observation, or user can delete manually.

    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
