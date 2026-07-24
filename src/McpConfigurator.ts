import * as fs from 'fs';
import * as path from 'path';

const bridgeCommand = 'node';
const bridgeArgs = [path.resolve(__dirname, 'mcp-proxy.js').replace(/\\/g, '/')];
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

const getAppdataPath = () => process.env.APPDATA || (isWin ? process.env.USERPROFILE + '\\AppData\\Roaming' : '');
const getMacAppSupportPath = () => process.env.HOME + '/Library/Application Support';
const getUserProfilePath = () => process.env.USERPROFILE || process.env.HOME || '';
const getAppDataDir = () => isWin ? getAppdataPath() : getMacAppSupportPath();

/**
 * AI 客户端配置目标定义接口
 */
export interface TargetClient {
    /** 客户端显示名称 */
    name: string;
    /** 配置文件绝对路径 */
    file: string;
    /** 配置文件格式类型，支持 json 和 toml，默认为 json */
    format?: 'json' | 'toml';
    /** MCP 服务器配置根键名，默认为 mcpServers */
    mcpKey?: string;
}

/**
 * 支持的常见 AI 客户端配置文件路径与元数据定义列表
 */
export const targetPaths: TargetClient[] = [
    { name: 'Antigravity', file: path.join(getUserProfilePath(), '.gemini', 'config', 'mcp_config.json') },
    { name: 'Cherry Studio', file: path.join(getAppDataDir(), 'cherry-studio', 'mcp.json') },
    { name: 'Claude Code', file: path.join(getUserProfilePath(), '.claude.json') },
    { name: 'Claude Desktop', file: path.join(getAppDataDir(), 'Claude', 'claude_desktop_config.json') },
    { name: 'Cline', file: path.join(getAppDataDir(), 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json') },
    { name: 'CodeBuddy CLI', file: path.join(getUserProfilePath(), '.codebuddy', 'mcp.json') },
    { name: 'CodeWhale', file: path.join(getUserProfilePath(), '.codewhale', 'mcp.json') },
    { name: 'Deepseek-TUI', file: path.join(getUserProfilePath(), '.deepseek', 'mcp.json') },
    { name: 'Codex', file: path.join(getUserProfilePath(), '.codex', 'config.toml'), format: 'toml' },
    { name: 'Cursor', file: path.join(getUserProfilePath(), '.cursor', 'mcp.json') },
    { name: 'Gemini CLI', file: path.join(getUserProfilePath(), '.gemini', 'mcp.json') },
    { name: 'GitHub Copilot CLI', file: path.join(getUserProfilePath(), '.config', 'github-copilot', 'mcp.json') },
    { name: 'Kilo Code', file: path.join(getUserProfilePath(), '.kilo', 'mcp.json') },
    { name: 'Kiro', file: path.join(getUserProfilePath(), '.kiro', 'mcp.json') },
    { name: 'OpenCode', file: path.join(getUserProfilePath(), '.opencode', 'mcp.json') },
    { name: 'Qwen Code', file: path.join(getUserProfilePath(), '.qwen', 'mcp.json') },
    { name: 'Rider GitHub Copilot', file: path.join(getAppDataDir(), 'JetBrains', 'Rider', 'github-copilot', 'mcp.json') },
    { name: 'Roo Code', file: path.join(getAppDataDir(), 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json') },
    { name: 'Trae', file: path.join(getUserProfilePath(), '.trae', 'mcp.json') },
    { name: 'Trae CN', file: path.join(getUserProfilePath(), '.trae-cn', 'mcp.json') },
    { name: 'VSCode GitHub Copilot', file: path.join(getAppDataDir(), 'Code', 'User', 'globalStorage', 'github.copilot', 'mcp.json') },
    { name: 'VSCode Insiders GitHub Copilot', file: path.join(getAppDataDir(), 'Code - Insiders', 'User', 'globalStorage', 'github.copilot', 'mcp.json') },
    { name: 'Windsurf', file: path.join(getUserProfilePath(), '.codeium', 'windsurf', 'mcp_config.json') },
    { 
        name: 'Zed', 
        file: isWin 
            ? path.join(getAppdataPath(), 'Zed', 'settings.json') 
            : path.join(getUserProfilePath(), '.config', 'zed', 'settings.json'),
        format: 'json',
        mcpKey: 'context_servers'
    }
];

/**
 * 备份目标配置文件，生成同名 .bak 文件兜底
 * @param targetFile 目标文件绝对路径
 * @param clientName AI 客户端名称
 * @returns 备份文件的绝对路径，若无需备份或失败返回 null
 */
function backupConfigFile(targetFile: string, clientName: string): string | null {
    if (!fs.existsSync(targetFile)) {
        return null;
    }
    const backupPath = `${targetFile}.bak`;
    try {
        fs.copyFileSync(targetFile, backupPath);
        return backupPath;
    } catch (e: any) {
        console.error(`[McpConfigurator] 备份配置文件失败 (${clientName}): ${e.message}`);
        return null;
    }
}

/**
 * 向 TOML 格式（如 Codex 的 config.toml）安全增量注入 mcp-bridge 配置
 * @param content 现有的 TOML 字符串
 * @param command 启动命令 (如 node)
 * @param args 命令参数数组
 * @returns 更新后的 TOML 字符串
 */
export function processTomlInjection(content: string, command: string, args: string[]): string {
    const formattedArgs = JSON.stringify(args);
    const tomlSection = `[mcp_servers.mcp-bridge]\ncommand = "${command.replace(/\\/g, '\\\\')}"\nargs = ${formattedArgs}\n`;

    const sectionHeaderRegex = /\[mcp_servers\.mcp-bridge\][\s\S]*?(?=\n\[|\n$|$)/;
    if (sectionHeaderRegex.test(content)) {
        // 若已存在 [mcp_servers.mcp-bridge] 段落，精准替换
        return content.replace(sectionHeaderRegex, tomlSection.trim());
    } else {
        // 若不存在，追加在文件结尾
        const prefix = content.length > 0 && !content.endsWith('\n') ? '\n\n' : (content.length > 0 ? '\n' : '');
        return content + prefix + tomlSection;
    }
}

/**
 * 扫描系统中已知 AI 客户端的配置文件存在状态及 MCP 注入配置状态
 * @returns 客户端配置检测结果列表
 */
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
                if (t.format === 'toml') {
                    if (raw.includes('[mcp_servers.mcp-bridge]') && raw.includes('mcp-proxy.js')) {
                        isConfigured = true;
                    }
                } else {
                    const data = JSON.parse(raw);
                    const rootKey = t.mcpKey || 'mcpServers';
                    if (data[rootKey] && data[rootKey]['mcp-bridge']) {
                        const cfg = data[rootKey]['mcp-bridge'];
                        if (cfg.command && cfg.command.includes('node') && cfg.args && cfg.args[0] && (cfg.args[0].includes('index.js') || cfg.args[0].includes('mcp-proxy.js'))) {
                            isConfigured = true;
                        }
                    }
                }
            } catch(e) {
                isError = true;
            }
        }
        return { id, name: t.name, path: t.file, isInstalled, isConfigured, isError };
    });
}

