const http = require('http');

const CONFIG = {
    host: '127.0.0.1',
    port: 3456, // Ideally read from profile or keep dynamic, but fixed for test
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
    console.log("Testing manage_vfx...");

    try {
        // 1. Create a Particle Node
        const nodeName = "VFX_Test_" + Date.now();
        console.log(`Creating particle node: ${nodeName}`);

        const createResult = await callTool('manage_vfx', {
            action: 'create',
            name: nodeName,
            properties: {
                duration: 5,
                emissionRate: 50,
                startColor: "#FF0000",
                endColor: "#0000FF"
            }
        });

        let nodeId = createResult;
        // Check if result is UUID string or object
        if (typeof createResult === 'object') {
            // Sometimes mcp-bridge returns object? No, scene-script returns uuid or error.
            // But checking just in case
            nodeId = createResult.uuid || createResult;
        }

        if (!nodeId || typeof nodeId !== 'string') {
            console.error("FAILED: Could not create VFX node.", createResult);
            return;
        }
        console.log(`VFX Node created: ${nodeId}`);

        await wait(1000);

        // 2. Perform Undo (Verify creation undo)
        // ... Optional, let's focus on Update first.

        // 3. Update Particle Properties
        console.log("Updating particle properties...");
        const updateResult = await callTool('manage_vfx', {
            action: 'update',
            nodeId: nodeId,
            properties: {
                emissionRate: 100,
                startSize: 50,
                speed: 200
            }
        });
        console.log("Update result:", updateResult);

        await wait(1000);

        // 4. Get Info to Verify
        console.log("Verifying properties...");
        const info = await callTool('manage_vfx', { action: 'get_info', nodeId: nodeId });

        if (!info) {
            console.error("FAILED: Could not get info.");
            return;
        }

        console.log("Particle Info:", JSON.stringify(info, null, 2));

        if (info.emissionRate === 100 && info.speed === 200) {
            console.log("PASS: Properties updated and verified.");
        } else {
            console.error("FAILED: Properties mismatch.");
        }

        // 5. Verify 'custom' property using manage_components
        // We need to ensure custom is true for properties to take effect visually
        console.log("Verifying 'custom' property...");
        const components = await callTool('manage_components', {
            nodeId: nodeId,
            action: 'get'
        });

        let particleComp = null;
        if (components && Array.isArray(components)) {
            particleComp = components.find(c => c.type === 'cc.ParticleSystem' || c.type === 'ParticleSystem');
        }

        if (particleComp && particleComp.properties) {
            if (particleComp.properties.custom === true) {
                console.log("PASS: ParticleSystem.custom is TRUE.");
            } else {
                console.error("FAILED: ParticleSystem.custom is FALSE or Undefined.", particleComp.properties.custom);
            }

            // Check texture/file if possible
            if (particleComp.properties.file || particleComp.properties.texture) {
                console.log("PASS: ParticleSystem has file/texture.");
            } else {
                console.warn("WARNING: ParticleSystem might not have a texture/file set.");
            }
        } else {
            console.error("FAILED: Could not retrieve component details.");
        }

        await wait(1000);

        // 6. Fetch Logs to debug texture loading
        console.log("Fetching recent Editor Logs...");
        const logs = await callTool('read_console', { limit: 20 });
        if (logs && Array.isArray(logs)) {
            logs.forEach(log => {
                const msg = log.message || JSON.stringify(log);
                const type = log.type || 'info';

                // Filter for our debug logs or errors
                if (typeof msg === 'string' && (msg.includes("[mcp-bridge]") || type === 'error' || type === 'warn')) {
                    console.log(`[Editor Log] [${type}] ${msg}`);
                }
            });
        }

    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
