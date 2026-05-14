import * as fs from 'fs';
import * as pathModule from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Logger } from '../core/Logger';
import { AssetPatcher } from '../utils/AssetPatcher';
import { CommandQueue } from '../core/CommandQueue';
import { McpWrappers } from '../core/McpWrappers';
declare const Editor: any;

function getNewSceneTemplate() { return `[
  {
    "__type__": "cc.SceneAsset",
    "_name": "",
    "_objFlags": 0,
    "_native": "",
    "scene": {
      "__id__": 1
    }
  },
  {
    "__type__": "cc.Scene",
    "_objFlags": 0,
    "_parent": null,
    "_children": [
      {
        "__id__": 2
      }
    ],
    "_active": true,
    "_components": [],
    "_prefab": null,
    "_opacity": 255,
    "_color": {
      "__type__": "cc.Color",
      "r": 255,
      "g": 255,
      "b": 255,
      "a": 255
    },
    "_contentSize": {
      "__type__": "cc.Size",
      "width": 0,
      "height": 0
    },
    "_anchorPoint": {
      "__type__": "cc.Vec2",
      "x": 0,
      "y": 0
    },
    "_trs": {
      "__type__": "TypedArray",
      "ctor": "Float64Array",
      "array": [
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        1,
        1,
        1
      ]
    },
    "_is3DNode": true,
    "_groupIndex": 0,
    "groupIndex": 0,
    "autoReleaseAssets": false,
    "_id": "67362fcd-77fe-41dc-ac07-ba9829ca1351"
  },
  {
    "__type__": "cc.Node",
    "_name": "Main Camera",
    "_objFlags": 0,
    "_parent": {
      "__id__": 1
    },
    "_children": [],
    "_active": true,
    "_components": [
      {
        "__id__": 3
      }
    ],
    "_prefab": null,
    "_opacity": 255,
    "_color": {
      "__type__": "cc.Color",
      "r": 255,
      "g": 255,
      "b": 255,
      "a": 255
    },
    "_contentSize": {
      "__type__": "cc.Size",
      "width": 0,
      "height": 0
    },
    "_anchorPoint": {
      "__type__": "cc.Vec2",
      "x": 0.5,
      "y": 0.5
    },
    "_trs": {
      "__type__": "TypedArray",
      "ctor": "Float64Array",
      "array": [
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        1,
        1,
        1
      ]
    },
    "_is3DNode": false,
    "_groupIndex": 0,
    "groupIndex": 0,
    "_id": "18g4J2/lRImLg4Jj6+kHee"
  },
  {
    "__type__": "cc.Camera",
    "_name": "",
    "_objFlags": 0,
    "node": {
      "__id__": 2
    },
    "_enabled": true,
    "_cullingMask": 4294967295,
    "_clearFlags": 7,
    "_backgroundColor": {
      "__type__": "cc.Color",
      "r": 0,
      "g": 0,
      "b": 0,
      "a": 255
    },
    "_depth": -1,
    "_zoomRatio": 1,
    "_targetTexture": null,
    "_fov": 60,
    "_orthoSize": 10,
    "_nearClip": 1,
    "_farClip": 4096,
    "_ortho": true,
    "_rect": {
      "__type__": "cc.Rect",
      "x": 0,
      "y": 0,
      "width": 1,
      "height": 1
    },
    "_renderStages": 1,
    "_alignWithScreen": true,
    "_id": "31p6jB6B1H/IpswQ28vjH9"
  }
]`; }


export class ToolDispatcher {
  static isSceneBusy = false;

  static _ensureParentDirSync(targetPath: string) {
      const ext = pathModule.extname(targetPath);
      let dir = targetPath;
      if (ext) { dir = pathModule.dirname(targetPath); }
      if (dir === 'db://assets') return false;
      const fsPath = Editor.assetdb.urlToFspath(dir);
      if (!fsPath) return false;
      if (!fs.existsSync(fsPath)) {
          const parentDir = pathModule.dirname(dir);
          this._ensureParentDirSync(parentDir);
          const dirName = pathModule.basename(dir);
          const parentFsPath = Editor.assetdb.urlToFspath(parentDir);
          fs.mkdirSync(pathModule.join(parentFsPath, dirName));
          Editor.assetdb.refresh(dir);
          return true;
      }
      return false;
  }

  static generateFileId() { return AssetPatcher.generateFileId(); }
  static fixPrefabRootFileId(fp: any) { return AssetPatcher.fixPrefabRootFileId(fp); }

  static handleMcpCall(name, args, callback) {
		if (ToolDispatcher.isSceneBusy && (name === "save_scene" || name === "create_node")) {
			return callback("编辑器正忙（正在处理场景），请稍候。");
		}
				switch (name) {
			case "capture_editor_screenshot":
				ToolDispatcher.isSceneBusy = true;
				
				// 让编辑器的 Scene 视图居中并调整缩放看全景
								// 让编辑器的 Scene 视图居中（修复 init-scene-view 找不到的问题）
				Editor.Ipc.sendToPanel("scene", "scene:query-hierarchy", (err, sceneId, hierarchy) => {
					if (!err && hierarchy && hierarchy.children && hierarchy.children.length > 0) {
						const rootChild = hierarchy.children.find((c) => c.name === "Canvas") || hierarchy.children[0];
						if (rootChild) {
							Editor.Ipc.sendToPanel("scene", "scene:center-nodes", [rootChild.id]);
						}
					}
				});
				
				// 给予编辑器 500ms 刷新并完成视口相机动画
				setTimeout(() => {
					try {
						const win = Editor.Window.main.nativeWin;
						if (!win || !win.isVisible()) {
							ToolDispatcher.isSceneBusy = false;
							return callback("编辑器主窗口在后台或被最小化，无法截图，请先唤醒。");
						}
						
						let isResolved = false;
						const resolveCallback = (err, data) => {
							if (isResolved) return;
							isResolved = true;
							ToolDispatcher.isSceneBusy = false;
							callback(err, data);
						};
						
						// 安全超时防止死锁
						setTimeout(() => { resolveCallback("Editor screenshot API timed out.", null); }, 5000);

						try {
							const p = win.webContents.capturePage();
							if (p && typeof p.then === 'function') {
								p.then(image => resolveCallback(null, image.toDataURL()))
								 .catch(e => resolveCallback(`Promise Screenshot error: ${e.message}`, null));
							} else {
								win.capturePage((image) => resolveCallback(null, image.toDataURL()));
							}
						} catch(err) {
							// 降级尝试回调模式
							win.capturePage((image) => resolveCallback(null, image.toDataURL()));
						}
					} catch(e) {
						ToolDispatcher.isSceneBusy = false;
						callback(`截图失败: ${e.message}`);
					}
				}, 500);
				break;

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
					isSubProp: false,
				});
				callback(null, `节点名称已更新为 ${args.newName}`);
				break;

