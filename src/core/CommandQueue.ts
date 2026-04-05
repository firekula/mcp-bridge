import { Logger } from "./Logger";

export class CommandQueue {
	private static MAX_QUEUE_LENGTH = 100;
	private static commandQueue: any[] = [];
	private static isProcessingCommand = false;

	/**
	 * 将一个异步操作加入队列，保证串行执行
	 * @param {Function} fn 接受 done 回调的函数，fn(done) 中操作完成后必须调用 done()
	 * @returns {Promise} 操作完成后 resolve
	 */
	public static enqueue(fn: (done: () => void) => void): Promise<void> {
		if (CommandQueue.commandQueue.length >= CommandQueue.MAX_QUEUE_LENGTH) {
			Logger.warn(`[CommandQueue] 指令队列已满（${CommandQueue.MAX_QUEUE_LENGTH}），拒绝新请求`);
			return Promise.reject("队列已满，请稍后重试");
		}
		return new Promise((resolve) => {
			const timeoutId = setTimeout(() => {
				Logger.error("[CommandQueue] 指令执行超时(60s)，强制释放队列");
				CommandQueue.isProcessingCommand = false;
				resolve();
				CommandQueue.processNext();
			}, 60000);
			CommandQueue.commandQueue.push({ fn, resolve, timeoutId });
			CommandQueue.processNext();
		});
	}

	private static processNext() {
		if (CommandQueue.isProcessingCommand || CommandQueue.commandQueue.length === 0) return;
		CommandQueue.isProcessingCommand = true;
		const { fn, resolve, timeoutId } = CommandQueue.commandQueue.shift();
		try {
			fn(() => {
				clearTimeout(timeoutId);
				CommandQueue.isProcessingCommand = false;
				resolve();
				CommandQueue.processNext();
			});
		} catch (e) {
			clearTimeout(timeoutId);
			Logger.error(`[CommandQueue] 指令执行异常: ${e.message}`);
			CommandQueue.isProcessingCommand = false;
			resolve();
			CommandQueue.processNext();
		}
	}

	/**
	 * 获取当前队列长度
	 */
	public static getLength(): number {
		return CommandQueue.commandQueue.length;
	}

	/**
	 * 带超时保护的 callSceneScript 包装
	 */
	public static callSceneScriptWithTimeout(pluginName: string, method: string, args: any, callback: Function, timeout = 15000) {
		let settled = false;
		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				Logger.error(`[超时] callSceneScript "${method}" 超过 ${timeout}ms 未响应`);
				callback(`操作超时: ${method} (${timeout}ms)`);
			}
		}, timeout);

		const wrappedCallback = (err: any, result: any) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				if (err && typeof err === "object" && err.message && err.message.includes("panel not found")) {
					const friendlyMsg = `场景面板尚未就绪（可能正在重载插件或切换场景），请等待几秒后重试。原始信息: ${err.message}`;
					Logger.warn(`[scene-script] ${friendlyMsg}`);
					callback(friendlyMsg);
				} else if (err && typeof err === "string" && err.includes("panel not found")) {
					const friendlyMsg = `场景面板尚未就绪（可能正在重载插件或切换场景），请等待几秒后重试。原始信息: ${err}`;
					Logger.warn(`[scene-script] ${friendlyMsg}`);
					callback(friendlyMsg);
				} else {
					callback(err, result);
				}
			}
		};

		if (args === null || args === undefined) {
			Editor.Scene.callSceneScript(pluginName, method, wrappedCallback);
		} else {
			Editor.Scene.callSceneScript(pluginName, method, args, wrappedCallback);
		}
	}
}
