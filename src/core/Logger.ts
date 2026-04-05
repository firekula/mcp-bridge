import * as fs from "fs";
import * as pathModule from "path";

export class Logger {
	private static logBuffer: any[] = [];
	private static _logFilePath: string | null = null;

	/**
	 * 获取日志文件路径
	 */
	private static getLogFilePath(): string | null {
		if (Logger._logFilePath) return Logger._logFilePath;
		try {
			if (!Editor || !Editor.assetdb) return null;
			const assetsPath = Editor.assetdb.urlToFspath("db://assets");
			if (assetsPath) {
				const projectRoot = pathModule.dirname(assetsPath);
				const settingsDir = pathModule.join(projectRoot, "settings");
				if (!fs.existsSync(settingsDir)) {
					fs.mkdirSync(settingsDir, { recursive: true });
				}
				Logger._logFilePath = pathModule.join(settingsDir, "mcp-bridge.log");
				// 日志轮转
				try {
					if (fs.existsSync(Logger._logFilePath)) {
						const stats = fs.statSync(Logger._logFilePath);
						if (stats.size > 2 * 1024 * 1024) {
							const backupPath = Logger._logFilePath + ".old";
							if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
							fs.renameSync(Logger._logFilePath, backupPath);
						}
					}
				} catch (e) {
					// 轮转失败不影响主流程
				}
				return Logger._logFilePath;
			}
		} catch (e) {
			// 静默失败
		}
		return null;
	}

	/**
	 * 记录日志并同步至面板和文件
	 */
	public static log(type: 'info' | 'success' | 'warn' | 'error' | 'mcp', message: string) {
		const logEntry = {
			time: new Date().toISOString().replace("T", " ").substring(0, 23),
			type: type,
			content: message,
		};
		Logger.logBuffer.push(logEntry);
		if (Logger.logBuffer.length > 2000) {
			Logger.logBuffer = Logger.logBuffer.slice(-1500);
		}

		if (Editor && Editor.Ipc) {
			try {
				Editor.Ipc.sendToPanel("mcp-bridge", "mcp-bridge:on-log", logEntry);
			} catch (_e) {
				// 面板未打开时忽略此错误
			}
		}

		if (type === "error" && Editor) {
			Editor.error(`[MCP] ${message}`);
		} else if (type === "warn" && Editor) {
			Editor.warn(`[MCP] ${message}`);
		}

		try {
			const logPath = Logger.getLogFilePath();
			if (logPath) {
				const line = `[${logEntry.time}] [${type}] ${message}\n`;
				fs.appendFileSync(logPath, line, "utf8");
			}
		} catch (e) {
			// 静默失败
		}
	}

	public static info(message: string) { Logger.log("info", message); }
	public static success(message: string) { Logger.log("success", message); }
	public static warn(message: string) { Logger.log("warn", message); }
	public static error(message: string) { Logger.log("error", message); }
	public static mcp(message: string) { Logger.log("mcp", message); }

	public static getLogContent(): string {
		return Logger.logBuffer.map(entry => `[${entry.time}] [${entry.type}] ${entry.content}`).join("\n");
	}

	public static getLogs(): any[] {
		return Logger.logBuffer;
	}

	public static clearLogs() {
		Logger.logBuffer = [];
		Logger.info("日志已清理");
	}
}