			case "save_scene":
				ToolDispatcher.isSceneBusy = true;
				// addLog("info", "准备保存场景... 等待 UI 同步。");
				Editor.Ipc.sendToPanel("scene", "scene:stash-and-save");
				ToolDispatcher.isSceneBusy = false;
				// addLog("info", "安全保存已完成。");
				callback(null, "场景保存成功。");
				break;

			case "save_prefab":
				ToolDispatcher.isSceneBusy = true;
				// addLog("info", "调用场景脚本保存预制体...");
				CommandQueue.callSceneScriptWithTimeout("mcp-bridge", "save-prefab", {}, (err, res) => {
					ToolDispatcher.isSceneBusy = false;
					callback(err, res);
				});
				break;

			case "close_prefab":
				ToolDispatcher.isSceneBusy = true;
				// addLog("info", "调用场景脚本退出预制体模式...");
				CommandQueue.callSceneScriptWithTimeout("mcp-bridge", "close-prefab", {}, (err, res) => {
					ToolDispatcher.isSceneBusy = false;
					callback(err, res);
				});
				break;

			case "get_scene_hierarchy":
				CommandQueue.callSceneScriptWithTimeout("mcp-bridge", "get-hierarchy", args, callback);
				break;

			case "update_node_transform":
				// 直接调用场景脚本更新属性，绕过可能导致 "Unknown object" 的复杂 Undo 系统
				CommandQueue.callSceneScriptWithTimeout("mcp-bridge", "update-node-transform", args, (err, result) => {
					if (err) {
						// addLog("error", `Transform update failed: ${err}`);
						callback(err);
					} else {
						callback(null, "变换信息已更新");
					}
				});
				break;

			case "create_scene":
				const sceneUrl = `db://assets/${args.sceneName}.fire`;
				if (Editor.assetdb.exists(sceneUrl)) {
					return callback("场景已存在");
				}
				Editor.assetdb.create(sceneUrl, getNewSceneTemplate(), (err) => {
					callback(err, err ? null : `标准场景已创建于 ${sceneUrl}`);
				});
				break;

			case "create_prefab": {
				let prefabUrl, nodeName;
				if (args.prefabName.startsWith("db://")) {
					prefabUrl = args.prefabName.endsWith(".prefab") ? args.prefabName : args.prefabName + ".prefab";
					// 提取 basename 作为节点名称，并移除 .prefab 后缀
					const rawName = prefabUrl.substring(prefabUrl.lastIndexOf("/") + 1);
					nodeName = rawName.replace(/\.prefab$/, "");
				} else {
					nodeName = args.prefabName;
					prefabUrl = `db://assets/${nodeName}.prefab`;
				}

				// 先重命名节点以匹配预制体名称
				Editor.Ipc.sendToPanel("scene", "scene:set-property", {
					id: args.nodeId,
					path: "name",
					type: "String",
					// 注意：节点名称不允许带有斜杠，使用纯标识符名称
					value: nodeName,
					isSubProp: false,
				});
				// 【修复】使用自定义 9 步后处理管线：Editor.serialize() → 移除 cc.Scene → 添加 cc.Prefab/cc.PrefabInfo → 清空 _id
				setTimeout(() => {
					ToolDispatcher._createPrefabViaSceneScript(args.nodeId, prefabUrl, callback);
				}, 300);
				break;
			}

			case "open_scene":
				ToolDispatcher.isSceneBusy = true; // 锁定
				const openUuid = Editor.assetdb.urlToUuid(args.url);
				if (openUuid) {
					Editor.Ipc.sendToMain("scene:open-by-uuid", openUuid);
					setTimeout(() => {
						ToolDispatcher.isSceneBusy = false;
						callback(null, `成功：正在打开场景 ${args.url}`);
					}, 2000);
				} else {
					ToolDispatcher.isSceneBusy = false;
					callback(`找不到路径为 ${args.url} 的资源`);
				}
				break;

			case "open_prefab":
				ToolDispatcher.isSceneBusy = true; // 锁定
				const prefabUuid = Editor.assetdb.urlToUuid(args.url);
				if (prefabUuid) {
					// 【核心修复】使用正确的 IPC 消息进入预制体编辑模式
					Editor.Ipc.sendToAll("scene:enter-prefab-edit-mode", prefabUuid);
					setTimeout(() => {
						ToolDispatcher.isSceneBusy = false;
						callback(null, `成功：正在打开预制体 ${args.url}`);
					}, 2000);
				} else {
					ToolDispatcher.isSceneBusy = false;
					callback(`找不到路径为 ${args.url} 的资源`);
				}
				break;

			case "create_node":
				if (args.type === "sprite" || args.type === "button") {
					const splashUuid = Editor.assetdb.urlToUuid(
						"db://internal/image/default_sprite_splash.png/default_sprite_splash",
					);
					args.defaultSpriteUuid = splashUuid;
				}
				CommandQueue.callSceneScriptWithTimeout("mcp-bridge", "create-node", args, callback);
				break;

			case "manage_components":
				CommandQueue.callSceneScriptWithTimeout("mcp-bridge", "manage-components", args, callback);
				break;

			case "manage_script":
				ToolDispatcher.manageScript(args, callback);
				break;

			case "batch_execute":
				ToolDispatcher.batchExecute(args, callback);
				break;

			case "manage_asset":
				ToolDispatcher.manageAsset(args, callback);
				break;

			case "scene_management":
				ToolDispatcher.sceneManagement(args, callback);
				break;

			case "prefab_management":
				ToolDispatcher.prefabManagement(args, callback);
				break;

			case "manage_editor":
				ToolDispatcher.manageEditor(args, callback);
				break;
			case "get_sha":
				McpWrappers.getSha(args, callback);
				break;
			case "manage_animation":
				McpWrappers.manageAnimation(args, callback);
				break;

			case "find_gameobjects":
				CommandQueue.callSceneScriptWithTimeout("mcp-bridge", "find-gameobjects", args, callback);
				break;

			case "manage_material":
				ToolDispatcher.manageMaterial(args, callback);
				break;

			case "manage_texture":
				ToolDispatcher.manageTexture(args, callback);
				break;

			case "manage_shader":
				ToolDispatcher.manageShader(args, callback);
				break;

			case "execute_menu_item":
				ToolDispatcher.executeMenuItem(args, callback);
				break;

