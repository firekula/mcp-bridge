# Cocos-MCP 开发计划文档

## 1. 项目概述

### 1.1 项目背景

Cocos-MCP (Model Context Protocol) 插件是一个为 Cocos Creator 编辑器提供外部 AI 工具交互能力的桥梁。通过 HTTP 服务和 MCP 协议，插件允许外部 AI 工具（如 Cursor、VS Code 等）直接与 Cocos Creator 编辑器进行交互，实现场景操作、资源管理、脚本编辑等功能。

### 1.2 项目目标

- 提供与 Unity-MCP 对等的功能集，使 Cocos Creator 开发者获得同样强大的 AI 辅助开发体验
- 实现编辑器管理、游戏对象查找、材质/纹理管理等高级功能
- 优化现有功能，提高插件稳定性和性能
- 建立完善的测试和部署流程

### 1.3 技术栈

- **开发语言**：JavaScript/TypeScript
- **运行环境**：Node.js (Cocos Creator 内置)
- **通信协议**：HTTP + JSON (MCP 协议)
- **编辑器 API**：Cocos Creator 2.4.x Editor API
- **界面技术**：HTML/CSS + Cocos Creator 面板 API

## 2. 功能分析

### 2.1 Unity-MCP 功能参考

Unity-MCP 提供了以下核心功能：

| 功能类别 | 具体功能 | 描述 |
|---------|---------|------|
| 编辑器管理 | manage_editor | 控制 Unity 编辑器状态和操作 |
| 游戏对象管理 | find_gameobjects | 根据条件查找游戏对象 |
| 材质管理 | manage_material | 创建和管理材质资源 |
| 着色器管理 | manage_shader | 管理着色器资源 |
| 纹理管理 | manage_texture | 管理纹理资源 |
| 代码编辑增强 | apply_text_edits | 应用文本编辑操作到文件 |
| 测试功能 | run_tests | 运行测试用例 |
| 控制台读取 | read_console | 读取编辑器控制台输出 |
| 菜单项执行 | execute_menu_item | 执行编辑器菜单项 |
| 脚本验证 | validate_script | 验证脚本语法 |
| VFX 管理 | manage_vfx | 管理视觉效果资源 |

### 2.2 Cocos-MCP 现状分析

#### 已实现功能

- **场景节点操作**：获取选中节点、设置节点名称、获取场景层级、更新节点变换、创建节点
- **组件管理**：添加、移除、获取组件
- **资源管理**：创建、删除、移动资源
- **脚本管理**：创建、删除、读取、写入脚本（默认创建 TypeScript 脚本）
- **批处理执行**：批量执行多个操作
- **资产管理**：管理各种资源文件
- **场景管理**：创建、删除、复制、获取场景信息
- **预制体管理**：创建、更新、实例化、获取预制体信息
- **面板界面**：提供主面板和工具测试面板
- **编辑器管理**：控制编辑器状态、执行编辑器操作
- **游戏对象查找**：根据条件查找场景中的节点
- **材质管理**：创建和管理材质资源
- **着色器管理**：管理着色器资源
- **纹理管理**：管理纹理资源
- **代码编辑增强**：应用文本编辑操作到文件
- **测试功能**：运行自动化测试用例 (`run_tests.js`)
- **控制台读取**：读取编辑器控制台输出
- **菜单项执行**：执行编辑器菜单项
- **脚本验证**：验证脚本语法

#### 缺失功能

- **VFX 管理**：管理视觉效果资源（暂未排期）

### 2.3 功能优先级排序

所有高/中优先级功能均已完成。

### 2.4 Unity-MCP 差异分析 (Gap Analysis)

