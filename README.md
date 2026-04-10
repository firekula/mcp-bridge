# MCP Bridge 插件

这是一个为 Cocos Creator 设计的 MCP (Model Context Protocol) 桥接插件，用于连接外部 AI 工具与 Cocos Creator 编辑器，实现对场景、节点等资源的自动化操作。

## 适用版本

此插件适用于 Cocos Creator 2.4.x 版本。由于使用了特定的编辑器 API，可能不兼容较新或较老的版本。

## 功能特性

- **HTTP 服务接口**: 提供标准 HTTP 接口，外部工具可以通过 MCP 协议调用 Cocos Creator 编辑器功能
- **场景节点操作**: 获取、创建、修改场景中的节点
- **资源管理**: 创建场景、预制体，打开场景或预制体进入编辑模式
- **组件管理**: 添加、删除、获取节点组件
- **脚本管理**: 创建、删除、读取、写入脚本文件
- **批处理执行**: 批量执行多个 MCP 工具操作，提高效率
- **资产管理**: 创建、删除、移动、获取资源信息
- **实时日志**: 提供详细的操作日志记录和展示，支持持久化写入项目内日志文件
- **自动启动**: 支持编辑器启动时自动开启服务
- **编辑器管理**: 获取和设置选中对象，刷新编辑器
- **游戏对象查找**: 根据条件查找场景中的节点
- **材质管理**: 创建和管理材质资源
- **纹理管理**: 创建和管理纹理资源
- **菜单项执行**: 执行 Cocos Creator 编辑器菜单项
- **代码编辑增强**: 应用文本编辑操作到文件
- **控制台读取**: 读取编辑器控制台输出
- **脚本验证**: 验证脚本语法正确性
- **全局搜索**: 在项目中搜索文本内容
- **撤销/重做**: 管理编辑器的撤销栈
- **特效管理**: 创建和修改粒子系统
- **并发安全**: 指令队列串行化执行，队列上限 100 条（超限返回 HTTP 429），防止编辑器卡死
- **超时保护**: IPC 通信和指令队列均有超时兜底机制
- **属性保护**: 组件核心属性黑名单机制，防止 AI 篡改 `node`/`uuid` 等引用导致崩溃
- **AI 容错**: 参数别名映射（`operation`→`action`、`save`→`update`/`write`），兼容大模型幻觉
- **引用查找**: 查找场景中所有引用了指定节点或资源的位置，支持 Texture2D → SpriteFrame 子资源自动解析
- **项目构建**: 一键触发 Cocos 原生 `Editor.Builder` 构建产物（内置智能防闪退兜底机制）
- **工程信息**: 用于拉取当前活跃的编辑器级状态（版本号、根目录、当前打开的场景 UUID）

## 安装与使用

### 安装

将此插件复制到 Cocos Creator 项目的 `packages` 目录下即可。

### 构建

```bash
npm install
npm run build
```

> **注意**: 构建使用 esbuild 并指定 `--target=es2018` 以确保兼容 Cocos Creator 2.4.x 内置的 Electron 9.x 运行时。

### 启动

1. 打开 Cocos Creator 编辑器
2. 在菜单栏选择 `MCP 桥接器/开启MCP设置面板` 打开设置面板
3. 在面板中点击 "启动" 按钮启动服务
4. 服务默认运行在端口 3456 上

### 配置选项

- **端口**: 可以自定义 HTTP 服务监听的端口，默认为 3456
- **自动启动**: 可以设置编辑器启动时自动开启服务
- **多实例支持**: 如果默认端口 (3456) 被占用，插件会自动尝试端口+1 (如 3457)，直到找到可用端口。
- **配置隔离**: 插件配置（是否自动启动、上次使用的端口）现已存储在项目目录 (`settings/mcp-bridge.json`) 中，不同项目的配置互不干扰。

## 连接 AI 编辑器

### 自动化一键配置（推荐）

当前版本内置支持以下 AI 客户端的自动化配置探测与写入：
- **Claude Desktop** (全局)
- **Cline** (VSCode 工作区/全局)
- **Roo Code** (VSCode 工作区/全局)
- **Trae** (全局)

1. 在 Cocos Creator 菜单栏选择 `MCP 桥接器/开启MCP设置面板` 打开设置面板。
2. 切换到顶部的 **「MCP 配置」** 选项卡。
3. 若系统扫描成功，从下拉菜单选定对应的宿主 AI 客户端。
4. 点击 **「一键配置当前平台」**。插件将安全地完成 MCP Server 定义注册信息的全自动写入。重启对应 AI 即可无缝拉起。

### 手动在 AI 编辑器中配置

如果你的 AI 编辑器提供的是 Type: command 或 Stdio 选项：

```
Command: node
Args: [插件安装路径]/dist/mcp-proxy.js
```

### 或者添加 JSON 配置：

```json
{
    "mcpServers": {
        "mcp-bridge": {
            "command": "node",
            "args": ["[插件安装路径]/dist/mcp-proxy.js"]
        }
    }
}
```

