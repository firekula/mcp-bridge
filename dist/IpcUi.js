"use strict";
var __awaiter =
	(this && this.__awaiter) ||
	function (thisArg, _arguments, P, generator) {
		function adopt(value) {
			return value instanceof P
				? value
				: new P(function (resolve) {
						resolve(value);
					});
		}
		return new (P || (P = Promise))(function (resolve, reject) {
			function fulfilled(value) {
				try {
					step(generator.next(value));
				} catch (e) {
					reject(e);
				}
			}
			function rejected(value) {
				try {
					step(generator["throw"](value));
				} catch (e) {
					reject(e);
				}
			}
			function step(result) {
				result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
			}
			step((generator = generator.apply(thisArg, _arguments || [])).next());
		});
	};
var __generator =
	(this && this.__generator) ||
	function (thisArg, body) {
		var _ = {
				label: 0,
				sent: function () {
					if (t[0] & 1) throw t[1];
					return t[1];
				},
				trys: [],
				ops: [],
			},
			f,
			y,
			t,
			g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
		return (
			(g.next = verb(0)),
			(g["throw"] = verb(1)),
			(g["return"] = verb(2)),
			typeof Symbol === "function" &&
				(g[Symbol.iterator] = function () {
					return this;
				}),
			g
		);
		function verb(n) {
			return function (v) {
				return step([n, v]);
			};
		}
		function step(op) {
			if (f) throw new TypeError("Generator is already executing.");
			while ((g && ((g = 0), op[0] && (_ = 0)), _))
				try {
					if (
						((f = 1),
						y &&
							(t =
								op[0] & 2
									? y["return"]
									: op[0]
										? y["throw"] || ((t = y["return"]) && t.call(y), 0)
										: y.next) &&
							!(t = t.call(y, op[1])).done)
					)
						return t;
					if (((y = 0), t)) op = [op[0] & 2, t.value];
					switch (op[0]) {
						case 0:
						case 1:
							t = op;
							break;
						case 4:
							_.label++;
							return { value: op[1], done: false };
						case 5:
							_.label++;
							y = op[1];
							op = [0];
							continue;
						case 7:
							op = _.ops.pop();
							_.trys.pop();
							continue;
						default:
							if (
								!((t = _.trys), (t = t.length > 0 && t[t.length - 1])) &&
								(op[0] === 6 || op[0] === 2)
							) {
								_ = 0;
								continue;
							}
							if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) {
								_.label = op[1];
								break;
							}
							if (op[0] === 6 && _.label < t[1]) {
								_.label = t[1];
								t = op;
								break;
							}
							if (t && _.label < t[2]) {
								_.label = t[2];
								_.ops.push(op);
								break;
							}
							if (t[2]) _.ops.pop();
							_.trys.pop();
							continue;
					}
					op = body.call(thisArg, _);
				} catch (e) {
					op = [6, e];
					y = 0;
				} finally {
					f = t = 0;
				}
			if (op[0] & 5) throw op[1];
			return { value: op[0] ? op[1] : void 0, done: true };
		}
	};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IpcUi = void 0;
