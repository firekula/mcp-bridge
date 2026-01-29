"use strict";

const http = require("http");
const path = require("path");

let logBuffer = []; // 存储所有日志
let mcpServer = null;
let serverConfig = {
	port: 3456,
	active: false,
};

// 封装日志函数，同时发送给面板和编辑器控制台
function addLog(type, message) {
	const logEntry = {
		time: new Date().toLocaleTimeString(),
		type: type,
		content: message,
	};
	logBuffer.push(logEntry);
	Editor.Ipc.sendToPanel("mcp-bridge", "mcp-bridge:on-log", logEntry);
	// 【修改】移除 Editor.log，保持编辑器控制台干净
	// 仅在非常严重的系统错误时才输出到编辑器
	if (type === "error") {
		Editor.error(`[MCP] ${message}`); // 如果你完全不想在编辑器看，可以注释掉
	}
}

const getNewSceneTemplate = () => {
	// 尝试获取 UUID 生成函数
	let newId = "";
	if (Editor.Utils && Editor.Utils.uuid) {
		newId = Editor.Utils.uuid();
	} else if (Editor.Utils && Editor.Utils.UuidUtils && Editor.Utils.UuidUtils.uuid) {
		newId = Editor.Utils.UuidUtils.uuid();
	} else {
		// 兜底方案：如果找不到编辑器 API，生成一个随机字符串
		newId = Math.random().toString(36).substring(2, 15);
	}

	const sceneData = [
		{
			__type__: "cc.SceneAsset",
			_name: "",
			_objFlags: 0,
			_native: "",
			scene: { __id__: 1 },
		},
		{
			__id__: 1,
			__type__: "cc.Scene",
			_name: "",
			_objFlags: 0,
			_parent: null,
			_children: [],
			_active: true,
			_level: 0,
			_components: [],
			autoReleaseAssets: false,
			_id: newId,
		},
	];
	return JSON.stringify(sceneData);
};

