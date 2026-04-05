
import * as fs from 'fs';
import * as path from 'path';

const bridgeCommand = 'node';
const bridgeArgs = [path.resolve(__dirname, 'mcp-proxy.js').replace(/\\/g, '/')];
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

const getUserProfilePath = () => process.env.USERPROFILE || process.env.HOME || '';

const targetPaths = [
    { name: 'Claude Code', file: path.join(getUserProfilePath(), '.claude.json') },
    { name: 'Antigravity', file: path.join(getUserProfilePath(), '.gemini', 'antigravity', 'mcp_config.json') },
    { name: 'Trae', file: path.join(getUserProfilePath(), '.trae', 'mcp.json') },
    { name: 'Trae CN', file: path.join(getUserProfilePath(), '.trae-cn', 'mcp.json') }
];

export function scanMcpClients(): any[] {
    return targetPaths.map((t, id) => {
        if (!t.file) {
            return { id, name: t.name, path: '', isInstalled: false, isConfigured: false, isError: false };
        }
        
        const targetDir = path.dirname(t.file);
        const isInstalled = fs.existsSync(targetDir);
        let isConfigured = false;
        let isError = false;

        if (isInstalled && fs.existsSync(t.file)) {
            try {
                const raw = fs.readFileSync(t.file, 'utf-8');
                const data = JSON.parse(raw);
                if (data.mcpServers && data.mcpServers['mcp-bridge']) {
                    const cfg = data.mcpServers['mcp-bridge'];
                    if (cfg.command && cfg.command.includes('node') && cfg.args && cfg.args[0] && (cfg.args[0].includes('index.js') || cfg.args[0].includes('mcp-proxy.js'))) {
                        isConfigured = true;
                    }
                }
            } catch(e) {
                isError = true;
            }
        }
        return { id, name: t.name, path: t.file, isInstalled, isConfigured, isError };
    });
}

export function getPayload(): string {
    const payload = {
        "mcpServers": {
            "mcp-bridge": {
                "command": bridgeCommand,
                "args": bridgeArgs
            }
        }
    };
    return JSON.stringify(payload, null, 2);
}

export function injectMcpConfig(clientId: number): string {
    let log = '';
    let successCount = 0;
    
    let targets = targetPaths.map((t, i) => Object.assign({}, t, { id: i }));
    if (typeof clientId === 'number' && clientId >= 0) {
        targets = targets.filter(t => t.id === clientId);
    }

    for (const target of targets) {
        if (!target.file) continue;

        const targetDir = path.dirname(target.file);
        if (!fs.existsSync(targetDir)) {
            continue;
        }

        let mcpData: any = { mcpServers: {} };
        if (fs.existsSync(target.file)) {
            try {
                const raw = fs.readFileSync(target.file, 'utf-8');
                mcpData = JSON.parse(raw);
                if (!mcpData.mcpServers) {
                    mcpData.mcpServers = {};
                }
            } catch (e: any) {
                log += `⚠️ [${target.name}] 文件损坏，放弃写入: ${e.message}\n`;
                continue;
            }
        }

        mcpData.mcpServers['mcp-bridge'] = {
            command: bridgeCommand,
            args: bridgeArgs
        };

        try {
            fs.writeFileSync(target.file, JSON.stringify(mcpData, null, 2), 'utf-8');
            log += `✅ [${target.name}] 成功注入配置。\n`;
            successCount++;
        } catch (e: any) {
            log += `❌ [${target.name}] 写入失败: ${e.message}\n`;
        }
    }

    if (successCount === 0 && log === '') {
        return "未能发现所选的常见 AI 客户端全局配置文件，无法写入。";
    }

    return log;
}
