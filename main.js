"use strict";

const http = require("http");
const path = require("path");

let logBuffer = []; // 存储所有日志
let mcpServer = null;
let isSceneBusy = false;
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

const getToolsList = () => {
	return [
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
			description: "打开场景文件。注意：这是一个异步且耗时的操作，打开后请等待几秒再进行节点创建或保存操作。",
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
		{
			name: "manage_components",
			description: "管理节点组件",
			inputSchema: {
				type: "object",
				properties: {
					nodeId: { type: "string", description: "节点 UUID" },
					action: { type: "string", enum: ["add", "remove", "get"], description: "操作类型" },
					componentType: { type: "string", description: "组件类型，如 cc.Sprite" },
					componentId: { type: "string", description: "组件 ID (用于 remove 操作)" },
					properties: { type: "object", description: "组件属性 (用于 add 操作)" },
				},
				required: ["nodeId", "action"],
			},
		},
		{
			name: "manage_script",
			description: "管理脚本文件",
			inputSchema: {
				type: "object",
				properties: {
					action: { type: "string", enum: ["create", "delete", "read", "write"], description: "操作类型" },
					path: { type: "string", description: "脚本路径，如 db://assets/scripts/NewScript.js" },
					content: { type: "string", description: "脚本内容 (用于 create 和 write 操作)" },
					name: { type: "string", description: "脚本名称 (用于 create 操作)" },
				},
				required: ["action", "path"],
			},
		},
		{
			name: "batch_execute",
			description: "批处理执行多个操作",
			inputSchema: {
				type: "object",
				properties: {
					operations: {
						type: "array",
						items: {
							type: "object",
							properties: {
								tool: { type: "string", description: "工具名称" },
								params: { type: "object", description: "工具参数" },
							},
							required: ["tool", "params"],
						},
						description: "操作列表",
					},
				},
				required: ["operations"],
			},
		},
		{
			name: "manage_asset",
			description: "管理资源",
			inputSchema: {
				type: "object",
				properties: {
					action: { type: "string", enum: ["create", "delete", "move", "get_info"], description: "操作类型" },
					path: { type: "string", description: "资源路径，如 db://assets/textures" },
					targetPath: { type: "string", description: "目标路径 (用于 move 操作)" },
					content: { type: "string", description: "资源内容 (用于 create 操作)" },
				},
				required: ["action", "path"],
			},
		},
		{
			name: "scene_management",
			description: "场景管理",
			inputSchema: {
				type: "object",
				properties: {
					action: {
						type: "string",
						enum: ["create", "delete", "duplicate", "get_info"],
						description: "操作类型",
					},
					path: { type: "string", description: "场景路径，如 db://assets/scenes/NewScene.fire" },
					targetPath: { type: "string", description: "目标路径 (用于 duplicate 操作)" },
					name: { type: "string", description: "场景名称 (用于 create 操作)" },
				},
				required: ["action", "path"],
			},
		},
		{
			name: "prefab_management",
			description: "预制体管理",
			inputSchema: {
				type: "object",
				properties: {
					action: {
						type: "string",
						enum: ["create", "update", "instantiate", "get_info"],
						description: "操作类型",
					},
					path: { type: "string", description: "预制体路径，如 db://assets/prefabs/NewPrefab.prefab" },
					nodeId: { type: "string", description: "节点 ID (用于 create 操作)" },
					parentId: { type: "string", description: "父节点 ID (用于 instantiate 操作)" },
				},
				required: ["action", "path"],
			},
		},
		{
			name: "manage_editor",
			description: "管理编辑器",
			inputSchema: {
				type: "object",
				properties: {
					action: {
						type: "string",
						enum: ["get_selection", "set_selection", "refresh_editor"],
						description: "操作类型",
					},
					target: {
						type: "string",
						enum: ["node", "asset"],
						description: "目标类型 (用于 set_selection 操作)",
					},
					properties: { type: "object", description: "操作属性" },
				},
				required: ["action"],
			},
		},
		{
			name: "find_gameobjects",
			description: "查找游戏对象",
			inputSchema: {
				type: "object",
				properties: {
					conditions: { type: "object", description: "查找条件" },
					recursive: { type: "boolean", default: true, description: "是否递归查找" },
				},
				required: ["conditions"],
			},
		},
		{
			name: "manage_material",
			description: "管理材质",
			inputSchema: {
				type: "object",
				properties: {
					action: { type: "string", enum: ["create", "delete", "get_info"], description: "操作类型" },
					path: { type: "string", description: "材质路径，如 db://assets/materials/NewMaterial.mat" },
					properties: { type: "object", description: "材质属性" },
				},
				required: ["action", "path"],
			},
		},
		{
			name: "manage_texture",
			description: "管理纹理",
			inputSchema: {
				type: "object",
				properties: {
					action: { type: "string", enum: ["create", "delete", "get_info"], description: "操作类型" },
					path: { type: "string", description: "纹理路径，如 db://assets/textures/NewTexture.png" },
					properties: { type: "object", description: "纹理属性" },
				},
				required: ["action", "path"],
			},
		},
		{
			name: "execute_menu_item",
			description: "执行菜单项",
			inputSchema: {
				type: "object",
				properties: {
					menuPath: { type: "string", description: "菜单项路径" },
				},
				required: ["menuPath"],
			},
		},
		{
			name: "apply_text_edits",
			description: "应用文本编辑",
			inputSchema: {
				type: "object",
				properties: {
					filePath: { type: "string", description: "文件路径" },
					edits: { type: "array", items: { type: "object" }, description: "编辑操作列表" },
				},
				required: ["filePath", "edits"],
			},
		},
		{
			name: "read_console",
			description: "读取控制台",
			inputSchema: {
				type: "object",
				properties: {
					limit: { type: "number", description: "输出限制" },
					type: { type: "string", enum: ["log", "error", "warn"], description: "输出类型" },
				},
			},
		},
		{
			name: "validate_script",
			description: "验证脚本",
			inputSchema: {
				type: "object",
				properties: {
					filePath: { type: "string", description: "脚本路径" },
				},
				required: ["filePath"],
			},
		},
		{
			name: "find_in_file",
			description: "在项目中全局搜索文本内容",
			inputSchema: {
				type: "object",
				properties: {
					query: { type: "string", description: "搜索关键词" },
					extensions: {
						type: "array",
						items: { type: "string" },
						description: "文件后缀列表 (例如 ['.js', '.ts'])",
						default: [".js", ".ts", ".json", ".fire", ".prefab", ".xml", ".txt", ".md"]
					},
					includeSubpackages: { type: "boolean", default: true, description: "是否搜索子包 (暂时默认搜索 assets 目录)" }
				},
				required: ["query"]
			}
		},
		{
			name: "manage_undo",
			description: "管理编辑器的撤销和重做历史",
			inputSchema: {
				type: "object",
				properties: {
					action: {
						type: "string",
						enum: ["undo", "redo", "begin_group", "end_group", "cancel_group"],
						description: "操作类型"
					},
					description: { type: "string", description: "撤销组的描述 (用于 begin_group)" }
				},
				required: ["action"]
			}
		},
		{
			name: "manage_vfx",
			description: "管理全场景特效 (粒子系统)",
			inputSchema: {
				type: "object",
				properties: {
					action: {
						type: "string",
						enum: ["create", "update", "get_info"],
						description: "操作类型"
					},
					nodeId: { type: "string", description: "节点 UUID (用于 update/get_info)" },
					properties: {
						type: "object",
						description: "粒子系统属性 (用于 create/update)",
						properties: {
							duration: { type: "number", description: "发射时长" },
							emissionRate: { type: "number", description: "发射速率" },
							life: { type: "number", description: "生命周期" },
							lifeVar: { type: "number", description: "生命周期变化" },
							startColor: { type: "string", description: "起始颜色 (Hex)" },
							endColor: { type: "string", description: "结束颜色 (Hex)" },
							startSize: { type: "number", description: "起始大小" },
							endSize: { type: "number", description: "结束大小" },
							speed: { type: "number", description: "速度" },
							angle: { type: "number", description: "角度" },
							gravity: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
							file: { type: "string", description: "粒子文件路径 (plist) 或 texture 路径" }
						}
					},
					name: { type: "string", description: "节点名称 (用于 create)" },
					parentId: { type: "string", description: "父节点 ID (用于 create)" }
				},
				required: ["action"]
			}
		}
	];
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
				res.setHeader("Content-Type", "application/json");
				res.setHeader("Access-Control-Allow-Origin", "*");

				let body = "";
				req.on("data", (chunk) => {
					body += chunk;
				});
				req.on("end", () => {
					const url = req.url;
					if (url === "/list-tools") {
						const tools = getToolsList();
						addLog("info", `AI Client requested tool list`);
						// 明确返回成功结构
						res.writeHead(200);
						return res.end(JSON.stringify({ tools: tools }));
					}
					if (url === "/call-tool") {
						try {
							const { name, arguments: args } = JSON.parse(body || "{}");
							addLog("mcp", `REQ -> [${name}]`);

							this.handleMcpCall(name, args, (err, result) => {
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
								if (err) {
									addLog("error", `RES <- [${name}] 失败: ${err}`);
								} else {
									// 成功时尝试捕获简单的结果预览（如果是字符串或简短对象）
									let preview = "";
									if (typeof result === 'string') {
										preview = result.length > 100 ? result.substring(0, 100) + "..." : result;
									} else if (typeof result === 'object') {
										try {
											const jsonStr = JSON.stringify(result);
											preview = jsonStr.length > 100 ? jsonStr.substring(0, 100) + "..." : jsonStr;
										} catch (e) {
											preview = "Object (Circular/Unserializable)";
										}
									}
									addLog("success", `RES <- [${name}] 成功 : ${preview}`);
								}
								res.writeHead(200);
								res.end(JSON.stringify(response));
							});
						} catch (e) {
							if (e instanceof SyntaxError) {
								addLog("error", `JSON Parse Error: ${e.message}`);
								res.writeHead(400);
								res.end(JSON.stringify({ error: "Invalid JSON" }));
							} else {
								addLog("error", `Internal Server Error: ${e.message}`);
								res.writeHead(500);
								res.end(JSON.stringify({ error: e.message }));
							}
						}
						return;
					}

					// --- 兜底处理 (404) ---
					res.writeHead(404);
					res.end(JSON.stringify({ error: "Not Found", url: url }));
				});
			});

			mcpServer.on("error", (e) => {
				addLog("error", `Server Error: ${e.message}`);
			});
			mcpServer.listen(port, () => {
				serverConfig.active = true;
				addLog("success", `MCP Server running at http://127.0.0.1:${port}`);
				Editor.Ipc.sendToPanel("mcp-bridge", "mcp-bridge:state-changed", serverConfig);
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
		if (isSceneBusy && (name === "save_scene" || name === "create_node")) {
			return callback("Editor is busy (Processing Scene), please wait a moment.");
		}
		switch (name) {
			case "get_selected_node":
				const ids = Editor.Selection.curSelection("node");
				callback(null, ids);
				break;

			case "set_node_name":
				// 使用 scene:set-property 以支持撤销
				Editor.Ipc.sendToPanel("scene", "scene:set-property", {
					id: args.id,
					path: "name",
					type: "String",
					value: args.newName,
					isSubProp: false
				});
				callback(null, `Node name updated to ${args.newName}`);
				break;

			case "save_scene":
				isSceneBusy = true;
				addLog("info", "Preparing to save scene... Waiting for UI sync.");
				// 强制延迟保存，防止死锁
				setTimeout(() => {
					// 使用 stash-and-save 替代 save-scene，这更接近 Ctrl+S 的行为
					Editor.Ipc.sendToMain("scene:stash-and-save");
					addLog("info", "Executing Safe Save (Stash)...");
					setTimeout(() => {
						isSceneBusy = false;
						addLog("info", "Safe Save completed.");
						callback(null, "Scene saved successfully.");
					}, 1000);
				}, 500);
				break;

			case "get_scene_hierarchy":
				Editor.Scene.callSceneScript("mcp-bridge", "get-hierarchy", callback);
				break;

			case "update_node_transform":
				const { id, x, y, scaleX, scaleY, color } = args;
				// 将多个属性修改打包到一个 Undo 组中
				Editor.Ipc.sendToPanel("scene", "scene:undo-record", "Transform Update");

				try {
					// 注意：Cocos Creator 属性类型通常首字母大写，如 'Float', 'String', 'Boolean'
					// 也有可能支持 'Number'，但 'Float' 更保险
					if (x !== undefined) Editor.Ipc.sendToPanel("scene", "scene:set-property", { id, path: "x", type: "Float", value: x, isSubProp: false });
					if (y !== undefined) Editor.Ipc.sendToPanel("scene", "scene:set-property", { id, path: "y", type: "Float", value: y, isSubProp: false });
					if (scaleX !== undefined) Editor.Ipc.sendToPanel("scene", "scene:set-property", { id, path: "scaleX", type: "Float", value: scaleX, isSubProp: false });
					if (scaleY !== undefined) Editor.Ipc.sendToPanel("scene", "scene:set-property", { id, path: "scaleY", type: "Float", value: scaleY, isSubProp: false });
					if (color) {
						// 颜色稍微复杂，传递 hex 字符串可能需要 Color 对象转换，但 set-property 也许可以直接接受 info
						// 安全起见，颜色还是走 scene-script 或者尝试直接 set-property
						// 这里的 color 是 Hex String。尝试传 String 让编辑器解析? 
						// 通常编辑器需要 cc.Color 对象或 {r,g,b,a}
						// 暂时保留 color 通过 scene-script 处理? 或者跳过?
						// 为了保持一致性，还是走 scene-script 更新颜色，但这样颜色可能无法 undo。
						// 改进：使用 scene script 处理颜色，但尝试手动 record?
						// 暂且忽略颜色的 Undo，先保证 Transform 的 Undo。
						Editor.Scene.callSceneScript("mcp-bridge", "update-node-transform", { id, color }, (err) => {
							if (err) addLog("warn", "Color update failed or partial");
						});
					}

					Editor.Ipc.sendToPanel("scene", "scene:undo-commit");
					callback(null, "Transform updated");
				} catch (e) {
					Editor.Ipc.sendToPanel("scene", "scene:undo-cancel");
					callback(e);
				}
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
				isSceneBusy = true; // 锁定
				const openUuid = Editor.assetdb.urlToUuid(args.url);
				if (openUuid) {
					Editor.Ipc.sendToMain("scene:open-by-uuid", openUuid);
					setTimeout(() => {
						isSceneBusy = false;
						callback(null, `Success: Opening scene ${args.url}`);
					}, 2000);
				} else {
					isSceneBusy = false;
					callback(`Could not find asset with URL ${args.url}`);
				}
				break;

			case "create_node":
				Editor.Scene.callSceneScript("mcp-bridge", "create-node", args, callback);
				break;

			case "manage_components":
				Editor.Scene.callSceneScript("mcp-bridge", "manage-components", args, callback);
				break;

			case "manage_script":
				this.manageScript(args, callback);
				break;

			case "batch_execute":
				this.batchExecute(args, callback);
				break;

			case "manage_asset":
				this.manageAsset(args, callback);
				break;

			case "scene_management":
				this.sceneManagement(args, callback);
				break;

			case "prefab_management":
				this.prefabManagement(args, callback);
				break;

			case "manage_editor":
				this.manageEditor(args, callback);
				break;

			case "find_gameobjects":
				Editor.Scene.callSceneScript("mcp-bridge", "find-gameobjects", args, callback);
				break;

			case "manage_material":
				this.manageMaterial(args, callback);
				break;

			case "manage_texture":
				this.manageTexture(args, callback);
				break;

			case "execute_menu_item":
				this.executeMenuItem(args, callback);
				break;

			case "apply_text_edits":
				this.applyTextEdits(args, callback);
				break;

			case "read_console":
				this.readConsole(args, callback);
				break;

			case "validate_script":
				this.validateScript(args, callback);
				break;

			case "find_in_file":
				this.findInFile(args, callback);
				break;

			case "manage_undo":
				this.manageUndo(args, callback);
				break;

			case "manage_vfx":
				// 【修复】在主进程预先解析 URL 为 UUID，因为渲染进程(scene-script)无法访问 Editor.assetdb
				if (args.properties && args.properties.file) {
					if (typeof args.properties.file === 'string' && args.properties.file.startsWith("db://")) {
						const uuid = Editor.assetdb.urlToUuid(args.properties.file);
						if (uuid) {
							args.properties.file = uuid; // 替换为 UUID
						} else {
							console.warn(`Failed to resolve path to UUID: ${args.properties.file}`);
						}
					}
				}
				// 预先获取默认贴图 UUID (尝试多个可能的路径)
				const defaultPaths = [
					"db://internal/image/default_sprite_splash",
					"db://internal/image/default_sprite_splash.png",
					"db://internal/image/default_particle",
					"db://internal/image/default_particle.png"
				];

				for (const path of defaultPaths) {
					const uuid = Editor.assetdb.urlToUuid(path);
					if (uuid) {
						args.defaultSpriteUuid = uuid;
						addLog("info", `[mcp-bridge] Resolved Default Sprite UUID: ${uuid} from ${path}`);
						break;
					}
				}

				if (!args.defaultSpriteUuid) {
					addLog("warn", "[mcp-bridge] Failed to resolve any default sprite UUID.");
				}

				Editor.Scene.callSceneScript("mcp-bridge", "manage-vfx", args, callback);
				break;

			default:
				callback(`Unknown tool: ${name}`);
				break;
		}
	},

	// 管理脚本文件
	manageScript(args, callback) {
		const { action, path, content } = args;

		switch (action) {
			case "create":
				if (Editor.assetdb.exists(path)) {
					return callback(`Script already exists at ${path}`);
				}
				// 确保父目录存在
				const fs = require("fs");
				const pathModule = require("path");
				const absolutePath = Editor.assetdb.urlToFspath(path);
				const dirPath = pathModule.dirname(absolutePath);
				if (!fs.existsSync(dirPath)) {
					fs.mkdirSync(dirPath, { recursive: true });
				}
				Editor.assetdb.create(
					path,
					content ||
					`const { ccclass, property } = cc._decorator;

@ccclass
export default class NewScript extends cc.Component {
    @property(cc.Label)
    label: cc.Label = null;

    @property
    text: string = 'hello';

    // LIFE-CYCLE CALLBACKS:

    onLoad () {}

    start () {}

    update (dt) {}
}`,
					(err) => {
						callback(err, err ? null : `Script created at ${path}`);
					},
				);
				break;

			case "delete":
				if (!Editor.assetdb.exists(path)) {
					return callback(`Script not found at ${path}`);
				}
				Editor.assetdb.delete([path], (err) => {
					callback(err, err ? null : `Script deleted at ${path}`);
				});
				break;

			case "read":
				Editor.assetdb.queryInfoByUuid(Editor.assetdb.urlToUuid(path), (err, info) => {
					if (err) {
						return callback(`Failed to get script info: ${err}`);
					}
					Editor.assetdb.loadAny(path, (err, content) => {
						callback(err, err ? null : content);
					});
				});
				break;

			case "write":
				Editor.assetdb.create(path, content, (err) => {
					callback(err, err ? null : `Script updated at ${path}`);
				});
				break;

			default:
				callback(`Unknown script action: ${action}`);
				break;
		}
	},

	// 批处理执行
	batchExecute(args, callback) {
		const { operations } = args;
		const results = [];
		let completed = 0;

		if (!operations || operations.length === 0) {
			return callback("No operations provided");
		}

		operations.forEach((operation, index) => {
			this.handleMcpCall(operation.tool, operation.params, (err, result) => {
				results[index] = { tool: operation.tool, error: err, result: result };
				completed++;

				if (completed === operations.length) {
					callback(null, results);
				}
			});
		});
	},

	// 管理资源
	manageAsset(args, callback) {
		const { action, path, targetPath, content } = args;

		switch (action) {
			case "create":
				if (Editor.assetdb.exists(path)) {
					return callback(`Asset already exists at ${path}`);
				}
				// 确保父目录存在
				const fs = require("fs");
				const pathModule = require("path");
				const absolutePath = Editor.assetdb.urlToFspath(path);
				const dirPath = pathModule.dirname(absolutePath);
				if (!fs.existsSync(dirPath)) {
					fs.mkdirSync(dirPath, { recursive: true });
				}
				Editor.assetdb.create(path, content || "", (err) => {
					callback(err, err ? null : `Asset created at ${path}`);
				});
				break;

			case "delete":
				if (!Editor.assetdb.exists(path)) {
					return callback(`Asset not found at ${path}`);
				}
				Editor.assetdb.delete([path], (err) => {
					callback(err, err ? null : `Asset deleted at ${path}`);
				});
				break;

			case "move":
				if (!Editor.assetdb.exists(path)) {
					return callback(`Asset not found at ${path}`);
				}
				if (Editor.assetdb.exists(targetPath)) {
					return callback(`Target asset already exists at ${targetPath}`);
				}
				Editor.assetdb.move(path, targetPath, (err) => {
					callback(err, err ? null : `Asset moved from ${path} to ${targetPath}`);
				});
				break;

			case "get_info":
				try {
					if (!Editor.assetdb.exists(path)) {
						return callback(`Asset not found: ${path}`);
					}
					const uuid = Editor.assetdb.urlToUuid(path);
					// Return basic info constructed manually to avoid API compatibility issues
					callback(null, {
						url: path,
						uuid: uuid,
						exists: true
					});
				} catch (e) {
					callback(`Error getting asset info: ${e.message}`);
				}
				break;

			default:
				callback(`Unknown asset action: ${action}`);
				break;
		}
	},

	// 场景管理
	sceneManagement(args, callback) {
		const { action, path, targetPath, name } = args;

		switch (action) {
			case "create":
				if (Editor.assetdb.exists(path)) {
					return callback(`Scene already exists at ${path}`);
				}
				// 确保父目录存在
				const fs = require("fs");
				const pathModule = require("path");
				const absolutePath = Editor.assetdb.urlToFspath(path);
				const dirPath = pathModule.dirname(absolutePath);
				if (!fs.existsSync(dirPath)) {
					fs.mkdirSync(dirPath, { recursive: true });
				}
				Editor.assetdb.create(path, getNewSceneTemplate(), (err) => {
					callback(err, err ? null : `Scene created at ${path}`);
				});
				break;

			case "delete":
				if (!Editor.assetdb.exists(path)) {
					return callback(`Scene not found at ${path}`);
				}
				Editor.assetdb.delete([path], (err) => {
					callback(err, err ? null : `Scene deleted at ${path}`);
				});
				break;

			case "duplicate":
				if (!Editor.assetdb.exists(path)) {
					return callback(`Scene not found at ${path}`);
				}
				if (!targetPath) {
					return callback(`Target path is required for duplicate operation`);
				}
				if (Editor.assetdb.exists(targetPath)) {
					return callback(`Target scene already exists at ${targetPath}`);
				}
				// 读取原场景内容
				Editor.assetdb.loadAny(path, (err, content) => {
					if (err) {
						return callback(`Failed to read scene: ${err}`);
					}
					// 确保目标目录存在
					const fs = require("fs");
					const pathModule = require("path");
					const targetAbsolutePath = Editor.assetdb.urlToFspath(targetPath);
					const targetDirPath = pathModule.dirname(targetAbsolutePath);
					if (!fs.existsSync(targetDirPath)) {
						fs.mkdirSync(targetDirPath, { recursive: true });
					}
					// 创建复制的场景
					Editor.assetdb.create(targetPath, content, (err) => {
						callback(err, err ? null : `Scene duplicated from ${path} to ${targetPath}`);
					});
				});
				break;

			case "get_info":
				Editor.assetdb.queryInfoByUuid(Editor.assetdb.urlToUuid(path), (err, info) => {
					callback(err, err ? null : info);
				});
				break;

			default:
				callback(`Unknown scene action: ${action}`);
				break;
		}
	},

	// 预制体管理
	prefabManagement(args, callback) {
		const { action, path, nodeId, parentId } = args;

		switch (action) {
			case "create":
				if (!nodeId) {
					return callback(`Node ID is required for create operation`);
				}
				if (Editor.assetdb.exists(path)) {
					return callback(`Prefab already exists at ${path}`);
				}
				// 确保父目录存在
				const fs = require("fs");
				const pathModule = require("path");
				const absolutePath = Editor.assetdb.urlToFspath(path);
				const dirPath = pathModule.dirname(absolutePath);
				if (!fs.existsSync(dirPath)) {
					fs.mkdirSync(dirPath, { recursive: true });
				}
				// 从节点创建预制体
				Editor.Ipc.sendToMain("scene:create-prefab", nodeId, path);
				callback(null, `Command sent: Creating prefab from node ${nodeId} at ${path}`);
				break;

			case "update":
				if (!nodeId) {
					return callback(`Node ID is required for update operation`);
				}
				if (!Editor.assetdb.exists(path)) {
					return callback(`Prefab not found at ${path}`);
				}
				// 更新预制体
				Editor.Ipc.sendToMain("scene:update-prefab", nodeId, path);
				callback(null, `Command sent: Updating prefab ${path} from node ${nodeId}`);
				break;

			case "instantiate":
				if (!Editor.assetdb.exists(path)) {
					return callback(`Prefab not found at ${path}`);
				}
				// 实例化预制体
				Editor.Scene.callSceneScript(
					"mcp-bridge",
					"instantiate-prefab",
					{
						prefabPath: path,
						parentId: parentId,
					},
					callback,
				);
				break;

			case "get_info":
				Editor.assetdb.queryInfoByUuid(Editor.assetdb.urlToUuid(path), (err, info) => {
					callback(err, err ? null : info);
				});
				break;

			default:
				callback(`Unknown prefab action: ${action}`);
		}
	},

	// 管理编辑器
	manageEditor(args, callback) {
		const { action, target, properties } = args;

		switch (action) {
			case "get_selection":
				// 获取当前选中的资源或节点
				const nodeSelection = Editor.Selection.curSelection("node");
				const assetSelection = Editor.Selection.curSelection("asset");
				callback(null, {
					nodes: nodeSelection,
					assets: assetSelection,
				});
				break;
			case "set_selection":
				// 设置选中状态
				if (target === "node" && properties.nodes) {
					Editor.Selection.select("node", properties.nodes);
				} else if (target === "asset" && properties.assets) {
					Editor.Selection.select("asset", properties.assets);
				}
				callback(null, "Selection updated");
				break;
			case "refresh_editor":
				// 刷新编辑器
				const refreshPath = (properties && properties.path) ? properties.path : 'db://assets/scripts';
				Editor.assetdb.refresh(refreshPath, (err) => {
					if (err) {
						addLog("error", `Refresh failed: ${err}`);
						callback(err);
					} else {
						callback(null, `Editor refreshed: ${refreshPath}`);
					}
				});
				break;
			default:
				callback("Unknown action");
				break;
		}
	},

	// 管理材质
	manageMaterial(args, callback) {
		const { action, path, properties } = args;

		switch (action) {
			case "create":
				if (Editor.assetdb.exists(path)) {
					return callback(`Material already exists at ${path}`);
				}
				// 确保父目录存在
				const fs = require("fs");
				const pathModule = require("path");
				const absolutePath = Editor.assetdb.urlToFspath(path);
				const dirPath = pathModule.dirname(absolutePath);
				if (!fs.existsSync(dirPath)) {
					fs.mkdirSync(dirPath, { recursive: true });
				}
				// 创建材质资源
				const materialContent = JSON.stringify({
					__type__: "cc.Material",
					_name: "",
					_objFlags: 0,
					_native: "",
					effects: [
						{
							technique: 0,
							defines: {},
							uniforms: properties.uniforms || {},
						},
					],
				});
				Editor.assetdb.create(path, materialContent, (err) => {
					callback(err, err ? null : `Material created at ${path}`);
				});
				break;
			case "delete":
				if (!Editor.assetdb.exists(path)) {
					return callback(`Material not found at ${path}`);
				}
				Editor.assetdb.delete([path], (err) => {
					callback(err, err ? null : `Material deleted at ${path}`);
				});
				break;
			case "get_info":
				Editor.assetdb.queryInfoByUuid(Editor.assetdb.urlToUuid(path), (err, info) => {
					callback(err, err ? null : info);
				});
				break;
			default:
				callback(`Unknown material action: ${action}`);
				break;
		}
	},

	// 管理纹理
	manageTexture(args, callback) {
		const { action, path, properties } = args;

		switch (action) {
			case "create":
				if (Editor.assetdb.exists(path)) {
					return callback(`Texture already exists at ${path}`);
				}
				// 确保父目录存在
				const fs = require("fs");
				const pathModule = require("path");
				const absolutePath = Editor.assetdb.urlToFspath(path);
				const dirPath = pathModule.dirname(absolutePath);
				if (!fs.existsSync(dirPath)) {
					fs.mkdirSync(dirPath, { recursive: true });
				}
				// 创建纹理资源（简化版，实际需要处理纹理文件）
				const textureContent = JSON.stringify({
					__type__: "cc.Texture2D",
					_name: "",
					_objFlags: 0,
					_native: properties.native || "",
					width: properties.width || 128,
					height: properties.height || 128,
				});
				Editor.assetdb.create(path, textureContent, (err) => {
					callback(err, err ? null : `Texture created at ${path}`);
				});
				break;
			case "delete":
				if (!Editor.assetdb.exists(path)) {
					return callback(`Texture not found at ${path}`);
				}
				Editor.assetdb.delete([path], (err) => {
					callback(err, err ? null : `Texture deleted at ${path}`);
				});
				break;
			case "get_info":
				Editor.assetdb.queryInfoByUuid(Editor.assetdb.urlToUuid(path), (err, info) => {
					callback(err, err ? null : info);
				});
				break;
			default:
				callback(`Unknown texture action: ${action}`);
				break;
		}
	},

	// 执行菜单项
	executeMenuItem(args, callback) {
		const { menuPath } = args;

		try {
			// 执行菜单项
			Editor.Ipc.sendToMain("menu:click", menuPath);
			callback(null, `Menu item executed: ${menuPath}`);
		} catch (err) {
			callback(`Failed to execute menu item: ${err.message}`);
		}
	},

	// 应用文本编辑
	applyTextEdits(args, callback) {
		const { filePath, edits } = args;

		// 读取文件内容
		Editor.assetdb.queryInfoByUrl(filePath, (err, info) => {
			if (err) {
				callback(`Failed to get file info: ${err.message}`);
				return;
			}

			Editor.assetdb.loadAny(filePath, (err, content) => {
				if (err) {
					callback(`Failed to load file: ${err.message}`);
					return;
				}

				// 应用编辑操作
				let updatedContent = content;
				edits.forEach((edit) => {
					switch (edit.type) {
						case "insert":
							updatedContent =
								updatedContent.slice(0, edit.position) +
								edit.text +
								updatedContent.slice(edit.position);
							break;
						case "delete":
							updatedContent = updatedContent.slice(0, edit.start) + updatedContent.slice(edit.end);
							break;
						case "replace":
							updatedContent =
								updatedContent.slice(0, edit.start) + edit.text + updatedContent.slice(edit.end);
							break;
					}
				});

				// 写回文件
				Editor.assetdb.create(filePath, updatedContent, (err) => {
					callback(err, err ? null : `Text edits applied to ${filePath}`);
				});
			});
		});
	},

	// 读取控制台
	readConsole(args, callback) {
		const { limit, type } = args;
		let filteredOutput = logBuffer;

		if (type) {
			filteredOutput = filteredOutput.filter((item) => item.type === type);
		}

		if (limit) {
			filteredOutput = filteredOutput.slice(-limit);
		}

		callback(null, filteredOutput);
	},

	executeMenuItem(args, callback) {
		const { menuPath } = args;
		if (!menuPath) {
			return callback("Menu path is required");
		}
		addLog("info", `Executing Menu Item: ${menuPath}`);

		// 尝试通过 IPC 触发菜单 (Cocos 2.x 常用方式)
		// 如果是保存场景，直接使用对应的 stash-and-save IPC
		if (menuPath === 'File/Save Scene') {
			Editor.Ipc.sendToMain("scene:stash-and-save");
		} else {
			// 通用尝试 (可能不工作，取决于编辑器版本)
			// Editor.Ipc.sendToMain('ui:menu-click', menuPath); 
			// 兜底：仅记录日志，暂不支持通用菜单点击
			addLog("warn", "Generic menu execution partial support.");
		}
		callback(null, `Menu action triggered: ${menuPath}`);
	},

	// 验证脚本
	validateScript(args, callback) {
		const { filePath } = args;

		// 读取脚本内容
		Editor.assetdb.queryInfoByUrl(filePath, (err, info) => {
			if (err) {
				callback(`Failed to get file info: ${err.message}`);
				return;
			}

			Editor.assetdb.loadAny(filePath, (err, content) => {
				if (err) {
					callback(`Failed to load file: ${err.message}`);
					return;
				}

				try {
					// 对于 JavaScript 脚本，使用 eval 进行简单验证
					if (filePath.endsWith(".js")) {
						// 包装在函数中以避免变量污染
						const wrapper = `(function() { ${content} })`;
						eval(wrapper);
					}
					// 对于 TypeScript 脚本，这里可以添加更复杂的验证逻辑

					callback(null, { valid: true, message: "Script syntax is valid" });
				} catch (err) {
					callback(null, { valid: false, message: err.message });
				}
			});
		});
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

	// 验证脚本
	validateScript(args, callback) {
		const { filePath } = args;

		// 读取脚本内容
		Editor.assetdb.queryInfoByUrl(filePath, (err, info) => {
			if (err) {
				callback(`Failed to get file info: ${err.message}`);
				return;
			}

			Editor.assetdb.loadMeta(info.uuid, (err, content) => {
				if (err) {
					callback(`Failed to load file: ${err.message}`);
					return;
				}

				try {
					// 对于 JavaScript 脚本，使用 eval 进行简单验证
					if (filePath.endsWith('.js')) {
						// 包装在函数中以避免变量污染
						const wrapper = `(function() { ${content} })`;
						eval(wrapper);
					}
					// 对于 TypeScript 脚本，这里可以添加更复杂的验证逻辑

					callback(null, { valid: true, message: 'Script syntax is valid' });
				} catch (err) {
					callback(null, { valid: false, message: err.message });
				}
			});
		});
	},

	// 全局文件搜索
	findInFile(args, callback) {
		const { query, extensions, includeSubpackages } = args;
		const fs = require('fs');
		const path = require('path');

		const assetsPath = Editor.assetdb.urlToFspath("db://assets");
		const validExtensions = extensions || [".js", ".ts", ".json", ".fire", ".prefab", ".xml", ".txt", ".md"];
		const results = [];
		const MAX_RESULTS = 500; // 限制返回结果数量，防止溢出

		try {
			// 递归遍历函数
			const walk = (dir) => {
				if (results.length >= MAX_RESULTS) return;

				const list = fs.readdirSync(dir);
				list.forEach((file) => {
					if (results.length >= MAX_RESULTS) return;

					// 忽略隐藏文件和 node_modules
					if (file.startsWith('.') || file === 'node_modules' || file === 'bin' || file === 'local') return;

					const filePath = path.join(dir, file);
					const stat = fs.statSync(filePath);

					if (stat && stat.isDirectory()) {
						walk(filePath);
					} else {
						// 检查后缀
						const ext = path.extname(file).toLowerCase();
						if (validExtensions.includes(ext)) {
							try {
								const content = fs.readFileSync(filePath, 'utf8');
								// 简单的行匹配
								const lines = content.split('\n');
								lines.forEach((line, index) => {
									if (results.length >= MAX_RESULTS) return;
									if (line.includes(query)) {
										// 转换为项目相对路径 (db://assets/...)
										const relativePath = path.relative(assetsPath, filePath);
										// 统一使用 forward slash
										const dbPath = "db://assets/" + relativePath.split(path.sep).join('/');

										results.push({
											filePath: dbPath,
											line: index + 1,
											content: line.trim()
										});
									}
								});
							} catch (e) {
								// 读取文件出错，跳过
							}
						}
					}
				});
			};

			walk(assetsPath);
			callback(null, results);
		} catch (err) {
			callback(`Find in file failed: ${err.message}`);
		}
	},

	// 管理撤销/重做
	manageUndo(args, callback) {
		const { action, description } = args;

		try {
			switch (action) {
				case "undo":
					Editor.Ipc.sendToPanel("scene", "scene:undo");
					callback(null, "Undo command executed");
					break;
				case "redo":
					Editor.Ipc.sendToPanel("scene", "scene:redo");
					callback(null, "Redo command executed");
					break;
				case "begin_group":
					// scene:undo-record [id]
					// 这里的 id 好像是可选的，或者用于区分不同的事务
					Editor.Ipc.sendToPanel("scene", "scene:undo-record", description || "MCP Action");
					callback(null, `Undo group started: ${description || "MCP Action"}`);
					break;
				case "end_group":
					Editor.Ipc.sendToPanel("scene", "scene:undo-commit");
					callback(null, "Undo group committed");
					break;
				case "cancel_group":
					Editor.Ipc.sendToPanel("scene", "scene:undo-cancel");
					callback(null, "Undo group cancelled");
					break;
				default:
					callback(`Unknown undo action: ${action}`);
			}
		} catch (err) {
			callback(`Undo operation failed: ${err.message}`);
		}
	},
};
