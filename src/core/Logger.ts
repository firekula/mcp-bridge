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
			if (typeof Editor === "undefined" || !Editor || !Editor.assetdb) return null;
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
	 * 格式化 Date 为本地时间 + 时区偏移量字符串
	 * @param date 目标 Date 对象，默认为当前时间
	 * @returns 格式如 "2026-07-24 10:59:07.123 +08:00"
	 */
	public static formatLocalTimeWithOffset(date: Date = new Date()): string {
		const pad = (num: number, len: number = 2) => String(num).padStart(len, "0");

		const year = date.getFullYear();
		const month = pad(date.getMonth() + 1);
		const day = pad(date.getDate());
		const hours = pad(date.getHours());
		const minutes = pad(date.getMinutes());
		const seconds = pad(date.getSeconds());
		const ms = pad(date.getMilliseconds(), 3);

		const offsetMinutes = date.getTimezoneOffset();
		const sign = offsetMinutes <= 0 ? "+" : "-";
		const absOffset = Math.abs(offsetMinutes);
		const offsetHours = pad(Math.floor(absOffset / 60));
		const offsetMins = pad(absOffset % 60);

		return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms} ${sign}${offsetHours}:${offsetMins}`;
	}

	/**
	 * 记录日志并同步至面板和文件
	 */
	public static log(type: 'info' | 'success' | 'warn' | 'error' | 'mcp', message: string) {
		const logEntry = {
			time: Logger.formatLocalTimeWithOffset(),
			type: type,
			content: message,
		};
		Logger.logBuffer.push(logEntry);
		if (Logger.logBuffer.length > 2000) {
			Logger.logBuffer = Logger.logBuffer.slice(-1500);
		}

		if (typeof Editor !== "undefined" && Editor && Editor.Ipc) {
			try {
				Editor.Ipc.sendToPanel("mcp-bridge", "mcp-bridge:on-log", logEntry);
			} catch (_e) {
				// 面板未打开时忽略此错误
			}
		}

		if (type === "error" && typeof Editor !== "undefined" && Editor) {
			Editor.error(`[MCP] ${message}`);
		} else if (type === "warn" && typeof Editor !== "undefined" && Editor) {
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
