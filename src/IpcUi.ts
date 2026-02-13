// @ts-ignore
const Editor = window.Editor;

export class IpcUi {
	private root: ShadowRoot;
	private logArea: HTMLTextAreaElement | null = null;
	private ipcList: HTMLElement | null = null;
	private allMessages: any[] = [];
	private filterSelect: HTMLSelectElement | null = null;
	private paramInput: HTMLTextAreaElement | null = null;

	/**
	 * 构造函数
	 * @param root Shadow UI 根节点
	 */
	constructor(root: ShadowRoot) {
		this.root = root;
		this.bindEvents();
	}

	/**
	 * 绑定 UI 事件
	 */
	private bindEvents() {
		const btnScan = this.root.querySelector("#btnScanIpc");
		const btnTest = this.root.querySelector("#btnTestIpc");
		const cbSelectAll = this.root.querySelector("#cbSelectAllIpc");
		this.logArea = this.root.querySelector("#ipcLog") as HTMLTextAreaElement;
		this.ipcList = this.root.querySelector("#ipcList") as HTMLElement;
		this.filterSelect = this.root.querySelector("#ipcFilter") as HTMLSelectElement;
		this.paramInput = this.root.querySelector("#ipcParams") as HTMLTextAreaElement;

		if (btnScan) {
			btnScan.addEventListener("confirm", () => this.scanMessages());
		}
		if (btnTest) {
			btnTest.addEventListener("confirm", () => this.testSelected());
		}
		if (cbSelectAll) {
			cbSelectAll.addEventListener("change", (e: any) =>
				this.toggleAll(e.detail ? e.detail.value : e.target.value === "true" || e.target.checked),
			);
		}
		if (this.filterSelect) {
			this.filterSelect.addEventListener("change", () => this.filterMessages());
		}
	}

	/**
	 * 扫描 IPC 消息
	 */
	private scanMessages() {
		this.log("正在扫描 IPC 消息...");
		// @ts-ignore
		Editor.Ipc.sendToMain("mcp-bridge:scan-ipc-messages", (err: any, msgs: any[]) => {
			if (err) {
				this.log(`扫描错误: ${err}`);
				return;
			}
			if (msgs) {
				this.allMessages = msgs;
				this.filterMessages();
				this.log(`找到 ${msgs.length} 条消息。`);
			} else {
				this.log("未找到任何消息。");
			}
		});
	}

	/**
	 * 根据当前选择器过滤消息列表
	 */
	private filterMessages() {
		if (!this.allMessages) return;
		const filter = this.filterSelect ? this.filterSelect.value : "all";

		let filtered = this.allMessages;
		if (filter === "available") {
			filtered = this.allMessages.filter((m) => m.status === "可用");
		} else if (filter === "unavailable") {
			filtered = this.allMessages.filter((m) => m.status && m.status.includes("不可用"));
		} else if (filter === "untested") {
			filtered = this.allMessages.filter((m) => !m.status || m.status === "未测试");
		}

		this.renderList(filtered);
	}

	/**
	 * 渲染消息列表 UI
	 * @param msgs 消息对象数组
	 */
	private renderList(msgs: any[]) {
		if (!this.ipcList) return;
		this.ipcList.innerHTML = "";

		msgs.forEach((msg) => {
			const item = document.createElement("div");
			item.className = "ipc-item";
			item.style.padding = "4px";
			item.style.borderBottom = "1px solid #333";
			item.style.display = "flex";
			item.style.alignItems = "center";

			// 复选框
			const checkbox = document.createElement("ui-checkbox");
			// @ts-ignore
			checkbox.value = false;
			checkbox.setAttribute("data-name", msg.name);
			checkbox.style.marginRight = "8px";

			// 内容区域
			const content = document.createElement("div");
			content.style.flex = "1";
			content.style.fontSize = "11px";

			let statusColor = "#888"; // 未测试
			if (msg.status === "可用")
				statusColor = "#4CAF50"; // 绿色
			else if (msg.status && msg.status.includes("不可用")) statusColor = "#F44336"; // 红色

			content.innerHTML = `
                <div style="display:flex; justify-content:space-between;">
                    <span style="color: #4CAF50; font-weight: bold;">${msg.name}</span>
                    <span style="color: ${statusColor}; font-size: 10px; border: 1px solid ${statusColor}; padding: 0 4px; border-radius: 4px;">${msg.status || "未测试"}</span>
                </div>
                <div style="color: #888;">${msg.description || "无描述"}</div>
                <div style="color: #666; font-size: 10px;">参数: ${msg.params || "无"}</div>
            `;

			// 执行按钮
			const btnRun = document.createElement("ui-button");
			btnRun.innerText = "执行";
			btnRun.className = "tiny";
			btnRun.style.height = "20px";
			btnRun.style.lineHeight = "20px";
			btnRun.addEventListener("confirm", () => {
				this.runTest(msg.name);
			});

			item.appendChild(checkbox);
			item.appendChild(content);
			item.appendChild(btnRun);
			this.ipcList!.appendChild(item);
		});
	}

	/**
	 * 测试所有选中的 IPC 消息
	 */
	private async testSelected() {
		const checkboxes = this.root.querySelectorAll("#ipcList ui-checkbox");
		const toTest: string[] = [];
		checkboxes.forEach((cb: any) => {
			// 在 Cocos 2.x 中, ui-checkbox 的值是布尔型
			if (cb.checked || cb.value === true) {
				toTest.push(cb.getAttribute("data-name"));
			}
		});

		if (toTest.length === 0) {
			this.log("未选择任何消息。");
			return;
		}

		this.log(`开始批量测试 ${toTest.length} 条消息...`);
		for (const name of toTest) {
			await this.runTest(name);
		}
		this.log("批量测试完成。");
	}

	/**
	 * 运行单个测试请求
	 * @param name 消息名称
	 */
	private runTest(name: string): Promise<void> {
		return new Promise((resolve) => {
			let params = null;
			if (this.paramInput && this.paramInput.value.trim()) {
				try {
					params = JSON.parse(this.paramInput.value.trim());
				} catch (e) {
					this.log(`[错误] 无效的 JSON 参数: ${e}`);
					resolve();
					return;
				}
			}

			this.log(`正在测试: ${name}，参数: ${JSON.stringify(params)}...`);
			// @ts-ignore
			Editor.Ipc.sendToMain("mcp-bridge:test-ipc-message", { name, params }, (err: any, result: any) => {
				if (err) {
					this.log(`[${name}] 失败: ${err}`);
				} else {
					this.log(`[${name}] 成功: ${JSON.stringify(result)}`);
				}
				resolve();
			});
		});
	}

	/**
	 * 全选/取消全选
	 * @param checked 是否选中
	 */
	private toggleAll(checked: boolean) {
		const checkboxes = this.root.querySelectorAll("#ipcList ui-checkbox");
		checkboxes.forEach((cb: any) => {
			cb.value = checked;
		});
	}

	/**
	 * 输出日志到界面
	 * @param msg 日志消息
	 */
	private log(msg: string) {
		if (this.logArea) {
			// @ts-ignore
			const time = new Date().toLocaleTimeString();
			this.logArea.value += `[${time}] ${msg}\n`;
			this.logArea.scrollTop = this.logArea.scrollHeight;
		}
	}
}
