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

## 11. 开发状态

### 11.1 已完成的任务

#### 第一阶段
- ✅ HTTP 服务接口实现
- ✅ 场景节点操作工具
- ✅ 资源管理工具
- ✅ 组件管理工具
- ✅ 脚本管理工具（默认创建 TypeScript 脚本）
- ✅ 批处理执行工具
- ✅ 资产管理工具
- ✅ 实时日志系统
- ✅ 自动启动功能
- ✅ 面板界面实现

#### 第二阶段
- ✅ 场景管理工具（scene_management）
  - 创建场景
  - 删除场景
  - 复制场景
  - 获取场景信息
- ✅ 预制体管理工具（prefab_management）
  - 创建预制体
  - 更新预制体
  - 实例化预制体
  - 获取预制体信息
- ✅ 面板布局优化
  - 响应式设计
  - 滚动条支持
  - 小窗口适配
- ✅ 移除旧工具
  - 删除了 create_scene 工具（功能整合到 scene_management）
  - 删除了 create_prefab 工具（功能整合到 prefab_management）
- ✅ README.md 文档更新
- ✅ 代码提交到本地仓库

#### 第三阶段
- ✅ 编辑器管理工具（manage_editor）
  - 获取选中对象
  - 设置选中状态
  - 刷新编辑器
- ✅ 游戏对象查找工具（find_gameobjects）
  - 根据名称、标签、组件、激活状态查找节点
  - 支持递归和非递归查找
- ✅ 材质管理工具（manage_material）
  - 创建、删除、获取材质信息
- ✅ 纹理管理工具（manage_texture）
  - 创建、删除、获取纹理信息
- ✅ 菜单项执行工具（execute_menu_item）
  - 执行 Cocos Creator 编辑器菜单项
- ✅ 代码编辑增强工具（apply_text_edits）
  - 支持插入、删除、替换文本操作
- ✅ 控制台读取工具（read_console）
  - 读取编辑器控制台输出
  - 支持按类型过滤和限制输出数量
- ✅ 脚本验证工具（validate_script）
  - 验证脚本语法正确性
- ✅ 面板工具说明功能
  - 添加工具说明框
  - 显示详细的工具描述和参数说明

### 11.2 未完成的任务

- ❌ 代码推送到远程仓库（认证错误）
- ❌ 测试用例编写
- ❌ 性能优化
- ❌ 错误处理增强
- ❌ 安全配置

### 11.3 后续需要完成的任务

#### 高优先级
1. **代码推送**：解决远程仓库认证问题，完成代码推送
2. **测试用例**：为核心工具编写测试用例
3. **安全配置**：添加 IP 白名单和认证机制

#### 中优先级
1. **性能优化**：优化 HTTP 服务响应速度，改进批处理执行效率
2. **错误处理**：增强错误处理和恢复机制，提高插件稳定性
3. **文档完善**：添加更详细的 API 文档和使用示例，包括新工具的详细说明

#### 低优先级
1. **工具扩展**：添加更多高级工具，如动画管理、物理系统管理等
2. **界面美化**：进一步优化面板界面，提升用户体验
3. **国际化**：支持多语言，方便国际用户使用
4. **插件发布**：准备插件发布到 Cocos 插件商店
5. **版本兼容**：适配更多 Cocos Creator 版本

### 11.4 任务优先级表

