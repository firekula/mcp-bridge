"use strict";
const { IpcManager } = require("./IpcManager");

const http = require("http");
const pathModule = require("path");
const fs = require("fs");
const crypto = require("crypto");

let logBuffer = []; // 存储所有日志
let mcpServer = null;
let isSceneBusy = false;
let serverConfig = {
    port: 3456,
    active: false,
};

/**
 * 指令队列 - 确保所有 MCP 工具调用串行执行
 * 防止 AssetDB.refresh 等异步重操作被并发请求打断，导致编辑器卡死
 * @see mcp_freeze_analysis.md
 */
let commandQueue = [];
let isProcessingCommand = false;

/**
 * 将一个异步操作加入队列，保证串行执行
 * @param {Function} fn 接受 done 回调的函数，fn(done) 中操作完成后必须调用 done()
 * @returns {Promise} 操作完成后 resolve
 */
function enqueueCommand(fn) {
    return new Promise((resolve) => {
        // 兜底超时保护：防止 fn 内部未调用 done() 导致队列永久停滞
        const timeoutId = setTimeout(() => {
            addLog("error", "[CommandQueue] 指令执行超时(60s)，强制释放队列");
            isProcessingCommand = false;
            resolve();
            processNextCommand();
        }, 60000);
        commandQueue.push({ fn, resolve, timeoutId });
        processNextCommand();
    });
}

/**
 * 从队列中取出下一个指令并执行
 */
function processNextCommand() {
    if (isProcessingCommand || commandQueue.length === 0) return;
    isProcessingCommand = true;
    const { fn, resolve, timeoutId } = commandQueue.shift();
    try {
        fn(() => {
            clearTimeout(timeoutId);
            isProcessingCommand = false;
            resolve();
            processNextCommand();
        });
    } catch (e) {
        // 防止队列因未捕获异常永久阻塞
        clearTimeout(timeoutId);
        addLog("error", `[CommandQueue] 指令执行异常: ${e.message}`);
        isProcessingCommand = false;
        resolve();
        processNextCommand();
    }
}

/**
 * 带超时保护的 callSceneScript 包装
 * 防止 Scene 面板阻塞时 callback 永不返回，导致 HTTP 连接堆积
 * @param {string} pluginName 插件名
 * @param {string} method 方法名
 * @param {*} args 参数（可以是对象或 null）
 * @param {Function} callback 回调 (err, result)
 * @param {number} timeout 超时毫秒数，默认 15000
 */
function callSceneScriptWithTimeout(pluginName, method, args, callback, timeout = 15000) {
    let settled = false;
    const timer = setTimeout(() => {
        if (!settled) {
            settled = true;
            addLog("error", `[超时] callSceneScript "${method}" 超过 ${timeout}ms 未响应`);
            callback(`操作超时: ${method} (${timeout}ms)`);
        }
    }, timeout);

    // callSceneScript 支持 3 参数（无 args）和 4 参数两种调用形式
    const wrappedCallback = (err, result) => {
        if (!settled) {
            settled = true;
            clearTimeout(timer);
            callback(err, result);
        }
    };

    if (args === null || args === undefined) {
        Editor.Scene.callSceneScript(pluginName, method, wrappedCallback);
    } else {
        Editor.Scene.callSceneScript(pluginName, method, args, wrappedCallback);
    }
}

/**
 * 日志文件路径（懒初始化，在项目 settings 目录下）
 * @type {string|null}
 */
let _logFilePath = null;

/**
 * 获取日志文件路径
 * @returns {string|null}
 */
function getLogFilePath() {
    if (_logFilePath) return _logFilePath;
    try {
        const assetsPath = Editor.assetdb.urlToFspath("db://assets");
        if (assetsPath) {
            const projectRoot = pathModule.dirname(assetsPath);
            const settingsDir = pathModule.join(projectRoot, "settings");
            if (!fs.existsSync(settingsDir)) {
                fs.mkdirSync(settingsDir, { recursive: true });
            }
            _logFilePath = pathModule.join(settingsDir, "mcp-bridge.log");
            // 日志轮转: 超过 2MB 时备份旧日志并创建新文件
            try {
                if (fs.existsSync(_logFilePath)) {
                    const stats = fs.statSync(_logFilePath);
                    if (stats.size > 2 * 1024 * 1024) {
                        const backupPath = _logFilePath + ".old";
                        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
                        fs.renameSync(_logFilePath, backupPath);
                    }
                }
            } catch (e) {
                /* 轮转失败不影响主流程 */
            }
            return _logFilePath;
        }
    } catch (e) {
        // 静默失败，不影响主流程
    }
    return null;
}

/**
 * 封装日志函数
 * - 所有日志发送到 MCP 测试面板 + 内存缓存
 * - 仅 error / warn 输出到编辑器控制台（防止刷屏）
 * - 所有日志实时追加写入项目内 settings/mcp-bridge.log 文件（持久化）
 * @param {'info' | 'success' | 'warn' | 'error' | 'mcp'} type 日志类型
 * @param {string} message 日志内容
 */
function addLog(type, message) {
    const logEntry = {
        time: new Date().toISOString().replace("T", " ").substring(0, 23),
        type: type,
        content: message,
    };
    logBuffer.push(logEntry);
    // 防止内存泄漏：限制日志缓存上限
    if (logBuffer.length > 2000) {
        logBuffer = logBuffer.slice(-1500);
    }
    // 发送到面板
    Editor.Ipc.sendToPanel("mcp-bridge", "mcp-bridge:on-log", logEntry);

    // 仅关键信息输出到编辑器控制台（error / warn）
    if (type === "error") {
        Editor.error(`[MCP] ${message}`);
    } else if (type === "warn") {
        Editor.warn(`[MCP] ${message}`);
    }

    // 持久化到日志文件（实时写入，确保闪退时不丢失）
    try {
        const logPath = getLogFilePath();
        if (logPath) {
            const line = `[${logEntry.time}] [${type}] ${message}\n`;
            fs.appendFileSync(logPath, line, "utf8");
        }
    } catch (e) {
        // 文件写入失败时静默，不影响主流程
    }
}

/**
 * 获取完整的日志内容（文本格式）
 * @returns {string} 拼接后的日志字符串
 */
function getLogContent() {
    return logBuffer.map((entry) => `[${entry.time}] [${entry.type}] ${entry.content}`).join("\n");
}

/**
 * 生成新场景的 JSON 模板数据
 * @returns {string} 场景数据的 JSON 字符串
 */
const getNewSceneTemplate = () => {
    // 尝试获取 UUID 生成函数
    let newId = "";
    if (Editor.Utils && Editor.Utils.uuid) {
        newId = Editor.Utils.uuid();
    } else if (Editor.Utils && Editor.Utils.UuidUtils && Editor.Utils.UuidUtils.uuid) {
        newId = Editor.Utils.UuidUtils.uuid();
    } else {
        // 兜底方案：如果找不到编辑器 API，生成一个随机字符串
        newId = Math.random().toString(36).substring(2, 15);
    }

    const sceneData = [
        {
            __type__: "cc.SceneAsset",
            _name: "",
            _objFlags: 0,
            _native: "",
            scene: { __id__: 1 },
        },
        {
            __id__: 1,
            __type__: "cc.Scene",
            _name: "",
            _objFlags: 0,
            _parent: null,
            _children: [],
            _active: true,
            _level: 0,
            _components: [],
            autoReleaseAssets: false,
            _id: newId,
        },
    ];
    return JSON.stringify(sceneData);
};

/**
 * 获取所有支持的 MCP 工具列表定义
 * @returns {Array<Object>} 工具定义数组
 */