// @ts-ignore
var Editor = window.Editor;
var IpcUi = /** @class */ (function () {
	function IpcUi(root) {
		this.logArea = null;
		this.ipcList = null;
		this.allMessages = [];
		this.filterSelect = null;
		this.paramInput = null;
		this.root = root;
		this.bindEvents();
	}
	IpcUi.prototype.bindEvents = function () {
		var _this = this;
		var btnScan = this.root.querySelector("#btnScanIpc");
		var btnTest = this.root.querySelector("#btnTestIpc");
		var cbSelectAll = this.root.querySelector("#cbSelectAllIpc");
		this.logArea = this.root.querySelector("#ipcLog");
		this.ipcList = this.root.querySelector("#ipcList");
		this.filterSelect = this.root.querySelector("#ipcFilter");
		this.paramInput = this.root.querySelector("#ipcParams");
		if (btnScan) {
			btnScan.addEventListener("confirm", function () {
				return _this.scanMessages();
			});
		}
		if (btnTest) {
			btnTest.addEventListener("confirm", function () {
				return _this.testSelected();
			});
		}
		if (cbSelectAll) {
			cbSelectAll.addEventListener("change", function (e) {
				return _this.toggleAll(e.detail ? e.detail.value : e.target.value === "true" || e.target.checked);
			});
		}
		if (this.filterSelect) {
			this.filterSelect.addEventListener("change", function () {
				return _this.filterMessages();
			});
		}
	};
	IpcUi.prototype.scanMessages = function () {
		var _this = this;
		this.log("正在扫描 IPC 消息...");
		// @ts-ignore
		Editor.Ipc.sendToMain("mcp-bridge:scan-ipc-messages", function (err, msgs) {
			if (err) {
				_this.log("扫描错误: ".concat(err));
				return;
			}
			if (msgs) {
				_this.allMessages = msgs;
				_this.filterMessages();
				_this.log("找到 ".concat(msgs.length, " 条消息。"));
			} else {
				_this.log("未找到任何消息。");
			}
		});
	};
	IpcUi.prototype.filterMessages = function () {
		if (!this.allMessages) return;
		var filter = this.filterSelect ? this.filterSelect.value : "all";
		var filtered = this.allMessages;
		if (filter === "available") {
			filtered = this.allMessages.filter(function (m) {
				return m.status === "可用";
			});
		} else if (filter === "unavailable") {
			filtered = this.allMessages.filter(function (m) {
				return m.status && m.status.includes("不可用");
			});
		} else if (filter === "untested") {
			filtered = this.allMessages.filter(function (m) {
				return !m.status || m.status === "未测试";
			});
		}
		this.renderList(filtered);
	};
	IpcUi.prototype.renderList = function (msgs) {
		var _this = this;
		if (!this.ipcList) return;
		this.ipcList.innerHTML = "";
		msgs.forEach(function (msg) {
			var item = document.createElement("div");
			item.className = "ipc-item";
			item.style.padding = "4px";
			item.style.borderBottom = "1px solid #333";
			item.style.display = "flex";
			item.style.alignItems = "center";
			// Checkbox
			var checkbox = document.createElement("ui-checkbox");
			// @ts-ignore
			checkbox.value = false;
			checkbox.setAttribute("data-name", msg.name);
			checkbox.style.marginRight = "8px";
			// Content
			var content = document.createElement("div");
			content.style.flex = "1";
			content.style.fontSize = "11px";
			var statusColor = "#888"; // Untested
			if (msg.status === "可用")
				statusColor = "#4CAF50"; // Green
			else if (msg.status && msg.status.includes("不可用")) statusColor = "#F44336"; // Red
			content.innerHTML =
				'\n                <div style="display:flex; justify-content:space-between;">\n                    <span style="color: #4CAF50; font-weight: bold;">'
					.concat(msg.name, '</span>\n                    <span style="color: ')
					.concat(statusColor, "; font-size: 10px; border: 1px solid ")
					.concat(statusColor, '; padding: 0 4px; border-radius: 4px;">')
					.concat(
						msg.status || "未测试",
						'</span>\n                </div>\n                <div style="color: #888;">',
					)
					.concat(
						msg.description || "无描述",
						'</div>\n                <div style="color: #666; font-size: 10px;">参数: ',
					)
					.concat(msg.params || "无", "</div>\n            ");
			// Action Button
			var btnRun = document.createElement("ui-button");
			btnRun.innerText = "执行";
			btnRun.className = "tiny";
			btnRun.style.height = "20px";
			btnRun.style.lineHeight = "20px";
			btnRun.addEventListener("confirm", function () {
				_this.runTest(msg.name);
			});
			item.appendChild(checkbox);
			item.appendChild(content);
			item.appendChild(btnRun);
			_this.ipcList.appendChild(item);
		});
	};
	IpcUi.prototype.testSelected = function () {
		return __awaiter(this, void 0, void 0, function () {
			var checkboxes, toTest, _i, toTest_1, name_1;
			return __generator(this, function (_a) {
				switch (_a.label) {
					case 0:
						checkboxes = this.root.querySelectorAll("#ipcList ui-checkbox");
						toTest = [];
						checkboxes.forEach(function (cb) {
							// In Cocos 2.x, ui-checkbox value is boolean
							if (cb.checked || cb.value === true) {
								toTest.push(cb.getAttribute("data-name"));
							}
						});
						if (toTest.length === 0) {
							this.log("未选择任何消息。");
							return [2 /*return*/];
						}
						this.log("开始批量测试 ".concat(toTest.length, " 条消息..."));
						((_i = 0), (toTest_1 = toTest));
						_a.label = 1;
					case 1:
						if (!(_i < toTest_1.length)) return [3 /*break*/, 4];
						name_1 = toTest_1[_i];
						return [4 /*yield*/, this.runTest(name_1)];
					case 2:
						_a.sent();
						_a.label = 3;
					case 3:
						_i++;
						return [3 /*break*/, 1];
					case 4:
						this.log("批量测试完成。");
						return [2 /*return*/];
				}
			});
		});
	};
	IpcUi.prototype.runTest = function (name) {
		var _this = this;
		return new Promise(function (resolve) {
			var params = null;
			if (_this.paramInput && _this.paramInput.value.trim()) {
				try {
					params = JSON.parse(_this.paramInput.value.trim());
				} catch (e) {
					_this.log("[错误] 无效的 JSON 参数: ".concat(e));
					resolve();
					return;
				}
			}
			_this.log("正在测试: ".concat(name, "，参数: ").concat(JSON.stringify(params), "..."));
			// @ts-ignore
			Editor.Ipc.sendToMain(
				"mcp-bridge:test-ipc-message",
				{ name: name, params: params },
				function (err, result) {
					if (err) {
						_this.log("[".concat(name, "] 失败: ").concat(err));
					} else {
						_this.log("[".concat(name, "] 成功: ").concat(JSON.stringify(result)));
					}
					resolve();
				},
			);
		});
	};
	IpcUi.prototype.toggleAll = function (checked) {
		var checkboxes = this.root.querySelectorAll("#ipcList ui-checkbox");
		checkboxes.forEach(function (cb) {
			cb.value = checked;
		});
	};
	IpcUi.prototype.log = function (msg) {
		if (this.logArea) {
			// @ts-ignore
			var time = new Date().toLocaleTimeString();
			this.logArea.value += "[".concat(time, "] ").concat(msg, "\n");
			this.logArea.scrollTop = this.logArea.scrollHeight;
		}
	};
	return IpcUi;
})();
exports.IpcUi = IpcUi;
