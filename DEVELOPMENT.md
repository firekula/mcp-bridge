# MCP Bridge 插件开发流程文档

本文档记录了 MCP Bridge 插件的完整开发流程，包括核心架构设计、功能实现、测试与调试等各个阶段。

## 1. 项目初始化

### 1.1 目录结构搭建

```
mcp-bridge/
├── main.js              # 插件主入口
├── scene-script.js      # 场景脚本
├── mcp-proxy.js         # MCP 代理
├── README.md            # 项目说明
├── DEVELOPMENT.md       # 开发流程文档
├── package.json         # 插件配置
└── panel/               # 面板目录
    ├── index.html       # 面板界面
    └── index.js         # 面板逻辑
```

### 1.2 插件配置

在 `package.json` 中配置插件信息：

```json
{
  "name": "mcp-bridge",
  "version": "1.0.0",
  "description": "MCP Bridge for Cocos Creator",
  "main": "main.js",
  "panel": {
    "main": "panel/index.html",
    "type": "dockable",
    "title": "MCP Bridge",
    "width": 800,
    "height": 600
  },
  "contributions": {
    "menu": [
      {
        "path": "Packages/MCP Bridge",
        "label": "Open Test Panel",
        "message": "open-test-panel"
      }
    ]
  }
}
```

## 2. 核心架构设计

### 2.1 系统架构

```
┌────────────────────┐     HTTP     ┌────────────────────┐     IPC     ┌────────────────────┐
│  外部 AI 工具       │  ──────────> │  main.js (HTTP服务) │  ─────────> │  scene-script.js   │
│  (Cursor/VS Code)  │     <──────── │  (MCP 协议处理)     │     <──────── │  (场景操作执行)     │
└────────────────────┘     JSON     └────────────────────┘     JSON     └────────────────────┘
```

### 2.2 核心模块

1. **HTTP 服务模块**：处理外部请求，解析 MCP 协议
2. **MCP 工具模块**：实现各种操作工具
3. **场景操作模块**：执行场景相关操作
4. **资源管理模块**：处理脚本和资源文件
5. **面板界面模块**：提供用户交互界面

## 3. 功能模块实现

### 3.1 HTTP 服务实现

在 `main.js` 中实现 HTTP 服务：

```javascript
startServer(port) {
    try {
        const http = require('http');
        mcpServer = http.createServer((req, res) => {
            // 处理请求...
        });
        mcpServer.listen(port, () => {
            addLog("success", `MCP Server running at http://127.0.0.1:${port}`);
        });
    } catch (e) {
        addLog("error", `Failed to start server: ${e.message}`);
    }
}
```

### 3.2 MCP 工具注册

在 `/list-tools` 接口中注册工具：

```javascript
const tools = [
    {
        name: "get_selected_node",
        description: "获取当前选中的节点",
        parameters: []
    },
    // 其他工具...
];
```

### 3.3 场景操作实现

在 `scene-script.js` 中实现场景相关操作：

```javascript
const sceneScript = {
    'create-node'(params, callback) {
        // 创建节点逻辑...
    },
    'set-property'(params, callback) {
        // 设置属性逻辑...
    },
    // 其他操作...
};
```

### 3.4 脚本管理实现

在 `main.js` 中实现脚本管理功能：

```javascript
manageScript(args, callback) {
    const { action, path, content } = args;
    switch (action) {
        case "create":
            // 确保父目录存在
            const fs = require('fs');
            const pathModule = require('path');
            const absolutePath = Editor.assetdb.urlToFspath(path);
            const dirPath = pathModule.dirname(absolutePath);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
            // 创建 TypeScript 脚本
            Editor.assetdb.create(path, content || `const { ccclass, property } = cc._decorator;

@ccclass
export default class NewScript extends cc.Component {
    // LIFE-CYCLE CALLBACKS:

    onLoad () {}

    start () {}

    update (dt) {}
}`, (err) => {
                callback(err, err ? null : `Script created at ${path}`);
            });
            break;
        // 其他操作...
    }
}
```

### 3.5 批处理执行实现

在 `main.js` 中实现批处理功能：

```javascript
batchExecute(args, callback) {
    const { operations } = args;
    const results = [];
    let completed = 0;

    if (!operations || operations.length === 0) {
        return callback("No operations provided");
    }

    operations.forEach((operation, index) => {
        this.handleMcpCall(operation.tool, operation.params, (err, result) => {
            results[index] = { tool: operation.tool, error: err, result: result };
            completed++;

            if (completed === operations.length) {
                callback(null, results);
            }
        });
    });
}
```

### 3.6 资产管理实现

在 `main.js` 中实现资产管理功能：

```javascript
manageAsset(args, callback) {
    const { action, path, targetPath, content } = args;

    switch (action) {
        case "create":
            // 确保父目录存在
            const fs = require('fs');
            const pathModule = require('path');
            const absolutePath = Editor.assetdb.urlToFspath(path);
            const dirPath = pathModule.dirname(absolutePath);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
            Editor.assetdb.create(path, content || '', (err) => {
                callback(err, err ? null : `Asset created at ${path}`);
            });
            break;
        // 其他操作...
    }
}
```

### 3.7 面板界面实现

在 `panel/index.html` 中实现标签页界面：

```html
<div class="mcp-container">
    <!-- 标签页 -->
    <div class="tabs">
        <ui-button id="tabMain" class="tab-button active">Main</ui-button>
        <ui-button id="tabTest" class="tab-button">Tool Test</ui-button>
    </div>

    <!-- 主面板内容 -->
    <div id="panelMain" class="tab-content active">
        <!-- 主面板内容... -->
    </div>

    <!-- 测试面板内容 -->
    <div id="panelTest" class="tab-content">
        <div class="test-container">
            <div class="test-layout">
                <!-- 左侧工具列表 -->
                <div class="left-panel">
                    <!-- 工具列表... -->
                </div>
                
                <!-- 右侧输入输出 -->
                <div class="right-panel">
                    <!-- 输入输出区域... -->
                </div>
            </div>
        </div>
    </div>
