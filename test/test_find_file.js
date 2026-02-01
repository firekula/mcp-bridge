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

async function run() {
    console.log("Testing find_in_file...");

    try {
        // 1. Check tools
        const tools = await request('POST', '/list-tools');
        const findTool = tools.tools.find(t => t.name === 'find_in_file');
        if (!findTool) {
            console.error("FAILED: find_in_file tool not found in list.");
            return;
        }
        console.log("PASS: find_in_file exists in tool list.");

        // 2. Create a temp file to search for
        const tempFilePath = "db://assets/test_find_me.txt";
        const uniqueString = "UniqueStringToFind_" + Date.now();
        console.log(`Creating temp file with content "${uniqueString}"...`);

        await callTool('manage_asset', {
            action: 'create',
            path: tempFilePath,
            content: `This is a test file.\nIt contains ${uniqueString} here.`
        });

        // Wait a bit for assetdb to refresh
        await new Promise(r => setTimeout(r, 2000));

        // 3. Call find_in_file
        console.log(`Searching for "${uniqueString}"...`);

        const results = await callTool('find_in_file', { query: uniqueString });

        if (!Array.isArray(results)) {
            console.error("FAILED: Result is not an array:", results);
            // Cleanup
            await callTool('manage_asset', { action: 'delete', path: tempFilePath });
            return;
        }

        console.log(`Found ${results.length} matches.`);
        const match = results.find(r => r.content.includes(uniqueString));

        if (match) {
            console.log("PASS: Found match in created file.");
            console.log("Match Details:", match);
        } else {
            console.error("FAILED: Did not find match. Results:", results);
        }

        // 4. Cleanup
        await callTool('manage_asset', { action: 'delete', path: tempFilePath });

    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
