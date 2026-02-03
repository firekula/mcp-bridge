# MCP Bridge 插件开发流程文档

本文档记录了 MCP Bridge 插件的完整开发流程，包括核心架构设计、功能实现、测试与调试等各个阶段。

## 0. 项目开发规范 (Project Rules)

> [!IMPORTANT]
> 所有贡献者必须严格遵守以下规则：

1.  **语言与沟通**: 所有注释、文档、计划、任务及 AI 回复必须使用 **简体中文 (Simplified Chinese)**。
2.  **技术栈**: 新脚本必须使用 **TypeScript** (`.ts`)。禁止创建新的 `.js` 文件 (除非是构建脚本或测试配置)。
3.  **文档**: 所有修改或创建的脚本必须包含详细的 JSDoc 格式注释。
4.  **架构**: 严禁引入新的架构模式或重型外部库。必须复用现有的 Cocos Creator 管理器和工具类。
5.  **隔离原则**: 保持 `main.js` (主进程) 与 `scene-script.js` (渲染进程) 的严格职责分离。即使看似方便，也不要在 `main.js` 中直接操作场景节点对象。

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

## 11. 开发路线图 (Roadmap)

### 11.1 第三阶段开发计划（已完成）

| 任务 | 状态 | 描述 |
|------|------|------|
| 编辑器管理工具实现 | ✅ 完成 | 实现 manage_editor 工具，支持编辑器状态控制和操作执行 |
| 游戏对象查找工具实现 | ✅ 完成 | 实现 find_gameobjects 工具，支持根据条件查找场景节点 |
| 材质和纹理管理工具实现 | ✅ 完成 | 实现 manage_material 和 manage_texture 工具，支持材质和纹理资源管理 |
| 菜单项执行工具实现 | ✅ 完成 | 实现 execute_menu_item 工具，支持执行 Cocos Creator 菜单项 |
| 代码编辑增强工具实现 | ✅ 完成 | 实现 apply_text_edits 工具，支持文本编辑操作应用 |
| 控制台读取工具实现 | ✅ 完成 | 实现 read_console 工具，支持读取编辑器控制台输出 |
| 脚本验证工具实现 | ✅ 完成 | 实现 validate_script 工具，支持脚本语法验证 |

### 11.2 第四阶段开发计划（已完成）

| 任务 | 状态 | 描述 |
|------|------|------|
| 测试功能实现 | ✅ 完成 | 实现 run_tests.js 脚本，支持运行自动化测试用例 |
| 错误处理增强 | ✅ 完成 | 完善 HTTP 服务和工具调用的错误日志记录 |

### 11.3 差异填补阶段（Gap Filling）- 已完成

| 任务 | 状态 | 描述 |
|------|------|------|
| 全局文件搜索 | ✅ 完成 | 实现 find_in_file 工具 |
| 撤销/重做支持 | ✅ 完成 | 实现 manage_undo 工具，并重构核心操作支持撤销 |
| 特效管理 | ✅ 完成 | 实现 manage_vfx 工具，支持粒子系统管理 |

### 11.4 第六阶段：可靠性与体验优化（已完成）

| 任务 | 状态 | 描述 |
|------|------|------|
| IPC 工具增强 | ✅ 完成 | 修复 IpcManager 返回值解析，优化测试面板 (JSON 参数、筛选) |
| 脚本可靠性修复 | ✅ 完成 | 解决脚本编译时序导致的挂载失败问题 (文档引导 + 刷新机制) |
| 组件智能解析修复 | ✅ 完成 | 修复组件属性赋值时的 UUID 类型转换，支持压缩 UUID 及自定义组件 (`$_$ctor`) |

### 11.5 第七阶段开发计划（未来规划）

| 任务 | 优先级 | 预计时间 | 描述 |
|------|--------|----------|------|
| 插件发布 | 高 | 1 天 | 准备发布，提交到 Cocos 插件商店 |
| 文档完善 | 中 | 2 天 | 完善 API 文档 ("Getting Started" 教程) |
| 界面美化 | 低 | 2 天 | 优化面板 UI 体检 |
| 国际化支持 | 低 | 2 天 | 添加多语言 (i18n) 支持 |
| 工具扩展 | 低 | 3 天 | 添加更多高级工具 |

## 12. Unity-MCP 对比分析

### 12.1 功能差距 (Gap Analysis)

通过与 Unity-MCP 对比，Cocos-MCP 已实现绝大多数核心功能。

| 功能类别 | Unity-MCP 功能 | Cocos-MCP 状态 | 备注 |
|---------|---------------|---------------|------|
| 编辑器管理 | manage_editor | ✅ 已实现 | |
| 游戏对象管理 | find_gameobjects | ✅ 已实现 | |
| 材质管理 | manage_material | ✅ 已实现 | |
| 纹理管理 | manage_texture | ✅ 已实现 | |
| 代码编辑 | apply_text_edits | ✅ 已实现 | |
| 全局搜索 | find_in_file | ✅ 已实现 | |
| 控制台 | read_console | ✅ 已实现 | |
| 菜单执行 | execute_menu_item | ✅ 已实现 | |
| 脚本验证 | validate_script | ✅ 已实现 | |
| 撤销/重做 | undo/redo | ✅ 已实现 | |
| VFX 管理 | manage_vfx | ✅ 已实现 | |
| Git 集成 | get_sha | ❌ 未实现 | 低优先级 |
| ScriptableObject | manage_so | ❌ 未实现 | 使用 AssetDB 替代 |

## 13. 风险评估

### 13.1 潜在风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 编辑器 API 变更 | 插件功能失效 | 定期检查 Cocos 更新，适配新 API |
| 性能问题 | 插件响应缓慢 | 优化批处理 (batch_execute)，减少 IPC 通讯 |
| 安全漏洞 | 未授权访问 | (规划中) 面板设置 IP 白名单/Token 认证 |
| 兼容性问题 | 多版本不兼容 | 测试主流版本 (2.4.x)，提供兼容层 |

## 14. 结论

Cocos-MCP 插件的开发计划已顺利完成多个迭代阶段。目前插件实现了包括编辑器管理、场景操作、资源管理在内的全套核心功能，并完成了针对性的可靠性加固（IPC 通信、脚本时序、组件解析）。

插件功能已趋于稳定，后续工作重点将转向 **发布准备**、**文档体系建设** 以及 **用户体验优化**，力求为 Cocos Creator 开发者提供高质量的 AI 辅助开发工具。
