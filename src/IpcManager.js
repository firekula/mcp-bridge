"use strict";

const fs = require("fs");
const path = require("path");

/**
 * IPC 消息管理器
 * 负责解析 IPC 文档并执行消息测试
 */
class IpcManager {
    /**
     * 获取所有 IPC 消息列表
     * @returns {Array} 消息定义列表
     */
    static getIpcMessages() {
        // 获取文档路径
        const docPath = Editor.url("packages://mcp-bridge/docs/IPC_MESSAGES.md");
        if (!fs.existsSync(docPath)) {
            Editor.error(`[IPC 管理器] 找不到文档文件: ${docPath}`);
            return [];
        }

        const content = fs.readFileSync(docPath, "utf-8");
        const messages = [];

        // 正则匹配 ### `message-name`
        const regex = /### `(.*?)`\r?\n([\s\S]*?)(?=### `|$)/g;
        let match;

        while ((match = regex.exec(content)) !== null) {
            const name = match[1];
            const body = match[2];

            // 解析用途
            const purposeMatch = body.match(/- \*\*用途\*\*: (.*)/);
            const description = purposeMatch ? purposeMatch[1].trim() : "无描述";

            // 解析参数
            const paramsMatch = body.match(/- \*\*参数\*\*: (.*)/);
            const params = paramsMatch ? paramsMatch[1].trim() : "无";

            // 解析返回值
            const returnMatch = body.match(/- \*\*返回值\*\*: (.*)/);
            const returns = returnMatch ? returnMatch[1].trim() : "无";

            // 解析类型
            const typeMatch = body.match(/- \*\*类型\*\*: (.*)/);
            const type = typeMatch ? typeMatch[1].trim() : "未定义";

            // 解析状态
            const statusMatch = body.match(/- \*\*状态\*\*: (.*)/);
            const status = statusMatch ? statusMatch[1].trim() : "未测试";

            // 过滤掉广播事件和渲染进程监听的事件
            if (type === "广播事件" || type === "Events listened by Renderer Process" || type === "渲染进程监听") {
                continue;
            }

            messages.push({
                name,
                description,
                params,
                returns,
                type,
                status,
            });
        }

        return messages;
    }

    /**
     * 测试发送 IPC 消息
     * @param {string} name 消息名称
     * @param {*} args 参数
     * @returns {Promise} 测试结果
     */
    static testIpcMessage(name, args) {
        if (args === undefined) args = null;
        return new Promise((resolve) => {
            try {
                if (Editor.Ipc.sendToMain) {
                    Editor.Ipc.sendToMain(name, args);
                    resolve({ success: true, message: "消息已发送 (sendToMain)" });
                } else {
                    resolve({ success: false, message: "Editor.Ipc.sendToMain 不可用" });
                }
            } catch (e) {
                resolve({ success: false, message: `错误: ${e.message}` });
            }
        });
    }
}

module.exports = { IpcManager };
