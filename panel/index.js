"use strict";

const fs = require("fs");

Editor.Panel.extend({
	style: fs.readFileSync(Editor.url("packages://mcp-bridge/panel/index.html"), "utf-8"),
	template: fs.readFileSync(Editor.url("packages://mcp-bridge/panel/index.html"), "utf-8"),

	messages: {
		"mcp-bridge:on-log"(event, log) {
			this.renderLog(log);
		},
		"mcp-bridge:state-changed"(event, config) {
			this.updateUI(config.active);
		},
	},

	ready() {
		const portInput = this.shadowRoot.querySelector("#portInput");
		const btnToggle = this.shadowRoot.querySelector("#btnToggle");
		const autoStartCheck = this.shadowRoot.querySelector("#autoStartCheck");
		const btnClear = this.shadowRoot.querySelector("#btnClear");
		const btnCopy = this.shadowRoot.querySelector("#btnCopy");
		const logView = this.shadowRoot.querySelector("#logConsole");

		// 初始化
		Editor.Ipc.sendToMain("mcp-bridge:get-server-state", (err, data) => {
			if (data) {
				portInput.value = data.config.port;
				this.updateUI(data.config.active);
				data.logs.forEach((log) => this.renderLog(log));
			}
		});

		btnToggle.addEventListener("confirm", () => {
			Editor.Ipc.sendToMain("mcp-bridge:toggle-server", parseInt(portInput.value));
		});

		btnClear.addEventListener("confirm", () => {
			logView.innerHTML = "";
			Editor.Ipc.sendToMain("mcp-bridge:clear-logs");
		});

		btnCopy.addEventListener("confirm", () => {
			require("electron").clipboard.writeText(logView.innerText);
			Editor.success("All logs copied!");
		});
		Editor.Ipc.sendToMain("mcp-bridge:get-server-state", (err, data) => {
			if (data) {
				portInput.value = data.config.port;
				this.updateUI(data.config.active);

				// 设置自动启动复选框状态
				autoStartCheck.value = data.autoStart;

				data.logs.forEach((log) => this.renderLog(log));
			}
		});
		autoStartCheck.addEventListener("change", (event) => {
			// event.target.value 在 ui-checkbox 中是布尔值
			Editor.Ipc.sendToMain("mcp-bridge:set-auto-start", event.target.value);
		});
	},

	renderLog(log) {
		const logView = this.shadowRoot.querySelector("#logConsole");
		if (!logView) return;

		// 记录当前滚动条位置
		const isAtBottom = logView.scrollHeight - logView.scrollTop <= logView.clientHeight + 50;

		const el = document.createElement("div");
		el.className = `log-item ${log.type}`;
		el.innerHTML = `<span class="time">${log.time}</span><span class="msg">${log.content}</span>`;
		logView.appendChild(el);

		// 如果用户正在向上翻看，不自动滚动；否则自动滚到底部
		if (isAtBottom) {
			logView.scrollTop = logView.scrollHeight;
		}
	},

	updateUI(isActive) {
		const btnToggle = this.shadowRoot.querySelector("#btnToggle");
		if (!btnToggle) return;
		btnToggle.innerText = isActive ? "Stop" : "Start";
		btnToggle.style.backgroundColor = isActive ? "#aa4444" : "#44aa44";
	},
});
