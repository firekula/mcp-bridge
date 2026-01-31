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

		// 标签页元素
		const tabMain = this.shadowRoot.querySelector("#tabMain");
		const tabTest = this.shadowRoot.querySelector("#tabTest");
		const panelMain = this.shadowRoot.querySelector("#panelMain");
		const panelTest = this.shadowRoot.querySelector("#panelTest");

		// 测试面板元素
		const toolNameInput = this.shadowRoot.querySelector("#toolName");
		const toolParamsTextarea = this.shadowRoot.querySelector("#toolParams");
		const toolsList = this.shadowRoot.querySelector("#toolsList");
		const testBtn = this.shadowRoot.querySelector("#testBtn");
		const listToolsBtn = this.shadowRoot.querySelector("#listToolsBtn");
		const clearBtn = this.shadowRoot.querySelector("#clearBtn");
		const resultContent = this.shadowRoot.querySelector("#resultContent");

		let tools = [];
		const API_BASE = 'http://localhost:3456';

		// 初始化
		Editor.Ipc.sendToMain("mcp-bridge:get-server-state", (err, data) => {
			if (data) {
				portInput.value = data.config.port;
				this.updateUI(data.config.active);
				data.logs.forEach((log) => this.renderLog(log));
			}
		});

		// 标签页切换
		tabMain.addEventListener("confirm", () => {
			tabMain.classList.add("active");
			tabTest.classList.remove("active");
			panelMain.classList.add("active");
			panelTest.classList.remove("active");
		});

		tabTest.addEventListener("confirm", () => {
			tabTest.classList.add("active");
			tabMain.classList.remove("active");
			panelTest.classList.add("active");
			panelMain.classList.remove("active");
			// 自动获取工具列表
			this.getToolsList();
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

		// 测试面板事件
		testBtn.addEventListener("confirm", () => this.testTool());
		listToolsBtn.addEventListener("confirm", () => this.getToolsList());
		clearBtn.addEventListener("confirm", () => this.clearResult());

		// 获取工具列表
		this.getToolsList = function() {
			this.showResult('获取工具列表中...');
			
			fetch(`${API_BASE}/list-tools`)
				.then(response => {
					if (!response.ok) {
						throw new Error(`HTTP error! status: ${response.status}`);
					}
					return response.json();
				})
				.then(data => {
					if (data.tools) {
						tools = data.tools;
						this.displayToolsList(tools);
						this.showResult(`成功获取 ${tools.length} 个工具`, 'success');
					} else {
						this.showResult('获取工具列表失败：未找到工具数据', 'error');
					}
				})
				.catch(error => {
					this.showResult(`获取工具列表失败：${error.message}`, 'error');
				});
		};

		// 显示工具列表
		this.displayToolsList = function(tools) {
			toolsList.innerHTML = '';
			
			tools.forEach(tool => {
				const toolItem = document.createElement('div');
				toolItem.className = 'tool-item';
				toolItem.textContent = `${tool.name} - ${tool.description}`;
				toolItem.addEventListener('click', () => {
					toolNameInput.value = tool.name;
					// 尝试填充示例参数
					this.fillExampleParams(tool);
				});
				toolsList.appendChild(toolItem);
			});
		};

		// 填充示例参数
		this.fillExampleParams = function(tool) {
			let exampleParams = {};
			
			switch (tool.name) {
				case 'get_selected_node':
				case 'save_scene':
				case 'get_scene_hierarchy':
					exampleParams = {};
					break;
				
				case 'set_node_name':
					exampleParams = {
						"id": "节点UUID",
						"newName": "新节点名称"
					};
					break;
				
				case 'update_node_transform':
					exampleParams = {
						"id": "节点UUID",
						"x": 100,
						"y": 100,
						"scaleX": 1,
						"scaleY": 1
					};
					break;
				
				case 'create_scene':
					exampleParams = {
						"sceneName": "NewScene"
					};
					break;
				
				case 'create_prefab':
					exampleParams = {
						"nodeId": "节点UUID",
						"prefabName": "NewPrefab"
					};
					break;
				
				case 'open_scene':
					exampleParams = {
						"url": "db://assets/NewScene.fire"
					};
					break;
				
				case 'create_node':
					exampleParams = {
						"name": "NewNode",
						"parentId": "父节点UUID",
						"type": "empty"
					};
					break;
				
				case 'manage_components':
					exampleParams = {
						"nodeId": "节点UUID",
						"action": "add",
						"componentType": "cc.Button"
					};
					break;
				
				case 'manage_script':
					exampleParams = {
						"action": "create",
						"path": "db://assets/scripts/TestScript.ts",
						"content": "const { ccclass, property } = cc._decorator;\n\n@ccclass\nexport default class TestScript extends cc.Component {\n    // LIFE-CYCLE CALLBACKS:\n\n    onLoad () {}\n\n    start () {}\n\n    update (dt) {}\n}"
					};
					break;
				
				case 'batch_execute':
					exampleParams = {
						"operations": [
							{
								"tool": "get_selected_node",
								"params": {}
							}
						]
					};
					break;
				
				case 'manage_asset':
					exampleParams = {
						"action": "create",
						"path": "db://assets/test.txt",
						"content": "Hello, MCP!"
					};
					break;
			}
			
			toolParamsTextarea.value = JSON.stringify(exampleParams, null, 2);
		};

		// 测试工具
		this.testTool = function() {
			const toolName = toolNameInput.value.trim();
			const toolParamsStr = toolParamsTextarea.value.trim();
			
			if (!toolName) {
				this.showResult('请输入工具名称', 'error');
				return;
			}
			
			let toolParams;
			try {
				toolParams = toolParamsStr ? JSON.parse(toolParamsStr) : {};
			} catch (error) {
				this.showResult(`参数格式错误：${error.message}`, 'error');
				return;
			}
			
			this.showResult('测试工具中...');
			
			fetch(`${API_BASE}/call-tool`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					name: toolName,
					arguments: toolParams
				})
			})
			.then(response => {
				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}
				return response.json();
			})
			.then(data => {
				if (data.error) {
					this.showResult(`测试失败：${data.error}`, 'error');
				} else {
					this.showResult(JSON.stringify(data, null, 2), 'success');
				}
			})
			.catch(error => {
				this.showResult(`测试失败：${error.message}`, 'error');
			});
		};

		// 显示结果
		this.showResult = function(message, type = 'info') {
			resultContent.value = message;
			
			// 移除旧样式
			resultContent.className = '';
			
			// 添加新样式
			if (type === 'error' || type === 'success') {
				resultContent.className = type;
			}
		};

		// 清空结果
		this.clearResult = function() {
			this.showResult('点击"测试工具"按钮开始测试');
		};
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