通过对比 [Unity-MCP](https://github.com/CoplayDev/unity-mcp)，发现以下缺失或可增强的功能：

1.  **全局搜索 (`find_in_file`)**: ✅ 已实现。支持在整个项目中搜索文本内容。
2.  **ScriptableObject 管理 (`manage_scriptable_object`)**: 虽然 AssetDB 可以创建资源，但缺乏专门针对 ScriptableObject (cc.Asset) 的简便创建工具。
3.  **Undo/Redo 支持**: ✅ 已实现。通过 `manage_undo` 提供了 `undo/redo` 及事务组支持。
4.  **VFX 管理 (`manage_vfx`)**: ✅ 已实现。支持粒子系统的创建、修改和信息获取。
5.  **Git 集成 (`get_sha`)**: 获取当前版本库信息。

`find_in_file`、`Undo/Redo` 和 `manage_vfx` 已在最新迭代中完成。

## 3. 开发路线图

### 3.1 第三阶段开发计划（已完成）

| 任务 | 状态 | 描述 |
|------|------|------|
| 编辑器管理工具实现 | ✅ 完成 | 实现 manage_editor 工具，支持编辑器状态控制和操作执行 |
| 游戏对象查找工具实现 | ✅ 完成 | 实现 find_gameobjects 工具，支持根据条件查找场景节点 |
| 材质和纹理管理工具实现 | ✅ 完成 | 实现 manage_material 和 manage_texture 工具，支持材质和纹理资源管理 |
| 菜单项执行工具实现 | ✅ 完成 | 实现 execute_menu_item 工具，支持执行 Cocos Creator 菜单项 |
| 代码编辑增强工具实现 | ✅ 完成 | 实现 apply_text_edits 工具，支持文本编辑操作应用 |
| 控制台读取工具实现 | ✅ 完成 | 实现 read_console 工具，支持读取编辑器控制台输出 |
| 脚本验证工具实现 | ✅ 完成 | 实现 validate_script 工具，支持脚本语法验证 |

### 3.2 第四阶段开发计划（已完成）

| 任务 | 状态 | 描述 |
|------|------|------|
| 测试功能实现 | ✅ 完成 | 实现 run_tests.js 脚本，支持运行自动化测试用例 |
| 错误处理增强 | ✅ 完成 | 完善 HTTP 服务和工具调用的错误日志记录 |

### 3.3 差异填补阶段（Gap Filling）- 已完成

| 任务 | 状态 | 描述 |
|------|------|------|
| 全局文件搜索 | ✅ 完成 | 实现 find_in_file 工具 |
| 撤销/重做支持 | ✅ 完成 | 实现 manage_undo 工具，并重构核心操作支持撤销 |
| 特效管理 | ✅ 完成 | 实现 manage_vfx 工具，支持粒子系统管理 |

### 3.3 第五阶段开发计划（远期）

| 任务 | 优先级 | 预计时间 | 描述 |
|------|--------|----------|------|
| 工具扩展 | 低 | 3 天 | 添加更多高级工具和功能 |
| 界面美化 | 低 | 2 天 | 进一步优化面板界面，提升用户体验 |
| 国际化支持 | 低 | 2 天 | 添加多语言支持 |
| 文档完善 | 中 | 2 天 | 完善 API 文档和使用示例 |
| 插件发布 | 高 | 1 天 | 准备插件发布，提交到 Cocos 插件商店 |

## 4. 技术架构

### 4.1 系统架构

```
┌────────────────────┐     HTTP     ┌────────────────────┐     IPC     ┌────────────────────┐
│  外部 AI 工具       │  ──────────> │  main.js (HTTP服务) │  ─────────> │  scene-script.js   │
│  (Cursor/VS Code)  │     <──────── │  (MCP 协议处理)     │     <──────── │  (场景操作执行)     │
└────────────────────┘     JSON     └────────────────────┘     JSON     └────────────────────┘
```

### 4.2 核心模块

1. **HTTP 服务模块**：处理外部请求，解析 MCP 协议，返回操作结果
2. **MCP 工具模块**：实现各种操作工具，包括新增的编辑器管理、游戏对象查找等功能
3. **场景操作模块**：执行场景相关操作，如节点查找、组件管理等
4. **资源管理模块**：处理脚本、材质、纹理等资源文件的创建和管理
5. **面板界面模块**：提供用户交互界面，包括主面板和工具测试面板

### 4.3 技术实现要点

- **编辑器 API 调用**：使用 `Editor.Ipc` 与编辑器核心进行通信
- **资源操作**：使用 `Editor.assetdb` API 进行资源文件的创建、读取、更新和删除
- **场景操作**：通过场景脚本执行节点和组件操作
- **异步处理**：使用回调函数处理异步操作，避免阻塞主线程
- **错误处理**：完善的错误捕获和处理机制，提高插件稳定性
- **性能优化**：使用批处理执行减少 HTTP 请求次数，优化资源操作效率

## 5. 功能实现方案

### 5.1 编辑器管理工具 (`manage_editor`)

#### 功能描述

提供对 Cocos Creator 编辑器状态的控制和操作执行能力。

#### 实现方案

```javascript
// 在 main.js 中添加
manageEditor(args, callback) {
    const { action, target, properties } = args;
    
    switch (action) {
        case "get_selection":
            // 获取当前选中的资源或节点
            const nodeSelection = Editor.Selection.curSelection('node');
            const assetSelection = Editor.Selection.curSelection('asset');
            callback(null, {
                nodes: nodeSelection,
                assets: assetSelection
            });
            break;
        case "set_selection":
            // 设置选中状态
            if (target === 'node' && properties.nodes) {
                Editor.Selection.select('node', properties.nodes);
            } else if (target === 'asset' && properties.assets) {
                Editor.Selection.select('asset', properties.assets);
            }
            callback(null, "Selection updated");
            break;
        case "refresh_editor":
            // 刷新编辑器
            Editor.assetdb.refresh();
            callback(null, "Editor refreshed");
            break;
        default:
            callback("Unknown action");
    }
}
```

### 5.2 游戏对象查找工具 (`find_gameobjects`)

#### 功能描述

根据条件查找场景中的节点对象。

#### 实现方案

```javascript
// 在 scene-script.js 中添加
findGameObjects(params, callback) {
    const { conditions, recursive } = params;
    const result = [];
    
    // 遍历场景根节点
    cc.director.getScene().children.forEach(child => {
        searchNode(child, conditions, recursive, result);
    });
    
    callback(null, result);
}

function searchNode(node, conditions, recursive, result) {
    // 检查节点是否满足条件
    let match = true;
    
    if (conditions.name && !node.name.includes(conditions.name)) {
        match = false;
    }
    
    if (conditions.tag && node.tag !== conditions.tag) {
        match = false;
    }
    
    if (conditions.component && !node.getComponent(conditions.component)) {
        match = false;
    }
    
    if (match) {
        result.push({
            id: node.uuid,
            name: node.name,
            tag: node.tag,
            position: node.position,
            rotation: node.rotation,
            scale: node.scale
        });
    }
    
    // 递归搜索子节点
    if (recursive) {
        node.children.forEach(child => {
            searchNode(child, conditions, recursive, result);
        });
    }
}
```

### 5.3 材质和纹理管理工具 (`manage_material`, `manage_texture`)

#### 功能描述

管理材质和纹理资源，支持创建、修改、删除等操作。

#### 实现方案

```javascript
// 在 main.js 中添加
manageMaterial(args, callback) {
    const { action, path, properties } = args;
    
    switch (action) {
        case "create":
            // 创建材质资源
            const materialContent = JSON.stringify({
                __type__: "cc.Material",
                _name: "",
                _objFlags: 0,
                _native: "",
                effects: [{
                    technique: 0,
                    defines: {},
                    uniforms: properties.uniforms || {}
                }]
            });
            
            // 确保目录存在
            const fs = require('fs');
            const pathModule = require('path');
            const absolutePath = Editor.assetdb.urlToFspath(path);
            const dirPath = pathModule.dirname(absolutePath);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
            
            Editor.assetdb.create(path, materialContent, (err) => {
                callback(err, err ? null : `Material created at ${path}`);
            });
            break;
        // 其他操作...
    }
}

manageTexture(args, callback) {
    const { action, path, properties } = args;
    
    switch (action) {
        case "create":
            // 创建纹理资源（简化版，实际需要处理纹理文件）
            const textureContent = JSON.stringify({
                __type__: "cc.Texture2D",
                _name: "",
                _objFlags: 0,
                _native: properties.native || "",
                width: properties.width || 128,
                height: properties.height || 128
            });
            
            // 确保目录存在
            const fs = require('fs');
            const pathModule = require('path');
            const absolutePath = Editor.assetdb.urlToFspath(path);
            const dirPath = pathModule.dirname(absolutePath);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
            
            Editor.assetdb.create(path, textureContent, (err) => {
                callback(err, err ? null : `Texture created at ${path}`);
            });
            break;
        // 其他操作...
    }
}
```

### 5.4 菜单项执行工具 (`execute_menu_item`)

#### 功能描述

执行 Cocos Creator 编辑器的菜单项命令。

#### 实现方案

```javascript
// 在 main.js 中添加
executeMenuItem(args, callback) {
    const { menuPath } = args;
    
    try {
        // 执行菜单项
        Editor.Ipc.sendToMain('menu:click', menuPath);
        callback(null, `Menu item executed: ${menuPath}`);
    } catch (err) {
        callback(`Failed to execute menu item: ${err.message}`);
    }
}
```

### 5.5 代码编辑增强工具 (`apply_text_edits`)

#### 功能描述

应用文本编辑操作到文件，支持插入、删除、替换等操作。

#### 实现方案

```javascript
// 在 main.js 中添加
applyTextEdits(args, callback) {
    const { filePath, edits } = args;
    
    // 读取文件内容
    Editor.assetdb.queryInfoByUrl(filePath, (err, info) => {
        if (err) {
            callback(`Failed to get file info: ${err.message}`);
            return;
        }
        
        Editor.assetdb.loadMeta(info.uuid, (err, content) => {
            if (err) {
                callback(`Failed to load file: ${err.message}`);
                return;
            }
            
            // 应用编辑操作
            let updatedContent = content;
            edits.forEach(edit => {
                switch (edit.type) {
                    case "insert":
                        updatedContent = updatedContent.slice(0, edit.position) + edit.text + updatedContent.slice(edit.position);
                        break;
                    case "delete":
                        updatedContent = updatedContent.slice(0, edit.start) + updatedContent.slice(edit.end);
                        break;
                    case "replace":
                        updatedContent = updatedContent.slice(0, edit.start) + edit.text + updatedContent.slice(edit.end);
                        break;
                }
            });
            
            // 写回文件
            Editor.assetdb.save(info.uuid, updatedContent, (err) => {
                callback(err, err ? null : `Text edits applied to ${filePath}`);
            });
        });
    });
}
```

### 5.6 控制台读取工具 (`read_console`)

#### 功能描述

读取编辑器控制台的输出信息。

#### 实现方案

```javascript
// 在 main.js 中添加
// 首先在模块顶部添加控制台输出捕获
let consoleOutput = [];
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = function(...args) {
    consoleOutput.push({ type: 'log', message: args.join(' ') });
    originalLog.apply(console, args);
};

console.error = function(...args) {
    consoleOutput.push({ type: 'error', message: args.join(' ') });
    originalError.apply(console, args);
};

console.warn = function(...args) {
    consoleOutput.push({ type: 'warn', message: args.join(' ') });
    originalWarn.apply(console, args);
};

// 然后添加 read_console 工具
readConsole(args, callback) {
    const { limit, type } = args;
    let filteredOutput = consoleOutput;
    
    if (type) {
        filteredOutput = filteredOutput.filter(item => item.type === type);
    }
    
    if (limit) {
        filteredOutput = filteredOutput.slice(-limit);
    }
    
    callback(null, filteredOutput);
}
```

### 5.7 脚本验证工具 (`validate_script`)

#### 功能描述

验证脚本文件的语法正确性。

#### 实现方案

```javascript
// 在 main.js 中添加
validateScript(args, callback) {
    const { filePath } = args;
    
    // 读取脚本内容
    Editor.assetdb.queryInfoByUrl(filePath, (err, info) => {
        if (err) {
            callback(`Failed to get file info: ${err.message}`);
            return;
        }
        
        Editor.assetdb.loadMeta(info.uuid, (err, content) => {
            if (err) {
                callback(`Failed to load file: ${err.message}`);
                return;
            }
            
            try {
                // 对于 JavaScript 脚本，使用 eval 进行简单验证
                if (filePath.endsWith('.js')) {
                    // 包装在函数中以避免变量污染
                    const wrapper = `(function() { ${content} })`;
                    eval(wrapper);
                }
                // 对于 TypeScript 脚本，这里可以添加更复杂的验证逻辑
                
                callback(null, { valid: true, message: 'Script syntax is valid' });
            } catch (err) {
                callback(null, { valid: false, message: err.message });
            }
        });
    });
}
    });
}
```

### 5.8 常用 IPC 消息参考 (Cocos Creator 2.4.x)

基于社区资料整理，以下 IPC 消息可用于扩展功能：

#### 场景操作 (`scene:`)
- **创建/实例化**:
    - `scene:create-node-by-classid` (参数: name, parentUuid)
    - `scene:create-nodes-by-uuids` (实例化预制体, 参数: [prefabUuid], parentUuid)
- **修改**:
    - `scene:set-property` (参数: {id, path, type, value})
    - `scene:copy-nodes` / `scene:paste-nodes`
- **安全机制**:
    - `scene:undo` / `scene:redo` (建议集成到 manage_editor)

#### 资源操作 (`assets:`)
- `assets:hint` (高亮资源)
- `assets:open-text-file` (打开外部编辑器)

## 6. 测试策略

### 6.1 测试目标

- 验证所有新增功能的正确性和稳定性
- 确保现有功能不受影响
- 测试插件在不同场景下的性能表现
- 验证错误处理机制的有效性

### 6.2 测试方法

#### 单元测试

- 为每个工具函数编写独立的测试用例
- 测试各种输入参数和边界情况
- 验证函数返回值的正确性

#### 集成测试

- 测试工具之间的协作能力
- 验证批处理执行的正确性
- 测试插件与编辑器的集成稳定性

#### 性能测试

- 测试工具执行速度
- 验证批处理执行的性能优势
- 测试插件在处理大量操作时的表现

#### 回归测试

- 确保新增功能不破坏现有功能
- 验证修复的 bug 不会再次出现
- 测试插件在不同版本 Cocos Creator 中的兼容性

### 6.3 测试工具

- **手动测试**：通过面板界面测试工具功能
- **脚本测试**：编写测试脚本自动执行测试用例
- **性能分析**：使用浏览器开发者工具分析性能瓶颈

## 7. 部署与维护

### 7.1 部署方案

#### 本地部署

1. 将插件复制到 Cocos Creator 项目的 `packages` 目录
2. 重启 Cocos Creator 编辑器
3. 在编辑器中打开 MCP Bridge 面板
4. 启动 HTTP 服务

#### 远程部署

1. 使用 Git 进行版本控制
2. 提供插件的 GitHub 仓库地址
3. 发布插件到 Cocos 插件商店（未来）

### 7.2 维护计划

#### 版本管理

- 遵循语义化版本规范（MAJOR.MINOR.PATCH）
- 定期发布更新版本
- 维护详细的版本变更日志

#### 错误处理

- 建立错误报告机制
- 定期分析错误日志
- 及时修复发现的问题

#### 性能优化

- 定期分析插件性能
- 优化资源操作和网络请求
- 提高插件响应速度

#### 文档维护

- 保持 README.md 和开发文档的更新
- 提供详细的 API 文档
- 编写使用教程和示例

## 8. 风险评估

### 8.1 潜在风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 编辑器 API 变更 | 插件功能失效 | 定期检查 Cocos Creator 更新，适配新 API |
| 性能问题 | 插件响应缓慢 | 优化代码结构，使用批处理执行，避免阻塞操作 |
| 安全漏洞 | 未授权访问 | 添加 IP 白名单，实现认证机制，限制服务访问范围 |
| 兼容性问题 | 不同版本 Cocos Creator 不兼容 | 测试多个版本，提供版本兼容层 |
| 错误处理不完善 | 插件崩溃 | 完善错误捕获和处理机制，提高插件稳定性 |

### 8.2 应对策略

- **持续集成**：建立自动化测试流程，及时发现问题
- **监控机制**：添加性能监控和错误监控
- **用户反馈**：建立用户反馈渠道，收集使用问题
- **文档完善**：提供详细的安装和使用文档
- **社区支持**：建立社区支持渠道，解答用户问题

## 9. 结论

Cocos-MCP 插件的开发计划基于与 Unity-MCP 的功能对比，旨在为 Cocos Creator 开发者提供同样强大的 AI 辅助开发体验。通过分阶段实现编辑器管理、游戏对象查找、材质/纹理管理等高级功能，插件将逐步完善其功能集，成为 Cocos Creator 编辑器的重要扩展工具。

本开发计划文档为后续的开发工作提供了详细的指导，包括功能实现方案、技术架构设计、测试策略和部署维护计划。通过严格按照计划执行开发工作，我们可以确保插件的质量和稳定性，为 Cocos Creator 生态系统做出贡献。