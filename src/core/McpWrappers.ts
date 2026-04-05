import * as fs from 'fs';
import * as pathModule from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Logger } from './Logger';
import { CommandQueue } from './CommandQueue';
declare const Editor: any;

export class McpWrappers {
  static getResourcesList() {
		return [
			{
				uri: "cocos://hierarchy",
				name: "Scene Hierarchy",
				description: "当前场景层级的 JSON 快照",
				mimeType: "application/json",
			},
			{
				uri: "cocos://selection",
				name: "Current Selection",
				description: "当前选中节点的 UUID 列表",
				mimeType: "application/json",
			},
			{
				uri: "cocos://logs/latest",
				name: "Editor Logs",
				description: "最新的编辑器日志 (内存缓存)",
				mimeType: "text/plain",
			},
		];
	}

	/**
	 * 读取指定的 MCP 资源内容
	 * @param {string} uri 资源统一资源标识符 (URI)
	 * @param {Function} callback 完成回调 (err, content)
	 */

  static handleReadResource(uri, callback) {
		let parsed;
		try {
			parsed = new URL(uri);
		} catch (e) {
			return callback(`Invalid URI: ${uri}`);
		}

		if (parsed.protocol !== "cocos:") {
			return callback(`Unsupported protocol: ${parsed.protocol}`);
		}

		const type = parsed.hostname; // hierarchy, selection, logs

		switch (type) {
			case "hierarchy":
				// 注意: query-hierarchy 是异步的
				Editor.Ipc.sendToPanel("scene", "scene:query-hierarchy", (err, sceneId, hierarchy) => {
					if (err) return callback(err);
					callback(null, JSON.stringify(hierarchy, null, 2));
				});
				break;

			case "selection":
				const selection = Editor.Selection.curSelection("node");
				callback(null, JSON.stringify(selection));
				break;

			case "logs":
				callback(null, Logger.getLogContent());
				break;

			default:
				callback(`Resource not found: ${uri}`);
				break;
		}
	}

	/**
	 * 处理来自 HTTP 的 MCP 调用请求
	 * @param {string} name 工具名称
	 * @param {Object} args 工具参数
	 * @param {Function} callback 完成回调 (err, result)
	 */

  static searchProject(args, callback) {
		const { query, useRegex, path: searchPath, matchType, extensions } = args;

		// 默认值
		const rootPathUrl = searchPath || "db://assets";
		const rootPath = Editor.assetdb.urlToFspath(rootPathUrl);

		if (!rootPath || !fs.existsSync(rootPath)) {
			return callback(`无效的搜索路径: ${rootPathUrl}`);
		}

		const mode = matchType || "content"; // content, file_name, dir_name
		const validExtensions = extensions || [".js", ".ts", ".json", ".fire", ".prefab", ".xml", ".txt", ".md"];
		const results = [];
		const MAX_RESULTS = 500;

		let regex = null;
		if (useRegex) {
			try {
				regex = new RegExp(query);
			} catch (e) {
				return callback(`Invalid regex: ${e.message}`);
			}
		}

		const checkMatch = (text) => {
			if (useRegex) return regex.test(text);
			return text.includes(query);
		};

		try {
			const walk = (dir) => {
				if (results.length >= MAX_RESULTS) return;

				const list = fs.readdirSync(dir);
				list.forEach((file) => {
					if (results.length >= MAX_RESULTS) return;

					// 忽略隐藏文件和常用忽略目录
					if (
						file.startsWith(".") ||
						file === "node_modules" ||
						file === "bin" ||
						file === "local" ||
						file === "library" ||
						file === "temp"
					)
						return;

					const filePath = pathModule.join(dir, file);
					const stat = fs.statSync(filePath);

					if (stat && stat.isDirectory()) {
						// 目录名搜索
						if (mode === "dir_name") {
							if (checkMatch(file)) {
								const relativePath = pathModule.relative(
									Editor.assetdb.urlToFspath("db://assets"),
									filePath,
								);
								const dbPath = "db://assets/" + relativePath.split(pathModule.sep).join("/");
								results.push({
									filePath: dbPath,
									type: "directory",
									name: file,
								});
							}
						}
						// 递归
						walk(filePath);
					} else {
						const ext = pathModule.extname(file).toLowerCase();

						// 文件名搜索
						if (mode === "file_name") {
							if (validExtensions && validExtensions.length > 0 && !validExtensions.includes(ext)) {
								// 如果指定了后缀，则必须匹配
								// (Logic kept simple: if extensions provided, filter by them. If not provided, search all files or default list?)
								// Let's stick to validExtensions for file_name search too to avoid noise, or maybe allow all if extensions is explicitly null?
								// Schema default is null. Let's start with checkMatch(file) directly if no extensions provided.
								// Actually validExtensions has a default list. Let's respect it if it was default, but for file_name maybe we want all?
								// Let's use validExtensions only if mode is content. For file_name, usually we search everything unless filtered.
								// But to be safe and consistent with previous find_in_file, let's respect validExtensions.
							}

							// 简化逻辑：对文件名搜索，也检查后缀（如果用户未传则用默认列表）
							if (validExtensions.includes(ext)) {
								if (checkMatch(file)) {
									const relativePath = pathModule.relative(
										Editor.assetdb.urlToFspath("db://assets"),
										filePath,
									);
									const dbPath = "db://assets/" + relativePath.split(pathModule.sep).join("/");
									results.push({
										filePath: dbPath,
										type: "file",
										name: file,
									});
								}
							}
							// 如果需要搜索非文本文件（如 .png），可以传入 extensions=['.png']
						}

						// 内容搜索
						else if (mode === "content") {
							if (validExtensions.includes(ext)) {
								try {
									const content = fs.readFileSync(filePath, "utf8");
									const lines = content.split("\n");
									lines.forEach((line, index) => {
										if (results.length >= MAX_RESULTS) return;
										if (checkMatch(line)) {
											const relativePath = pathModule.relative(
												Editor.assetdb.urlToFspath("db://assets"),
												filePath,
											);
											const dbPath =
												"db://assets/" + relativePath.split(pathModule.sep).join("/");
											results.push({
												filePath: dbPath,
												line: index + 1,
												content: line.trim(),
											});
										}
									});
								} catch (e) {
									// Skip read error
								}
							}
						}
					}
				});
			};

			walk(rootPath);
			callback(null, results);
		} catch (err) {
			callback(`项目搜索失败: ${err.message}`);
		}
	}

