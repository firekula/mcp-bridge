"use strict";

const http = require("http");
const path = require("path");

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
		// 插件加载时启动一个微型服务器供 MCP 使用 (默认端口 3000)
		this.startMcpServer();
	},

	unload() {
		if (this.server) this.server.close();
	},

	// 暴露给 MCP 或面板的 API 封装
	messages: {
		"open-test-panel"() {
			Editor.Panel.open("mcp-bridge");
		},

		// 获取当前选中节点信息
		"get-selected-info"(event) {
			let selection = Editor.Selection.curSelection("node");
			if (event) event.reply(null, selection);
			return selection;
		},

		// 修改场景中的节点（需要通过 scene-script）
		"set-node-property"(event, args) {
			Editor.log("Calling scene script with:", args); // 打印日志确认 main 进程收到了面板的消息

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
	},

	// 简易 MCP 桥接服务器
	startMcpServer() {
		this.server = http.createServer((req, res) => {
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
						// 2. 执行工具逻辑
						const { name, arguments: args } = JSON.parse(body);

						if (name === "get_selected_node") {
							let ids = Editor.Selection.curSelection("node");
							res.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(ids) }] }));
						} else if (name === "set_node_name") {
							Editor.Scene.callSceneScript(
								"mcp-bridge",
								"set-property",
								{
									id: args.id,
									path: "name",
									value: args.newName,
								},
								(err, result) => {
									res.end(
										JSON.stringify({
											content: [
												{ type: "text", text: err ? `Error: ${err}` : `Success: ${result}` },
											],
										}),
									);
								},
							);
						} else if (name === "save_scene") {
							// 触发编辑器保存指令
							Editor.Ipc.sendToMain("scene:save-scene");
							res.end(JSON.stringify({ content: [{ type: "text", text: "Scene saved successfully" }] }));
						} else if (name === "get_scene_hierarchy") {
							Editor.Scene.callSceneScript("mcp-bridge", "get-hierarchy", (err, hierarchy) => {
								if (err) {
									res.end(
										JSON.stringify({
											content: [
												{ type: "text", text: "Error fetching hierarchy: " + err.message },
											],
										}),
									);
								} else {
									res.end(
										JSON.stringify({
											content: [{ type: "text", text: JSON.stringify(hierarchy, null, 2) }],
										}),
									);
								}
							});
						} else if (name === "update_node_transform") {
							Editor.Scene.callSceneScript("mcp-bridge", "update-node-transform", args, (err, result) => {
								res.end(
									JSON.stringify({
										content: [{ type: "text", text: err ? `Error: ${err}` : result }],
									}),
								);
							});
						} else if (name === "create_scene") {
							const url = `db://assets/${args.sceneName}.fire`;
							if (Editor.assetdb.exists(url)) {
								return res.end(
									JSON.stringify({
										content: [{ type: "text", text: "Error: Scene already exists" }],
									}),
								);
							}

							// 生成标准场景内容
							const sceneJson = getNewSceneTemplate();

							Editor.assetdb.create(url, sceneJson, (err, results) => {
								if (err) {
									res.end(
										JSON.stringify({
											content: [{ type: "text", text: "Error creating scene: " + err }],
										}),
									);
								} else {
									res.end(
										JSON.stringify({
											content: [{ type: "text", text: `Standard Scene created at ${url}` }],
										}),
									);
								}
							});
						} else if (name === "create_prefab") {
							const url = `db://assets/${args.prefabName}.prefab`;
							// 2.4.x 创建预制体的 IPC 消息
							Editor.Ipc.sendToMain("scene:create-prefab", args.nodeId, url);
							res.end(
								JSON.stringify({
									content: [
										{ type: "text", text: `Command sent: Creating prefab '${args.prefabName}'` },
									],
								}),
							);
						} else if (name === "open_scene") {
							const url = args.url;
							// 1. 将 db:// 路径转换为 UUID
							const uuid = Editor.assetdb.urlToUuid(url);

							if (uuid) {
								// 2. 发送核心 IPC 消息给主进程
								// scene:open-by-uuid 是编辑器内置的场景打开逻辑
								Editor.Ipc.sendToMain("scene:open-by-uuid", uuid);

								res.end(
									JSON.stringify({
										content: [
											{ type: "text", text: `Success: Opening scene ${url} (UUID: ${uuid})` },
										],
									}),
								);
							} else {
								res.end(
									JSON.stringify({
										content: [
											{ type: "text", text: `Error: Could not find asset with URL ${url}` },
										],
									}),
								);
							}
						} else if (name === "create_node") {
							// 转发给场景脚本处理
							Editor.Scene.callSceneScript("mcp-bridge", "create-node", args, (err, result) => {
								res.end(
									JSON.stringify({
										content: [
											{ type: "text", text: err ? `Error: ${err}` : `Node created: ${result}` },
										],
									}),
								);
							});
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

		this.server.listen(3456);
		Editor.log("MCP Server standard interface listening on http://localhost:3456");
	},
};
