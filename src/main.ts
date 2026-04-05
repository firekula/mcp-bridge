import { HttpServer } from './core/HttpServer';
import { McpRouter } from './core/McpRouter';
import { Logger } from './core/Logger';
import { IpcManager } from './IpcManager';
declare const Editor: any;

export = {
    'scene-script': 'scene-script.js',
    openTestPanel() {
        Editor.Panel.open('mcp-bridge');
    },
    querySpriteFrameUuid(event, uuid) {
		const fs = require("fs");
		try {
			const url = Editor.assetdb.uuidToUrl(uuid);
			if (!url) {
				return event.reply && event.reply(null, null);
			}
			const fspath = Editor.assetdb.urlToFspath(url);
			if (!fspath) {
				return event.reply && event.reply(null, null);
			}
			const metaPath = fspath + ".meta";
			if (fs.existsSync(metaPath)) {
				const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
				if (meta && meta.subMetas) {
					const subKeys = Object.keys(meta.subMetas);
					for (let k of subKeys) {
						if (meta.subMetas[k].uuid) {
							return event.reply && event.reply(null, meta.subMetas[k].uuid);
						}
					}
				}
			}
			return event.reply && event.reply(null, null);
		} catch (e) {
			return event.reply && event.reply(null, null);
		}
	},
    getProfile() {
		// 'project' 表示存储在项目本地（settings/mcp-bridge.json），实现配置隔离
		return Editor.Profile.load("profile://project/mcp-bridge.json", "mcp-bridge");
	},
    load() {
        Logger.info('MCP Bridge Plugin Loaded');
        let profile = this.getProfile();
        HttpServer.config.port = profile.get('last-port') || 3456;
        let autoStart = profile.get('auto-start');

        if (autoStart) {
            Logger.info('Auto-start is enabled. Initializing server...');
            setTimeout(() => {
                this.startServer(HttpServer.config.port);
            }, 1000);
        }
    },
    unload() {
        this.stopServer();
    },
    startServer(port: number) {
        HttpServer.start(port, McpRouter.handleRequest);
    },
    stopServer() {
        HttpServer.stop();
    },
    messages: {
		"scan-ipc-messages"(event) {
			try {
				const msgs = IpcManager.getIpcMessages();
				if (event.reply) event.reply(null, msgs);
			} catch (e) {
				if (event.reply) event.reply(e.message);
			}
		},
		"test-ipc-message"(event, args) {
			const { name, params } = args;
			IpcManager.testIpcMessage(name, params).then((result) => {
				if (event.reply) event.reply(null, result);
			});
		},
		"open-test-panel"() {
			Editor.Panel.open("mcp-bridge");
		},

		"toggle-server"(event, port) {
			if (HttpServer.config.active) HttpServer.stop();
			else {
				// 用户手动启动时，保存偏好端口
				this.getProfile().set("last-port", port);
				this.getProfile().save();
				this.startServer(port);
			}
		},
		"clear-logs"() {
			Logger.clearLogs();
			Logger.info("日志已清理");
		},

		// 修改场景中的节点（需要通过 scene-script）
		"set-node-property"(event, args) {
			Logger.mcp(`设置节点属性: ${args.name} (${args.type})`);
			// 确保第一个参数 'mcp-bridge' 和 package.json 的 name 一致
			Editor.Scene.callSceneScript("mcp-bridge", "set-property", args, (err, result) => {
				if (err) {
					Editor.error("Scene Script Error:", err);
				}
				if (event && event.reply) {
					event.reply(err, result);
				}
			});
		},
		"create-node"(event, args) {
			Logger.mcp(`创建节点: ${args.name} (${args.type})`);
			Editor.Scene.callSceneScript("mcp-bridge", "create-node", args, (err, result) => {
				if (err) Logger.error(`创建节点失败: ${err}`);
				else Logger.success(`节点已创建: ${result}`);
				event.reply(err, result);
			});
		},
		"get-server-state"(event) {
			let profile = this.getProfile();
			event.reply(null, {
				config: HttpServer.config,
				logs: Logger.getLogs(),
				autoStart: profile.get("auto-start"), // 返回自动启动状态
			});
		},

		"set-auto-start"(event, value) {
			this.getProfile().set("auto-start", value);
			this.getProfile().save();
			Logger.info(`自动启动已设置为: ${value}`);
		},

		"inspect-apis"() {
			Logger.info("[API 检查器] 开始深度分析...");

			// 获取函数参数的辅助函数
			const getArgs = (func) => {
				try {
					const str = func.toString();
					const match = str.match(/function\s.*?\(([^)]*)\)/) || str.match(/.*?\(([^)]*)\)/);
					if (match) {
						return match[1]
							.split(",")
							.map((arg) => arg.trim())
							.filter((a) => a)
							.join(", ");
					}
					return `${func.length} args`;
				} catch (e) {
					return "?";
				}
			};

			// 检查对象的辅助函数
			const inspectObj = (name, obj) => {
				if (!obj) return { name, exists: false };
				const props = {};
				const proto = Object.getPrototypeOf(obj);

				// 组合自身属性和原型属性
				const allKeys = new Set([
					...Object.getOwnPropertyNames(obj),
					...Object.getOwnPropertyNames(proto || {}),
				]);

				allKeys.forEach((key) => {
					if (key.startsWith("_")) return; // 跳过私有属性
					try {
						const val = obj[key];
						if (typeof val === "function") {
							props[key] = `func(${getArgs(val)})`;
						} else {
							props[key] = typeof val;
						}
					} catch (e) {}
				});
				return { name, exists: true, props };
			};

			// 1. 检查标准对象
			const standardObjects = {
				"Editor.assetdb": Editor.assetdb,
				"Editor.Selection": Editor.Selection,
				"Editor.Ipc": Editor.Ipc,
				"Editor.Panel": Editor.Panel,
				"Editor.Scene": Editor.Scene,
				"Editor.Utils": Editor.Utils,
				"Editor.remote": Editor.remote,
			};

			const report = {};
			Object.keys(standardObjects).forEach((key) => {
				report[key] = inspectObj(key, standardObjects[key]);
			});

			// 2. 检查特定论坛提到的 API
			const forumChecklist = [
				"Editor.assetdb.queryInfoByUuid",
				"Editor.assetdb.assetInfoByUuid",
				"Editor.assetdb.move",
				"Editor.assetdb.createOrSave",
				"Editor.assetdb.delete",
				"Editor.assetdb.urlToUuid",
				"Editor.assetdb.uuidToUrl",
				"Editor.assetdb.fspathToUrl",
				"Editor.assetdb.urlToFspath",
				"Editor.remote.assetdb.uuidToUrl",
				"Editor.Selection.select",
				"Editor.Selection.clear",
				"Editor.Selection.curSelection",
				"Editor.Selection.curGlobalActivate",
			];

			const checklistResults = {};
			forumChecklist.forEach((path) => {
				const parts = path.split(".");
				let curr = global; // 在主进程中，Editor 是全局的
				let exists = true;
				for (const part of parts) {
					if (curr && curr[part]) {
						curr = curr[part];
					} else {
						exists = false;
						break;
					}
				}
				checklistResults[path] = exists
					? typeof curr === "function"
						? `Available(${getArgs(curr)})`
						: "Available"
					: "Missing";
			});

			Logger.info(`[API 检查器] 标准对象:\n${JSON.stringify(report, null, 2)}`);
			Logger.info(`[API 检查器] 论坛核查清单:\n${JSON.stringify(checklistResults, null, 2)}`);

			// 3. 检查内置包 IPC 消息
			const ipcReport = {};
			const builtinPackages = ["scene", "builder", "assets"]; // 核心内置包
			const fs = require("fs");

			builtinPackages.forEach((pkgName) => {
				try {
					const pkgPath = Editor.url(`packages://${pkgName}/package.json`);
					if (pkgPath && fs.existsSync(pkgPath)) {
						const pkgData = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
						if (pkgData.messages) {
							ipcReport[pkgName] = Object.keys(pkgData.messages);
						} else {
							ipcReport[pkgName] = "No messages defined";
						}
					} else {
						ipcReport[pkgName] = "Package path not found";
					}
				} catch (e) {
					ipcReport[pkgName] = `Error: ${e.message}`;
				}
			});

			Logger.info(`[API 检查器] 内置包 IPC 消息:\n${JSON.stringify(ipcReport, null, 2)}`);
		},

		"mcp-scan-clients"(event) {
			try {
				const { scanMcpClients } = require('./McpConfigurator');
				if (event.reply) event.reply(null, scanMcpClients());
			} catch (e) {
				if (event.reply) event.reply(new Error(e.message));
			}
		},

		"mcp-inject-client"(event, clientId) {
			try {
				const { injectMcpConfig } = require('./McpConfigurator');
				const log = injectMcpConfig(clientId === -1 ? undefined : clientId);
				if (event.reply) event.reply(null, log);
			} catch (e) {
				if (event.reply) event.reply(new Error("写入报错: " + e.message));
			}
		},

		"mcp-get-payload"(event) {
			try {
				const { getPayload } = require('./McpConfigurator');
				if (event.reply) event.reply(null, getPayload());
			} catch (e) {
				if (event.reply) event.reply(new Error(e.message));
			}
		}
	},

	/**
	 * 全局项目文件搜索 (支持正则表达式、文件名、目录名搜索)
	 * @param {Object} args 参数
	 * @param {Function} callback 完成回调
	 */
};
