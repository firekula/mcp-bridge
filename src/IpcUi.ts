
// @ts-ignore
const Editor = window.Editor;

export class IpcUi {
    private root: ShadowRoot;
    private logArea: HTMLTextAreaElement | null = null;
    private ipcList: HTMLElement | null = null;
    private allMessages: any[] = [];
    private filterSelect: HTMLSelectElement | null = null;
    private paramInput: HTMLTextAreaElement | null = null;

    constructor(root: ShadowRoot) {
        this.root = root;
        this.bindEvents();
    }

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
            cbSelectAll.addEventListener("change", (e: any) => this.toggleAll(e.detail ? e.detail.value : (e.target.value === 'true' || e.target.checked)));
        }
        if (this.filterSelect) {
            this.filterSelect.addEventListener("change", () => this.filterMessages());
        }
    }

    private scanMessages() {
        this.log("Scanning IPC messages...");
        // @ts-ignore
        Editor.Ipc.sendToMain("mcp-bridge:scan-ipc-messages", (err: any, msgs: any[]) => {
            if (err) {
                this.log(`Scan Error: ${err}`);
                return;
            }
            if (msgs) {
                this.allMessages = msgs;
                this.filterMessages();
                this.log(`Found ${msgs.length} messages.`);
            } else {
                this.log("No messages found.");
            }
        });
    }

    private filterMessages() {
        if (!this.allMessages) return;
        const filter = this.filterSelect ? this.filterSelect.value : "all";

        let filtered = this.allMessages;
        if (filter === "available") {
            filtered = this.allMessages.filter(m => m.status === "可用");
        } else if (filter === "unavailable") {
            filtered = this.allMessages.filter(m => m.status && m.status.includes("不可用"));
        } else if (filter === "untested") {
            filtered = this.allMessages.filter(m => !m.status || m.status === "未测试");
        }

        this.renderList(filtered);
    }

    private renderList(msgs: any[]) {
        if (!this.ipcList) return;
        this.ipcList.innerHTML = "";

        msgs.forEach(msg => {
            const item = document.createElement("div");
            item.className = "ipc-item";
            item.style.padding = "4px";
            item.style.borderBottom = "1px solid #333";
            item.style.display = "flex";
            item.style.alignItems = "center";

            // Checkbox
            const checkbox = document.createElement("ui-checkbox");
            // @ts-ignore
            checkbox.value = false;
            checkbox.setAttribute("data-name", msg.name);
            checkbox.style.marginRight = "8px";

            // Content
            const content = document.createElement("div");
            content.style.flex = "1";
            content.style.fontSize = "11px";

            let statusColor = "#888"; // Untested
            if (msg.status === "可用") statusColor = "#4CAF50"; // Green
            else if (msg.status && msg.status.includes("不可用")) statusColor = "#F44336"; // Red

            content.innerHTML = `
                <div style="display:flex; justify-content:space-between;">
                    <span style="color: #4CAF50; font-weight: bold;">${msg.name}</span>
                    <span style="color: ${statusColor}; font-size: 10px; border: 1px solid ${statusColor}; padding: 0 4px; border-radius: 4px;">${msg.status || "未测试"}</span>
                </div>
                <div style="color: #888;">${msg.description || "No desc"}</div>
                <div style="color: #666; font-size: 10px;">Params: ${msg.params || "None"}</div>
            `;

            // Action Button
            const btnRun = document.createElement("ui-button");
            btnRun.innerText = "Run";
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

    private async testSelected() {
        const checkboxes = this.root.querySelectorAll("#ipcList ui-checkbox");
        const toTest: string[] = [];
        checkboxes.forEach((cb: any) => {
            // In Cocos 2.x, ui-checkbox value is boolean
            if (cb.checked || cb.value === true) {
                toTest.push(cb.getAttribute("data-name"));
            }
        });

        if (toTest.length === 0) {
            this.log("No messages selected.");
            return;
        }

        this.log(`Starting batch test for ${toTest.length} messages...`);
        for (const name of toTest) {
            await this.runTest(name);
        }
        this.log("Batch test completed.");
    }

    private runTest(name: string): Promise<void> {
        return new Promise((resolve) => {
            let params = null;
            if (this.paramInput && this.paramInput.value.trim()) {
                try {
                    params = JSON.parse(this.paramInput.value.trim());
                } catch (e) {
                    this.log(`[Error] Invalid JSON Params: ${e}`);
                    resolve();
                    return;
                }
            }

            this.log(`Testing: ${name} with params: ${JSON.stringify(params)}...`);
            // @ts-ignore
            Editor.Ipc.sendToMain("mcp-bridge:test-ipc-message", { name, params }, (err: any, result: any) => {
                if (err) {
                    this.log(`[${name}] Failed: ${err}`);
                } else {
                    this.log(`[${name}] Success: ${JSON.stringify(result)}`);
                }
                resolve();
            });
        });
    }

    private toggleAll(checked: boolean) {
        const checkboxes = this.root.querySelectorAll("#ipcList ui-checkbox");
        checkboxes.forEach((cb: any) => {
            cb.value = checked;
        });
    }

    private log(msg: string) {
        if (this.logArea) {
            // @ts-ignore
            const time = new Date().toLocaleTimeString();
            this.logArea.value += `[${time}] ${msg}\n`;
            this.logArea.scrollTop = this.logArea.scrollHeight;
        }
    }
}
