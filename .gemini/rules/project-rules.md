---
trigger: always_on
description: "MCP Bridge 插件开发规则和编码规范"
---

# MCP Bridge Development Rules

## 1. 语言规范 (Language)

- **强制中文**: 所有的对话回复、代码注释、以及生成的文档都必须使用**中文**。
- **日志消息**: `addLog()` 的消息内容可以使用中英文混合，确保关键术语清晰。

---

## 2. 关键工作流程 (Critical Workflow)

### 2.1 插件重载

- **必须重载**: 修改 `main.js`, `package.json`, `scene-script.js`, 或 `panel/` 后，**必须**在编辑器中执行「扩展 → 刷新」或重启编辑器。
- **热更新不适用**: Cocos Creator 2.x 的插件主进程脚本不支持热更新。

### 2.2 测试驱动

- **测试脚本**: 每个新功能必须在 `test/` 目录下创建独立测试脚本 (如 `test/test_feature.js`)。
- **HTTP 验证**: 测试脚本通过 HTTP 请求直接调用插件 API，验证功能正确性。
- **运行前提**: 确保 Cocos Creator 编辑器已打开且 MCP Bridge 服务已启动。

---

## 3. 架构与进程隔离 (Architecture & IPC)

### 3.1 进程职责划分

| 文件              | 进程                | 可访问                                      | 不可访问                              |
| ----------------- | ------------------- | ------------------------------------------- | ------------------------------------- |
| `main.js`         | 主进程 (Main)       | `Editor.assetdb`, `Editor.Ipc`, `require()` | `cc.*` (Cocos 引擎)                   |
| `scene-script.js` | 渲染进程 (Renderer) | `cc.*`, `cc.engine`, `cc.director`          | `Editor.assetdb`, `Editor.FileSystem` |

### 3.2 跨进程通信规则

```
主进程 (main.js)                    渲染进程 (scene-script.js)
       │                                      │
       ├─ 1. 接收 HTTP 请求                    │
       ├─ 2. 解析 db:// 路径为 UUID            │
       │      Editor.assetdb.urlToUuid()       │
       ├─ 3. 调用场景脚本 ──────────────────────┤
       │      Editor.Scene.callSceneScript()   │
       │                                       ├─ 4. 操作节点/组件
       │                                       │      cc.engine.getInstanceById()
       │                                       ├─ 5. 通知场景变脏
       │                                       │      Editor.Ipc.sendToMain("scene:dirty")
       └─ 6. 返回结果 ◀────────────────────────┘
```

**核心规则**: 永远在 `main.js` 中将 `db://` 路径转换为 UUID，再传递给 `scene-script.js`。

---

## 4. 编码规范 (Coding Standards)

### 4.1 命名规范

| 类型       | 规范                 | 示例                              |
| ---------- | -------------------- | --------------------------------- |
| 函数名     | camelCase            | `handleMcpCall`, `manageScript`   |
| 常量       | SCREAMING_SNAKE_CASE | `MAX_RESULTS`, `DEFAULT_PORT`     |
| 私有变量   | \_camelCase          | `_isMoving`, `_timer`             |
| 布尔变量   | is/has/can 前缀      | `isSceneBusy`, `hasComponent`     |
| MCP 工具名 | snake_case           | `get_selected_node`, `manage_vfx` |
| IPC 消息名 | kebab-case           | `get-hierarchy`, `create-node`    |

### 4.2 函数组织顺序

在 `module.exports` 中按以下顺序组织函数：

```javascript
module.exports = {
    // 1. 配置属性
    "scene-script": "scene-script.js",

    // 2. 生命周期函数
    load() {},
    unload() {},

    // 3. 服务器管理
    startServer(port) {},
    stopServer() {},

    // 4. 核心处理逻辑
    handleMcpCall(name, args, callback) {},

    // 5. 工具函数 (按字母顺序)
    applyTextEdits(args, callback) {},
    batchExecute(args, callback) {},
    // ...

    // 6. IPC 消息处理
    messages: {
        "open-test-panel"() {},
        // ...
    },
};
```

### 4.3 避免重复定义

> ⚠️ **重要**: `main.js` 已存在重复函数问题，编辑前务必使用 `view_file` 确认上下文，避免创建重复定义。

**检查清单**:

- [ ] 新增函数前，搜索是否已存在同名函数
- [ ] 修改函数时，确认只有一个定义
- [ ] `messages` 对象中避免重复的消息处理器

### 4.4 日志规范

使用 `addLog(type, message)` 替代 `console.log()`：

```javascript
// ✅ 正确
addLog("info", "服务启动成功");
addLog("error", `操作失败: ${err.message}`);
addLog("mcp", `REQ -> [${toolName}]`);
addLog("success", `RES <- [${toolName}] 成功`);

// ❌ 错误
console.log("服务启动成功"); // 不会被 read_console 捕获
```

