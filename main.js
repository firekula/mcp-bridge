"use strict";

const http = require("http");

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
		const http = require("http");

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
						];
						res.end(JSON.stringify({ tools }));
					} else if (req.url === "/call-tool" && req.method === "POST") {
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