			case "apply_text_edits":
				ToolDispatcher.applyTextEdits(args, callback);
				break;

			case "read_console":
				ToolDispatcher.readConsole(args, callback);
				break;

			case "validate_script":
				ToolDispatcher.validateScript(args, callback);
				break;

			case "search_project":
				McpWrappers.searchProject(args, callback);
				break;

			case "manage_undo":
				McpWrappers.manageUndo(args, callback);
				break;

			case "manage_vfx":
				// 【修复】在主进程预先解析 URL 为 UUID，因为渲染进程(scene-script)无法访问 Editor.assetdb
				if (args.properties && args.properties.file) {
					if (typeof args.properties.file === "string" && args.properties.file.startsWith("db://")) {
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
					"db://internal/image/default_particle.png",
				];

				for (const path of defaultPaths) {
					const uuid = Editor.assetdb.urlToUuid(path);
					if (uuid) {
						args.defaultSpriteUuid = uuid;
						// addLog("info", `[mcp-bridge] Resolved Default Sprite UUID: ${uuid} from ${path}`);
						break;
					}
				}

				if (!args.defaultSpriteUuid) {
					// addLog("warn", "[mcp-bridge] Failed to resolve any default sprite UUID.");
				}

				CommandQueue.callSceneScriptWithTimeout("mcp-bridge", "manage-vfx", args, callback);
				break;

			case "find_references": {
				// 自动解析 Texture2D → SpriteFrame 子资源 UUID
				// 确保传入图片 UUID 也能查到使用对应 SpriteFrame 的组件
				const additionalIds = [];
				try {
					const targetUrl = Editor.assetdb.uuidToUrl(args.targetId);
					if (targetUrl) {
						const targetFspath = Editor.assetdb.urlToFspath(targetUrl);
						if (targetFspath) {
							const metaPath = targetFspath + ".meta";
							if (fs.existsSync(metaPath)) {
								const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
								if (meta && meta.subMetas) {
									for (const subKey of Object.keys(meta.subMetas)) {
										const sub = meta.subMetas[subKey];
										if (sub && sub.uuid) {
											additionalIds.push(sub.uuid);
										}
									}
								}
							}
						}
					}
				} catch (e) {
					// addLog("warn", `[find_references] 解析子资源 UUID 失败: ${e.message}`);
				}
				if (additionalIds.length > 0) {
					args.additionalIds = additionalIds;
				}
				CommandQueue.callSceneScriptWithTimeout("mcp-bridge", "find-references", args, callback);
				break;
			}

			case "build_project":
				Editor.Ipc.sendToMain("mcp-bridge:build-project", args, (err, state) => {
					callback(err, state);
				});
				break;

			case "get_project_info":
				Editor.Ipc.sendToMain("mcp-bridge:get-project-info", args, (err, info) => {
					callback(err, info);
				});
				break;

			default:
				callback(`Unknown tool: ${name}`);
				break;
		}
	}

	/**
	 * 管理项目中的脚本文件 (TS/JS)
	 * @param {Object} args 参数
	 * @param {Function} callback 完成回调
	 */
	/**
	 * 通过自定义场景脚本创建预制体
	 * scene-script 中 create-prefab 处理器将 Editor.serialize() 的场景格式输出
	 * 经过 9 步后处理转换为标准预制体格式（含 cc.Prefab、cc.PrefabInfo、清空 _id 等）
	 * @param {string} nodeId 要创建为预制体的节点 UUID
	 * @param {string} prefabUrl 预制体的 db:// 路径，如 db://assets/MyPrefab.prefab
	 * @param {Function} callback 完成回调 (err, result)
	 */

  static _createPrefabViaSceneScript(nodeId, prefabUrl, callback) {
		CommandQueue.callSceneScriptWithTimeout("mcp-bridge", "create-prefab", { nodeId }, (err, serializedData) => {
			if (err) {
				// addLog("error", `[create-prefab] 序列化节点失败: ${err}`);
				return callback(err);
			}

			if (!serializedData) {
				return callback("序列化返回空数据");
			}

			// serializedData 是 Editor.serialize 返回的 JSON 字符串
			// 经过 _safeCreateAsset 安全落盘并刷新
			AssetPatcher.safeCreateAsset(prefabUrl, serializedData, callback, (doneCreate) => {
				// 安全网：使用 crypto 生成更安全的 fileId 替换场景脚本中留空的根节点 fileId
				// 在闭锁区内修改，保障数据完整
				setTimeout(() => {
					const prefabFspath = Editor.assetdb.urlToFspath(prefabUrl);
					if (prefabFspath) { ToolDispatcher.fixPrefabRootFileId(prefabFspath);
					}
					// 完成附加修改后，放行 Watcher 闭锁
					doneCreate(null, `预制体已创建: ${prefabUrl}`);
				}, 500);
			});
		});
	}

  static manageScript(args, callback) {
		const { action, path: scriptPath, content } = args;

		switch (action) {
			case "create":
				if (Editor.assetdb.exists(scriptPath)) {
					return callback(`脚本已存在: ${scriptPath}`);
				}

				AssetPatcher.safeCreateAsset(
					scriptPath,
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
					callback,
					null, // 不需要 post-modifier，因为脚本没有像纹理那样复杂的子元数据构建
				);
				break;

			case "delete":
				if (!Editor.assetdb.exists(scriptPath)) {
					return callback(`找不到脚本: ${scriptPath}`);
				}
				Editor.assetdb.delete([scriptPath], (err) => {
					callback(err, err ? null : `脚本已删除: ${scriptPath}`);
				});
				break;

			case "read":
				// 使用 fs 读取，绕过 assetdb.loadAny
				const readFsPath = Editor.assetdb.urlToFspath(scriptPath);
				if (!readFsPath || !fs.existsSync(readFsPath)) {
					return callback(`找不到脚本: ${scriptPath}`);
				}
				try {
					const content = fs.readFileSync(readFsPath, "utf-8");
					callback(null, content);
				} catch (e) {
					callback(`读取脚本失败: ${e.message}`);
				}
				break;

			case "save": // 兼容 AI 幻觉
			case "write":
				// 使用 fs 写入 + refresh，确保覆盖成功
				const writeFsPath = Editor.assetdb.urlToFspath(scriptPath);
				if (!writeFsPath) {
					return callback(`路径无效: ${scriptPath}`);
				}

				try {
					fs.writeFileSync(writeFsPath, content, "utf-8");
					Editor.assetdb.refresh(scriptPath, (err) => {
						if (err) // addLog("warn", `写入脚本后刷新失败: ${err}`);
						callback(null, `脚本已更新: ${scriptPath}`);
					});
				} catch (e) {
					callback(`写入脚本失败: ${e.message}`);
				}
				break;

			default:
				callback(`未知的脚本操作类型: ${action}`);
				break;
		}
	}

	/**
	 * 批量执行多个 MCP 工具操作（串行链式执行）
	 * 【重要修复】原并行 forEach 会导致多个 AssetDB 操作同时执行引发编辑器卡死，
	 * 改为串行执行确保每个操作完成后再执行下一个
	 * @param {Object} args 参数 (operations 数组)
	 * @param {Function} callback 完成回调
	 */

  static batchExecute(args, callback) {
		const { operations } = args;
		const results = [];

		if (!operations || operations.length === 0) {
			return callback("未提供任何操作指令");
		}

		let index = 0;
		const next = () => {
			if (index >= operations.length) {
				return callback(null, results);
			}
			const operation = operations[index];
			ToolDispatcher.handleMcpCall(operation.tool, operation.params, (err, result) => {
				results[index] = { tool: operation.tool, error: err, result: result };
				index++;
				next();
			});
		};
		next();
	}

	/**
	 * 通用的资源管理函数 (创建、删除、移动等)
	 * @param {Object} args 参数
	 * @param {Function} callback 完成回调
	 */

  static manageAsset(args, callback) {
		const { action, path, targetPath, content } = args;

		switch (action) {
			case "create":
				if (Editor.assetdb.exists(path)) {
					return callback(`资源已存在: ${path}`);
				}
				AssetPatcher.safeCreateAsset(path, content || "", callback);
				break;

			case "delete":
				if (!Editor.assetdb.exists(path)) {
					return callback(`找不到资源: ${path}`);
				}
				Editor.assetdb.delete([path], (err) => {
					callback(err, err ? null : `资源已删除: ${path}`);
				});
				break;

			case "move":
				if (!Editor.assetdb.exists(path)) {
					return callback(`源资源不存在: ${path}`);
				}
				if (!targetPath) {
					return callback(`未提供目标路径 targetPath`);
				}

				// 对于 move 操作，虽然我们可以使用 safeCreateAsset 的目录创建和刷新思路，
				// 但是它本质是一个 move 而不是 create。所以我们需要手动预创建目录并刷新。
				let hasNewDir = false;
				try {
					if (typeof ToolDispatcher._ensureParentDirSync !== "function") {
						let allKeys = [];
						for (let k in Editor.assetdb) {
							allKeys.push(k);
						}
						const dbMethods = allKeys.filter(
							(k) => k.toLowerCase().includes("move") || k.toLowerCase().includes("dir"),
						);
						// addLog("warn", `[2.4.10 Debug] \`ToolDispatcher._ensureParentDirSync\` is missing.`);
						// addLog("warn", `[2.4.10 Debug] Editor.assetdb 相关 API: ${dbMethods.join(", ")}`);

						// 在 2.4.10 中不存在此同步方法，跳过手动创建目录，直接让原有 move 接口处理看效果
						hasNewDir = false;
					} else {
						hasNewDir = ToolDispatcher._ensureParentDirSync(targetPath);
					}
				} catch (e) {
					// addLog("error", `[2.4.10 Debug] 创建物理目录异常: ${e.message}`);
					return callback(`创建物理目录失败: ${e.message}`);
				}

				const onMoveComplete = (err) => {
					if (!Editor.App.focused) {
						Editor.AssetDB.runDBWatch("on");
					}
					if (err) return callback(err);

					if (hasNewDir) {
						const dirUrl = targetPath.substring(0, targetPath.lastIndexOf("/"));
						Editor.assetdb.refresh(dirUrl, (refreshErr) => {
							callback(refreshErr, refreshErr ? null : `资源已移动到: ${targetPath}`);
						});
					} else {
						callback(null, `资源已移动到: ${targetPath}`);
					}
				};

				Editor.AssetDB.runDBWatch("off");
				Editor.assetdb.move(path, targetPath, onMoveComplete);
				break;

			case "get_info":
				if (!Editor || !Editor.assetdb) {
					return callback(`当前编辑器资产数据库对象为空，无法调用管理`);
				}
				if (!Editor.assetdb.exists(path)) {
					return callback(`找不到资源: ${path}`);
				}

				if (typeof Editor.assetdb.queryInfoByUrl === "function") {
					Editor.assetdb.queryInfoByUrl(path, (err, info) => {
						if (err) return callback(`查询失败: ${err.message}`);
						if (!info) return callback(`找不到资源信息: ${path}`);
						callback(null, info);
					});
				} else if (
					typeof Editor.assetdb.urlToUuid === "function" &&
					typeof Editor.assetdb.queryInfoByUuid === "function"
				) {
					const uuid = Editor.assetdb.urlToUuid(path);
					Editor.assetdb.queryInfoByUuid(uuid, (err, info) => {
						if (err) return callback(`查询失败: ${err.message}`);
						if (!info) return callback(`找不到资源信息: ${path}`);
						callback(null, info);
					});
				} else {
					let allKeys = [];
					for (let k in Editor.assetdb) {
						allKeys.push(k);
					}
					const dbMethods = allKeys.filter(
						(k) =>
							k.toLowerCase().includes("info") ||
							k.toLowerCase().includes("query") ||
							k.toLowerCase().includes("uuid"),
					);
					// addLog("warn", `[2.4.10 Debug] Editor.assetdb API (\`info|query|uuid\`): ${dbMethods.join(", ")}`);

					try {
						const uuid = Editor.assetdb.urlToUuid(path);
						if (uuid && typeof Editor.assetdb.assetInfoByUuid === "function") {
							const info = Editor.assetdb.assetInfoByUuid(uuid);
							if (info) {
								// addLog("success", `[2.4.10 Debug] 成功通过 assetInfoByUuid 降级获取资源信息`);
								return callback(null, info);
							}
						}
					} catch (e) {
						// addLog("error", `[2.4.10 Debug] 退级调用 assetInfoByUuid 异常: ${e.message}`);
					}

					return callback(`当前 Cocos 环境不支持资源详细信息查询 (可用 API 已在控制台打印)`);
				}
				break;

			default:
				callback(`未知的资源操作类型: ${action}`);
				break;
		}
	}

	// 场景管理

  static sceneManagement(args, callback) {
		const { action, path, targetPath, name } = args;

		switch (action) {
			case "create":
				if (Editor.assetdb.exists(path)) {
					return callback(`场景已存在: ${path}`);
				}

				AssetPatcher.safeCreateAsset(path, getNewSceneTemplate(), callback, null);
				break;

			case "delete":
				if (!Editor.assetdb.exists(path)) {
					return callback(`找不到场景: ${path}`);
				}
				Editor.assetdb.delete([path], (err) => {
					callback(err, err ? null : `场景已删除: ${path}`);
				});
				break;

			case "duplicate":
				if (!Editor.assetdb.exists(path)) {
					return callback(`源场景不存在: ${path}`);
				}
				if (Editor.assetdb.exists(targetPath)) {
					return callback(`目标场景已存在: ${targetPath}`);
				}

				const sourceFsPath = Editor.assetdb.urlToFspath(path);
				if (!sourceFsPath || !fs.existsSync(sourceFsPath)) {
					return callback(`定位源场景文件失败: ${path}`);
				}
				try {
					const content = fs.readFileSync(sourceFsPath, "utf-8");
					AssetPatcher.safeCreateAsset(targetPath, content, callback, null);
				} catch (e) {
					callback(`Duplicate failed: ${e.message}`);
				}
				break;

			case "get_info":
				if (Editor.assetdb.exists(path)) {
					const uuid = Editor.assetdb.urlToUuid(path);
					const info = Editor.assetdb.assetInfoByUuid(uuid);
					callback(null, info || { url: path, uuid: uuid, exists: true });
				} else {
					return callback(`找不到场景: ${path}`);
				}
				break;

			default:
				callback(`Unknown scene action: ${action}`);
				break;
		}
	}

	// 预制体管理

  static prefabManagement(args, callback) {
		const { action, path: prefabPath, nodeId, parentId } = args;

		switch (action) {
			case "create":
				if (!nodeId) {
					return callback("创建预制体需要节点 ID");
				}
				if (Editor.assetdb.exists(prefabPath)) {
					return callback(`预制体已存在: ${prefabPath}`);
				}
				// 解析目标目录和文件名
				const targetDir = prefabPath.substring(0, prefabPath.lastIndexOf("/"));
				const fileName = prefabPath.substring(prefabPath.lastIndexOf("/") + 1);
				const prefabName = fileName.replace(".prefab", "");

				// 1. 重命名节点以匹配预制体名称
				Editor.Ipc.sendToPanel("scene", "scene:set-property", {
					id: nodeId,
					path: "name",
					type: "String",
					value: prefabName,
					isSubProp: false,
				});

				// 2.【修复】使用自定义序列化替代内置 scene:create-prefab，避免根节点 PrefabInfo 损坏
				// _createPrefabViaSceneScript 内部调用 Editor.assetdb.create()，
				// 前置通过 _ensureParentDir 等待真实目录建立完备
				const createdPrefabUrl = `${targetDir}/${prefabName}.prefab`;

				// 对于预制体，_createPrefabViaSceneScript 需要在内部采用 _safeCreateAsset
				// 所以我们这里直接调用，将逻辑下放到内部
				ToolDispatcher._createPrefabViaSceneScript(nodeId, createdPrefabUrl, callback);
				break;

			case "save": // 兼容 AI 幻觉
			case "update":
				if (!nodeId) {
					return callback("更新预制体需要节点 ID");
				}
				if (!Editor.assetdb.exists(prefabPath)) {
					return callback(`找不到预制体: ${prefabPath}`);
				}
				// 更新预制体
				Editor.Ipc.sendToPanel("scene", "scene:update-prefab", nodeId, prefabPath);
				callback(null, `指令已发送: 从节点 ${nodeId} 更新预制体 ${prefabPath}`);
				break;

			case "instantiate":
				if (!Editor.assetdb.exists(prefabPath)) {
					return callback(`路径为 ${prefabPath} 的预制体不存在`);
				}
				// 实例化预制体
				const prefabUuid = Editor.assetdb.urlToUuid(prefabPath);
				CommandQueue.callSceneScriptWithTimeout(
					"mcp-bridge",
					"instantiate-prefab",
					{
						prefabUuid: prefabUuid,
						parentId: parentId,
					},
					callback,
				);
				break;

			case "get_info":
				if (Editor.assetdb.exists(prefabPath)) {
					const uuid = Editor.assetdb.urlToUuid(prefabPath);
					const info = Editor.assetdb.assetInfoByUuid(uuid);
					// 确保返回对象包含 exists: true，以满足测试验证
					const result = info || { url: prefabPath, uuid: uuid };
					result.exists = true;
					callback(null, result);
				} else {
					return callback(`找不到预制体: ${prefabPath}`);
				}
				break;

			default:
				callback(`未知的预制体管理操作: ${action}`);
		}
	}

	/**
	 * 管理编辑器状态 (选中对象、刷新等)
	 * @param {Object} args 参数
	 * @param {Function} callback 完成回调
	 */

  static manageEditor(args, callback) {
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
				if (target === "node") {
					const ids = properties.ids || properties.nodes;
					if (ids) Editor.Selection.select("node", ids);
				} else if (target === "asset") {
					const ids = properties.ids || properties.assets;
					if (ids) Editor.Selection.select("asset", ids);
				}
				callback(null, "选中状态已更新");
				break;
			case "refresh_editor":
				// 刷新编辑器资源数据库
				// 支持指定路径以避免大型项目全量刷新耗时过长
				// 示例: properties.path = 'db://assets/scripts/MyScript.ts' (刷新单个文件)
				//        properties.path = 'db://assets/resources' (刷新某个目录)
				//        不传 (默认 'db://assets'，全量刷新)
				const refreshPath = properties && properties.path ? properties.path : "db://assets";
				// addLog("info", `[refresh_editor] 开始刷新: ${refreshPath}`);
				Editor.assetdb.refresh(refreshPath, (err) => {
					if (err) {
						// addLog("error", `刷新失败: ${err}`);
						callback(err);
					} else {
						callback(null, `编辑器已刷新: ${refreshPath}`);
					}
				});
				break;
			default:
				callback("未知的编辑器管理操作");
				break;
		}
	}

	// 管理着色器 (Effect)

  static manageShader(args, callback) {
		const { action, path: effectPath, content } = args;

		switch (action) {
			case "create":
				if (Editor.assetdb.exists(effectPath)) {
					return callback(`Effect 已存在: ${effectPath}`);
				}
				const defaultEffect = `CCEffect %{
  techniques:
  - passes:
    - vert: vs
      frag: fs
      blendState:
        targets:
        - blend: true
      rasterizerState:
        cullMode: none
      properties:
        texture: { value: white }
        mainColor: { value: [1, 1, 1, 1], editor: { type: color } }
}%

CCProgram vs %{
  precision highp float;
  #include <cc-global>
  attribute vec3 a_position;
  attribute vec2 a_uv0;
  varying vec2 v_uv0;
  void main () {
    gl_Position = cc_matViewProj * vec4(a_position, 1.0);
    v_uv0 = a_uv0;
  }
}%

CCProgram fs %{
  precision highp float;
  uniform sampler2D texture;
  uniform Constant {
    vec4 mainColor;
  };
  varying vec2 v_uv0;
  void main () {
    gl_FragColor = mainColor * texture2D(texture, v_uv0);
  }
}%`;

				AssetPatcher.safeCreateAsset(effectPath, content || defaultEffect, callback);
				break;

			case "read":
				if (!Editor.assetdb.exists(effectPath)) {
					return callback(`找不到 Effect: ${effectPath}`);
				}
				const fspath = Editor.assetdb.urlToFspath(effectPath);
				try {
					const data = fs.readFileSync(fspath, "utf-8");
					callback(null, data);
				} catch (e) {
					callback(`读取 Effect 失败: ${e.message}`);
				}
				break;

			case "save": // 兼容 AI 幻觉
			case "write":
				if (!Editor.assetdb.exists(effectPath)) {
					return callback(`Effect not found: ${effectPath}`);
				}
				const writeFsPath = Editor.assetdb.urlToFspath(effectPath);
				try {
					fs.writeFileSync(writeFsPath, content, "utf-8");
					Editor.assetdb.refresh(effectPath, (err) => {
						callback(err, err ? null : `Effect 已更新: ${effectPath}`);
					});
				} catch (e) {
					callback(`更新 Effect 失败: ${e.message}`);
				}
				break;

			case "delete":
				if (!Editor.assetdb.exists(effectPath)) {
					return callback(`找不到 Effect: ${effectPath}`);
				}
				Editor.assetdb.delete([effectPath], (err) => {
					callback(err, err ? null : `Effect 已删除: ${effectPath}`);
				});
				break;

			case "get_info":
				if (Editor.assetdb.exists(effectPath)) {
					const uuid = Editor.assetdb.urlToUuid(effectPath);
					const info = Editor.assetdb.assetInfoByUuid(uuid);
					callback(null, info || { url: effectPath, uuid: uuid, exists: true });
				} else {
					callback(`找不到 Effect: ${effectPath}`);
				}
				break;

			default:
				callback(`Unknown shader action: ${action}`);
				break;
		}
	}

	// 管理材质

  static manageMaterial(args, callback) {
		const { action, path: matPath, properties = {} } = args;

		switch (action) {
			case "create":
				if (Editor.assetdb.exists(matPath)) {
					return callback(`材质已存在: ${matPath}`);
				}
				// 构造 Cocos 2.4.x 材质内容
				const materialData = {
					__type__: "cc.Material",
					_name: "",
					_objFlags: 0,
					_native: "",
					_effectAsset: properties.shaderUuid ? { __uuid__: properties.shaderUuid } : null,
					_techniqueIndex: 0,
					_techniqueData: {
						0: {
							defines: properties.defines || {},
							props: properties.uniforms || {},
						},
					},
				};

				AssetPatcher.safeCreateAsset(matPath, JSON.stringify(materialData, null, 2), callback);
				break;

			case "save": // 兼容 AI 幻觉
			case "update":
				if (!Editor.assetdb.exists(matPath)) {
					return callback(`找不到材质: ${matPath}`);
				}
				const fspath = Editor.assetdb.urlToFspath(matPath);
				try {
					const content = fs.readFileSync(fspath, "utf-8");
					const matData = JSON.parse(content);

					// 确保结构存在
					if (!matData._techniqueData) matData._techniqueData = {};
					if (!matData._techniqueData["0"]) matData._techniqueData["0"] = {};
					const tech = matData._techniqueData["0"];

					// 更新 Shader
					if (properties.shaderUuid) {
						matData._effectAsset = { __uuid__: properties.shaderUuid };
					}

					// 更新 Defines
					if (properties.defines) {
						tech.defines = Object.assign(tech.defines || {}, properties.defines);
					}

					fs.writeFileSync(fspath, JSON.stringify(matData, null, 2), "utf-8");
					Editor.assetdb.refresh(matPath, (err) => {
						callback(err, err ? null : `材质已更新: ${matPath}`);
					});
				} catch (e) {
					callback(`更新材质失败: ${e.message}`);
				}
				break;

			case "delete":
				if (!Editor.assetdb.exists(matPath)) {
					return callback(`找不到材质: ${matPath}`);
				}
				Editor.assetdb.delete([matPath], (err) => {
					callback(err, err ? null : `材质已删除: ${matPath}`);
				});
				break;

			case "get_info":
				if (Editor.assetdb.exists(matPath)) {
					const uuid = Editor.assetdb.urlToUuid(matPath);
					const info = Editor.assetdb.assetInfoByUuid(uuid);
					callback(null, info || { url: matPath, uuid: uuid, exists: true });
				} else {
					callback(`找不到材质: ${matPath}`);
				}
				break;

			default:
				callback(`Unknown material action: ${action}`);
				break;
		}
	}

	/**
	 * 安全创建资源 (V8 完美原子级联方案)
	 * 从根源解决 Cocos 原生由于 API 缺陷导致的一系列并发时序和子资产提取错乱 Bug。
	 * 策略：永远不去触碰物理项目文件夹里的 fs.mkdir。计算出缺失的深层树结构，
	 * 在 OS Temp 文件夹构建整颗由缺失目录和最终文件组成的隔离树，最后通过
	 * 原生的 Editor.assetdb.import 单次原子地把整个树吸入最底层的共有确切父节点。
	 *
	 * @param {string} path db:// 资源路径
	 * @param {string|Buffer} content 文件内容
	 * @param {Function} originalCallback 外层完毕回调 (err, msg)
	 * @param {Function} [postCreateModifier] 修改 Meta 的可选回调
	 */

  static manageTexture(args, callback) {
		const { action, path, properties } = args;

		switch (action) {
			case "create":
				if (Editor.assetdb.exists(path)) {
					return callback(`纹理已存在: ${path}`);
				}
				// 准备文件内容 (优先使用 properties.content，否则使用默认 1x1 透明 PNG)
				let base64Data =
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
				if (properties && properties.content) {
					base64Data = properties.content;
				}
				const textureBuffer = Buffer.from(base64Data, "base64");

				AssetPatcher.safeCreateAsset(path, textureBuffer, callback, (doneCreate) => {
					// 如果有 9-slice 等附加属性配置，更新 Meta
					if (properties && (properties.border || properties.type)) {
						const uuid = Editor.assetdb.urlToUuid(path);
						if (!uuid) return doneCreate(null, `纹理已创建，但未能立即获取 UUID。`);

						// 稍微延迟确保刚在内存中创建完的 Meta 对象可读
						setTimeout(() => {
							const meta = Editor.assetdb.loadMeta(uuid);
							if (meta) {
								let changed = false;
								if (properties.type) {
									meta.type = properties.type;
									changed = true;
								}

								// 设置 9-slice (border)
								if (properties.border) {
									meta.type = "sprite";
									const subKeys = Object.keys(meta.subMetas);
									if (subKeys.length > 0) {
										const subMeta = meta.subMetas[subKeys[0]];
										subMeta.border = properties.border;
										changed = true;
									}
								}

								if (changed) {
									Editor.assetdb.saveMeta(uuid, JSON.stringify(meta), (metaErr) => {
										if (metaErr) Editor.warn(`保存资源 Meta 失败 ${path}: ${metaErr}`);
										doneCreate(null, `纹理已创建并更新 Meta: ${path}`);
									});
									return; // 内部完成
								}
							}
							doneCreate(null, `纹理已创建: ${path}`);
						}, 100);
					} else {
						doneCreate(null, `纹理已创建: ${path}`);
					}
				});
				break;
			case "delete":
				if (!Editor.assetdb.exists(path)) {
					return callback(`找不到纹理: ${path}`);
				}
				Editor.assetdb.delete([path], (err) => {
					callback(err, err ? null : `纹理已删除: ${path}`);
				});
				break;
			case "get_info":
				if (Editor.assetdb.exists(path)) {
					const uuid = Editor.assetdb.urlToUuid(path);
					const info = Editor.assetdb.assetInfoByUuid(uuid);
					callback(null, info || { url: path, uuid: uuid, exists: true });
				} else {
					callback(`找不到纹理: ${path}`);
				}
				break;
			case "save": // 兼容 AI 幻觉
			case "update":
				if (!Editor.assetdb.exists(path)) {
					return callback(`找不到纹理: ${path}`);
				}
				const uuid = Editor.assetdb.urlToUuid(path);
				let meta = Editor.assetdb.loadMeta(uuid);

				// Fallback: 如果 Editor.assetdb.loadMeta 失败 (API 偶尔不稳定)，尝试直接读取文件系统中的 .meta 文件
				if (!meta) {
					try {
						const fspath = Editor.assetdb.urlToFspath(path);
						const metaPath = fspath + ".meta";
						if (fs.existsSync(metaPath)) {
							const metaContent = fs.readFileSync(metaPath, "utf-8");
							meta = JSON.parse(metaContent);
							// addLog("info", `[manage_texture] Loaded meta from fs fallback: ${metaPath}`);
						}
					} catch (e) {
						// addLog("warn", `[manage_texture] Meta fs fallback failed: ${e.message}`);
					}
				}

				if (!meta) {
					return callback(`加载资源 Meta 失败: ${path}`);
				}

				let changed = false;
				if (properties) {
					// 更新类型
					if (properties.type) {
						if (meta.type !== properties.type) {
							meta.type = properties.type;
							changed = true;
						}
					}

					// 更新 9-slice border
					if (properties.border) {
						// 确保类型是 sprite
						if (meta.type !== "sprite") {
							meta.type = "sprite";
							changed = true;
						}

						// 找到 SubMeta
						// Cocos Meta 结构: { subMetas: { "textureName": { ... } } }
						// 注意：Cocos 2.x 的 meta 结构因版本而异，旧版可能使用 border: [t, b, l, r] 数组，
						// 而新版 (如 2.3.x+) 通常使用 borderTop, borderBottom 等独立字段。
						// 此处逻辑实现了兼容性处理。
						const subKeys = Object.keys(meta.subMetas);
						if (subKeys.length > 0) {
							const subMeta = meta.subMetas[subKeys[0]];
							const newBorder = properties.border; // [top, bottom, left, right]

							// 方式 1: standard array style
							if (subMeta.border !== undefined) {
								const oldBorder = subMeta.border;
								if (
									!oldBorder ||
									oldBorder[0] !== newBorder[0] ||
									oldBorder[1] !== newBorder[1] ||
									oldBorder[2] !== newBorder[2] ||
									oldBorder[3] !== newBorder[3]
								) {
									subMeta.border = newBorder;
									changed = true;
								}
							}
							// 方式 2: individual fields style (common in 2.3.x)
							else if (subMeta.borderTop !== undefined) {
								// top, bottom, left, right
								if (
									subMeta.borderTop !== newBorder[0] ||
									subMeta.borderBottom !== newBorder[1] ||
									subMeta.borderLeft !== newBorder[2] ||
									subMeta.borderRight !== newBorder[3]
								) {
									subMeta.borderTop = newBorder[0];
									subMeta.borderBottom = newBorder[1];
									subMeta.borderLeft = newBorder[2];
									subMeta.borderRight = newBorder[3];
									changed = true;
								}
							}
							// 方式 3: 如果都没有，尝试写入 individual fields
							else {
								subMeta.borderTop = newBorder[0];
								subMeta.borderBottom = newBorder[1];
								subMeta.borderLeft = newBorder[2];
								subMeta.borderRight = newBorder[3];
								changed = true;
							}
						}
					}
				}

				if (changed) {
					// 使用 saveMeta 或者 fs 写入
					// 为了安全，如果 loadMeta 失败了，safeMeta 可能也会失败，所以这里尽量用 API，不行再 fallback (暂且只用 API)
					Editor.assetdb.saveMeta(uuid, JSON.stringify(meta), (err) => {
						if (err) return callback(`保存 Meta 失败: ${err}`);
						callback(null, `纹理已更新: ${path}`);
					});
				} else {
					callback(null, `资源不需要更新: ${path}`);
				}
				break;
			default:
				callback(`未知的纹理操作类型: ${action}`);
				break;
		}
	}

	/**
	 * 对文件应用一系列精确的文本编辑操作
	 * @param {Object} args 参数
	 * @param {Function} callback 完成回调
	 */

  static applyTextEdits(args, callback) {
		const { filePath, edits } = args;

		// 1. 获取文件系统路径
		const fspath = Editor.assetdb.urlToFspath(filePath);
		if (!fspath) {
			return callback(`找不到文件或 URL 无效: ${filePath}`);
		}

		const fs = require("fs");
		if (!fs.existsSync(fspath)) {
			return callback(`文件不存在: ${fspath}`);
		}

		try {
			// 2. 读取
			let updatedContent = fs.readFileSync(fspath, "utf-8");

			// 3. 应用编辑
			// 必须按倒序应用编辑，否则后续编辑的位置会偏移 (假设edits未排序，这里简单处理，实际上LSP通常建议客户端倒序应用或计算偏移)
			// 这里假设edits已经按照位置排序或者用户负责，如果需要严谨，应先按 start/position 倒序排序
			// 简单排序保险：
			const sortedEdits = [...edits].sort((a, b) => {
				const posA = a.position !== undefined ? a.position : a.start;
				const posB = b.position !== undefined ? b.position : b.start;
				return posB - posA; // 从大到小
			});

			sortedEdits.forEach((edit) => {
				switch (edit.type) {
					case "insert":
						updatedContent =
							updatedContent.slice(0, edit.position) + edit.text + updatedContent.slice(edit.position);
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

			// 4. 写入
			fs.writeFileSync(fspath, updatedContent, "utf-8");

			// 5. 通知编辑器资源变化 (重要)
			Editor.assetdb.refresh(filePath, (err) => {
				if (err) // addLog("warn", `刷新失败 ${filePath}: ${err}`);
				callback(null, `文本编辑已应用: ${filePath}`);
			});
		} catch (err) {
			callback(`操作失败: ${err.message}`);
		}
	}

	// 读取控制台

  static readConsole(args, callback) {
		const { limit, type } = args;
		let filteredOutput = Logger.getLogs();

		if (type) {
			// [优化] 支持别名映射
			const targetType = type === "log" ? "info" : type;
			filteredOutput = filteredOutput.filter((item) => item.type === targetType);
		}

		if (limit) {
			filteredOutput = filteredOutput.slice(-limit);
		}

		callback(null, filteredOutput);
	}

	/**
	 * 执行编辑器菜单项
	 * @param {Object} args 参数 (menuPath)
	 * @param {Function} callback 完成回调
	 */

  static executeMenuItem(args, callback) {
		const { menuPath } = args;
		if (!menuPath) {
			return callback("菜单路径是必填项");
		}
		// addLog("info", `执行菜单项: ${menuPath}`);

		// 菜单项映射表 (Cocos Creator 2.4.x IPC)
		// 参考: IPC_MESSAGES.md
		const menuMap = {
			"File/New Scene": "scene:new-scene",
			"File/Save Scene": "scene:stash-and-save",
			"File/Save": "scene:stash-and-save", // 别名
			"Edit/Undo": "scene:undo",
			"Edit/Redo": "scene:redo",
			"Edit/Delete": "scene:delete-nodes",
			Delete: "scene:delete-nodes",
			delete: "scene:delete-nodes",
		};

		// 特殊处理 delete-node:UUID 格式
		if (menuPath.startsWith("delete-node:")) {
			const uuid = menuPath.split(":")[1];
			if (uuid) {
				CommandQueue.callSceneScriptWithTimeout("mcp-bridge", "delete-node", { uuid }, (err, result) => {
					if (err) callback(err);
					else callback(null, result || `节点 ${uuid} 已通过场景脚本删除`);
				});
				return;
			}
		}

		if (menuMap[menuPath]) {
			const ipcMsg = menuMap[menuPath];
			try {
				// 获取当前选中的节点进行删除（如果该消息是删除操作）
				if (ipcMsg === "scene:delete-nodes") {
					const selection = Editor.Selection.curSelection("node");
					if (selection.length > 0) {
						Editor.Ipc.sendToMain(ipcMsg, selection);
						callback(null, `菜单动作已触发: ${menuPath} -> ${ipcMsg} (影响 ${selection.length} 个节点)`);
					} else {
						callback("没有选中任何节点进行删除");
					}
				} else {
					Editor.Ipc.sendToMain(ipcMsg);
					callback(null, `菜单动作已触发: ${menuPath} -> ${ipcMsg}`);
				}
			} catch (err) {
				callback(`执行 IPC ${ipcMsg} 失败: ${err.message}`);
			}
		} else {
			// 杜绝 AI 幻觉，移除不存在的 menu:click 调用
			// 直接返回明确的失败并引导扩展 menuMap
			callback(`不支持执行非预设菜单路径: ${menuPath}。如确需该菜单，请在 ToolDispatcher 的 menuMap 中补充真正的 IPC 消息映射。`);
		}
	}

	/**
	 * 验证脚本文件的语法或基础结构
	 * @param {Object} args 参数 (filePath)
	 * @param {Function} callback 完成回调
	 */

  static validateScript(args, callback) {
		const { filePath } = args;

		// 1. 获取文件系统路径
		const fspath = Editor.assetdb.urlToFspath(filePath);
		if (!fspath) {
			return callback(`找不到文件或 URL 无效: ${filePath}`);
		}

		// 2. 检查文件是否存在
		if (!fs.existsSync(fspath)) {
			return callback(`文件不存在: ${fspath}`);
		}

		// 3. 读取内容并验证
		try {
			const content = fs.readFileSync(fspath, "utf-8");

			// 检查空文件
			if (!content || content.trim().length === 0) {
				return callback(null, { valid: false, message: "脚本内容为空" });
			}

			// 对于 JavaScript 脚本，使用 Function 构造器进行语法验证
			if (filePath.endsWith(".js")) {
				const wrapper = `(function() { ${content} })`;
				try {
					new Function(wrapper);
					callback(null, { valid: true, message: "JavaScript 语法验证通过" });
				} catch (syntaxErr) {
					return callback(null, { valid: false, message: syntaxErr.message });
				}
			}
			// 对于 TypeScript，由于没有内置 TS 编译器，我们进行基础的"防呆"检查
			// 并明确告知用户无法进行完整编译验证
			else if (filePath.endsWith(".ts")) {
				// 简单的正则表达式检查：是否有非法字符或明显错误结构 (示例)
				// 这里暂时只做简单的括号匹配检查或直接通过，但给出一个 Warning

				// 检查是否有 class 定义 (简单的启发式检查)
				if (
					!content.includes("class ") &&
					!content.includes("interface ") &&
					!content.includes("enum ") &&
					!content.includes("export ")
				) {
					return callback(null, {
						valid: true,
						message:
							"警告: TypeScript 文件似乎缺少标准定义 (class/interface/export)，但由于缺少编译器，已跳过基础语法检查。",
					});
				}

				callback(null, {
					valid: true,
					message: "TypeScript 基础检查通过。(完整编译验证需要通过编辑器构建流程)",
				});
			} else {
				callback(null, { valid: true, message: "未知的脚本类型，跳过验证。" });
			}
		} catch (err) {
			callback(null, { valid: false, message: `读取错误: ${err.message}` });
		}
	}
	// 暴露给 MCP 或面板的 API 封装


}