| 任务 | 优先级 | 状态 | 描述 |
|------|--------|------|------|
| 代码推送 | 高 | 未完成 | 解决远程仓库认证问题 |
| 测试用例 | 高 | 未完成 | 为核心工具编写测试用例 |
| 安全配置 | 高 | 未完成 | 添加 IP 白名单和认证机制 |
| 性能优化 | 中 | 未完成 | 优化 HTTP 服务响应速度，改进批处理执行效率 |
| 错误处理 | 中 | 未完成 | 增强错误处理和恢复机制，提高插件稳定性 |
| 文档完善 | 中 | 未完成 | 添加更详细的 API 文档和使用示例，包括新工具的详细说明 |
| 工具扩展 | 低 | 未完成 | 添加更多高级工具，如动画管理、物理系统管理等 |
| 界面美化 | 低 | 未完成 | 进一步优化面板界面，提升用户体验 |
| 国际化 | 低 | 未完成 | 支持多语言，方便国际用户使用 |
| 插件发布 | 低 | 未完成 | 准备插件发布到 Cocos 插件商店 |
| 版本兼容 | 低 | 未完成 | 适配更多 Cocos Creator 版本 |
| 编辑器管理工具 | 高 | 已完成 | 实现 manage_editor 工具，支持编辑器状态管理 |
| 游戏对象查找工具 | 高 | 已完成 | 实现 find_gameobjects 工具，支持根据条件查找节点 |
| 材质和纹理管理工具 | 高 | 已完成 | 实现 manage_material 和 manage_texture 工具 |
| 菜单项执行工具 | 高 | 已完成 | 实现 execute_menu_item 工具，支持执行编辑器菜单项 |
| 代码编辑增强工具 | 中 | 已完成 | 实现 apply_text_edits 工具，支持文本编辑操作 |
| 控制台读取工具 | 中 | 已完成 | 实现 read_console 工具，支持读取控制台输出 |
| 脚本验证工具 | 中 | 已完成 | 实现 validate_script 工具，支持脚本语法验证 |
| 面板工具说明功能 | 低 | 已完成 | 添加工具说明框，显示详细的工具描述和参数说明 |

## 12. Unity-MCP 对比分析

### 12.1 Unity-MCP 功能特性

Unity-MCP 提供了以下核心功能：

- **资产管理**：管理各种 Unity 资源
- **编辑器管理**：控制 Unity 编辑器功能
- **游戏对象管理**：创建、修改、查找游戏对象
- **组件管理**：添加、移除、修改组件
- **材质管理**：创建和修改材质
- **预制体管理**：管理预制体资源
- **场景管理**：创建、保存、加载场景
- **脚本管理**：创建、修改脚本
- **ScriptableObject 管理**：管理配置文件
- **着色器管理**：管理着色器资源
- **VFX 管理**：管理视觉效果
- **纹理管理**：管理纹理资源
- **批处理执行**：批量执行多个操作
- **游戏对象查找**：根据条件查找游戏对象
- **文件内容查找**：在文件中查找内容
- **控制台读取**：读取 Unity 控制台输出
- **Unity 刷新**：刷新 Unity 编辑器
- **测试运行**：运行测试用例
- **获取测试任务**：获取测试任务信息
- **菜单项执行**：执行 Unity 菜单项
- **文本编辑应用**：应用文本编辑操作
- **脚本编辑应用**：应用脚本编辑操作
- **脚本验证**：验证脚本语法
- **创建脚本**：创建新脚本
- **删除脚本**：删除脚本文件
- **获取 SHA**：获取版本控制 SHA 值

### 12.2 Cocos-MCP 功能特性

当前 Cocos-MCP 已实现的功能：

- **场景节点操作**：获取选中节点、设置节点名称、获取场景层级、更新节点变换、创建节点
- **组件管理**：添加、移除、获取组件
- **资源管理**：创建、删除、移动资源
- **脚本管理**：创建、删除、读取、写入脚本（默认创建 TypeScript 脚本）
- **批处理执行**：批量执行多个操作
- **资产管理**：管理各种资源文件
- **场景管理**：创建、删除、复制、获取场景信息
- **预制体管理**：创建、更新、实例化、获取预制体信息
- **面板界面**：提供主面板和工具测试面板

### 12.3 功能缺失对比