module.exports = {
	"scene-script": "scene-script.js",
	load() {
		addLog("info", "MCP Bridge Plugin Loaded");
		// 读取配置
		let profile = this.getProfile();
		serverConfig.port = profile.get("last-port") || 3456;
		let autoStart = profile.get("auto-start");

		if (autoStart) {
			addLog("info", "Auto-start is enabled. Initializing server...");
			// 延迟一点启动，确保编辑器环境完全就绪
			setTimeout(() => {
				this.startServer(serverConfig.port);
			}, 1000);
		}
	},
	// 获取配置文件的辅助函数
	getProfile() {
		// 'local' 表示存储在项目本地（local/mcp-bridge.json）
		return Editor.Profile.load("profile://local/mcp-bridge.json", "mcp-bridge");
	},

	unload() {
		this.stopServer();
	},
	startServer(port) {
		if (mcpServer) this.stopServer();

		try {
			mcpServer = http.createServer((req, res) => {
				// 设置 CORS 方便调试
				res.setHeader("Access-Control-Allow-Origin", "*");
				res.setHeader("Access-Control-Allow-Headers", "Content-Type");
				res.setHeader("Content-Type", "application/json");

				if (req.method === "OPTIONS") {
					res.end();
					return;
				}

				let body = "";
				req.on("data", (chunk) => {
					body += chunk;
				});
				req.on("end", () => {
					try {
						// 简单的路由处理
						if (req.url === "/list-tools" && req.method === "GET") {
							// 1. 返回工具定义 (符合 MCP 规范)
							const tools = [
								{
									name: "get_selected_node",
									description: "获取当前编辑器中选中的节点 ID",
									inputSchema: { type: "object", properties: {} },
								},
								{
									name: "set_node_name",
									description: "修改指定节点的名称",
									inputSchema: {
										type: "object",
										properties: {
											id: { type: "string", description: "节点的 UUID" },
											newName: { type: "string", description: "新的节点名称" },
										},
										required: ["id", "newName"],
									},
								},
								{
									name: "save_scene",
									description: "保存当前场景的修改",
									inputSchema: { type: "object", properties: {} },
								},
								{
									name: "get_scene_hierarchy",
									description: "获取当前场景的完整节点树结构（包括 UUID、名称和层级关系）",
									inputSchema: { type: "object", properties: {} },
								},
								{
									name: "update_node_transform",
									description: "修改节点的坐标、缩放或颜色",
									inputSchema: {
										type: "object",
										properties: {
											id: { type: "string", description: "节点 UUID" },
											x: { type: "number" },
											y: { type: "number" },
											scaleX: { type: "number" },
											scaleY: { type: "number" },
											color: { type: "string", description: "HEX 颜色代码如 #FF0000" },
										},
										required: ["id"],
									},
								},
								{
									name: "create_scene",
									description: "在 assets 目录下创建一个新的场景文件",
									inputSchema: {
										type: "object",
										properties: {
											sceneName: { type: "string", description: "场景名称" },
										},
										required: ["sceneName"],
									},
								},
								{
									name: "create_prefab",
									description: "将场景中的某个节点保存为预制体资源",
									inputSchema: {
										type: "object",
										properties: {
											nodeId: { type: "string", description: "节点 UUID" },
											prefabName: { type: "string", description: "预制体名称" },
										},
										required: ["nodeId", "prefabName"],
									},
								},
								{
									name: "open_scene",
									description: "在编辑器中打开指定的场景文件",
									inputSchema: {
										type: "object",
										properties: {
											url: {
												type: "string",
												description: "场景资源路径，如 db://assets/NewScene.fire",
											},
										},
										required: ["url"],
									},
								},
								{
									name: "create_node",
									description: "在当前场景中创建一个新节点",
									inputSchema: {
										type: "object",
										properties: {
											name: { type: "string", description: "节点名称" },
											parentId: {
												type: "string",
												description: "父节点 UUID (可选，不传则挂在场景根部)",
											},
											type: {
												type: "string",
												enum: ["empty", "sprite", "label"],
												description: "节点预设类型",
											},
										},
										required: ["name"],
									},
								},
							];
							return res.end(JSON.stringify({ tools }));
						}
						if (req.url === "/call-tool" && req.method === "POST") {
							try {
								const { name, arguments: args } = JSON.parse(body);

								addLog("mcp", `REQ -> [${name}] ${JSON.stringify(args)}`);

								this.handleMcpCall(name, args, (err, result) => {
									// 3. 构建 MCP 标准响应格式
									const response = {
										content: [
											{
												type: "text",
												text: err
													? `Error: ${err}`
													: typeof result === "object"
														? JSON.stringify(result, null, 2)
														: result,
											},
										],
									};

									// 4. 记录返回日志
									if (err) {
										addLog("error", `RES <- [${name}] Failed: ${err}`);
									} else {
										// 日志里只显示简短的返回值，防止长 JSON（如 hierarchy）刷屏
										const logRes = typeof result === "object" ? "[Object Data]" : result;
										addLog("success", `RES <- [${name}] Success: ${logRes}`);
									}
									res.end(JSON.stringify(response));
								});
							} catch (e) {
								addLog("error", `Parse Error: ${e.message}`);
								res.end(JSON.stringify({ content: [{ type: "text", text: `Error: ${e.message}` }] }));
							}
						} else {
							res.statusCode = 404;
							res.end(JSON.stringify({ error: "Not Found" }));
						}
					} catch (e) {
						res.statusCode = 500;
						res.end(JSON.stringify({ error: e.message }));
					}
				});
			});

			mcpServer.listen(port, () => {
				serverConfig.active = true;
				addLog("success", `Server started on port ${port}`);
				Editor.Ipc.sendToPanel("mcp-bridge", "mcp-bridge:state-changed", serverConfig);
			});

			mcpServer.on("error", (err) => {
				addLog("error", `Server Error: ${err.message}`);
				this.stopServer();
			});
			// 启动成功后顺便存一下端口
			this.getProfile().set("last-port", port);
			this.getProfile().save();
		} catch (e) {
			addLog("error", `Failed to start server: ${e.message}`);
		}
	},

	stopServer() {
		if (mcpServer) {
			mcpServer.close();
			mcpServer = null;
			serverConfig.active = false;
			addLog("warn", "MCP Server stopped");
			Editor.Ipc.sendToPanel("mcp-bridge", "mcp-bridge:state-changed", serverConfig);
		}
	},

	// 统一处理逻辑，方便日志记录
	handleMcpCall(name, args, callback) {
		switch (name) {
			case "get_selected_node":
				const ids = Editor.Selection.curSelection("node");
				callback(null, ids);
				break;

			case "set_node_name":
				Editor.Scene.callSceneScript(
					"mcp-bridge",
					"set-property",
					{
						id: args.id,
						path: "name",
						value: args.newName,
					},
					callback,
				);
				break;

			case "save_scene":
				Editor.Ipc.sendToMain("scene:save-scene");
				callback(null, "Scene saved successfully");
				break;

			case "get_scene_hierarchy":
				Editor.Scene.callSceneScript("mcp-bridge", "get-hierarchy", callback);
				break;

			case "update_node_transform":
				Editor.Scene.callSceneScript("mcp-bridge", "update-node-transform", args, callback);
				break;

			case "create_scene":
				const sceneUrl = `db://assets/${args.sceneName}.fire`;
				if (Editor.assetdb.exists(sceneUrl)) {
					return callback("Scene already exists");
				}
				Editor.assetdb.create(sceneUrl, getNewSceneTemplate(), (err) => {
					callback(err, err ? null : `Standard Scene created at ${sceneUrl}`);
				});
				break;

			case "create_prefab":
				const prefabUrl = `db://assets/${args.prefabName}.prefab`;
				Editor.Ipc.sendToMain("scene:create-prefab", args.nodeId, prefabUrl);
				callback(null, `Command sent: Creating prefab '${args.prefabName}'`);
				break;

			case "open_scene":
				const openUuid = Editor.assetdb.urlToUuid(args.url);
				if (openUuid) {
					Editor.Ipc.sendToMain("scene:open-by-uuid", openUuid);
					callback(null, `Success: Opening scene ${args.url}`);
				} else {
					callback(`Could not find asset with URL ${args.url}`);
				}
				break;

			case "create_node":
				Editor.Scene.callSceneScript("mcp-bridge", "create-node", args, callback);
				break;

			default:
				callback(`Unknown tool: ${name}`);
				break;
		}
	},
	// 暴露给 MCP 或面板的 API 封装
	messages: {
		"open-test-panel"() {
			Editor.Panel.open("mcp-bridge");
		},
		"get-server-state"(event) {
			event.reply(null, { config: serverConfig, logs: logBuffer });
		},
		"toggle-server"(event, port) {
			if (serverConfig.active) this.stopServer();
			else this.startServer(port);
		},
		"clear-logs"() {
			logBuffer = [];
			addLog("info", "Logs cleared");
		},

		// 修改场景中的节点（需要通过 scene-script）
		"set-node-property"(event, args) {
			addLog("mcp", `Creating node: ${args.name} (${args.type})`);
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
			addLog("mcp", `Creating node: ${args.name} (${args.type})`);
			Editor.Scene.callSceneScript("mcp-bridge", "create-node", args, (err, result) => {
				if (err) addLog("error", `CreateNode Failed: ${err}`);
				else addLog("success", `Node Created: ${result}`);
				event.reply(err, result);
			});
		},
		"get-server-state"(event) {
			let profile = this.getProfile();
			event.reply(null, {
				config: serverConfig,
				logs: logBuffer,
				autoStart: profile.get("auto-start"), // 返回自动启动状态
			});
		},

		"set-auto-start"(event, value) {
			this.getProfile().set("auto-start", value);
			this.getProfile().save();
			addLog("info", `Auto-start set to: ${value}`);
		},
	},
};