const getToolsList = () => {
    const globalPrecautions =
        "【AI 安全守则】: 1. 执行任何写操作前必须先通过 get_scene_hierarchy 或 manage_components(get) 验证主体存在。 2. 严禁基于假设盲目猜测属性名。 3. 资源属性（如 cc.Prefab）必须通过 UUID 进行赋值。 4. 严禁频繁刷新全局资源 (refresh_editor)，必须通过 properties.path 指定具体修改的文件或目录以防止编辑器长期卡死。";
    return [
        {
            name: "get_selected_node",
            description: `获取当前编辑器中选中的节点 ID。建议获取后立即调用 get_scene_hierarchy 确认该节点是否仍存在于当前场景中。`,
            inputSchema: { type: "object", properties: {} },
        },
        {
            name: "set_node_name",
            description: `${globalPrecautions} 修改指定节点的名称`,
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string", description: "节点的 UUID" },
                    newName: { type: "string", description: "新的节点名称" },
                },
                required: ["id", "newName"],
            },
        },
        {
            name: "save_scene",
            description: `保存当前场景的修改`,
            inputSchema: { type: "object", properties: {} },
        },
        {
            name: "get_scene_hierarchy",
            description: `获取当前场景的节点树结构（包含 UUID、名称、子节点数）。若要查询节点组件详情等，请使用 manage_components。`,
            inputSchema: {
                type: "object",
                properties: {
                    nodeId: { type: "string", description: "指定的根节点 UUID。如果不传则获取整个场景的根。" },
                    depth: {
                        type: "number",
                        description: "遍历的深度限制，默认为 2。用来防止过大场景导致返回数据超长。",
                    },
                    includeDetails: { type: "boolean", description: "是否包含坐标、缩放等杂项详情，默认为 false。" },
                },
            },
        },
        {
            name: "update_node_transform",
            description: `${globalPrecautions} 修改节点的坐标、缩放或颜色。执行前必须调用 get_scene_hierarchy 确保 node ID 有效。`,
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string", description: "节点 UUID" },
                    x: { type: "number" },
                    y: { type: "number" },
                    width: { type: "number" },
                    height: { type: "number" },
                    scaleX: { type: "number" },
                    scaleY: { type: "number" },
                    color: { type: "string", description: "HEX 颜色代码如 #FF0000" },
                },
                required: ["id"],
            },
        },
        {
            name: "create_scene",
            description: `在 assets 目录下创建一个新的场景文件。创建并通过 open_scene 打开后，请务必初始化基础节点（如 Canvas 和 Camera）。`,
            inputSchema: {
                type: "object",
                properties: {
                    sceneName: { type: "string", description: "场景名称" },
                },
                required: ["sceneName"],
            },
        },
        {
            name: "create_prefab",
            description: `${globalPrecautions} 将场景中的某个节点保存为预制体资源`,
            inputSchema: {
                type: "object",
                properties: {
                    nodeId: { type: "string", description: "节点 UUID" },
                    prefabName: { type: "string", description: "预制体名称" },
                },
                required: ["nodeId", "prefabName"],
            },
        },
        {
            name: "open_scene",
            description: `打开场景文件。注意：这是一个异步且耗时的操作，打开后请等待几秒。重要：如果是新创建或空的场景，请务必先创建并初始化基础节点（Canvas/Camera）。`,
            inputSchema: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "场景资源路径，如 db://assets/NewScene.fire",
                    },
                },
                required: ["url"],
            },
        },
        {
            name: "open_prefab",
            description: `在编辑器中打开预制体文件进入编辑模式。注意：这是一个异步操作，打开后请等待几秒。`,
            inputSchema: {
                type: "object",
                properties: {
                    url: {
                        type: "string",
                        description: "预制体资源路径，如 db://assets/prefabs/Test.prefab",
                    },
                },
                required: ["url"],
            },
        },
        {
            name: "create_node",
            description: `${globalPrecautions} 在当前场景中创建一个新节点。重要提示：1. 如果指定 parentId，必须先通过 get_scene_hierarchy 确保该父节点真实存在且未被删除。2. 类型说明：'sprite' (100x100 尺寸 + 默认贴图), 'button' (150x50 尺寸 + 深色底图 + Button组件), 'label' (120x40 尺寸 + Label组件), 'empty' (纯空节点)。`,
            inputSchema: {
                type: "object",
                properties: {
                    name: { type: "string", description: "节点名称" },
                    parentId: {
                        type: "string",
                        description: "父节点 UUID (可选，不传则挂在场景根部)",
                    },
                    type: {
                        type: "string",
                        enum: ["empty", "sprite", "label", "button"],
                        description: "节点预设类型",
                    },
                },
                required: ["name"],
            },
        },
        {
            name: "manage_components",
            description: `${globalPrecautions} 管理节点组件。重要提示：1. 操作前必须调用 get_scene_hierarchy 确认 nodeId 对应的节点仍然存在。2. 添加前先用 'get' 检查是否已存在。3. 添加 cc.Sprite 后必须设置 spriteFrame 属性，否则节点不显示。4. 创建按钮时，请确保目标节点有足够的 width 和 height 作为点击区域。5. 赋值或更新属性前，必须确保目标属性在组件上真实存在，严禁盲目操作不存在的属性。6. 对于资源类属性（如 cc.Prefab, sp.SkeletonData），传递资源的 UUID。插件会自动进行异步加载并正确序列化，避免 Inspector 出现 Type Error。`,
            inputSchema: {
                type: "object",
                properties: {
                    nodeId: { type: "string", description: "节点 UUID" },
                    action: {
                        type: "string",
                        enum: ["add", "remove", "update", "get"],
                        description:
                            "操作类型 (add: 添加组件, remove: 移除组件, update: 更新组件属性, get: 获取组件列表)",
                    },
                    componentType: { type: "string", description: "组件类型，如 cc.Sprite (add/update 操作需要)" },
                    componentId: { type: "string", description: "组件 ID (remove/update 操作可选)" },
                    properties: {
                        type: "object",
                        description:
                            "组件属性 (add/update 操作使用). 支持智能解析: 如果属性类型是组件但提供了节点UUID，会自动查找对应组件。",
                    },
                },
                required: ["nodeId", "action"],
            },
        },
        {
            name: "manage_script",
            description: `${globalPrecautions} 管理脚本文件。注意：创建或修改脚本需时间编译。创建后必须调用 refresh_editor (务必指定 path) 生成 meta 文件，否则无法作为组件添加。`,
            inputSchema: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["create", "delete", "read", "write"], description: "操作类型" },
                    path: { type: "string", description: "脚本路径，如 db://assets/scripts/NewScript.js" },
                    content: { type: "string", description: "脚本内容 (用于 create 和 write 操作)" },
                    name: { type: "string", description: "脚本名称 (用于 create 操作)" },
                },
                required: ["action", "path"],
            },
        },
        {
            name: "batch_execute",
            description: `${globalPrecautions} 批处理执行多个操作`,
            inputSchema: {
                type: "object",
                properties: {
                    operations: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                tool: { type: "string", description: "工具名称" },
                                params: { type: "object", description: "工具参数" },
                            },
                            required: ["tool", "params"],
                        },
                        description: "操作列表",
                    },
                },
                required: ["operations"],
            },
        },
        {
            name: "manage_asset",
            description: `${globalPrecautions} 管理资源`,
            inputSchema: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["create", "delete", "move", "get_info"], description: "操作类型" },
                    path: { type: "string", description: "资源路径，如 db://assets/textures" },
                    targetPath: { type: "string", description: "目标路径 (用于 move 操作)" },
                    content: { type: "string", description: "资源内容 (用于 create 操作)" },
                },
                required: ["action", "path"],
            },
        },
        {
            name: "scene_management",
            description: `${globalPrecautions} 场景管理`,
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["create", "delete", "duplicate", "get_info"],
                        description: "操作类型",
                    },
                    path: { type: "string", description: "场景路径，如 db://assets/scenes/NewScene.fire" },
                    targetPath: { type: "string", description: "目标路径 (用于 duplicate 操作)" },
                    name: { type: "string", description: "场景名称 (用于 create 操作)" },
                },
                required: ["action", "path"],
            },
        },
        {
            name: "prefab_management",
            description: `${globalPrecautions} 预制体管理`,
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["create", "update", "instantiate", "get_info"],
                        description: "操作类型",
                    },
                    path: { type: "string", description: "预制体路径，如 db://assets/prefabs/NewPrefab.prefab" },
                    nodeId: { type: "string", description: "节点 ID (用于 create 操作)" },
                    parentId: { type: "string", description: "父节点 ID (用于 instantiate 操作)" },
                },
                required: ["action", "path"],
            },
        },
        {
            name: "manage_editor",
            description: `${globalPrecautions} 管理编辑器`,
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["get_selection", "set_selection", "refresh_editor"],
                        description: "操作类型",
                    },
                    target: {
                        type: "string",
                        enum: ["node", "asset"],
                        description: "目标类型 (用于 set_selection 操作)",
                    },
                    properties: {
                        type: "object",
                        description:
                            "操作属性。⚠️极为重要：refresh_editor 必须通过 properties.path 指定精确的刷新路径（如 'db://assets/scripts/MyScript.ts'）。严禁不带 path 参数进行全局刷新 (db://assets)，这在大型项目中会导致编辑器卡死数分钟，严重阻塞工作流。",
                    },
                },
                required: ["action"],
            },
        },
        {
            name: "find_gameobjects",
            description: `按条件在场景中搜索游戏对象。返回匹配节点的轻量级结构 (UUID, name, active, components 等)。若要获取完整的详细组件属性，请进一步对目标使用 manage_components。`,
            inputSchema: {
                type: "object",
                properties: {
                    conditions: {
                        type: "object",
                        description:
                            "查找条件。支持的属性：name (节点名称，支持模糊匹配), component (包含的组件类名，如 'cc.Sprite'), active (布尔值，节点的激活状态)。",
                    },
                    recursive: { type: "boolean", default: true, description: "是否递归查找所有子节点" },
                },
                required: ["conditions"],
            },
        },
        {
            name: "manage_material",
            description: `${globalPrecautions} 管理材质。支持创建、获取信息以及更新 Shader、Defines 和 Uniforms 参数。`,
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["create", "delete", "get_info", "update"],
                        description: "操作类型",
                    },
                    path: { type: "string", description: "材质路径，如 db://assets/materials/NewMaterial.mat" },
                    properties: {
                        type: "object",
                        description: "材质属性 (add/update 操作使用)",
                        properties: {
                            shaderUuid: { type: "string", description: "关联的 Shader (Effect) UUID" },
                            defines: { type: "object", description: "预编译宏定义" },
                            uniforms: { type: "object", description: "Uniform 参数列表" },
                        },
                    },
                },
                required: ["action", "path"],
            },
        },
        {
            name: "manage_texture",
            description: `${globalPrecautions} 管理纹理`,
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["create", "delete", "get_info", "update"],
                        description: "操作类型",
                    },
                    path: { type: "string", description: "纹理路径，如 db://assets/textures/NewTexture.png" },
                    properties: { type: "object", description: "纹理属性" },
                },
                required: ["action", "path"],
            },
        },
        {
            name: "manage_shader",
            description: `${globalPrecautions} 管理着色器 (Effect)。支持创建、读取、更新、删除和获取信息。`,
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["create", "delete", "read", "write", "get_info"],
                        description: "操作类型",
                    },
                    path: { type: "string", description: "着色器路径，如 db://assets/effects/NewEffect.effect" },
                    content: { type: "string", description: "着色器内容 (create/write)" },
                },
                required: ["action", "path"],
            },
        },
        {
            name: "execute_menu_item",
            description: `${globalPrecautions} 执行菜单项。对于节点删除，请使用 "delete-node:UUID" 格式以确保精确执行。对于保存、撤销等操作，请优先使用专用工具 (save_scene, manage_undo)。`,
            inputSchema: {
                type: "object",
                properties: {
                    menuPath: {
                        type: "string",
                        description: "菜单项路径 (支持 'Project/Build' 或 'delete-node:UUID')",
                    },
                },
                required: ["menuPath"],
            },
        },
        {
            name: "apply_text_edits",
            description: `${globalPrecautions} 对文件应用文本编辑。**专用于修改脚本源代码 (.js, .ts) 或文本文件**。如果要修改场景节点属性，请使用 'manage_components'。`,
            inputSchema: {
                type: "object",
                properties: {
                    edits: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                type: {
                                    type: "string",
                                    enum: ["insert", "delete", "replace"],
                                    description: "操作类型",
                                },
                                start: { type: "number", description: "起始偏移量 (字符索引)" },
                                end: { type: "number", description: "结束偏移量 (delete/replace 用)" },
                                position: { type: "number", description: "插入位置 (insert 用)" },
                                text: { type: "string", description: "要插入或替换的文本" },
                            },
                        },
                        description: "编辑操作列表。请严格使用偏移量(offset)而非行号。",
                    },
                    filePath: { type: "string", description: "文件路径 (db://...)" },
                },
                required: ["filePath", "edits"],
            },
        },
        {
            name: "read_console",
            description: `读取控制台`,
            inputSchema: {
                type: "object",
                properties: {
                    limit: { type: "number", description: "输出限制" },
                    type: {
                        type: "string",
                        enum: ["info", "warn", "error", "success", "mcp"],
                        description: "输出类型 (info, warn, error, success, mcp)",
                    },
                },
            },
        },
        {
            name: "validate_script",
            description: `验证脚本`,
            inputSchema: {
                type: "object",
                properties: {
                    filePath: { type: "string", description: "脚本路径" },
                },
                required: ["filePath"],
            },
        },
        {
            name: "search_project",
            description: `搜索项目文件。支持三种模式：1. 'content' (默认): 搜索文件内容，支持正则表达式；2. 'file_name': 在指定目录下搜索匹配的文件名；3. 'dir_name': 在指定目录下搜索匹配的文件夹名。`,
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "搜索关键词或正则表达式模式" },
                    useRegex: {
                        type: "boolean",
                        description:
                            "是否将 query 视为正则表达式 (仅在 matchType 为 'content', 'file_name' 或 'dir_name' 时生效)",
                    },
                    path: {
                        type: "string",
                        description: "搜索起点路径，例如 'db://assets/scripts'。默认为 'db://assets'",
                    },
                    matchType: {
                        type: "string",
                        enum: ["content", "file_name", "dir_name"],
                        description:
                            "匹配模式：'content' (内容关键词/正则), 'file_name' (搜索文件名), 'dir_name' (搜索文件夹名)",
                    },
                    extensions: {
                        type: "array",
                        items: { type: "string" },
                        description:
                            "限定文件后缀 (如 ['.js', '.ts'])。仅在 matchType 为 'content' 或 'file_name' 时有效。",
                        default: [".js", ".ts", ".json", ".fire", ".prefab", ".xml", ".txt", ".md"],
                    },
                    includeSubpackages: { type: "boolean", default: true, description: "是否递归搜索子目录" },
                },
                required: ["query"],
            },
        },
        {
            name: "manage_undo",
            description: `${globalPrecautions} 管理编辑器的撤销和重做历史`,
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["undo", "redo", "begin_group", "end_group", "cancel_group"],
                        description: "操作类型",
                    },
                    description: { type: "string", description: "撤销组的描述 (用于 begin_group)" },
                },
                required: ["action"],
            },
        },
        {
            name: "manage_vfx",
            description: `${globalPrecautions} 管理全场景特效 (粒子系统)。重要提示：在创建或更新前，必须通过 get_scene_hierarchy 或 manage_components 确认父节点或目标节点的有效性。严禁对不存在的对象进行操作。`,
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["create", "update", "get_info"],
                        description: "操作类型",
                    },
                    nodeId: { type: "string", description: "节点 UUID (用于 update/get_info)" },
                    properties: {
                        type: "object",
                        description: "粒子系统属性 (用于 create/update)",
                        properties: {
                            duration: { type: "number", description: "发射时长" },
                            emissionRate: { type: "number", description: "发射速率" },
                            life: { type: "number", description: "生命周期" },
                            lifeVar: { type: "number", description: "生命周期变化" },
                            startColor: { type: "string", description: "起始颜色 (Hex)" },
                            endColor: { type: "string", description: "结束颜色 (Hex)" },
                            startSize: { type: "number", description: "起始大小" },
                            endSize: { type: "number", description: "结束大小" },
                            speed: { type: "number", description: "速度" },
                            angle: { type: "number", description: "角度" },
                            gravity: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
                            file: { type: "string", description: "粒子文件路径 (plist) 或 texture 路径" },
                        },
                    },
                    name: { type: "string", description: "节点名称 (用于 create)" },
                    parentId: { type: "string", description: "父节点 ID (用于 create)" },
                },
                required: ["action"],
            },
        },
        {
            name: "get_sha",
            description: `获取指定文件的 SHA-256 哈希值`,
            inputSchema: {
                type: "object",
                properties: {
                    path: { type: "string", description: "文件路径，如 db://assets/scripts/Test.ts" },
                },
                required: ["path"],
            },
        },
        {
            name: "manage_animation",
            description: `${globalPrecautions} 管理节点的动画组件。重要提示：在执行 play/pause 等操作前，必须先确认节点及其 Animation 组件存在。严禁操作空引用。`,
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["get_list", "get_info", "play", "stop", "pause", "resume"],
                        description: "操作类型",
                    },
                    nodeId: { type: "string", description: "节点 UUID" },
                    clipName: { type: "string", description: "动画剪辑名称 (用于 play)" },
                },
                required: ["action", "nodeId"],
            },
        },
    ];
};