注意：请将上述配置中的路径替换为你自己项目中 `dist/mcp-proxy.js` 文件的实际绝对路径。

## 项目架构

```
mcp-bridge/
├── src/                          # TypeScript 源码
│   ├── main.ts                   # 插件主入口 (load/unload, IPC 注册)
│   ├── scene-script.ts           # 场景脚本 (渲染进程, 操作 cc.* 引擎 API)
│   ├── mcp-proxy.ts              # MCP stdio 代理 (AI 客户端 ↔ HTTP 桥接)
│   ├── IpcManager.ts             # IPC 消息管理器
│   ├── McpConfigurator.ts        # AI 客户端配置自动注入
│   ├── core/                     # 核心基础设施
│   │   ├── Logger.ts             # 集中式日志 (缓冲 + 面板同步 + 文件落盘)
│   │   ├── CommandQueue.ts       # 指令队列 (串行化 + 超时保护)
│   │   ├── HttpServer.ts         # HTTP 服务器生命周期管理
│   │   ├── McpRouter.ts          # HTTP 请求路由分发
│   │   └── McpWrappers.ts        # 独立资源工具 (search/undo/sha/animation)
│   ├── tools/                    # MCP 工具层
│   │   ├── ToolRegistry.ts       # 工具定义注册表 (name/description/schema)
│   │   └── ToolDispatcher.ts     # 工具调度中心 (handleMcpCall → 场景脚本)
│   ├── utils/                    # 通用工具
│   │   └── AssetPatcher.ts       # 原子化资源创建 + Prefab 修补工具
│   └── panel/                    # 设置面板
│       └── index.ts              # 面板交互逻辑
├── panel/
│   └── index.html                # 面板 HTML 模板
├── dist/                         # 编译输出 (esbuild bundle)
│   ├── main.js                   # 主进程入口
│   ├── scene-script.js           # 场景脚本
│   ├── panel/index.js            # 面板脚本
│   └── mcp-proxy.js              # MCP 代理
├── package.json                  # 插件清单 (Cocos Creator 2.x 格式)
└── tsconfig.json                 # TypeScript 编译配置
```

### 进程架构

```
主进程 (main.ts)                    渲染进程 (scene-script.ts)
       │                                      │
       ├─ 1. 接收 HTTP 请求                    │
       │      HttpServer → McpRouter           │
       ├─ 2. 路由到工具分发器                    │
       │      ToolDispatcher.handleMcpCall()   │
       ├─ 3. 调用场景脚本 ──────────────────────┤
       │      CommandQueue → callSceneScript   │
       │                                       ├─ 4. 操作节点/组件
       │                                       │      cc.engine / cc.director
       │                                       ├─ 5. 通知场景变脏
       │                                       │      Editor.Ipc → scene:dirty
       └─ 6. 返回 JSON 结果 ◀──────────────────┘
```

## API 接口

服务提供以下 MCP 工具接口：

### 1. get_selected_node

- **描述**: 获取当前编辑器中选中的节点 ID
- **参数**: 无

### 2. set_node_name

- **描述**: 修改指定节点的名称
- **参数**:
    - `id`: 节点的 UUID
    - `newName`: 新的节点名称

### 3. save_scene / save_prefab / close_prefab

- **描述**: 场景和预制体保存/关闭操作
- **参数**: 无（`save_scene` 保存场景，`save_prefab` 保存当前预制体，`close_prefab` 退出预制体编辑模式）

### 4. get_scene_hierarchy

- **描述**: 获取当前场景的完整节点树结构。如果要查询具体组件属性请配合 manage_components。
- **参数**:
    - `nodeId`: 指定的根节点 UUID（可选）
    - `depth`: 遍历深度限制，默认为 2（可选）
    - `includeDetails`: 是否包含坐标、缩放等详情，默认为 false（可选）

### 5. update_node_transform

- **描述**: 修改节点的坐标、缩放、颜色或显隐状态
- **参数**: `id`(必需), `x`, `y`, `width`, `height`, `scaleX`, `scaleY`, `rotation`, `color`, `opacity`, `active`, `anchorX`, `anchorY`, `skewX`, `skewY`

### 6. open_scene / open_prefab

- **描述**: 打开场景/预制体进入编辑模式（异步操作，需等待几秒）
- **参数**: `url` — 资源路径（如 `db://assets/NewScene.fire`）

### 7. create_node

- **描述**: 在当前场景中创建新节点
- **参数**: `name`(必需), `parentId`, `type`(empty/sprite/label/button), `layout`(center/top/bottom/full 等)

### 8. manage_components

- **描述**: 管理节点组件（增删改查）
- **参数**: `nodeId`(必需), `action`(add/remove/update/get), `componentType`, `componentId`, `properties`

### 9. manage_script

- **描述**: 管理脚本文件
- **参数**: `action`(create/delete/read/write), `path`, `content`, `name`

