"use strict";
const fs = require("fs");
const { IpcUi } = require("../dist/IpcUi");

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
		const root = this.shadowRoot;
		// 获取 DOM 元素
		const els = {
			port: root.querySelector("#portInput"),
			btnToggle: root.querySelector("#btnToggle"),
			autoStart: root.querySelector("#autoStartCheck"),
			logView: root.querySelector("#logConsole"),
			tabMain: root.querySelector("#tabMain"),
			tabTest: root.querySelector("#tabTest"),
			tabIpc: root.querySelector("#tabIpc"),
			panelMain: root.querySelector("#panelMain"),
			panelTest: root.querySelector("#panelTest"),
			panelIpc: root.querySelector("#panelIpc"),
			toolName: root.querySelector("#toolName"),
			toolParams: root.querySelector("#toolParams"),
			toolDescription: root.querySelector("#toolDescription"),
			toolsList: root.querySelector("#toolsList"),
			testBtn: root.querySelector("#testBtn"),
			listBtn: root.querySelector("#listToolsBtn"),
			clearBtn: root.querySelector("#clearTestBtn"),
			result: root.querySelector("#resultContent"),
			left: root.querySelector("#testLeftPanel"),
			resizer: root.querySelector("#testResizer"),
		};

		// 1. 初始化状态
		Editor.Ipc.sendToMain("mcp-bridge:get-server-state", (err, data) => {
			if (data) {
				els.port.value = data.config.port;
				els.autoStart.value = data.autoStart;
				this.updateUI(data.config.active);
				els.logView.innerHTML = "";
				data.logs.forEach((l) => this.renderLog(l));
			}
		});

		// 初始化 IPC UI
		new IpcUi(root);

		// 2. 标签切换
		els.tabMain.addEventListener("confirm", () => {
			els.tabMain.classList.add("active");
			els.tabTest.classList.remove("active");
			els.tabIpc.classList.remove("active");
			els.panelMain.classList.add("active");
			els.panelTest.classList.remove("active");
			els.panelIpc.classList.remove("active");
		});
		els.tabTest.addEventListener("confirm", () => {
			els.tabTest.classList.add("active");
			els.tabMain.classList.remove("active");
			els.tabIpc.classList.remove("active");
			els.panelTest.classList.add("active");
			els.panelMain.classList.remove("active");
			els.panelIpc.classList.remove("active");
			this.fetchTools(els);
		});
		els.tabIpc.addEventListener("confirm", () => {
			els.tabIpc.classList.add("active");
			els.tabMain.classList.remove("active");
			els.tabTest.classList.remove("active");
			els.panelIpc.classList.add("active");
			els.panelMain.classList.remove("active");
			els.panelTest.classList.remove("active");
		});

		// 3. 基础功能
		els.btnToggle.addEventListener("confirm", () => {
			Editor.Ipc.sendToMain("mcp-bridge:toggle-server", parseInt(els.port.value));
		});
		root.querySelector("#btnClear").addEventListener("confirm", () => {
			els.logView.innerHTML = "";
			Editor.Ipc.sendToMain("mcp-bridge:clear-logs");
		});
		root.querySelector("#btnCopy").addEventListener("confirm", () => {
			require("electron").clipboard.writeText(els.logView.innerText);
			Editor.success("Logs Copied");
		});
		els.autoStart.addEventListener("change", (e) => {
			Editor.Ipc.sendToMain("mcp-bridge:set-auto-start", e.target.value);
		});

		// 4. 测试页功能
		els.listBtn.addEventListener("confirm", () => this.fetchTools(els));
		els.clearBtn.addEventListener("confirm", () => {
			els.result.value = "";
		});
		els.testBtn.addEventListener("confirm", () => this.runTest(els));
		els.testBtn.addEventListener("confirm", () => this.runTest(els));
		// 添加 API 探查功能
		const probeBtn = root.querySelector("#probeApisBtn");
		if (probeBtn) {
			probeBtn.addEventListener("confirm", () => {
				Editor.Ipc.sendToMain("mcp-bridge:inspect-apis");
				els.result.value = "Probe command sent. Check console logs.";
			});
		}

		// 5. 【修复】拖拽逻辑
		if (els.resizer && els.left) {
			els.resizer.addEventListener("mousedown", (e) => {
				e.preventDefault();
				const startX = e.clientX;
				const startW = els.left.offsetWidth;
				const onMove = (ev) => {
					els.left.style.width = startW + (ev.clientX - startX) + "px";
				};
				const onUp = () => {
					document.removeEventListener("mousemove", onMove);
					document.removeEventListener("mouseup", onUp);
					document.body.style.cursor = "default";
				};
				document.addEventListener("mousemove", onMove);
				document.addEventListener("mouseup", onUp);
				document.body.style.cursor = "col-resize";
			});
		}
	},

	fetchTools(els) {
		const url = `http://localhost:${els.port.value}/list-tools`;
		fetch(url)
			.then((r) => r.json())
			.then((data) => {
				els.toolsList.innerHTML = "";
				const toolsMap = {};
				data.tools.forEach((t) => {
					toolsMap[t.name] = t;
					const item = document.createElement("div");
					item.className = "tool-item";
					item.textContent = t.name;
					item.onclick = () => {
						els.toolName.value = t.name;
						els.toolParams.value = JSON.stringify(this.getExample(t.name), null, 2);
						this.showToolDescription(els, t);
					};
					els.toolsList.appendChild(item);
				});
				// 保存工具映射表，以便后续检索
				this.toolsMap = toolsMap;
				els.result.value = `Loaded ${data.tools.length} tools.`;
			})
			.catch((e) => {
				els.result.value = "Error: " + e.message;
			});
	},

	showToolDescription(els, tool) {
		if (!tool) {
			els.toolDescription.textContent = "选择工具查看说明";
			return;
		}

		let description = tool.description || "无描述";
		let inputSchema = tool.inputSchema;

		let details = [];
		if (inputSchema && inputSchema.properties) {
			details.push("参数说明:");
			for (const [key, prop] of Object.entries(inputSchema.properties)) {
				let propDesc = `- ${key}`;
				if (prop.description) {
					propDesc += `: ${prop.description}`;
				}
				if (prop.required || (inputSchema.required && inputSchema.required.includes(key))) {
					propDesc += " (必填)";
				}
				details.push(propDesc);
			}
		}

		els.toolDescription.innerHTML = `${description}<br><br>${details.join('<br>')}`;
	},

	runTest(els) {
		const url = `http://localhost:${els.port.value}/call-tool`;
		const body = { name: els.toolName.value, arguments: JSON.parse(els.toolParams.value || "{}") };
		els.result.value = "Testing...";
		fetch(url, { method: "POST", body: JSON.stringify(body) })
			.then((r) => r.json())
			.then((d) => {
				els.result.value = JSON.stringify(d, null, 2);
			})
			.catch((e) => {
				els.result.value = "Error: " + e.message;
			});
	},

	getExample(name) {
		const examples = {
			set_node_name: { id: "UUID", newName: "Hello" },
			update_node_transform: { id: "UUID", x: 0, y: 0, color: "#FF0000" },
			create_node: { name: "Node", type: "sprite", parentId: "" },
			open_scene: { url: "db://assets/Scene.fire" },
			manage_editor: { action: "get_selection" },
			find_gameobjects: { conditions: { name: "Node", active: true }, recursive: true },
			manage_material: {
				action: "create",
				path: "db://assets/materials/NewMaterial.mat",
				properties: { uniforms: {} },
			},
			manage_texture: {
				action: "create",
				path: "db://assets/textures/NewTexture.png",
				properties: { width: 128, height: 128 },
			},
			execute_menu_item: { menuPath: "Assets/Create/Folder" },
			apply_text_edits: {
				filePath: "db://assets/scripts/TestScript.ts",
				edits: [{ type: "insert", position: 0, text: "// Test comment\n" }],
			},
			read_console: { limit: 10, type: "log" },
			validate_script: { filePath: "db://assets/scripts/TestScript.ts" },
		};
		return examples[name] || {};
	},

	renderLog(log) {
		const view = this.shadowRoot.querySelector("#logConsole");
		if (!view) return;
		const atBottom = view.scrollHeight - view.scrollTop <= view.clientHeight + 50;
		const el = document.createElement("div");
		el.className = `log-item ${log.type}`;
		el.innerHTML = `<span class="time">${log.time}</span><span class="msg">${log.content}</span>`;
		view.appendChild(el);
		if (atBottom) view.scrollTop = view.scrollHeight;
	},

	updateUI(active) {
		const btn = this.shadowRoot.querySelector("#btnToggle");
		if (!btn) return;
		btn.innerText = active ? "Stop" : "Start";
		btn.style.backgroundColor = active ? "#aa4444" : "#44aa44";
	},
});