| type      | 用途          | 颜色 |
| --------- | ------------- | ---- |
| `info`    | 一般信息      | 蓝色 |
| `success` | 操作成功      | 绿色 |
| `warn`    | 警告信息      | 黄色 |
| `error`   | 错误信息      | 红色 |
| `mcp`     | MCP 请求/响应 | 紫色 |

---

## 5. 撤销/重做支持 (Undo/Redo)

### 5.1 使用 scene:set-property

对于节点属性修改，优先使用 `scene:set-property` 以获得原生 Undo 支持：

```javascript
// ✅ 支持 Undo
Editor.Ipc.sendToPanel("scene", "scene:set-property", {
    id: nodeId,
    path: "x",
    type: "Float",
    value: 100,
    isSubProp: false,
});

// ⚠️ 不支持 Undo，但同步生效（update-node-transform 使用此方式）
node.x = 100;
```

> **注意**: `update-node-transform` 中所有 13 个属性均使用直接赋值方式，这是为了解决异步 IPC 竞态条件导致属性不生效的问题。此为设计性 trade-off：牺牲 Undo 支持以保证属性即时可靠生效。

### 5.2 使用 Undo 组

对于复合操作，使用 Undo 组包装：

```javascript
Editor.Ipc.sendToPanel("scene", "scene:undo-record", "Transform Update");
try {
    // 执行多个属性修改
    Editor.Ipc.sendToPanel("scene", "scene:undo-commit");
} catch (e) {
    Editor.Ipc.sendToPanel("scene", "scene:undo-cancel");
}
```

---

## 6. 功能特定规则 (Feature Specifics)

### 6.1 粒子系统 (VFX)

```javascript
// 必须设置 custom = true，否则属性修改可能不生效
particleSystem.custom = true;

// 确保纹理有效，否则粒子不可见
if (!particleSystem.texture && !particleSystem.file) {
    // 加载默认纹理
}
```

### 6.2 资源路径解析

```javascript
// 内置资源可能需要多个路径尝试
const defaultPaths = [
    "db://internal/image/default_sprite_splash",
    "db://internal/image/default_sprite_splash.png",
    "db://internal/image/default_particle",
    "db://internal/image/default_particle.png",
];

for (const path of defaultPaths) {
    const uuid = Editor.assetdb.urlToUuid(path);
    if (uuid) break;
}
```

### 6.3 场景操作时序

```javascript
// 场景操作后需要延迟通知 UI 刷新
newNode.parent = parent;
Editor.Ipc.sendToMain("scene:dirty");

// 使用 setTimeout 让出主循环
setTimeout(() => {
    Editor.Ipc.sendToAll("scene:node-created", {
        uuid: newNode.uuid,
        parentUuid: parent.uuid,
    });
}, 10);
```

---

## 7. 错误处理规范 (Error Handling)

### 7.1 回调风格统一

```javascript
// ✅ 标准风格
callback(null, result); // 成功
callback("Error message"); // 失败 (字符串)
callback(new Error("message")); // 失败 (Error 对象)

// 避免混用
callback(err, null); // 不推荐，保持一致性
```

### 7.2 异步操作错误处理

```javascript
Editor.assetdb.queryInfoByUrl(path, (err, info) => {
    if (err) {
        addLog("error", `查询资源失败: ${err.message}`);
        return callback(`Failed to get info: ${err.message}`);
    }
    // 继续处理...
});
```

---

## 8. 提交规范 (Git Commit)

使用 [Conventional Commits](https://conventionalcommits.org/) 格式：

| 类型       | 用途     | 示例                                         |
| ---------- | -------- | -------------------------------------------- |
| `feat`     | 新功能   | `feat: add manage_vfx tool`                  |
| `fix`      | 修复 bug | `fix: resolve duplicate function in main.js` |
| `docs`     | 文档更新 | `docs: add code review report`               |
| `refactor` | 重构     | `refactor: split main.js into modules`       |
| `test`     | 测试     | `test: add material management tests`        |
| `chore`    | 杂项     | `chore: update dependencies`                 |

---

## 9. 已知问题 (Known Issues)

| 问题                                     | 原因                                  | 解决方案                           |
| ---------------------------------------- | ------------------------------------- | ---------------------------------- |
| "Unknown object to record" 错误          | Cocos 2.4.x Undo 系统与 MCP 交互问题  | 可忽略，不影响功能                 |
| "sendToMain scene:stash-and-save failed" | 时序问题                              | 手动 Ctrl+S 保存                   |
| `update-node-transform` 不支持 Undo      | 为解决异步 IPC 竞态问题，改用直接赋值 | 设计性 trade-off，保证属性即时生效 |
| execute_menu_item 仅支持部分菜单         | 缺乏通用菜单 IPC                      | 添加菜单映射表                     |