/**
 * 获取默认的标准 JSON MCP 配置 Payload
 * @returns JSON 配置字符串
 */
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

/**
 * 注入 MCP Bridge 配置至指定的 AI 客户端配置文件中
 * 支持自动创建目录、.bak 备份兜底以及 JSON/TOML 格式的安全增量合并
 * @param clientId 客户端索引 ID（可选，不传时注入全部可注入的目标）
 * @returns 操作日志信息
 */
export function injectMcpConfig(clientId?: number): string {
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
            try {
                fs.mkdirSync(targetDir, { recursive: true });
            } catch (e: any) {
                log += `❌ [${target.name}] 创建目录失败: ${e.message}\n`;
                continue;
            }
        }

        // 步骤1：如果目标配置文件已存在，先进行自动备份兜底
        const backupFile = backupConfigFile(target.file, target.name);
        if (backupFile) {
            log += `📦 [${target.name}] 已安全备份原始配置至 ${path.basename(backupFile)}\n`;
        }

        // 步骤2：根据格式进行安全增量合并
        if (target.format === 'toml') {
            let existingContent = '';
            if (fs.existsSync(target.file)) {
                existingContent = fs.readFileSync(target.file, 'utf-8');
            }
            const updatedToml = processTomlInjection(existingContent, bridgeCommand, bridgeArgs);
            try {
                fs.writeFileSync(target.file, updatedToml, 'utf-8');
                log += `✅ [${target.name}] 成功注入 TOML 配置。\n`;
                successCount++;
            } catch (e: any) {
                log += `❌ [${target.name}] 写入失败: ${e.message}\n`;
            }
        } else {
            // 默认 JSON 格式
            let mcpData: any = {};
            const rootKey = target.mcpKey || 'mcpServers';

            if (fs.existsSync(target.file)) {
                try {
                    const raw = fs.readFileSync(target.file, 'utf-8');
                    mcpData = JSON.parse(raw);
                } catch (e: any) {
                    log += `⚠️ [${target.name}] 原始 JSON 损坏，放弃写入: ${e.message}\n`;
                    continue;
                }
            }

            if (!mcpData[rootKey] || typeof mcpData[rootKey] !== 'object') {
                mcpData[rootKey] = {};
            }

            mcpData[rootKey]['mcp-bridge'] = {
                command: bridgeCommand,
                args: bridgeArgs
            };

            try {
                fs.writeFileSync(target.file, JSON.stringify(mcpData, null, 2), 'utf-8');
                log += `✅ [${target.name}] 成功注入 JSON 配置。\n`;
                successCount++;
            } catch (e: any) {
                log += `❌ [${target.name}] 写入失败: ${e.message}\n`;
            }
        }
    }

    if (successCount === 0 && log === '') {
        return "未能发现所选的常见 AI 客户端全局配置文件，无法写入。";
    }

    return log;
}
