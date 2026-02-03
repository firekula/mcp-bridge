"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IpcManager = void 0;
// @ts-ignore
var fs = require('fs');
// @ts-ignore
var path = require('path');
/**
 * IPC 消息管理器
 * 负责解析 IPC 文档并执行消息测试
 */
var IpcManager = /** @class */ (function () {
    function IpcManager() {
    }
    /**
     * 获取所有 IPC 消息列表
     * @returns 消息定义列表
     */
    IpcManager.getIpcMessages = function () {
        // 获取文档路径
        // @ts-ignore
        var docPath = Editor.url('packages://mcp-bridge/IPC_MESSAGES.md');
        if (!fs.existsSync(docPath)) {
            // @ts-ignore
            Editor.error("[IPC Manager] Document not found: ".concat(docPath));
            return [];
        }
        var content = fs.readFileSync(docPath, 'utf-8');
        var messages = [];
        // 正则匹配 ### `message-name`
        var regex = /### `(.*?)`\r?\n([\s\S]*?)(?=### `|$)/g;
        var match;
        while ((match = regex.exec(content)) !== null) {
            var name_1 = match[1];
            var body = match[2];
            // 解析用途
            var purposeMatch = body.match(/- \*\*用途\*\*: (.*)/);
            var description = purposeMatch ? purposeMatch[1].trim() : "无描述";
            // 解析参数
            var paramsMatch = body.match(/- \*\*参数\*\*: (.*)/);
            var params = paramsMatch ? paramsMatch[1].trim() : "无";
            // 解析返回值
            var returnMatch = body.match(/- \*\*返回值\*\*: (.*)/);
            var returns = returnMatch ? returnMatch[1].trim() : "无";
            // 解析类型
            var typeMatch = body.match(/- \*\*类型\*\*: (.*)/);
            var type = typeMatch ? typeMatch[1].trim() : "未定义";
            // 解析状态
            var statusMatch = body.match(/- \*\*状态\*\*: (.*)/);
            var status_1 = statusMatch ? statusMatch[1].trim() : "未测试";
            // 过滤掉广播事件和渲染进程监听的事件
            if (type === "广播事件" || type === "Events listened by Renderer Process" || type === "渲染进程监听") {
                continue;
            }
            messages.push({
                name: name_1,
                description: description,
                params: params,
                returns: returns,
                type: type,
                status: status_1
            });
        }
        return messages;
    };
    /**
     * 测试发送 IPC 消息
     * @param name 消息名称
     * @param args 参数
     * @returns Promise<any> 测试结果
     */
    IpcManager.testIpcMessage = function (name_2) {
        return __awaiter(this, arguments, void 0, function (name, args) {
            if (args === void 0) { args = null; }
            return __generator(this, function (_a) {
                return [2 /*return*/, new Promise(function (resolve) {
                        // 简单防呆：防止执行危险操作
                        // 如果消息包含 "delete", "remove", "close", "stop" 且没有明确参数确认，则警告
                        // 但用户要求"快速验证"，所以我们默认允许，但如果是无参调用可能有风险
                        // 这里我们尝试使用 Editor.Ipc.sendToMain 或 requestToMain
                        // @ts-ignore
                        // 简单的测试：只是发送看看是否报错。
                        // 对于 request 类型的消息，我们期望有回调
                        // Cocos Creator 2.4 API: Editor.Ipc.sendToMain(message, ...args)
                        try {
                            // @ts-ignore
                            if (Editor.Ipc.sendToMain) {
                                // @ts-ignore
                                Editor.Ipc.sendToMain(name, args);
                                resolve({ success: true, message: "Message sent (sendToMain)" });
                            }
                            else {
                                resolve({ success: false, message: "Editor.Ipc.sendToMain not available" });
                            }
                        }
                        catch (e) {
                            resolve({ success: false, message: "Error: ".concat(e.message) });
                        }
                    })];
            });
        });
    };
    return IpcManager;
}());
exports.IpcManager = IpcManager;