module.exports = {
    "scene-script": "scene-script.js",
    /**
     * 插件加载时的回调
     */
    load() {
        addLog("info", "MCP Bridge Plugin Loaded");
        // 读取配置
        let profile = this.getProfile();
        serverConfig.port = profile.get("last-port") || 3456;
        let autoStart = profile.get("auto-start");

        if (autoStart) {
            addLog("info", "Auto-start is enabled. Initializing server...");
            // 延迟一点启动，确保编辑器环境完全就绪
            setTimeout(() => {
                this.startServer(serverConfig.port);
            }, 1000);
        }
    },
    /**
     * 获取插件配置文件的辅助函数
     * @returns {Object} Editor.Profile 实例
     */
    getProfile() {
        // 'project' 表示存储在项目本地（settings/mcp-bridge.json），实现配置隔离
        return Editor.Profile.load("profile://project/mcp-bridge.json", "mcp-bridge");
    },

    /**
     * 插件卸载时的回调
     */
    unload() {
        this.stopServer();
    },
    /**
     * 启动 HTTP 服务器
     * @param {number} port 监听端口
     */
    startServer(port) {
        if (mcpServer) this.stopServer();

        const tryStart = (currentPort, retries) => {
            if (retries <= 0) {
                addLog("error", `Failed to find an available port after multiple attempts.`);
                return;
            }

            try {
                mcpServer = http.createServer((req, res) => {
                    this._handleRequest(req, res);
                });

                mcpServer.on("error", (e) => {
                    if (e.code === "EADDRINUSE") {
                        addLog("warn", `Port ${currentPort} is in use, trying ${currentPort + 1}...`);
                        try {
                            mcpServer.close();
                        } catch (err) {
                            // align
                        }
                        mcpServer = null;
                        // Delay slightly to ensure cleanup
                        setTimeout(() => {
                            tryStart(currentPort + 1, retries - 1);
                        }, 100);
                    } else {
                        addLog("error", `Server Error: ${e.message}`);
                    }
                });

                mcpServer.listen(currentPort, () => {
                    serverConfig.active = true;
                    serverConfig.port = currentPort;
                    addLog("success", `MCP Server running at http://127.0.0.1:${currentPort}`);
                    Editor.Ipc.sendToPanel("mcp-bridge", "mcp-bridge:state-changed", serverConfig);

                    // Important: Do NOT save the auto-assigned port to profile to avoid pollution
                });
            } catch (e) {
                addLog("error", `Failed to start server: ${e.message}`);
            }
        };

        // Start trying from the configured port, retry 10 times
        tryStart(port, 10);
    },

    _handleRequest(req, res) {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");

        const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB 请求体上限
        let body = "";
        let aborted = false;
        req.on("data", (chunk) => {
            body += chunk;
            if (body.length > MAX_BODY_SIZE) {
                aborted = true;
                addLog("error", `[HTTP] 请求体超过 ${MAX_BODY_SIZE} 字节上限，已拒绝`);
                res.writeHead(413);
                res.end(JSON.stringify({ error: "请求体过大" }));
                req.destroy();
            }
        });
        req.on("end", () => {
            if (aborted) return;
            const url = req.url;
            if (url === "/list-tools") {
                const tools = getToolsList();
                addLog("info", `AI Client requested tool list`);
                res.writeHead(200);
                return res.end(JSON.stringify({ tools: tools }));
            }
            if (url === "/list-resources") {
                const resources = this.getResourcesList();
                addLog("info", `AI Client requested resource list`);
                res.writeHead(200);
                return res.end(JSON.stringify({ resources: resources }));
            }
            if (url === "/read-resource") {
                try {
                    const { uri } = JSON.parse(body || "{}");
                    addLog("mcp", `READ -> [${uri}]`);
                    this.handleReadResource(uri, (err, content) => {
                        if (err) {
                            addLog("error", `读取失败: ${err}`);
                            res.writeHead(500);
                            return res.end(JSON.stringify({ error: err }));
                        }
                        addLog("success", `读取成功: ${uri}`);
                        res.writeHead(200);
                        res.end(
                            JSON.stringify({
                                contents: [
                                    {
                                        uri: uri,
                                        mimeType: "application/json",
                                        text: typeof content === "string" ? content : JSON.stringify(content),
                                    },
                                ],
                            }),
                        );
                    });
                } catch (e) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: e.message }));
                }
                return;
            }
            if (url === "/call-tool") {
                try {
                    const { name, arguments: args } = JSON.parse(body || "{}");
                    let argsPreview = "";
                    if (args) {
                        try {
                            argsPreview = typeof args === "object" ? JSON.stringify(args) : String(args);
                            if (argsPreview.length > 500) {
                                argsPreview = argsPreview.substring(0, 500) + "...[Truncated]";
                            }
                        } catch (e) {
                            argsPreview = "[无法序列化的参数]";
                        }
                    }
                    addLog("mcp", `REQ -> [${name}] (队列长度: ${commandQueue.length}) 参数: ${argsPreview}`);

                    enqueueCommand((done) => {
                        this.handleMcpCall(name, args, (err, result) => {
                            const response = {
                                content: [
                                    {
                                        type: "text",
                                        text: err
                                            ? `Error: ${err}`
                                            : typeof result === "object"
                                              ? JSON.stringify(result, null, 2)
                                              : result,
                                    },
                                ],
                            };
                            if (err) {
                                addLog("error", `RES <- [${name}] 失败: ${err}`);
                            } else {
                                let preview = "";
                                if (typeof result === "string") {
                                    preview = result.length > 100 ? result.substring(0, 100) + "..." : result;
                                } else if (typeof result === "object") {
                                    try {
                                        const jsonStr = JSON.stringify(result);
                                        preview = jsonStr.length > 100 ? jsonStr.substring(0, 100) + "..." : jsonStr;
                                    } catch (e) {
                                        preview = "Object (Circular/Unserializable)";
                                    }
                                }
                                addLog("success", `RES <- [${name}] 成功 : ${preview}`);
                            }
                            res.writeHead(200);
                            res.end(JSON.stringify(response));
                            done();
                        });
                    });
                } catch (e) {
                    if (e instanceof SyntaxError) {
                        addLog("error", `JSON Parse Error: ${e.message}`);
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: "Invalid JSON" }));
                    } else {
                        addLog("error", `Internal Server Error: ${e.message}`);
                        res.writeHead(500);
                        res.end(JSON.stringify({ error: e.message }));
                    }
                }
                return;
            }

            res.writeHead(404);
            res.end(JSON.stringify({ error: "Not Found", url: url }));
        });
    },

    /**
     * 关闭 HTTP 服务器
     */
    stopServer() {
        if (mcpServer) {
            mcpServer.close();
            mcpServer = null;
            serverConfig.active = false;
            addLog("warn", "MCP Server stopped");
            Editor.Ipc.sendToPanel("mcp-bridge", "mcp-bridge:state-changed", serverConfig);
        }
    },

    /**
     * 获取 MCP 资源列表
     * @returns {Array<Object>} 资源列表数组
     */
    getResourcesList() {
        return [
            {
                uri: "cocos://hierarchy",
                name: "Scene Hierarchy",
                description: "当前场景层级的 JSON 快照",
                mimeType: "application/json",
            },
            {
                uri: "cocos://selection",
                name: "Current Selection",
                description: "当前选中节点的 UUID 列表",
                mimeType: "application/json",
            },
            {
                uri: "cocos://logs/latest",
                name: "Editor Logs",
                description: "最新的编辑器日志 (内存缓存)",
                mimeType: "text/plain",
            },
        ];
    },

    /**
     * 读取指定的 MCP 资源内容
     * @param {string} uri 资源统一资源标识符 (URI)
     * @param {Function} callback 完成回调 (err, content)
     */
    handleReadResource(uri, callback) {
        let parsed;
        try {
            parsed = new URL(uri);
        } catch (e) {
            return callback(`Invalid URI: ${uri}`);
        }

        if (parsed.protocol !== "cocos:") {
            return callback(`Unsupported protocol: ${parsed.protocol}`);
        }

        const type = parsed.hostname; // hierarchy, selection, logs

        switch (type) {
            case "hierarchy":
                // 注意: query-hierarchy 是异步的
                Editor.Ipc.sendToPanel("scene", "scene:query-hierarchy", (err, sceneId, hierarchy) => {
                    if (err) return callback(err);
                    callback(null, JSON.stringify(hierarchy, null, 2));
                });
                break;

            case "selection":
                const selection = Editor.Selection.curSelection("node");
                callback(null, JSON.stringify(selection));
                break;

            case "logs":
                callback(null, getLogContent());
                break;

            default:
                callback(`Resource not found: ${uri}`);
                break;
        }
    },

    /**
     * 处理来自 HTTP 的 MCP 调用请求
     * @param {string} name 工具名称
     * @param {Object} args 工具参数
     * @param {Function} callback 完成回调 (err, result)
     */
    handleMcpCall(name, args, callback) {
        if (isSceneBusy && (name === "save_scene" || name === "create_node")) {
            return callback("编辑器正忙（正在处理场景），请稍候。");
        }
        switch (name) {
            case "get_selected_node":
                const ids = Editor.Selection.curSelection("node");
                callback(null, ids);
                break;

            case "set_node_name":
                // 使用 scene:set-property 以支持撤销
                Editor.Ipc.sendToPanel("scene", "scene:set-property", {
                    id: args.id,
                    path: "name",
                    type: "String",
                    value: args.newName,
                    isSubProp: false,
                });
                callback(null, `节点名称已更新为 ${args.newName}`);
                break;

            case "save_scene":
                isSceneBusy = true;
                addLog("info", "准备保存场景... 等待 UI 同步。");
                Editor.Ipc.sendToPanel("scene", "scene:stash-and-save");
                isSceneBusy = false;
                addLog("info", "安全保存已完成。");
                callback(null, "场景保存成功。");
                break;

            case "get_scene_hierarchy":
                callSceneScriptWithTimeout("mcp-bridge", "get-hierarchy", args, callback);
                break;

            case "update_node_transform":
                // 直接调用场景脚本更新属性，绕过可能导致 "Unknown object" 的复杂 Undo 系统
                callSceneScriptWithTimeout("mcp-bridge", "update-node-transform", args, (err, result) => {
                    if (err) {
                        addLog("error", `Transform update failed: ${err}`);
                        callback(err);
                    } else {
                        callback(null, "变换信息已更新");
                    }
                });
                break;

            case "create_scene":
                const sceneUrl = `db://assets/${args.sceneName}.fire`;
                if (Editor.assetdb.exists(sceneUrl)) {
                    return callback("场景已存在");
                }
                Editor.assetdb.create(sceneUrl, getNewSceneTemplate(), (err) => {
                    callback(err, err ? null : `标准场景已创建于 ${sceneUrl}`);
                });
                break;

            case "create_prefab":
                const prefabUrl = `db://assets/${args.prefabName}.prefab`;
                Editor.Ipc.sendToMain("scene:create-prefab", args.nodeId, prefabUrl);
                callback(null, `命令已发送：正在创建预制体 '${args.prefabName}'`);
                break;

            case "open_scene":
                isSceneBusy = true; // 锁定
                const openUuid = Editor.assetdb.urlToUuid(args.url);
                if (openUuid) {
                    Editor.Ipc.sendToMain("scene:open-by-uuid", openUuid);
                    setTimeout(() => {
                        isSceneBusy = false;
                        callback(null, `成功：正在打开场景 ${args.url}`);
                    }, 2000);
                } else {
                    isSceneBusy = false;
                    callback(`找不到路径为 ${args.url} 的资源`);
                }
                break;

            case "open_prefab":
                isSceneBusy = true; // 锁定
                const prefabUuid = Editor.assetdb.urlToUuid(args.url);
                if (prefabUuid) {
                    // 【核心修复】使用正确的 IPC 消息进入预制体编辑模式
                    Editor.Ipc.sendToAll("scene:enter-prefab-edit-mode", prefabUuid);
                    setTimeout(() => {
                        isSceneBusy = false;
                        callback(null, `成功：正在打开预制体 ${args.url}`);
                    }, 2000);
                } else {
                    isSceneBusy = false;
                    callback(`找不到路径为 ${args.url} 的资源`);
                }
                break;

            case "create_node":
                if (args.type === "sprite" || args.type === "button") {
                    const splashUuid = Editor.assetdb.urlToUuid(
                        "db://internal/image/default_sprite_splash.png/default_sprite_splash",
                    );
                    args.defaultSpriteUuid = splashUuid;
                }
                callSceneScriptWithTimeout("mcp-bridge", "create-node", args, callback);
                break;

            case "manage_components":
                callSceneScriptWithTimeout("mcp-bridge", "manage-components", args, callback);
                break;

            case "manage_script":
                this.manageScript(args, callback);
                break;

            case "batch_execute":
                this.batchExecute(args, callback);
                break;

            case "manage_asset":
                this.manageAsset(args, callback);
                break;

            case "scene_management":
                this.sceneManagement(args, callback);
                break;

            case "prefab_management":
                this.prefabManagement(args, callback);
                break;

            case "manage_editor":
                this.manageEditor(args, callback);
                break;
            case "get_sha":
                this.getSha(args, callback);
                break;
            case "manage_animation":
                this.manageAnimation(args, callback);
                break;

            case "find_gameobjects":
                callSceneScriptWithTimeout("mcp-bridge", "find-gameobjects", args, callback);
                break;

            case "manage_material":
                this.manageMaterial(args, callback);
                break;

            case "manage_texture":
                this.manageTexture(args, callback);
                break;

            case "manage_shader":
                this.manageShader(args, callback);
                break;

            case "execute_menu_item":
                this.executeMenuItem(args, callback);
                break;

            case "apply_text_edits":
                this.applyTextEdits(args, callback);
                break;

            case "read_console":
                this.readConsole(args, callback);
                break;

            case "validate_script":
                this.validateScript(args, callback);
                break;

            case "search_project":
                this.searchProject(args, callback);
                break;

            case "manage_undo":
                this.manageUndo(args, callback);
                break;

            case "manage_vfx":
                // 【修复】在主进程预先解析 URL 为 UUID，因为渲染进程(scene-script)无法访问 Editor.assetdb
                if (args.properties && args.properties.file) {
                    if (typeof args.properties.file === "string" && args.properties.file.startsWith("db://")) {
                        const uuid = Editor.assetdb.urlToUuid(args.properties.file);
                        if (uuid) {
                            args.properties.file = uuid; // 替换为 UUID
                        } else {
                            console.warn(`Failed to resolve path to UUID: ${args.properties.file}`);
                        }
                    }
                }
                // 预先获取默认贴图 UUID (尝试多个可能的路径)
                const defaultPaths = [
                    "db://internal/image/default_sprite_splash",
                    "db://internal/image/default_sprite_splash.png",
                    "db://internal/image/default_particle",
                    "db://internal/image/default_particle.png",
                ];

                for (const path of defaultPaths) {
                    const uuid = Editor.assetdb.urlToUuid(path);
                    if (uuid) {
                        args.defaultSpriteUuid = uuid;
                        addLog("info", `[mcp-bridge] Resolved Default Sprite UUID: ${uuid} from ${path}`);
                        break;
                    }
                }

                if (!args.defaultSpriteUuid) {
                    addLog("warn", "[mcp-bridge] Failed to resolve any default sprite UUID.");
                }

                callSceneScriptWithTimeout("mcp-bridge", "manage-vfx", args, callback);
                break;

            default:
                callback(`Unknown tool: ${name}`);
                break;
        }
    },

    /**
     * 管理项目中的脚本文件 (TS/JS)
     * @param {Object} args 参数
     * @param {Function} callback 完成回调
     */
    manageScript(args, callback) {
        const { action, path: scriptPath, content } = args;

        switch (action) {
            case "create":
                if (Editor.assetdb.exists(scriptPath)) {
                    return callback(`脚本已存在: ${scriptPath}`);
                }
                // 确保父目录存在
                const absolutePath = Editor.assetdb.urlToFspath(scriptPath);
                const dirPath = pathModule.dirname(absolutePath);
                if (!fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath, { recursive: true });
                }
                Editor.assetdb.create(
                    scriptPath,
                    content ||
                        `const { ccclass, property } = cc._decorator;

@ccclass
export default class NewScript extends cc.Component {
    @property(cc.Label)
    label: cc.Label = null;

    @property
    text: string = 'hello';

    // LIFE-CYCLE CALLBACKS:

    onLoad () {}

    start () {}

    update (dt) {}
}`,
                    (err) => {
                        if (err) {
                            callback(err);
                        } else {
                            // 【关键修复】创建脚本后，必须刷新 AssetDB 并等待完成，
                            // 否则后续立即挂载脚本的操作(manage_components)会因找不到脚本 UUID 而失败。
                            Editor.assetdb.refresh(scriptPath, (refreshErr) => {
                                if (refreshErr) {
                                    addLog("warn", `脚本创建后刷新失败: ${refreshErr}`);
                                }
                                callback(null, `脚本已创建: ${scriptPath}`);
                            });
                        }
                    },
                );
                break;

            case "delete":
                if (!Editor.assetdb.exists(scriptPath)) {
                    return callback(`找不到脚本: ${scriptPath}`);
                }
                Editor.assetdb.delete([scriptPath], (err) => {
                    callback(err, err ? null : `脚本已删除: ${scriptPath}`);
                });
                break;

            case "read":
                // 使用 fs 读取，绕过 assetdb.loadAny
                const readFsPath = Editor.assetdb.urlToFspath(scriptPath);
                if (!readFsPath || !fs.existsSync(readFsPath)) {
                    return callback(`找不到脚本: ${scriptPath}`);
                }
                try {
                    const content = fs.readFileSync(readFsPath, "utf-8");
                    callback(null, content);
                } catch (e) {
                    callback(`读取脚本失败: ${e.message}`);
                }
                break;

            case "save": // 兼容 AI 幻觉
            case "write":
                // 使用 fs 写入 + refresh，确保覆盖成功
                const writeFsPath = Editor.assetdb.urlToFspath(scriptPath);
                if (!writeFsPath) {
                    return callback(`路径无效: ${scriptPath}`);
                }

                try {
                    fs.writeFileSync(writeFsPath, content, "utf-8");
                    Editor.assetdb.refresh(scriptPath, (err) => {
                        if (err) addLog("warn", `写入脚本后刷新失败: ${err}`);
                        callback(null, `脚本已更新: ${scriptPath}`);
                    });
                } catch (e) {
                    callback(`写入脚本失败: ${e.message}`);
                }
                break;

            default:
                callback(`未知的脚本操作类型: ${action}`);
                break;
        }
    },

    /**
     * 批量执行多个 MCP 工具操作（串行链式执行）
     * 【重要修复】原并行 forEach 会导致多个 AssetDB 操作同时执行引发编辑器卡死，
     * 改为串行执行确保每个操作完成后再执行下一个
     * @param {Object} args 参数 (operations 数组)
     * @param {Function} callback 完成回调
     */
    batchExecute(args, callback) {
        const { operations } = args;
        const results = [];

        if (!operations || operations.length === 0) {
            return callback("未提供任何操作指令");
        }

        let index = 0;
        const next = () => {
            if (index >= operations.length) {
                return callback(null, results);
            }
            const operation = operations[index];
            this.handleMcpCall(operation.tool, operation.params, (err, result) => {
                results[index] = { tool: operation.tool, error: err, result: result };
                index++;
                next();
            });
        };
        next();
    },

    /**
     * 通用的资源管理函数 (创建、删除、移动等)
     * @param {Object} args 参数
     * @param {Function} callback 完成回调
     */
    manageAsset(args, callback) {
        const { action, path, targetPath, content } = args;

        switch (action) {
            case "create":
                if (Editor.assetdb.exists(path)) {
                    return callback(`资源已存在: ${path}`);
                }
                // 确保父目录存在
                const fs = require("fs");
                const pathModule = require("path");
                const absolutePath = Editor.assetdb.urlToFspath(path);
                const dirPath = pathModule.dirname(absolutePath);
                if (!fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath, { recursive: true });
                }
                Editor.assetdb.create(path, content || "", (err) => {
                    callback(err, err ? null : `资源已创建: ${path}`);
                });
                break;

            case "delete":
                if (!Editor.assetdb.exists(path)) {
                    return callback(`找不到资源: ${path}`);
                }
                Editor.assetdb.delete([path], (err) => {
                    callback(err, err ? null : `资源已删除: ${path}`);
                });
                break;

            case "move":
                if (!Editor.assetdb.exists(path)) {
                    return callback(`找不到资源: ${path}`);
                }
                if (Editor.assetdb.exists(targetPath)) {
                    return callback(`目标资源已存在: ${targetPath}`);
                }
                Editor.assetdb.move(path, targetPath, (err) => {
                    callback(err, err ? null : `资源已从 ${path} 移动到 ${targetPath}`);
                });
                break;

            case "get_info":
                try {
                    if (!Editor.assetdb.exists(path)) {
                        return callback(`找不到资源: ${path}`);
                    }
                    const uuid = Editor.assetdb.urlToUuid(path);
                    const info = Editor.assetdb.assetInfoByUuid(uuid);
                    if (info) {
                        callback(null, info);
                    } else {
                        // 备选方案：如果 API 未返回信息但资源确实存在
                        callback(null, { url: path, uuid: uuid, exists: true });
                    }
                } catch (e) {
                    callback(`获取资源信息失败: ${e.message}`);
                }
                break;

            default:
                callback(`未知的资源管理操作: ${action}`);
                break;
        }
    },

    /**
     * 场景相关的资源管理 (创建、克隆场景等)
     * @param {Object} args 参数
     * @param {Function} callback 完成回调
     */
    sceneManagement(args, callback) {
        const { action, path, targetPath, name } = args;

        switch (action) {
            case "create":
                if (Editor.assetdb.exists(path)) {
                    return callback(`场景已存在: ${path}`);
                }
                // 确保父目录存在
                const absolutePath = Editor.assetdb.urlToFspath(path);
                const dirPath = pathModule.dirname(absolutePath);
                if (!fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath, { recursive: true });
                }
                Editor.assetdb.create(path, getNewSceneTemplate(), (err) => {
                    callback(err, err ? null : `场景已创建: ${path}`);
                });
                break;

            case "delete":
                if (!Editor.assetdb.exists(path)) {
                    return callback(`找不到场景: ${path}`);
                }
                Editor.assetdb.delete([path], (err) => {
                    callback(err, err ? null : `场景已删除: ${path}`);
                });
                break;

            case "duplicate":
                if (!Editor.assetdb.exists(path)) {
                    return callback(`找不到场景: ${path}`);
                }
                if (!targetPath) {
                    return callback("复制操作需要目标路径");
                }
                if (Editor.assetdb.exists(targetPath)) {
                    return callback(`目标场景已存在: ${targetPath}`);
                }
                // 【修复】Cocos 2.4.x 主进程中 Editor.assetdb 没有 loadAny
                // 直接使用 fs 读取物理文件
                try {
                    const sourceFsPath = Editor.assetdb.urlToFspath(path);
                    if (!sourceFsPath || !fs.existsSync(sourceFsPath)) {
                        return callback(`定位源场景文件失败: ${path}`);
                    }
                    const content = fs.readFileSync(sourceFsPath, "utf-8");

                    // 确保目标目录存在
                    const targetAbsolutePath = Editor.assetdb.urlToFspath(targetPath);
                    const targetDirPath = pathModule.dirname(targetAbsolutePath);
                    if (!fs.existsSync(targetDirPath)) {
                        fs.mkdirSync(targetDirPath, { recursive: true });
                    }
                    // 创建复制的场景
                    Editor.assetdb.create(targetPath, content, (err) => {
                        if (err) return callback(err);
                        // 【增加】关键刷新，确保数据库能查到新文件
                        Editor.assetdb.refresh(targetPath, (refreshErr) => {
                            callback(refreshErr, refreshErr ? null : `场景已从 ${path} 复制到 ${targetPath}`);
                        });
                    });
                } catch (e) {
                    callback(`Duplicate failed: ${e.message}`);
                }
                break;

            case "get_info":
                if (Editor.assetdb.exists(path)) {
                    const uuid = Editor.assetdb.urlToUuid(path);
                    const info = Editor.assetdb.assetInfoByUuid(uuid);
                    callback(null, info || { url: path, uuid: uuid, exists: true });
                } else {
                    return callback(`找不到场景: ${path}`);
                }
                break;

            default:
                callback(`Unknown scene action: ${action}`);
                break;
        }
    },

    // 预制体管理
    prefabManagement(args, callback) {
        const { action, path: prefabPath, nodeId, parentId } = args;

        switch (action) {
            case "create":
                if (!nodeId) {
                    return callback("创建预制体需要节点 ID");
                }
                if (Editor.assetdb.exists(prefabPath)) {
                    return callback(`预制体已存在: ${prefabPath}`);
                }
                // 确保父目录存在
                const absolutePath = Editor.assetdb.urlToFspath(prefabPath);
                const dirPath = pathModule.dirname(absolutePath);
                if (!fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath, { recursive: true });
                    // 【增强】确保 AssetDB 刷新文件夹，防止场景脚本找不到目标目录
                    Editor.assetdb.refresh(targetDir);
                }

                // 解析目标目录和文件名
                const fileName = prefabPath.substring(prefabPath.lastIndexOf("/") + 1);
                const prefabName = fileName.replace(".prefab", "");

                // 1. 重命名节点以匹配预制体名称
                Editor.Ipc.sendToPanel("scene", "scene:set-property", {
                    id: nodeId,
                    path: "name",
                    type: "String",
                    value: prefabName,
                    isSubProp: false,
                });

                // 2. 发送创建命令 (参数: [uuids], dirPath)
                // 注意: scene:create-prefab 第三个参数必须是 db:// 目录路径
                // 【增强】增加延迟到 300ms，确保 IPC 消息处理并同步到底层引擎
                setTimeout(() => {
                    Editor.Ipc.sendToPanel("scene", "scene:create-prefab", [nodeId], targetDir);
                }, 300);

                callback(null, `指令已发送: 从节点 ${nodeId} 在目录 ${targetDir} 创建名为 ${prefabName} 的预制体`);
                break;

            case "save": // 兼容 AI 幻觉
            case "update":
                if (!nodeId) {
                    return callback("更新预制体需要节点 ID");
                }
                if (!Editor.assetdb.exists(prefabPath)) {
                    return callback(`找不到预制体: ${prefabPath}`);
                }
                // 更新预制体
                Editor.Ipc.sendToPanel("scene", "scene:update-prefab", nodeId, prefabPath);
                callback(null, `指令已发送: 从节点 ${nodeId} 更新预制体 ${prefabPath}`);
                break;

            case "instantiate":
                if (!Editor.assetdb.exists(prefabPath)) {
                    return callback(`路径为 ${prefabPath} 的预制体不存在`);
                }
                // 实例化预制体
                const prefabUuid = Editor.assetdb.urlToUuid(prefabPath);
                callSceneScriptWithTimeout(
                    "mcp-bridge",
                    "instantiate-prefab",
                    {
                        prefabUuid: prefabUuid,
                        parentId: parentId,
                    },
                    callback,
                );
                break;

            case "get_info":
                if (Editor.assetdb.exists(prefabPath)) {
                    const uuid = Editor.assetdb.urlToUuid(prefabPath);
                    const info = Editor.assetdb.assetInfoByUuid(uuid);
                    // 确保返回对象包含 exists: true，以满足测试验证
                    const result = info || { url: prefabPath, uuid: uuid };
                    result.exists = true;
                    callback(null, result);
                } else {
                    return callback(`找不到预制体: ${prefabPath}`);
                }
                break;

            default:
                callback(`未知的预制体管理操作: ${action}`);
        }
    },

    /**
     * 管理编辑器状态 (选中对象、刷新等)
     * @param {Object} args 参数
     * @param {Function} callback 完成回调
     */
    manageEditor(args, callback) {
        const { action, target, properties } = args;

        switch (action) {
            case "get_selection":
                // 获取当前选中的资源或节点
                const nodeSelection = Editor.Selection.curSelection("node");
                const assetSelection = Editor.Selection.curSelection("asset");
                callback(null, {
                    nodes: nodeSelection,
                    assets: assetSelection,
                });
                break;
            case "set_selection":
                // 设置选中状态
                if (target === "node") {
                    const ids = properties.ids || properties.nodes;
                    if (ids) Editor.Selection.select("node", ids);
                } else if (target === "asset") {
                    const ids = properties.ids || properties.assets;
                    if (ids) Editor.Selection.select("asset", ids);
                }
                callback(null, "选中状态已更新");
                break;
            case "refresh_editor":
                // 刷新编辑器资源数据库
                // 支持指定路径以避免大型项目全量刷新耗时过长
                // 示例: properties.path = 'db://assets/scripts/MyScript.ts' (刷新单个文件)
                //        properties.path = 'db://assets/resources' (刷新某个目录)
                //        不传 (默认 'db://assets'，全量刷新)
                const refreshPath = properties && properties.path ? properties.path : "db://assets";
                addLog("info", `[refresh_editor] 开始刷新: ${refreshPath}`);
                Editor.assetdb.refresh(refreshPath, (err) => {
                    if (err) {
                        addLog("error", `刷新失败: ${err}`);
                        callback(err);
                    } else {
                        callback(null, `编辑器已刷新: ${refreshPath}`);
                    }
                });
                break;
            default:
                callback("未知的编辑器管理操作");
                break;
        }
    },

    // 管理着色器 (Effect)
    manageShader(args, callback) {
        const { action, path: effectPath, content } = args;

        switch (action) {
            case "create":
                if (Editor.assetdb.exists(effectPath)) {
                    return callback(`Effect 已存在: ${effectPath}`);
                }
                // 确保父目录存在
                const absolutePath = Editor.assetdb.urlToFspath(effectPath);
                const dirPath = pathModule.dirname(absolutePath);
                if (!fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath, { recursive: true });
                }

                const defaultEffect = `CCEffect %{
  techniques:
  - passes:
    - vert: vs
      frag: fs
      blendState:
        targets:
        - blend: true
      rasterizerState:
        cullMode: none
      properties:
        texture: { value: white }
        mainColor: { value: [1, 1, 1, 1], editor: { type: color } }
}%

CCProgram vs %{
  precision highp float;
  #include <cc-global>
  attribute vec3 a_position;
  attribute vec2 a_uv0;
  varying vec2 v_uv0;
  void main () {
    gl_Position = cc_matViewProj * vec4(a_position, 1.0);
    v_uv0 = a_uv0;
  }
}%

CCProgram fs %{
  precision highp float;
  uniform sampler2D texture;
  uniform Constant {
    vec4 mainColor;
  };
  varying vec2 v_uv0;
  void main () {
    gl_FragColor = mainColor * texture2D(texture, v_uv0);
  }
}%`;

                Editor.assetdb.create(effectPath, content || defaultEffect, (err) => {
                    if (err) return callback(err);
                    Editor.assetdb.refresh(effectPath, (refreshErr) => {
                        callback(refreshErr, refreshErr ? null : `Effect 已创建: ${effectPath}`);
                    });
                });
                break;

            case "read":
                if (!Editor.assetdb.exists(effectPath)) {
                    return callback(`找不到 Effect: ${effectPath}`);
                }
                const fspath = Editor.assetdb.urlToFspath(effectPath);
                try {
                    const data = fs.readFileSync(fspath, "utf-8");
                    callback(null, data);
                } catch (e) {
                    callback(`读取 Effect 失败: ${e.message}`);
                }
                break;

            case "save": // 兼容 AI 幻觉
            case "write":
                if (!Editor.assetdb.exists(effectPath)) {
                    return callback(`Effect not found: ${effectPath}`);
                }
                const writeFsPath = Editor.assetdb.urlToFspath(effectPath);
                try {
                    fs.writeFileSync(writeFsPath, content, "utf-8");
                    Editor.assetdb.refresh(effectPath, (err) => {
                        callback(err, err ? null : `Effect 已更新: ${effectPath}`);
                    });
                } catch (e) {
                    callback(`更新 Effect 失败: ${e.message}`);
                }
                break;

            case "delete":
                if (!Editor.assetdb.exists(effectPath)) {
                    return callback(`找不到 Effect: ${effectPath}`);
                }
                Editor.assetdb.delete([effectPath], (err) => {
                    callback(err, err ? null : `Effect 已删除: ${effectPath}`);
                });
                break;

            case "get_info":
                if (Editor.assetdb.exists(effectPath)) {
                    const uuid = Editor.assetdb.urlToUuid(effectPath);
                    const info = Editor.assetdb.assetInfoByUuid(uuid);
                    callback(null, info || { url: effectPath, uuid: uuid, exists: true });
                } else {
                    callback(`找不到 Effect: ${effectPath}`);
                }
                break;

            default:
                callback(`Unknown shader action: ${action}`);
                break;
        }
    },

    // 管理材质
    manageMaterial(args, callback) {
        const { action, path: matPath, properties = {} } = args;

        switch (action) {
            case "create":
                if (Editor.assetdb.exists(matPath)) {
                    return callback(`材质已存在: ${matPath}`);
                }
                // 确保父目录存在
                const absolutePath = Editor.assetdb.urlToFspath(matPath);
                const dirPath = pathModule.dirname(absolutePath);
                if (!fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath, { recursive: true });
                }

                // 构造 Cocos 2.4.x 材质内容
                const materialData = {
                    __type__: "cc.Material",
                    _name: "",
                    _objFlags: 0,
                    _native: "",
                    _effectAsset: properties.shaderUuid ? { __uuid__: properties.shaderUuid } : null,
                    _techniqueIndex: 0,
                    _techniqueData: {
                        0: {
                            defines: properties.defines || {},
                            props: properties.uniforms || {},
                        },
                    },
                };

                Editor.assetdb.create(matPath, JSON.stringify(materialData, null, 2), (err) => {
                    if (err) return callback(err);
                    Editor.assetdb.refresh(matPath, (refreshErr) => {
                        callback(refreshErr, refreshErr ? null : `材质已创建: ${matPath}`);
                    });
                });
                break;

            case "save": // 兼容 AI 幻觉
            case "update":
                if (!Editor.assetdb.exists(matPath)) {
                    return callback(`找不到材质: ${matPath}`);
                }
                const fspath = Editor.assetdb.urlToFspath(matPath);
                try {
                    const content = fs.readFileSync(fspath, "utf-8");
                    const matData = JSON.parse(content);

                    // 确保结构存在
                    if (!matData._techniqueData) matData._techniqueData = {};
                    if (!matData._techniqueData["0"]) matData._techniqueData["0"] = {};
                    const tech = matData._techniqueData["0"];

                    // 更新 Shader
                    if (properties.shaderUuid) {
                        matData._effectAsset = { __uuid__: properties.shaderUuid };
                    }

                    // 更新 Defines
                    if (properties.defines) {
                        tech.defines = Object.assign(tech.defines || {}, properties.defines);
                    }

                    // 更新 Props/Uniforms
                    if (properties.uniforms) {
                        tech.props = Object.assign(tech.props || {}, properties.uniforms);
                    }

                    fs.writeFileSync(fspath, JSON.stringify(matData, null, 2), "utf-8");
                    Editor.assetdb.refresh(matPath, (err) => {
                        callback(err, err ? null : `材质已更新: ${matPath}`);
                    });
                } catch (e) {
                    callback(`更新材质失败: ${e.message}`);
                }
                break;

            case "delete":
                if (!Editor.assetdb.exists(matPath)) {
                    return callback(`找不到材质: ${matPath}`);
                }
                Editor.assetdb.delete([matPath], (err) => {
                    callback(err, err ? null : `材质已删除: ${matPath}`);
                });
                break;

            case "get_info":
                if (Editor.assetdb.exists(matPath)) {
                    const uuid = Editor.assetdb.urlToUuid(matPath);
                    const info = Editor.assetdb.assetInfoByUuid(uuid);
                    callback(null, info || { url: matPath, uuid: uuid, exists: true });
                } else {
                    callback(`找不到材质: ${matPath}`);
                }
                break;

            default:
                callback(`Unknown material action: ${action}`);
                break;
        }
    },

    // 管理纹理
    manageTexture(args, callback) {
        const { action, path, properties } = args;

        switch (action) {
            case "create":
                if (Editor.assetdb.exists(path)) {
                    return callback(`纹理已存在: ${path}`);
                }
                // 确保父目录存在
                const absolutePath = Editor.assetdb.urlToFspath(path);
                const dirPath = pathModule.dirname(absolutePath);
                if (!fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath, { recursive: true });
                }

                // 1. 准备文件内容 (优先使用 properties.content，否则使用默认 1x1)
                let base64Data =
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
                if (properties && properties.content) {
                    base64Data = properties.content;
                }
                const buffer = Buffer.from(base64Data, "base64");

                try {
                    // 2. 写入物理文件
                    fs.writeFileSync(absolutePath, buffer);

                    // 3. 刷新该资源以生成 Meta
                    Editor.assetdb.refresh(path, (err, results) => {
                        if (err) return callback(err);

                        // 4. 如果有 9-slice 设置，更新 Meta
                        if (properties && (properties.border || properties.type)) {
                            const uuid = Editor.assetdb.urlToUuid(path);
                            if (!uuid) return callback(null, `纹理已创建，但未能立即获取 UUID。`);

                            // 稍微延迟确保 Meta 已生成
                            setTimeout(() => {
                                const meta = Editor.assetdb.loadMeta(uuid);
                                if (meta) {
                                    let changed = false;
                                    if (properties.type) {
                                        meta.type = properties.type;
                                        changed = true;
                                    }

                                    // 设置 9-slice (border)
                                    // 注意：Cocos 2.4 纹理 Meta 中 subMetas 下通常有一个与纹理同名的 key (或者主要的一个 key)
                                    if (properties.border) {
                                        // 确保类型是 sprite
                                        meta.type = "sprite";

                                        // 找到 SpriteFrame 的 subMeta
                                        const subKeys = Object.keys(meta.subMetas);
                                        if (subKeys.length > 0) {
                                            const subMeta = meta.subMetas[subKeys[0]];
                                            subMeta.border = properties.border; // [top, bottom, left, right]
                                            changed = true;
                                        }
                                    }

                                    if (changed) {
                                        Editor.assetdb.saveMeta(uuid, JSON.stringify(meta), (err) => {
                                            if (err) Editor.warn(`保存资源 Meta 失败 ${path}: ${err}`);
                                            callback(null, `纹理已创建并更新 Meta: ${path}`);
                                        });
                                        return;
                                    }
                                }
                                callback(null, `纹理已创建: ${path}`);
                            }, 100);
                        } else {
                            callback(null, `纹理已创建: ${path}`);
                        }
                    });
                } catch (e) {
                    callback(`写入纹理文件失败: ${e.message}`);
                }
                break;
            case "delete":
                if (!Editor.assetdb.exists(path)) {
                    return callback(`找不到纹理: ${path}`);
                }
                Editor.assetdb.delete([path], (err) => {
                    callback(err, err ? null : `纹理已删除: ${path}`);
                });
                break;
            case "get_info":
                if (Editor.assetdb.exists(path)) {
                    const uuid = Editor.assetdb.urlToUuid(path);
                    const info = Editor.assetdb.assetInfoByUuid(uuid);
                    callback(null, info || { url: path, uuid: uuid, exists: true });
                } else {
                    callback(`找不到纹理: ${path}`);
                }
                break;
            case "save": // 兼容 AI 幻觉
            case "update":
                if (!Editor.assetdb.exists(path)) {
                    return callback(`找不到纹理: ${path}`);
                }
                const uuid = Editor.assetdb.urlToUuid(path);
                let meta = Editor.assetdb.loadMeta(uuid);

                // Fallback: 如果 Editor.assetdb.loadMeta 失败 (API 偶尔不稳定)，尝试直接读取文件系统中的 .meta 文件
                if (!meta) {
                    try {
                        const fspath = Editor.assetdb.urlToFspath(path);
                        const metaPath = fspath + ".meta";
                        if (fs.existsSync(metaPath)) {
                            const metaContent = fs.readFileSync(metaPath, "utf-8");
                            meta = JSON.parse(metaContent);
                            addLog("info", `[manage_texture] Loaded meta from fs fallback: ${metaPath}`);
                        }
                    } catch (e) {
                        addLog("warn", `[manage_texture] Meta fs fallback failed: ${e.message}`);
                    }
                }

                if (!meta) {
                    return callback(`加载资源 Meta 失败: ${path}`);
                }

                let changed = false;
                if (properties) {
                    // 更新类型
                    if (properties.type) {
                        if (meta.type !== properties.type) {
                            meta.type = properties.type;
                            changed = true;
                        }
                    }

                    // 更新 9-slice border
                    if (properties.border) {
                        // 确保类型是 sprite
                        if (meta.type !== "sprite") {
                            meta.type = "sprite";
                            changed = true;
                        }

                        // 找到 SubMeta
                        // Cocos Meta 结构: { subMetas: { "textureName": { ... } } }
                        // 注意：Cocos 2.x 的 meta 结构因版本而异，旧版可能使用 border: [t, b, l, r] 数组，
                        // 而新版 (如 2.3.x+) 通常使用 borderTop, borderBottom 等独立字段。
                        // 此处逻辑实现了兼容性处理。
                        const subKeys = Object.keys(meta.subMetas);
                        if (subKeys.length > 0) {
                            const subMeta = meta.subMetas[subKeys[0]];
                            const newBorder = properties.border; // [top, bottom, left, right]

                            // 方式 1: standard array style
                            if (subMeta.border !== undefined) {
                                const oldBorder = subMeta.border;
                                if (
                                    !oldBorder ||
                                    oldBorder[0] !== newBorder[0] ||
                                    oldBorder[1] !== newBorder[1] ||
                                    oldBorder[2] !== newBorder[2] ||
                                    oldBorder[3] !== newBorder[3]
                                ) {
                                    subMeta.border = newBorder;
                                    changed = true;
                                }
                            }
                            // 方式 2: individual fields style (common in 2.3.x)
                            else if (subMeta.borderTop !== undefined) {
                                // top, bottom, left, right
                                if (
                                    subMeta.borderTop !== newBorder[0] ||
                                    subMeta.borderBottom !== newBorder[1] ||
                                    subMeta.borderLeft !== newBorder[2] ||
                                    subMeta.borderRight !== newBorder[3]
                                ) {
                                    subMeta.borderTop = newBorder[0];
                                    subMeta.borderBottom = newBorder[1];
                                    subMeta.borderLeft = newBorder[2];
                                    subMeta.borderRight = newBorder[3];
                                    changed = true;
                                }
                            }
                            // 方式 3: 如果都没有，尝试写入 individual fields
                            else {
                                subMeta.borderTop = newBorder[0];
                                subMeta.borderBottom = newBorder[1];
                                subMeta.borderLeft = newBorder[2];
                                subMeta.borderRight = newBorder[3];
                                changed = true;
                            }
                        }
                    }
                }

                if (changed) {
                    // 使用 saveMeta 或者 fs 写入
                    // 为了安全，如果 loadMeta 失败了，safeMeta 可能也会失败，所以这里尽量用 API，不行再 fallback (暂且只用 API)
                    Editor.assetdb.saveMeta(uuid, JSON.stringify(meta), (err) => {
                        if (err) return callback(`保存 Meta 失败: ${err}`);
                        callback(null, `纹理已更新: ${path}`);
                    });
                } else {
                    callback(null, `资源不需要更新: ${path}`);
                }
                break;
            default:
                callback(`未知的纹理操作类型: ${action}`);
                break;
        }
    },

    /**
     * 对文件应用一系列精确的文本编辑操作
     * @param {Object} args 参数
     * @param {Function} callback 完成回调
     */
    applyTextEdits(args, callback) {
        const { filePath, edits } = args;

        // 1. 获取文件系统路径
        const fspath = Editor.assetdb.urlToFspath(filePath);
        if (!fspath) {
            return callback(`找不到文件或 URL 无效: ${filePath}`);
        }

        const fs = require("fs");
        if (!fs.existsSync(fspath)) {
            return callback(`文件不存在: ${fspath}`);
        }

        try {
            // 2. 读取
            let updatedContent = fs.readFileSync(fspath, "utf-8");

            // 3. 应用编辑
            // 必须按倒序应用编辑，否则后续编辑的位置会偏移 (假设edits未排序，这里简单处理，实际上LSP通常建议客户端倒序应用或计算偏移)
            // 这里假设edits已经按照位置排序或者用户负责，如果需要严谨，应先按 start/position 倒序排序
            // 简单排序保险：
            const sortedEdits = [...edits].sort((a, b) => {
                const posA = a.position !== undefined ? a.position : a.start;
                const posB = b.position !== undefined ? b.position : b.start;
                return posB - posA; // 从大到小
            });

            sortedEdits.forEach((edit) => {
                switch (edit.type) {
                    case "insert":
                        updatedContent =
                            updatedContent.slice(0, edit.position) + edit.text + updatedContent.slice(edit.position);
                        break;
                    case "delete":
                        updatedContent = updatedContent.slice(0, edit.start) + updatedContent.slice(edit.end);
                        break;
                    case "replace":
                        updatedContent =
                            updatedContent.slice(0, edit.start) + edit.text + updatedContent.slice(edit.end);
                        break;
                }
            });

            // 4. 写入
            fs.writeFileSync(fspath, updatedContent, "utf-8");

            // 5. 通知编辑器资源变化 (重要)
            Editor.assetdb.refresh(filePath, (err) => {
                if (err) addLog("warn", `刷新失败 ${filePath}: ${err}`);
                callback(null, `文本编辑已应用: ${filePath}`);
            });
        } catch (err) {
            callback(`操作失败: ${err.message}`);
        }
    },

    // 读取控制台
    readConsole(args, callback) {
        const { limit, type } = args;
        let filteredOutput = logBuffer;

        if (type) {
            // [优化] 支持别名映射
            const targetType = type === "log" ? "info" : type;
            filteredOutput = filteredOutput.filter((item) => item.type === targetType);
        }

        if (limit) {
            filteredOutput = filteredOutput.slice(-limit);
        }

        callback(null, filteredOutput);
    },

    /**
     * 执行编辑器菜单项
     * @param {Object} args 参数 (menuPath)
     * @param {Function} callback 完成回调
     */
    executeMenuItem(args, callback) {
        const { menuPath } = args;
        if (!menuPath) {
            return callback("菜单路径是必填项");
        }
        addLog("info", `执行菜单项: ${menuPath}`);

        // 菜单项映射表 (Cocos Creator 2.4.x IPC)
        // 参考: IPC_MESSAGES.md
        const menuMap = {
            "File/New Scene": "scene:new-scene",
            "File/Save Scene": "scene:stash-and-save",
            "File/Save": "scene:stash-and-save", // 别名
            "Edit/Undo": "scene:undo",
            "Edit/Redo": "scene:redo",
            "Edit/Delete": "scene:delete-nodes",
            Delete: "scene:delete-nodes",
            delete: "scene:delete-nodes",
        };

        // 特殊处理 delete-node:UUID 格式
        if (menuPath.startsWith("delete-node:")) {
            const uuid = menuPath.split(":")[1];
            if (uuid) {
                callSceneScriptWithTimeout("mcp-bridge", "delete-node", { uuid }, (err, result) => {
                    if (err) callback(err);
                    else callback(null, result || `节点 ${uuid} 已通过场景脚本删除`);
                });
                return;
            }
        }

        if (menuMap[menuPath]) {
            const ipcMsg = menuMap[menuPath];
            try {
                // 获取当前选中的节点进行删除（如果该消息是删除操作）
                if (ipcMsg === "scene:delete-nodes") {
                    const selection = Editor.Selection.curSelection("node");
                    if (selection.length > 0) {
                        Editor.Ipc.sendToMain(ipcMsg, selection);
                        callback(null, `菜单动作已触发: ${menuPath} -> ${ipcMsg} (影响 ${selection.length} 个节点)`);
                    } else {
                        callback("没有选中任何节点进行删除");
                    }
                } else {
                    Editor.Ipc.sendToMain(ipcMsg);
                    callback(null, `菜单动作已触发: ${menuPath} -> ${ipcMsg}`);
                }
            } catch (err) {
                callback(`执行 IPC ${ipcMsg} 失败: ${err.message}`);
            }
        } else {
            // 对于未在映射表中的菜单，尝试通用的 menu:click (虽然不一定有效)
            // 或者直接返回不支持的警告
            addLog("warn", `支持映射表中找不到菜单项 '${menuPath}'。尝试通过旧版模式执行。`);

            // 尝试通用调用
            try {
                // 注意：Cocos Creator 2.x 的 menu:click 通常需要 Electron 菜单 ID，而不只是路径
                // 这里做个尽力而为的尝试
                Editor.Ipc.sendToMain("menu:click", menuPath);
                callback(null, `通用菜单动作已发送: ${menuPath} (仅支持项保证成功)`);
            } catch (e) {
                callback(`执行菜单项失败: ${menuPath}`);
            }
        }
    },

    /**
     * 验证脚本文件的语法或基础结构
     * @param {Object} args 参数 (filePath)
     * @param {Function} callback 完成回调
     */
    validateScript(args, callback) {
        const { filePath } = args;

        // 1. 获取文件系统路径
        const fspath = Editor.assetdb.urlToFspath(filePath);
        if (!fspath) {
            return callback(`找不到文件或 URL 无效: ${filePath}`);
        }

        // 2. 检查文件是否存在
        if (!fs.existsSync(fspath)) {
            return callback(`文件不存在: ${fspath}`);
        }

        // 3. 读取内容并验证
        try {
            const content = fs.readFileSync(fspath, "utf-8");

            // 检查空文件
            if (!content || content.trim().length === 0) {
                return callback(null, { valid: false, message: "脚本内容为空" });
            }

            // 对于 JavaScript 脚本，使用 Function 构造器进行语法验证
            if (filePath.endsWith(".js")) {
                const wrapper = `(function() { ${content} })`;
                try {
                    new Function(wrapper);
                    callback(null, { valid: true, message: "JavaScript 语法验证通过" });
                } catch (syntaxErr) {
                    return callback(null, { valid: false, message: syntaxErr.message });
                }
            }
            // 对于 TypeScript，由于没有内置 TS 编译器，我们进行基础的"防呆"检查
            // 并明确告知用户无法进行完整编译验证
            else if (filePath.endsWith(".ts")) {
                // 简单的正则表达式检查：是否有非法字符或明显错误结构 (示例)
                // 这里暂时只做简单的括号匹配检查或直接通过，但给出一个 Warning

                // 检查是否有 class 定义 (简单的启发式检查)
                if (
                    !content.includes("class ") &&
                    !content.includes("interface ") &&
                    !content.includes("enum ") &&
                    !content.includes("export ")
                ) {
                    return callback(null, {
                        valid: true,
                        message:
                            "警告: TypeScript 文件似乎缺少标准定义 (class/interface/export)，但由于缺少编译器，已跳过基础语法检查。",
                    });
                }

                callback(null, {
                    valid: true,
                    message: "TypeScript 基础检查通过。(完整编译验证需要通过编辑器构建流程)",
                });
            } else {
                callback(null, { valid: true, message: "未知的脚本类型，跳过验证。" });
            }
        } catch (err) {
            callback(null, { valid: false, message: `读取错误: ${err.message}` });
        }
    },
    // 暴露给 MCP 或面板的 API 封装
    messages: {
        "scan-ipc-messages"(event) {
            try {
                const msgs = IpcManager.getIpcMessages();
                if (event.reply) event.reply(null, msgs);
            } catch (e) {
                if (event.reply) event.reply(e.message);
            }
        },
        "test-ipc-message"(event, args) {
            const { name, params } = args;
            IpcManager.testIpcMessage(name, params).then((result) => {
                if (event.reply) event.reply(null, result);
            });
        },
        "open-test-panel"() {
            Editor.Panel.open("mcp-bridge");
        },

        "toggle-server"(event, port) {
            if (serverConfig.active) this.stopServer();
            else {
                // 用户手动启动时，保存偏好端口
                this.getProfile().set("last-port", port);
                this.getProfile().save();
                this.startServer(port);
            }
        },
        "clear-logs"() {
            logBuffer = [];
            addLog("info", "日志已清理");
        },

        // 修改场景中的节点（需要通过 scene-script）
        "set-node-property"(event, args) {
            addLog("mcp", `设置节点属性: ${args.name} (${args.type})`);
            // 确保第一个参数 'mcp-bridge' 和 package.json 的 name 一致
            Editor.Scene.callSceneScript("mcp-bridge", "set-property", args, (err, result) => {
                if (err) {
                    Editor.error("Scene Script Error:", err);
                }
                if (event && event.reply) {
                    event.reply(err, result);
                }
            });
        },
        "create-node"(event, args) {
            addLog("mcp", `创建节点: ${args.name} (${args.type})`);
            Editor.Scene.callSceneScript("mcp-bridge", "create-node", args, (err, result) => {
                if (err) addLog("error", `创建节点失败: ${err}`);
                else addLog("success", `节点已创建: ${result}`);
                event.reply(err, result);
            });
        },
        "get-server-state"(event) {
            let profile = this.getProfile();
            event.reply(null, {
                config: serverConfig,
                logs: logBuffer,
                autoStart: profile.get("auto-start"), // 返回自动启动状态
            });
        },

        "set-auto-start"(event, value) {
            this.getProfile().set("auto-start", value);
            this.getProfile().save();
            addLog("info", `自动启动已设置为: ${value}`);
        },

        "inspect-apis"() {
            addLog("info", "[API 检查器] 开始深度分析...");

            // 获取函数参数的辅助函数
            const getArgs = (func) => {
                try {
                    const str = func.toString();
                    const match = str.match(/function\s.*?\(([^)]*)\)/) || str.match(/.*?\(([^)]*)\)/);
                    if (match) {
                        return match[1]
                            .split(",")
                            .map((arg) => arg.trim())
                            .filter((a) => a)
                            .join(", ");
                    }
                    return `${func.length} args`;
                } catch (e) {
                    return "?";
                }
            };

            // 检查对象的辅助函数
            const inspectObj = (name, obj) => {
                if (!obj) return { name, exists: false };
                const props = {};
                const proto = Object.getPrototypeOf(obj);

                // 组合自身属性和原型属性
                const allKeys = new Set([
                    ...Object.getOwnPropertyNames(obj),
                    ...Object.getOwnPropertyNames(proto || {}),
                ]);

                allKeys.forEach((key) => {
                    if (key.startsWith("_")) return; // 跳过私有属性
                    try {
                        const val = obj[key];
                        if (typeof val === "function") {
                            props[key] = `func(${getArgs(val)})`;
                        } else {
                            props[key] = typeof val;
                        }
                    } catch (e) {}
                });
                return { name, exists: true, props };
            };

            // 1. 检查标准对象
            const standardObjects = {
                "Editor.assetdb": Editor.assetdb,
                "Editor.Selection": Editor.Selection,
                "Editor.Ipc": Editor.Ipc,
                "Editor.Panel": Editor.Panel,
                "Editor.Scene": Editor.Scene,
                "Editor.Utils": Editor.Utils,
                "Editor.remote": Editor.remote,
            };

            const report = {};
            Object.keys(standardObjects).forEach((key) => {
                report[key] = inspectObj(key, standardObjects[key]);
            });

            // 2. 检查特定论坛提到的 API
            const forumChecklist = [
                "Editor.assetdb.queryInfoByUuid",
                "Editor.assetdb.assetInfoByUuid",
                "Editor.assetdb.move",
                "Editor.assetdb.createOrSave",
                "Editor.assetdb.delete",
                "Editor.assetdb.urlToUuid",
                "Editor.assetdb.uuidToUrl",
                "Editor.assetdb.fspathToUrl",
                "Editor.assetdb.urlToFspath",
                "Editor.remote.assetdb.uuidToUrl",
                "Editor.Selection.select",
                "Editor.Selection.clear",
                "Editor.Selection.curSelection",
                "Editor.Selection.curGlobalActivate",
            ];

            const checklistResults = {};
            forumChecklist.forEach((path) => {
                const parts = path.split(".");
                let curr = global; // 在主进程中，Editor 是全局的
                let exists = true;
                for (const part of parts) {
                    if (curr && curr[part]) {
                        curr = curr[part];
                    } else {
                        exists = false;
                        break;
                    }
                }
                checklistResults[path] = exists
                    ? typeof curr === "function"
                        ? `Available(${getArgs(curr)})`
                        : "Available"
                    : "Missing";
            });

            addLog("info", `[API 检查器] 标准对象:\n${JSON.stringify(report, null, 2)}`);
            addLog("info", `[API 检查器] 论坛核查清单:\n${JSON.stringify(checklistResults, null, 2)}`);

            // 3. 检查内置包 IPC 消息
            const ipcReport = {};
            const builtinPackages = ["scene", "builder", "assets"]; // 核心内置包
            const fs = require("fs");

            builtinPackages.forEach((pkgName) => {
                try {
                    const pkgPath = Editor.url(`packages://${pkgName}/package.json`);
                    if (pkgPath && fs.existsSync(pkgPath)) {
                        const pkgData = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
                        if (pkgData.messages) {
                            ipcReport[pkgName] = Object.keys(pkgData.messages);
                        } else {
                            ipcReport[pkgName] = "No messages defined";
                        }
                    } else {
                        ipcReport[pkgName] = "Package path not found";
                    }
                } catch (e) {
                    ipcReport[pkgName] = `Error: ${e.message}`;
                }
            });

            addLog("info", `[API 检查器] 内置包 IPC 消息:\n${JSON.stringify(ipcReport, null, 2)}`);
        },
    },

    /**
     * 全局项目文件搜索 (支持正则表达式、文件名、目录名搜索)
     * @param {Object} args 参数
     * @param {Function} callback 完成回调
     */
    searchProject(args, callback) {
        const { query, useRegex, path: searchPath, matchType, extensions } = args;

        // 默认值
        const rootPathUrl = searchPath || "db://assets";
        const rootPath = Editor.assetdb.urlToFspath(rootPathUrl);

        if (!rootPath || !fs.existsSync(rootPath)) {
            return callback(`无效的搜索路径: ${rootPathUrl}`);
        }

        const mode = matchType || "content"; // content, file_name, dir_name
        const validExtensions = extensions || [".js", ".ts", ".json", ".fire", ".prefab", ".xml", ".txt", ".md"];
        const results = [];
        const MAX_RESULTS = 500;

        let regex = null;
        if (useRegex) {
            try {
                regex = new RegExp(query);
            } catch (e) {
                return callback(`Invalid regex: ${e.message}`);
            }
        }

        const checkMatch = (text) => {
            if (useRegex) return regex.test(text);
            return text.includes(query);
        };

        try {
            const walk = (dir) => {
                if (results.length >= MAX_RESULTS) return;

                const list = fs.readdirSync(dir);
                list.forEach((file) => {
                    if (results.length >= MAX_RESULTS) return;

                    // 忽略隐藏文件和常用忽略目录
                    if (
                        file.startsWith(".") ||
                        file === "node_modules" ||
                        file === "bin" ||
                        file === "local" ||
                        file === "library" ||
                        file === "temp"
                    )
                        return;

                    const filePath = pathModule.join(dir, file);
                    const stat = fs.statSync(filePath);

                    if (stat && stat.isDirectory()) {
                        // 目录名搜索
                        if (mode === "dir_name") {
                            if (checkMatch(file)) {
                                const relativePath = pathModule.relative(
                                    Editor.assetdb.urlToFspath("db://assets"),
                                    filePath,
                                );
                                const dbPath = "db://assets/" + relativePath.split(pathModule.sep).join("/");
                                results.push({
                                    filePath: dbPath,
                                    type: "directory",
                                    name: file,
                                });
                            }
                        }
                        // 递归
                        walk(filePath);
                    } else {
                        const ext = pathModule.extname(file).toLowerCase();

                        // 文件名搜索
                        if (mode === "file_name") {
                            if (validExtensions && validExtensions.length > 0 && !validExtensions.includes(ext)) {
                                // 如果指定了后缀，则必须匹配
                                // (Logic kept simple: if extensions provided, filter by them. If not provided, search all files or default list?)
                                // Let's stick to validExtensions for file_name search too to avoid noise, or maybe allow all if extensions is explicitly null?
                                // Schema default is null. Let's start with checkMatch(file) directly if no extensions provided.
                                // Actually validExtensions has a default list. Let's respect it if it was default, but for file_name maybe we want all?
                                // Let's use validExtensions only if mode is content. For file_name, usually we search everything unless filtered.
                                // But to be safe and consistent with previous find_in_file, let's respect validExtensions.
                            }

                            // 简化逻辑：对文件名搜索，也检查后缀（如果用户未传则用默认列表）
                            if (validExtensions.includes(ext)) {
                                if (checkMatch(file)) {
                                    const relativePath = pathModule.relative(
                                        Editor.assetdb.urlToFspath("db://assets"),
                                        filePath,
                                    );
                                    const dbPath = "db://assets/" + relativePath.split(pathModule.sep).join("/");
                                    results.push({
                                        filePath: dbPath,
                                        type: "file",
                                        name: file,
                                    });
                                }
                            }
                            // 如果需要搜索非文本文件（如 .png），可以传入 extensions=['.png']
                        }

                        // 内容搜索
                        else if (mode === "content") {
                            if (validExtensions.includes(ext)) {
                                try {
                                    const content = fs.readFileSync(filePath, "utf8");
                                    const lines = content.split("\n");
                                    lines.forEach((line, index) => {
                                        if (results.length >= MAX_RESULTS) return;
                                        if (checkMatch(line)) {
                                            const relativePath = pathModule.relative(
                                                Editor.assetdb.urlToFspath("db://assets"),
                                                filePath,
                                            );
                                            const dbPath =
                                                "db://assets/" + relativePath.split(pathModule.sep).join("/");
                                            results.push({
                                                filePath: dbPath,
                                                line: index + 1,
                                                content: line.trim(),
                                            });
                                        }
                                    });
                                } catch (e) {
                                    // Skip read error
                                }
                            }
                        }
                    }
                });
            };

            walk(rootPath);
            callback(null, results);
        } catch (err) {
            callback(`项目搜索失败: ${err.message}`);
        }
    },

    /**
     * 管理撤销/重做操作及事务分组
     * @param {Object} args 参数 (action, description, id)
     * @param {Function} callback 完成回调
     */
    manageUndo(args, callback) {
        const { action, description } = args;

        try {
            switch (action) {
                case "undo":
                    Editor.Ipc.sendToPanel("scene", "scene:undo");
                    callback(null, "撤销指令已执行");
                    break;
                case "redo":
                    Editor.Ipc.sendToPanel("scene", "scene:redo");
                    callback(null, "重做指令已执行");
                    break;
                case "begin_group":
                    addLog("info", `开始撤销组: ${description || "MCP 动作"}`);
                    // 如果有参数包含 id，则记录该节点
                    if (args.id) {
                        Editor.Ipc.sendToPanel("scene", "scene:undo-record", args.id);
                    }
                    callback(null, `撤销组已启动: ${description || "MCP 动作"}`);
                    break;
                case "end_group":
                    Editor.Ipc.sendToPanel("scene", "scene:undo-commit");
                    callback(null, "撤销组已提交");
                    break;
                case "cancel_group":
                    Editor.Ipc.sendToPanel("scene", "scene:undo-cancel");
                    callback(null, "撤销组已取消");
                    break;
                default:
                    callback(`未知的撤销操作: ${action}`);
            }
        } catch (err) {
            callback(`撤销操作失败: ${err.message}`);
        }
    },

    /**
     * 计算资源的 SHA-256 哈希值
     * @param {Object} args 参数 (path)
     * @param {Function} callback 完成回调
     */
    getSha(args, callback) {
        const { path: url } = args;
        const fspath = Editor.assetdb.urlToFspath(url);

        if (!fspath || !fs.existsSync(fspath)) {
            return callback(`找不到文件: ${url}`);
        }

        try {
            const fileBuffer = fs.readFileSync(fspath);
            const hashSum = crypto.createHash("sha256");
            hashSum.update(fileBuffer);
            const sha = hashSum.digest("hex");
            callback(null, { path: url, sha: sha });
        } catch (err) {
            callback(`计算 SHA 失败: ${err.message}`);
        }
    },

    /**
     * 管理节点动画 (播放、停止、获取信息等)
     * @param {Object} args 参数
     * @param {Function} callback 完成回调
     */
    manageAnimation(args, callback) {
        // 转发给场景脚本处理
        callSceneScriptWithTimeout("mcp-bridge", "manage-animation", args, callback);
    },
};