</div>
```

## 4. 测试与调试

### 4.1 本地测试

1. **启动服务**：在面板中点击 "Start" 按钮
2. **测试工具**：在 "Tool Test" 标签页中测试各个工具
3. **查看日志**：在主面板中查看操作日志

### 4.2 常见错误及修复

#### 4.2.1 面板加载错误

**错误信息**：`Panel info not found for panel mcp-bridge`

**解决方案**：
- 检查 `package.json` 中的面板配置
- 确保 `panel` 字段配置正确，移除冲突的 `panels` 字段

#### 4.2.2 资源创建错误

**错误信息**：`Parent path ... is not exists`

**解决方案**：
- 在创建资源前添加目录检查和创建逻辑
- 使用 `fs.mkdirSync(dirPath, { recursive: true })` 递归创建目录

#### 4.2.3 脚本语法错误

**错误信息**：`SyntaxError: Invalid or unexpected token`

**解决方案**：
- 使用模板字符串（反引号）处理多行字符串
- 避免变量名冲突

### 4.3 性能优化

1. **批处理执行**：使用 `batch_execute` 工具减少 HTTP 请求次数
2. **异步操作**：使用回调函数处理异步操作，避免阻塞主线程
3. **错误处理**：完善错误处理机制，提高插件稳定性

## 5. 文档编写

### 5.1 README.md

- 项目简介
- 功能特性
- 安装使用
- API 文档
- 技术实现

### 5.2 API 文档

为每个 MCP 工具编写详细的 API 文档，包括：
- 工具名称
- 功能描述
- 参数说明
- 返回值格式
- 使用示例

### 5.3 开发文档

- 项目架构
- 开发流程
- 代码规范
- 贡献指南

## 6. 部署与使用

### 6.1 部署方式

1. **本地部署**：将插件复制到 Cocos Creator 项目的 `packages` 目录
2. **远程部署**：通过版本控制系统管理插件代码

### 6.2 使用流程

1. **启动服务**：
   - 打开 Cocos Creator 编辑器
   - 选择 `Packages/MCP Bridge/Open Test Panel`
   - 点击 "Start" 按钮启动服务

2. **连接 AI 编辑器**：
   - 在 AI 编辑器中配置 MCP 代理
   - 使用 `node [项目路径]/packages/mcp-bridge/mcp-proxy.js` 作为命令

3. **执行操作**：
   - 通过 AI 编辑器发送 MCP 请求
   - 或在测试面板中直接测试工具

### 6.3 配置选项

- **端口设置**：默认 3456，可自定义
- **自动启动**：支持编辑器启动时自动开启服务

## 7. 功能扩展

### 7.1 添加新工具

1. **在 `main.js` 中注册工具**：
   - 在 `/list-tools` 响应中添加工具定义
   - 在 `handleMcpCall` 函数中添加处理逻辑

2. **在面板中添加示例**：
   - 在 `panel/index.js` 中添加工具示例参数
   - 更新工具列表

3. **更新文档**：
   - 在 `README.md` 中添加工具文档
   - 更新功能特性列表

### 7.2 集成新 API

1. **了解 Cocos Creator API**：
   - 查阅 Cocos Creator 编辑器 API 文档
   - 了解场景脚本 API

2. **实现集成**：
   - 在 `main.js` 或 `scene-script.js` 中添加对应功能
   - 处理异步操作和错误情况

3. **测试验证**：
   - 编写测试用例
   - 验证功能正确性

## 8. 版本管理

### 8.1 版本控制

- 使用 Git 进行版本控制
- 遵循语义化版本规范

### 8.2 发布流程

1. **代码审查**：检查代码质量和功能完整性
2. **测试验证**：确保所有功能正常工作
3. **文档更新**：更新 README 和相关文档
4. **版本发布**：标记版本号并发布

## 9. 技术栈

- **JavaScript**：主要开发语言
- **Node.js**：HTTP 服务和文件操作
- **Cocos Creator API**：编辑器功能集成
- **HTML/CSS**：面板界面
- **MCP 协议**：与 AI 工具通信

## 10. 最佳实践

1. **代码组织**：
   - 模块化设计，职责分离
   - 合理使用回调函数处理异步操作

2. **错误处理**：
   - 完善的错误捕获和处理
   - 详细的错误日志记录

3. **用户体验**：
   - 直观的面板界面
   - 实时的操作反馈
   - 详细的日志信息

4. **安全性**：
   - 验证输入参数
   - 防止路径遍历攻击
   - 限制服务访问范围

## 11. 总结

MCP Bridge 插件通过 HTTP 服务和 MCP 协议，为外部 AI 工具提供了与 Cocos Creator 编辑器交互的能力。插件支持场景操作、资源管理、组件管理、脚本管理等多种功能，为 Cocos Creator 项目的开发和自动化提供了有力的支持。

通过本文档的开发流程，我们构建了一个功能完整、稳定可靠的 MCP Bridge 插件，为 Cocos Creator 生态系统增添了新的工具和能力。
