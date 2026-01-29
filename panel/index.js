"use strict";

const fs = require("fs");
const path = require("path");

Editor.Panel.extend({
	// 读取样式和模板
	style: fs.readFileSync(Editor.url("packages://mcp-bridge/panel/index.html"), "utf-8"),
	template: fs.readFileSync(Editor.url("packages://mcp-bridge/panel/index.html"), "utf-8"),

	// 面板渲染成功后的回调
	ready() {
		// 使用 querySelector 确保能拿到元素，避免依赖可能为 undefined 的 this.$
		const btnGet = this.shadowRoot.querySelector("#btn-get");
		const btnSet = this.shadowRoot.querySelector("#btn-set");
		const nodeIdInput = this.shadowRoot.querySelector("#nodeId");
		const newNameInput = this.shadowRoot.querySelector("#newName");
		const logDiv = this.shadowRoot.querySelector("#log");

		if (!btnGet || !btnSet) {
			Editor.error("Failed to find UI elements. Check if IDs in HTML match.");
			return;
		}

		// 测试获取信息
		btnGet.addEventListener("confirm", () => {
			Editor.Ipc.sendToMain("mcp-bridge:get-selected-info", (err, ids) => {
				if (ids && ids.length > 0) {
					nodeIdInput.value = ids[0];
					logDiv.innerText = "Status: Selected Node " + ids[0];
				} else {
					logDiv.innerText = "Status: No node selected";
				}
			});
		});

		// 测试修改信息
		btnSet.addEventListener("confirm", () => {
			let data = {
				id: nodeIdInput.value,
				path: "name",
				value: newNameInput.value,
			};

			if (!data.id) {
				logDiv.innerText = "Error: Please get Node ID first";
				return;
			}

			Editor.Ipc.sendToMain("mcp-bridge:set-node-property", data, (err, res) => {
				if (err) {
					logDiv.innerText = "Error: " + err;
				} else {
					logDiv.innerText = "Success: " + res;
				}
			});
		});
	},
});
