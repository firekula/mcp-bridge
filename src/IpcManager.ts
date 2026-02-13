// @ts-ignore
const fs = require("fs");
// @ts-ignore
const path = require("path");

/**
 * IPC 消息管理器
 * 负责解析 IPC 文档并执行消息测试
 */
export class IpcManager {
	/**
	 * 获取所有 IPC 消息列表
	 * @returns 消息定义列表
	 */
	public static getIpcMessages(): any[] {
		// 获取文档路径
		// @ts-ignore
		const docPath = Editor.url("packages://mcp-bridge/IPC_MESSAGES.md");
		if (!fs.existsSync(docPath)) {
			// @ts-ignore
			Editor.error(`[IPC 管理器] 找不到文档文件: ${docPath}`);
			return [];
		}

		const content = fs.readFileSync(docPath, "utf-8");
		const messages: any[] = [];

		// 正则匹配 ### `message-name`
		const regex = /### `(.*?)`\r?\n([\s\S]*?)(?=### `|$)/g;
		let match;

		while ((match = regex.exec(content)) !== null) {
			const name = match[1];
			const body = match[2];

			// 解析用途
			const purposeMatch = body.match(/- \*\*用途\*\*: (.*)/);
			const description = purposeMatch ? purposeMatch[1].trim() : "无描述";

			// 解析参数
			const paramsMatch = body.match(/- \*\*参数\*\*: (.*)/);
			const params = paramsMatch ? paramsMatch[1].trim() : "无";

			// 解析返回值
			const returnMatch = body.match(/- \*\*返回值\*\*: (.*)/);
			const returns = returnMatch ? returnMatch[1].trim() : "无";

			// 解析类型
			const typeMatch = body.match(/- \*\*类型\*\*: (.*)/);
			const type = typeMatch ? typeMatch[1].trim() : "未定义";

			// 解析状态
			const statusMatch = body.match(/- \*\*状态\*\*: (.*)/);
			const status = statusMatch ? statusMatch[1].trim() : "未测试";

			// 过滤掉广播事件和渲染进程监听的事件
			if (type === "广播事件" || type === "Events listened by Renderer Process" || type === "渲染进程监听") {
				continue;
			}

			messages.push({
				name,
				description,
				params,
				returns,
				type,
				status,
			});
		}

		return messages;
	}

	/**
	 * 测试发送 IPC 消息
	 * @param name 消息名称
	 * @param args 参数
	 * @returns Promise<any> 测试结果
	 */
	public static async testIpcMessage(name: string, args: any = null): Promise<any> {
		return new Promise((resolve) => {
			// 简单防呆：防止执行危险操作
			// 如果消息包含 "delete", "remove", "close", "stop" 且没有明确参数确认，则警告
			// 但用户要求"快速验证"，所以我们默认允许，但如果是无参调用可能有风险
			// 这里我们尝试使用 Editor.Ipc.sendToMain 或 requestToMain

			// @ts-ignore
			// 简单的测试：只是发送看看是否报错。
			// 对于 request 类型的消息，我们期望有回调
			// Cocos Creator 2.4 API: Editor.Ipc.sendToMain(message, ...args)

			try {
				// @ts-ignore
				if (Editor.Ipc.sendToMain) {
					// @ts-ignore
					Editor.Ipc.sendToMain(name, args);
					resolve({ success: true, message: "消息已发送 (sendToMain)" });
				} else {
					resolve({ success: false, message: "Editor.Ipc.sendToMain 不可用" });
				}
			} catch (e: any) {
				resolve({ success: false, message: `错误: ${e.message}` });
			}
		});
	}
}