| 功能类别 | Unity-MCP 功能 | Cocos-MCP 状态 | 可实现性 |
|---------|---------------|---------------|--------|
| 编辑器管理 | manage_editor | ❌ 缺失 | ✅ 可实现 |
| 游戏对象管理 | find_gameobjects | ❌ 缺失 | ✅ 可实现 |
| 材质管理 | manage_material | ❌ 缺失 | ✅ 可实现 |
| 着色器管理 | manage_shader | ❌ 缺失 | ✅ 可实现 |
| 纹理管理 | manage_texture | ❌ 缺失 | ✅ 可实现 |
| 代码编辑增强 | apply_text_edits, script_apply_edits | ❌ 缺失 | ✅ 可实现 |
| 测试功能 | run_tests, get_test_job | ❌ 缺失 | ⚠️ 部分可实现 |
| 控制台读取 | read_console | ❌ 缺失 | ✅ 可实现 |
| 菜单项执行 | execute_menu_item | ❌ 缺失 | ✅ 可实现 |
| 脚本验证 | validate_script | ❌ 缺失 | ✅ 可实现 |
| VFX 管理 | manage_vfx | ❌ 缺失 | ✅ 可实现 |

### 12.4 功能实现建议

#### 高优先级功能

1. **编辑器管理工具** (`manage_editor`)
   - 功能：控制编辑器状态、执行编辑器操作
   - 实现方案：使用 `Editor.Ipc` 调用编辑器 API，如 `Editor.Selection`、`Editor.assetdb` 等

2. **游戏对象查找工具** (`find_gameobjects`)
   - 功能：根据条件查找场景中的节点
   - 实现方案：使用场景脚本遍历节点树，根据名称、标签、组件等条件过滤

3. **材质和纹理管理工具** (`manage_material`, `manage_texture`)
   - 功能：创建和管理材质、纹理资源
   - 实现方案：使用 `Editor.assetdb` API 操作资源文件

4. **菜单项执行工具** (`execute_menu_item`)
   - 功能：执行 Cocos Creator 菜单项
   - 实现方案：使用 `Editor.Ipc.sendToMain` 发送菜单命令

#### 中优先级功能

1. **代码编辑增强工具** (`apply_text_edits`, `script_apply_edits`)
   - 功能：应用文本编辑操作到文件
   - 实现方案：读取文件内容，应用编辑操作，然后写回文件

2. **控制台读取工具** (`read_console`)
   - 功能：读取编辑器控制台输出
   - 实现方案：重定向 `console.log` 等方法，捕获控制台输出

3. **脚本验证工具** (`validate_script`)
   - 功能：验证脚本语法正确性
   - 实现方案：使用 Node.js 的语法解析器或调用外部工具

#### 低优先级功能

1. **测试功能** (`run_tests`, `get_test_job`)
   - 功能：运行测试用例并获取结果
   - 实现方案：根据 Cocos Creator 的测试框架集成

2. **VFX 管理工具** (`manage_vfx`)
   - 功能：管理视觉效果资源
   - 实现方案：使用 `Editor.assetdb` API 操作 VFX 资源

## 13. 总结

MCP Bridge 插件通过 HTTP 服务和 MCP 协议，为外部 AI 工具提供了与 Cocos Creator 编辑器交互的能力。插件支持场景操作、资源管理、组件管理、脚本管理等多种功能，为 Cocos Creator 项目的开发和自动化提供了有力的支持。

通过本文档的开发流程，我们构建了一个功能完整、稳定可靠的 MCP Bridge 插件，为 Cocos Creator 生态系统增添了新的工具和能力。

目前插件已经完成了核心功能的实现，包括 15 个 MCP 工具，支持从场景操作到资源管理的各种功能。后续将继续完善测试、优化性能，并添加更多高级功能，为开发者提供更强大的工具支持。

通过与 Unity-MCP 的对比分析，我们识别出了多个可实现的功能，这些功能将进一步增强 Cocos-MCP 的能力，使其与 Unity-MCP 保持功能对等，为 Cocos Creator 开发者提供同样强大的 AI 辅助开发体验。
