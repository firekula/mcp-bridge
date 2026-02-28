"use strict";

/**
 * MCP Bridge 插件面板脚本
 * 负责处理面板 UI 交互、与主进程通信以及提供测试工具界面。
 */

const fs = require("fs");
const { IpcUi } = require("../src/IpcUi");

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
            this.updateUI(config.active);
            // 如果服务器已启动，更新面板显示的端口为实际运行端口
            if (config.active && config.port) {
                const portInput = this.shadowRoot.querySelector("#portInput");
                if (portInput) portInput.value = config.port;
            }
        },
    },

    /**
     * 面板就绪回调，进行 DOM 绑定与事件初始化
     */
    ready() {
        const root = this.shadowRoot;
        // 获取 DOM 元素映射
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

        // 1. 初始化服务器状态与配置
        Editor.Ipc.sendToMain("mcp-bridge:get-server-state", (err, data) => {
            if (data) {
                els.port.value = data.config.port;
                els.autoStart.value = data.autoStart;
                this.updateUI(data.config.active);
                els.logView.innerHTML = "";
                data.logs.forEach((l) => this.renderLog(l));
            }
        });

        // 初始化 IPC 调试专用 UI
        new IpcUi(root);

        // 2. 标签页切换逻辑
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
            this.fetchTools(els); // 切换到测试页时自动拉取工具列表
        });

        els.tabIpc.addEventListener("confirm", () => {
            els.tabIpc.classList.add("active");
            els.tabMain.classList.remove("active");
            els.tabTest.classList.remove("active");
            els.panelIpc.classList.add("active");
            els.panelMain.classList.remove("active");
            els.panelTest.classList.remove("active");
        });

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

        // 4. API 测试页交互逻辑
        els.listBtn.addEventListener("confirm", () => this.fetchTools(els));
        els.clearBtn.addEventListener("confirm", () => {
            els.result.value = "";
        });
        els.testBtn.addEventListener("confirm", () => this.runTest(els));

        // API 探查功能 (辅助开发者发现可用内部 IPC)
        const probeBtn = root.querySelector("#probeApisBtn");
        if (probeBtn) {
            probeBtn.addEventListener("confirm", () => {
                Editor.Ipc.sendToMain("mcp-bridge:inspect-apis");
                els.result.value = "API 探查指令已发送。请查看编辑器控制台 (Console) 获取详细报告。";
            });
        }

        // 5. 测试页分栏拖拽缩放逻辑
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

    /**
     * 从本地服务器获取 MCP 工具列表并渲染
     * @param {Object} els DOM 元素映射
     */
    fetchTools(els) {
        const url = `http://localhost:${els.port.value}/list-tools`;
        els.result.value = "正在获取工具列表...";
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
                this.toolsMap = toolsMap;
                els.result.value = `成功：加载了 ${data.tools.length} 个工具。`;
            })
            .catch((e) => {
                els.result.value = "获取失败: " + e.message;
            });
    },

    /**
     * 在面板中展示工具的详细描述与参数定义
     * @param {Object} els DOM 元素映射
     * @param {Object} tool 工具定义对象
     */
    showToolDescription(els, tool) {
        if (!tool) {
            els.toolDescription.textContent = "选择工具以查看说明";
            return;
        }

        let description = tool.description || "暂无描述";
        let inputSchema = tool.inputSchema;

        let details = [];
        if (inputSchema && inputSchema.properties) {
            details.push("<b>参数说明:</b>");
            for (const [key, prop] of Object.entries(inputSchema.properties)) {
                let propDesc = `- <code>${key}</code>`;
                if (prop.description) {
                    propDesc += `: ${prop.description}`;
                }
                if (prop.required || (inputSchema.required && inputSchema.required.includes(key))) {
                    propDesc += " <span style='color:#f44'>(必填)</span>";
                }
                details.push(propDesc);
            }
        }

        els.toolDescription.innerHTML = `${description}<br><br>${details.join("<br>")}`;
    },

    /**
     * 执行工具测试请求
     * @param {Object} els DOM 元素映射
     */
    runTest(els) {
        const url = `http://localhost:${els.port.value}/call-tool`;
        let args;
        try {
            args = JSON.parse(els.toolParams.value || "{}");
        } catch (e) {
            els.result.value = "JSON 格式错误: " + e.message;
            return;
        }

        const body = { name: els.toolName.value, arguments: args };
        els.result.value = "正在发送请求...";
        fetch(url, { method: "POST", body: JSON.stringify(body) })
            .then((r) => r.json())
            .then((d) => {
                els.result.value = JSON.stringify(d, null, 2);
            })
            .catch((e) => {
                els.result.value = "测试异常: " + e.message;
            });
    },

    /**
     * 获取指定工具的示例参数
     * @param {string} name 工具名称
     * @returns {Object} 示例参数对象
     */
    getExample(name) {
        const examples = {
            set_node_name: { id: "节点-UUID", newName: "新名称" },
            update_node_transform: { id: "节点-UUID", x: 0, y: 0, color: "#FF0000" },
            create_node: { name: "新节点", type: "sprite", parentId: "" },
            open_scene: { url: "db://assets/Scene.fire" },
            open_prefab: { url: "db://assets/MyPrefab.prefab" },
            manage_editor: { action: "get_selection" },
            find_gameobjects: { conditions: { name: "MyNode", active: true }, recursive: true },
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
                edits: [{ type: "insert", position: 0, text: "// 测试注释\n" }],
            },
            read_console: { limit: 10, type: "log" },
            validate_script: { filePath: "db://assets/scripts/TestScript.ts" },
        };
        return examples[name] || {};
    },

    /**
     * 将日志条目渲染至面板控制台
     * @param {Object} log 日志对象
     */
    renderLog(log) {
        const view = this.shadowRoot.querySelector("#logConsole");
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
    updateUI(active) {
        const btn = this.shadowRoot.querySelector("#btnToggle");
        if (!btn) return;
        btn.innerText = active ? "停止" : "启动";
        btn.style.backgroundColor = active ? "#aa4444" : "#44aa44";
    },
});