### 10. batch_execute

- **描述**: 批处理执行多个操作
- **参数**: `operations` — 操作列表（含 `tool` 和 `params`）

### 11. manage_asset

- **描述**: 管理资源（创建/删除/移动/查询信息）
- **参数**: `action`, `path`, `targetPath`, `content`

### 12. scene_management / prefab_management

- **描述**: 场景和预制体管理
- **参数**: `action`(create/delete/duplicate/get_info), `path`, `nodeId`, `parentId`

### 13. manage_editor

- **描述**: 管理编辑器（获取/设置选中, 刷新编辑器）
- **参数**: `action`(get_selection/set_selection/refresh_editor), `target`, `properties`

### 14. find_gameobjects

- **描述**: 按条件搜索场景中的游戏对象
- **参数**: `conditions`(name/component/active), `recursive`

### 15. manage_material / manage_texture / manage_shader

- **描述**: 管理材质、纹理、着色器资源
- **参数**: `action`, `path`, `properties`/`content`

### 16. execute_menu_item

- **描述**: 执行菜单项（支持 `delete-node:UUID` 直接删除节点）
- **参数**: `menuPath`

### 17. apply_text_edits

- **描述**: 对文件应用文本编辑（insert/delete/replace）
- **参数**: `filePath`, `edits`

### 18. read_console

- **描述**: 读取插件控制台日志
- **参数**: `limit`, `type`

### 19. validate_script

- **描述**: 验证脚本语法正确性
- **参数**: `filePath`

### 20. search_project

- **描述**: 搜索项目文件（支持正则、文件名、目录名）
- **参数**: `query`, `useRegex`, `path`, `matchType`, `extensions`, `includeSubpackages`

### 21. manage_undo

- **描述**: 撤销/重做管理
- **参数**: `action`(undo/redo/begin_group/end_group/cancel_group), `description`, `id`

### 22. manage_vfx

- **描述**: 特效（粒子系统）管理
- **参数**: `action`(create/update/get_info), `nodeId`, `name`, `parentId`, `properties`

### 23. manage_animation

- **描述**: 管理节点动画组件
- **参数**: `action`(get_list/get_info/play/stop/pause/resume), `nodeId`, `clipName`

### 24. get_sha

- **描述**: 获取指定文件的 SHA-256 哈希值
- **参数**: `path`

### 25. find_references

- **描述**: 查找场景中引用了指定节点或资源的所有位置
- **参数**: `targetId`, `targetType`(node/asset/auto)

### 26. create_scene / create_prefab

- **描述**: 创建场景文件 / 将场景节点保存为预制体
- **参数**: `sceneName` / `nodeId` + `prefabName`

### 27. build_project

- **描述**: 触发编辑器内置打包构建管线（具备空场景容错、剔除引擎模块白名单同步保护）
- **参数**: `platform` (例如 web-mobile), `debug`

### 28. get_project_info

- **描述**: 获取当前激活的编辑器环境数据
- **参数**: 无（返回 `path`, `version`, `openScene` 状态）

### 29. get_active_instances

- **描述**: 扫描并获取当前本地所有正在运行的 `mcp-bridge` 实例，返回各自对应的端口及项目根路径。
- **参数**: 无

### 30. set_active_instance

- **描述**: 当存在多个运行实例时，显式指定 AI 工具流路由至特定端口的工程绑定。
- **参数**: `port` (目标端口号)

## 开发指南

### 添加新 MCP 工具

1. 在 `src/tools/ToolRegistry.ts` 中添加工具定义（name, description, inputSchema）
2. 在 `src/tools/ToolDispatcher.ts` 中添加对应的处理方法
3. 如需操作场景节点，在 `src/scene-script.ts` 中添加对应的场景脚本处理器

### 构建与调试

```bash
# 类型检查（不生成文件）
npx tsc --noEmit

# 完整构建
npm run build

# 在 Cocos Creator 中重新加载插件
# 菜单 → 开发者 → 重新加载
```

### 日志管理

插件通过 `Logger` 服务统一记录所有操作日志：
- 面板实时显示（通过 IPC `sendToPanel`）
- 持久化写入 `settings/mcp-bridge.log`（自动轮转，上限 2MB）
- 内存缓冲区上限 2000 条，超限自动截断

## AI 操作安全守则

1. **确定性优先**：任何对节点、组件、属性的操作，都必须建立在"主体已确认存在"的基础上。
2. **校验流程**：操作前必须使用 `get_scene_hierarchy` / `manage_components(get)` 确认目标存在。
3. **禁止假设**：禁止盲目尝试对不存在的对象或属性进行修改。

## 更新日志

请查阅 [UPDATE_LOG.md](./UPDATE_LOG.md) 了解详细的版本更新历史。

## 许可证

GNU AFFERO GENERAL PUBLIC LICENSE Version 3, 19 November 2007

完整的许可证文本可在项目根目录的 LICENSE 文件中找到。