	/**
	 * 管理撤销/重做操作及事务分组
	 * @param {Object} args 参数 (action, description, id)
	 * @param {Function} callback 完成回调
	 */

  static manageUndo(args, callback) {
		const { action, description } = args;

		try {
			switch (action) {
				case "undo":
					Editor.Ipc.sendToPanel("scene", "scene:undo");
					callback(null, "撤销指令已执行");
					break;
				case "redo":
					Editor.Ipc.sendToPanel("scene", "scene:redo");
					callback(null, "重做指令已执行");
					break;
				case "begin_group":
					Logger.info(`开始撤销组: ${description || "MCP 动作"}`);
					// 如果有参数包含 id，则记录该节点
					if (args.id) {
						Editor.Ipc.sendToPanel("scene", "scene:undo-record", args.id);
					}
					callback(null, `撤销组已启动: ${description || "MCP 动作"}`);
					break;
				case "end_group":
					Editor.Ipc.sendToPanel("scene", "scene:undo-commit");
					callback(null, "撤销组已提交");
					break;
				case "cancel_group":
					Editor.Ipc.sendToPanel("scene", "scene:undo-cancel");
					callback(null, "撤销组已取消");
					break;
				default:
					callback(`未知的撤销操作: ${action}`);
			}
		} catch (err) {
			callback(`撤销操作失败: ${err.message}`);
		}
	}

	/**
	 * 计算资源的 SHA-256 哈希值
	 * @param {Object} args 参数 (path)
	 * @param {Function} callback 完成回调
	 */

  static getSha(args, callback) {
		const { path: url } = args;
		const fspath = Editor.assetdb.urlToFspath(url);

		if (!fspath || !fs.existsSync(fspath)) {
			return callback(`找不到文件: ${url}`);
		}

		try {
			const fileBuffer = fs.readFileSync(fspath);
			const hashSum = crypto.createHash("sha256");
			hashSum.update(fileBuffer);
			const sha = hashSum.digest("hex");
			callback(null, { path: url, sha: sha });
		} catch (err) {
			callback(`计算 SHA 失败: ${err.message}`);
		}
	}

	/**
	 * 管理节点动画 (播放、停止、获取信息等)
	 * @param {Object} args 参数
	 * @param {Function} callback 完成回调
	 */

  static manageAnimation(args, callback) {
		// 转发给场景脚本处理
		CommandQueue.callSceneScriptWithTimeout("mcp-bridge", "manage-animation", args, callback);
	}



}
