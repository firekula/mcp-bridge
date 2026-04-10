"use strict";

/**
 * MCP Bridge 插件面板脚本
 * 负责处理面板 UI 交互、与主进程通信以及提供测试工具界面。
 */

import * as fs from "fs";

Editor.Panel.extend({
	/**
	 * 面板 CSS 样式
	 */
	style: fs.readFileSync(Editor.url("packages://mcp-bridge/panel/index.html"), "utf-8"),

	/**
	 * 面板 HTML 模板
	 */
	template: fs.readFileSync(Editor.url("packages://mcp-bridge/panel/index.html"), "utf-8"),

	/**
	 * 监听来自主进程的消息
	 */
	messages: {
		/**
		 * 接收并渲染日志
		 * @param {Object} event IPC 事件对象
		 * @param {Object} log 日志数据
		 */
		"mcp-bridge:on-log"(event, log) {
			this.renderLog(log);
		},

		/**
		 * 服务器状态变更通知
		 * @param {Object} event IPC 事件对象
		 * @param {Object} config 服务器配置
		 */
		"mcp-bridge:state-changed"(event, config) {
			Editor.Ipc.sendToMain("mcp-bridge:get-server-state", (err, data) => {
				if (data) {
					const portInput = (this as any).shadowRoot.querySelector("#portInput") as HTMLInputElement;
					if (portInput) portInput.value = data.config.port;

					this.updateUI(data.config.active);

					const activePortDisplay = (this as any).shadowRoot.querySelector(
						"#activePortDisplay",
					) as HTMLElement;
					if (data.config.active && activePortDisplay) {
						activePortDisplay.style.display = "inline";
						const actPort = parseInt(data.config.port);
						activePortDisplay.textContent = `(当前生效: ${actPort})`;
						activePortDisplay.style.color = "#888";
					} else {
						if (activePortDisplay) activePortDisplay.style.display = "none";
					}
				}
			});
		},
	},

	/**
	 * 面板就绪回调，进行 DOM 绑定与事件初始化
	 */
	ready() {
		const root = (this as any).shadowRoot;
		// 获取 DOM 元素映射
		const els = {
			port: root.querySelector("#portInput"),
			btnToggle: root.querySelector("#btnToggle"),
			autoStart: root.querySelector("#autoStartCheck"),
			logView: root.querySelector("#logConsole"),
			tabMain: root.querySelector("#tabMain"),
			tabConfig: root.querySelector("#tabConfig"),
			panelMain: root.querySelector("#panelMain"),
			panelConfig: root.querySelector("#panelConfig"),
			mcpClientSelect: root.querySelector("#mcpClientSelect"),
			mcpConfigStatus: root.querySelector("#mcpConfigStatus"),
			btnRefreshMcp: root.querySelector("#btnRefreshMcp"),
			btnInjectMcp: root.querySelector("#btnInjectMcp"),
			btnInjectAll: root.querySelector("#btnInjectAll"),
		};

		// 1. 初始化服务器状态与配置
		Editor.Ipc.sendToMain("mcp-bridge:get-server-state", (err, data) => {
			if (data) {
				els.port.value = data.config.port;
				els.autoStart.value = data.autoStart;
				this.updateUI(data.config.active);

				const activePortDisplay = root.querySelector("#activePortDisplay") as HTMLElement;
				if (data.config.active && activePortDisplay) {
					activePortDisplay.style.display = "inline";
					const actPort = parseInt(data.config.port);
					activePortDisplay.textContent = `(当前生效: ${actPort})`;
					activePortDisplay.style.color = "#888";
				} else {
					if (activePortDisplay) activePortDisplay.style.display = "none";
				}

				els.logView.innerHTML = "";
				data.logs.forEach((l) => this.renderLog(l));
			}
		});

		// 2. 标签页切换逻辑
		const switchTab = (activeTab, activePanel) => {
			[els.tabMain, els.tabConfig].forEach((t) => {
				if (t) t.classList.remove("active");
			});
			[els.panelMain, els.panelConfig].forEach((p) => {
				if (p) p.classList.remove("active");
			});
			if (activeTab) activeTab.classList.add("active");
			if (activePanel) activePanel.classList.add("active");
		};

		if (els.tabMain) els.tabMain.addEventListener("confirm", () => switchTab(els.tabMain, els.panelMain));

		if (els.tabConfig) {
			els.tabConfig.addEventListener("confirm", () => {
				switchTab(els.tabConfig, els.panelConfig);
				this.fetchMcpClients(els);
			});
		}

		// 3. 基础控制按钮逻辑
		els.btnToggle.addEventListener("confirm", () => {
			Editor.Ipc.sendToMain("mcp-bridge:toggle-server", parseInt(els.port.value));
		});

		root.querySelector("#btnClear").addEventListener("confirm", () => {
			els.logView.innerHTML = "";
			Editor.Ipc.sendToMain("mcp-bridge:clear-logs");
		});

		root.querySelector("#btnCopy").addEventListener("confirm", () => {
			require("electron").clipboard.writeText(els.logView.innerText);
			Editor.success("日志已复制到剪贴板");
		});

		els.autoStart.addEventListener("change", (e) => {
			Editor.Ipc.sendToMain("mcp-bridge:set-auto-start", e.target.value);
		});

		// 4.5 MCP 配置页交互逻辑
		if (els.btnRefreshMcp) els.btnRefreshMcp.addEventListener("confirm", () => this.fetchMcpClients(els));
		if (els.btnInjectMcp) {
			els.btnInjectMcp.addEventListener("confirm", () => {
				const clientId = parseInt(els.mcpClientSelect.value);
				if (!isNaN(clientId)) this.injectMcpConfig(clientId, els);
			});
		}
		if (els.btnInjectAll) {
			els.btnInjectAll.addEventListener("confirm", () => {
				this.injectMcpConfig(-1, els);
			});
		}
		if (els.mcpClientSelect) {
			els.mcpClientSelect.addEventListener("change", () => {
				this.renderMcpClientStatus(els);
			});
		}
	},

	fetchMcpClients(els) {
		if (!els.mcpClientSelect) return;
		els.mcpConfigStatus.innerHTML = "<span style='color:#ffb74d'>正在扫描系统配置...</span>";
		Editor.Ipc.sendToMain("mcp-bridge:mcp-scan-clients", (err, clients) => {
			if (err) {
				els.mcpConfigStatus.innerHTML = `<span style='color:#f44336'>扫描失败: ${err.message}</span>`;
				return;
			}
			this.mcpClientsData = clients;
			els.mcpClientSelect.innerHTML = "";
			clients.forEach((client) => {
				const opt = document.createElement("option");
				opt.value = client.id;
				opt.textContent = client.name;
				els.mcpClientSelect.appendChild(opt);
			});
			this.renderMcpClientStatus(els);
		});
	},

	renderMcpClientStatus(els) {
		if (!this.mcpClientsData || !els.mcpClientSelect.value) return;
		const clientId = parseInt(els.mcpClientSelect.value);
		const client = this.mcpClientsData.find((c) => c.id === clientId);
		if (!client) return;

		let statusHtml = `<div style="word-break: break-all;">储存路径: <span style="color:#aaa">${client.path || "未知"}</span></div>`;
		if (client.isError) {
			statusHtml += `<div style="color:#f44336; margin-top:5px; font-weight:bold;">🔴 配置文件损坏</div>`;
		} else if (!client.isInstalled) {
			statusHtml += `<div style="color:#f44336; margin-top:5px; font-weight:bold;">🔴 未安装此客户端或找不到配置文件</div>`;
		} else if (client.isConfigured) {
			statusHtml += `<div style="color:#4caf50; margin-top:5px; font-weight:bold;">🟢 当前已连通 (MCP已配置)</div>`;
		} else {
			statusHtml += `<div style="color:#ff9800; margin-top:5px; font-weight:bold;">🟡 发现配置目录，但尚未设置 MCP 服务</div>`;
		}
		els.mcpConfigStatus.innerHTML = statusHtml;
	},

	injectMcpConfig(clientId, els) {
		els.mcpConfigStatus.innerHTML += "<br><span style='color:#1976d2'>正在注入配置...</span>";
		Editor.Ipc.sendToMain("mcp-bridge:mcp-inject-client", clientId, (err, log) => {
			if (err) {
				this.renderLog({
					type: "error",
					time: new Date().toLocaleTimeString(),
					content: "配置失败: " + err.message,
				});
			} else {
				this.renderLog({
					type: "success",
					time: new Date().toLocaleTimeString(),
					content: "MCP 配置结果:\n" + log,
				});
			}
			// 回到主页以便查看日志
			if (els.tabMain) {
				els.tabMain.dispatchEvent(new Event("confirm"));
			}
			// 重新刷新下数据，但由于刚才跳到了主页所以下次回配置页时会刷新。
			setTimeout(() => this.fetchMcpClients(els), 500);
		});
	},

	/**
	 * 将日志条目渲染至面板控制台
	 * @param {Object} log 日志对象
	 */
	renderLog(log: any) {
		const view = (this as any).shadowRoot.querySelector("#logConsole") as HTMLElement;
		if (!view) return;
		// 限制面板日志 DOM 节点数量，防止长时间运行后面板卡顿
		while (view.childNodes.length > 1000) {
			view.removeChild(view.firstChild);
		}
		const atBottom = view.scrollHeight - view.scrollTop <= view.clientHeight + 50;
		const el = document.createElement("div");
		el.className = `log-item ${log.type}`;
		// 使用 textContent 代替 innerHTML 防止 XSS 注入
		const timeSpan = document.createElement("span");
		timeSpan.className = "time";
		timeSpan.textContent = log.time;
		const msgSpan = document.createElement("span");
		msgSpan.className = "msg";
		msgSpan.textContent = log.content;
		el.appendChild(timeSpan);
		el.appendChild(msgSpan);
		view.appendChild(el);
		if (atBottom) view.scrollTop = view.scrollHeight;
	},

	/**
	 * 根据服务器运行状态更新 UI 按钮文字与样式
	 * @param {boolean} active 服务器是否处于激活状态
	 */
	updateUI(active: boolean) {
		const btn = (this as any).shadowRoot.querySelector("#btnToggle") as HTMLElement;
		if (!btn) return;
		btn.innerText = active ? "停止" : "启动";
		btn.style.backgroundColor = active ? "#aa4444" : "#44aa44";
	},
});
