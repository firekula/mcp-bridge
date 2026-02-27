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
- **并发安全**: 指令队列串行化执行，防止编辑器卡死
- **超时保护**: IPC 通信和指令队列均有超时兜底机制
- **工具说明**: 测试面板提供详细的工具描述和参数说明

## 安装与使用

### 安装

将此插件复制到 Cocos Creator 项目的 `packages` 目录下即可。

### 启动

1. 打开 Cocos Creator 编辑器
2. 在菜单栏选择 `MCP Bridge/Open Panel` 打开测试面板
3. 在面板中点击 "Start" 按钮启动服务
4. 服务默认运行在端口 3456 上

### 配置选项

- **端口**: 可以自定义 HTTP 服务监听的端口，默认为 3456
- **自动启动**: 可以设置编辑器启动时自动开启服务
- **多实例支持**: 如果默认端口 (3456) 被占用，插件会自动尝试端口+1 (如 3457)，直到找到可用端口。
- **配置隔离**: 插件配置（是否自动启动、上次使用的端口）现已存储在项目目录 (`settings/mcp-bridge.json`) 中，不同项目的配置互不干扰。

## 连接 AI 编辑器

### 在 AI 编辑器（如 Cursor / VS Code）中配置

如果你的 AI 编辑器提供的是 Type: command 或 Stdio 选项：

```
Command: node
Args: [Cocos Creator 项目的绝对路径]/packages/mcp-bridge/mcp-proxy.js
```

例如，在你的项目中，完整路径应该是：

```
Args: [你的项目所在盘符]:/[项目路径]/packages/mcp-bridge/mcp-proxy.js
```

### 或者添加 JSON 配置：

```json
{
    "mcpServers": {
        "cocos-creator": {
            "command": "node",
            "args": ["[Cocos Creator 项目的绝对路径]/packages/mcp-bridge/mcp-proxy.js"]
        }
    }
}
```

注意：请将上述配置中的路径替换为你自己项目中 `mcp-proxy.js` 文件的实际绝对路径。

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

### 3. save_scene

- **描述**: 保存当前场景的修改
- **参数**: 无

### 4. get_scene_hierarchy

- **描述**: 获取当前场景的完整节点树结构（支持分页避免长数据截断）。如果要查询具体组件属性请配合 manage_components。
- **参数**:
    - `nodeId`: 指定的根节点 UUID。如果不传则获取整个场景的根 (可选)。
    - `depth`: 遍历的深度限制，默认为 2。用来防止过大场景导致返回数据超长 (可选)。
    - `includeDetails`: 是否包含坐标、缩放等杂项详情，默认为 false (可选)。

### 5. update_node_transform

- **描述**: 修改节点的坐标、缩放或颜色
- **参数**:
    - `id`: 节点 UUID
    - `x`, `y`: 坐标
    - `width`, `height`: 节点宽高 (新增支持)
    - `scaleX`, `scaleY`: 缩放值
    - `color`: HEX 颜色代码（如 #FF0000）
- **重要提示**: 执行前必须调用 `get_scene_hierarchy` 确保 `id` 有效，防止操作不存在的节点。

### 6. open_scene

- **描述**: 在编辑器中打开指定的场景文件。这是一个异步且耗时的操作，打开后请等待几秒。**重要提示**：如果是新创建或空的场景，请务必先创建并初始化基础节点（Canvas/Camera）。
- **参数**:
    - `url`: 场景资源路径，如 `db://assets/NewScene.fire`

### 7. open_prefab

- **描述**: 在编辑器中打开指定的预制体文件进入编辑模式。这是一个异步操作，打开后请等待几秒。
- **参数**:
    - `url`: 预制体资源路径，如 `db://assets/prefabs/Test.prefab`

### 8. create_node

- **描述**: 在当前场景中创建一个新节点。
- **重要提示**:
    1. 如果指定了 `parentId`，必须先通过 `get_scene_hierarchy` 确认该 UUID 对应的父节点仍然存在。
    2. **预设类型差异**：
        - `empty`: 纯空节点，无组件，不带贴图。
        - `sprite`: 自动添加 Sprite 组件，默认尺寸 100x100，并带有引擎默认贴图占位。
        - `button`: 自动添加 Sprite 和 Button 组件，默认尺寸 **150x50**，背景色设为深色以便看清文字，并带有默认贴图。
        - `label`: 自动添加 Label 组件，默认尺寸 120x40。
- **参数**:
    - `name`: 节点名称
    - `parentId`: 父节点 UUID (可选)
    - `type`: 节点预设类型（`empty`, `sprite`, `label`, `button`）

### 8. manage_components

- **描述**: 管理节点组件。
- **重要最佳实践**:
    1. **引用验证**：操作前必须调用 `get_scene_hierarchy` 确认 `nodeId` 对应的节点真实存在（防止由于场景重置或节点删除导致的引用失效）。
    2. 在执行 `add` 操作前，建议先通过 `get` 操作检查是否已存在同类组件。
    3. 添加 `cc.Sprite` 后请务必设置其 `spriteFrame` 属性，否则节点将不显示。
    4. 创建按钮时，请确保目标节点有正数尺寸（`width`/`height`）作为点击区域。
- **参数**:
    - `nodeId`: 节点 UUID
    - `action`: 操作类型（`add`, `remove`, `get`, `update`）
    - `componentType`: 组件类型，如 `cc.Sprite`（用于 `add`/`update` 操作）
    - `componentId`: 组件 ID（用于 `remove`/`update` 操作）
    - `properties`: 组件属性（用于 `add`/`update` 操作）。
- **智能特性**：
    1. 如果属性期望组件类型但传入节点 UUID，插件会自动查找匹配组件。
    2. 对于资源类属性（如 `cc.Prefab`, `cc.Material`），传递资源的 UUID，插件会自动处理异步加载与序列化。
    3. **资产数组支持**: 针对 `materials` 等数组属性，支持传入 UUID 数组，插件将自动并发加载所有资源并同步更新编辑器 UI。
- **防呆校验 (Safety Checks)**：
    1. **类型拦截**: 严格禁止将 `cc.Node` 或 `Node` 作为组件类型添加，插件将直接拦截并以中文提示正确工具（如 `create-node` 或 `set-property`）。
    2. **合法性检查**: 严格校验传入的组件类必须继承自 `cc.Component`，防止非法类型引发底层报错。
- **操作规则 (Subject Validation Rule)**：赋值或更新前必须确保目标属性在组件上真实存在。

### 9. manage_script

- **描述**: 管理脚本文件，默认创建 TypeScript 脚本。**注意**：创建或修改脚本后，此工具没有主动刷新资源库。如果将要作为组件挂载到节点，创建后**必须**接着显式调用 `refresh_editor` 工具（传递精准路径参数）以便编辑器生成 `.meta` 文件并分配 UUID，否则无法作为组件添加。
- **参数**:
    - `action`: 操作类型（`create`, `delete`, `read`, `write`）
    - `path`: 脚本路径，如 `db://assets/scripts/NewScript.ts`
    - `content`: 脚本内容（用于 `create` 和 `write` 操作）
    - `name`: 脚本名称（用于 `create` 操作）
- **默认模板**: 当未提供 content 时，会使用 TypeScript 格式的默认模板

### 10. batch_execute

- **描述**: 批处理执行多个操作
- **参数**:
    - `operations`: 操作列表
        - `tool`: 工具名称
        - `params`: 工具参数

### 11. manage_asset

- **描述**: 管理资源
- **参数**:
    - `action`: 操作类型（`create`, `delete`, `move`, `get_info`）
    - `path`: 资源路径，如 `db://assets/textures`
    - `targetPath`: 目标路径（用于 `move` 操作）
    - `content`: 资源内容（用于 `create` 操作）

### 12. scene_management

- **描述**: 场景管理。创建并通过 `open_scene` 打开后，请务必初始化基础节点（如 Canvas 和 Camera）。
- **参数**:
    - `action`: 操作类型（`create`, `delete`, `duplicate`, `get_info`）
    - `path`: 场景路径，如 `db://assets/scenes/NewScene.fire`
    - `targetPath`: 目标路径（用于 `duplicate` 操作）
    - `name`: 场景名称（用于 `create` 操作）

### 13. prefab_management

- **描述**: 预制体管理
- **参数**:
    - `action`: 操作类型（`create`, `update`, `instantiate`, `get_info`）
    - `path`: 预制体路径，如 `db://assets/prefabs/NewPrefab.prefab`
    - `nodeId`: 节点 ID（用于 `create` 和 `update` 操作）
    - `parentId`: 父节点 ID（用于 `instantiate` 操作）

### 14. manage_editor

- **描述**: 管理编辑器
- **参数**:
    - `action`: 操作类型（`get_selection`, `set_selection`, `refresh_editor`）
    - `target`: 目标类型（`node`, `asset`）（用于 `set_selection` 操作）
    - `properties`: 操作属性
        - `nodes`: 节点 UUID 数组（用于 `set_selection` 操作）
        - `assets`: 资源 UUID 数组（用于 `set_selection` 操作）

### 15. find_gameobjects

- **描述**: 按条件在场景中搜索游戏对象。返回匹配节点的轻量级结构 (UUID, name, active, components 等)。若要获取完整的详细组件属性，请进一步对目标使用 `manage_components`。
- **参数**:
    - `conditions`: 查找条件
        - `name`: 节点名称（包含模糊匹配）
        - `component`: 包含的组件类名（如 `cc.Sprite`）
        - `active`: 布尔值，节点的激活状态
    - `recursive`: 是否递归查找所有的子节点（默认：true）

### 16. manage_material

- **描述**: 管理材质资源。支持适配 Cocos Creator 2.4.x 的 `_effectAsset` 和 `_techniqueData` 结构。
- **参数**:
    - `action`: 操作类型（`create`, `delete`, `update`, `get_info`）
    - `path`: 材质路径，如 `db://assets/materials/NewMaterial.mat`
    - `properties`: 材质属性（用于 `create` 和 `update` 操作）
        - `shaderUuid`: 指定使用的着色器 UUID
        - `defines`: 宏定义对象（用于 `update` 时会与现有值合并）
        - `uniforms`: Uniform 参数对象（用于 `update` 时会与现有值合并，对应引擎内的 `props`）

### 17. manage_shader

- **描述**: 管理着色器 (Effect) 资源。
- **参数**:
    - `action`: 操作类型（`create`, `read`, `write`, `delete`, `get_info`）
    - `path`: 着色器路径，如 `db://assets/effects/MyShader.effect`
    - `content`: 文本内容（用于 `create` 和 `write` 操作）

### 18. manage_texture

- **描述**: 管理纹理
- **参数**:
    - `action`: 操作类型（`create`, `delete`, `get_info`, `update`）
    - `path`: 纹理路径，如 `db://assets/textures/NewTexture.png`
    - `properties`: 纹理属性（用于 `create`/`update` 操作）
        - `type`: 纹理类型（如 `sprite`, `texture`, `raw`）(用于 `update`)
        - `border`: 九宫格边距数组 `[top, bottom, left, right]` (用于 `update`，仅当 type 为 sprite 时有效)
        - `subMetas`: (内部使用)
        - `width`: 宽度 (用于 `create` 生成占位图)
        - `height`: 高度 (用于 `create` 生成占位图)
        - `native`: 原生路径

### 18. execute_menu_item

- **描述**: 执行菜单项
- **参数**:
    - `menuPath`: 菜单项路径。
        - 支持 `delete-node:${UUID}` (推荐)：**直接删除指定节点**，不依赖编辑器选中状态，比 `Edit/Delete` 更稳定。
    - **注意**: 为了精确控制和稳定性，原有的 `File/Save`, `Edit/Undo` 等映射已移除，请直接使用 `save_scene`, `manage_undo` 等专用 MCP 工具。

### 19. apply_text_edits

- **描述**: 应用文本编辑
- **参数**:
    - `filePath`: 文件路径，如 `db://assets/scripts/TestScript.ts`
    - `edits`: 编辑操作列表
        - `type`: 操作类型（`insert`, `delete`, `replace`）
        - `position`: 插入位置（用于 `insert` 操作）
        - `start`: 开始位置（用于 `delete` 和 `replace` 操作）
        - `end`: 结束位置（用于 `delete` 和 `replace` 操作）
        - `text`: 文本内容（用于 `insert` 和 `replace` 操作）

### 20. read_console

- **描述**: 读取控制台
- **参数**:
    - `limit`: 输出限制（可选）
    - `type`: 输出类型（`log`, `error`, `warn`）（可选）

### 21. validate_script

- **描述**: 验证脚本
- **参数**:
    - `filePath`: 脚本路径，如 `db://assets/scripts/TestScript.ts`
    - **注意**：对于 TypeScript 文件，仅进行基础语法结构检查，不进行完整编译验证。

### 22. search_project

- **描述**: 搜索项目文件 (支持正则、文件名、目录名搜索)
- **参数**:
    - `query`: 搜索关键词或正则表达式 (String)
    - `useRegex`: 是否使用正则表达式 (Boolean, 默认 false)
    - `path`: 搜索路径 (String, 默认 "db://assets")
    - `matchType`: 匹配类型 (String: "content", "file_name", "dir_name", 默认 "content")
    - `extensions`: 文件后缀列表 (Array<String>, 可选)
    - `includeSubpackages`: 是否搜索子包 (Boolean, 默认 true)

**示例**:

```json
// 正则搜索
{
  "query": "^class\\s+\\w+",
  "useRegex": true,
  "matchType": "content"
}
// 搜索文件名
{
  "query": "Player",
  "matchType": "file_name"
}
```

- **描述**: 撤销/重做管理
- **参数**:
    - `action`: 操作类型 (`undo`, `redo`, `begin_group`, `end_group`, `cancel_group`)
    - `description`: 撤销组描述 (用于 `begin_group`)
    - `id`: 节点 UUID (用于 `begin_group` 时的 `undo-record`，可选)

### 24. manage_vfx

- **描述**: 特效(粒子)管理。重要提示：操作前必须确认父节点或目标节点的有效性。
- **参数**:
    - `action`: 操作类型 (`create`, `update`, `get_info`)
    - `nodeId`: 节点 UUID (用于 `update`, `get_info`)
    - `name`: 节点名称 (用于 `create`)
    - `parentId`: 父节点 UUID (用于 `create`)
    - `properties`: 粒子属性对象
        - `duration`, `emissionRate`, `life`, `lifeVar`, `startColor`, `endColor`
        - `startSize`, `endSize`, `speed`, `angle`, `gravity`, `file` (plist/texture)

### 25. manage_animation

- **描述**: 管理节点的动画组件
- **参数**:
    - `action`: 操作类型 (`get_list`, `get_info`, `play`, `stop`, `pause`, `resume`)
    - `nodeId`: 节点 UUID
    - `clipName`: 动画剪辑名称 (用于 `play` 操作，可选，默认播放 defaultClip)

### 26. get_sha

- **描述**: 获取指定文件的 SHA-256 哈希值
- **参数**:
    - `path`: 文件路径，如 `db://assets/scripts/Test.ts`

## 技术实现

### 架构设计

插件采用了典型的 Cocos Creator 扩展架构，包含以下几个部分：

- **main.js**: 插件主入口，负责启动 HTTP 服务和处理 MCP 请求
- **scene-script.js**: 场景脚本，负责实际执行节点操作
- **panel/**: 面板界面，提供用户交互界面
    - `index.html`: 面板 UI 结构
    - `index.js`: 面板交互逻辑

### HTTP 服务

插件内置了一个 HTTP 服务器，提供了两个主要接口：

- `GET /list-tools`: 返回所有可用的 MCP 工具定义
- `POST /call-tool`: 执行具体的工具操作

### MCP 协议集成

插件遵循 MCP (Model Context Protocol) 标准，使得外部 AI 工具能够理解并调用 Cocos Creator 的功能。

### 数据流

1. 外部工具发送 MCP 请求到插件的 HTTP 接口
2. main.js 接收请求并解析参数
3. 通过 Editor.Scene.callSceneScript 将请求转发给 scene-script.js
4. scene-script.js 在场景线程中执行具体操作
5. 将结果返回给外部工具

## 开发指南

### 添加新功能

要在插件中添加新的 MCP 工具，需要：

1. 在 main.js 的 `/list-tools` 响应中添加工具定义
2. 在 handleMcpCall 函数中添加对应的处理逻辑
3. 如需在场景线程中执行，需要在 scene-script.js 中添加对应函数

### 日志管理

插件会通过内置的测试面板（MCP Bridge/Open Panel）实时记录所有操作的日志，并同步持久化写入项目目录 `settings/mcp-bridge.log` 文件，编辑器重启后仍可查阅历史日志。日志记录包括：

- 服务启动/停止状态
- MCP 客户端请求接收（完整包含工具的 `arguments` 参数，超长自动截断）
- 场景节点树遍历与耗时信息
- 工具调用的执行成功/失败状态返回
- IPC 消息和核心底层报错堆栈
- 内存保护：日志缓冲区上限 2000 条，超出自动截断旧日志

## 注意事项

- 插件需要在 Cocos Creator 环境中运行
- HTTP 服务会占用指定端口，请确保端口未被其他程序占用
- 插件会自动标记场景为"已修改"，请注意保存场景
- 不同版本的 Cocos Creator 可能会有 API 差异，请根据实际情况调整

## AI 操作安全守则 (Subject Validation Rule)

为了保证自动化操作的稳定性，AI 在使用本插件工具时必须遵循以下守则：

1.  **确定性优先**：任何对节点、组件、属性的操作，都必须建立在“主体已确认存在”的基础上。
2.  **校验流程**：
    - **节点校验**：操作前必须使用 `get_scene_hierarchy` 确认节点。
    - **组件校验**：操作组件前必须使用 `get`（通过 `manage_components`）确认组件存在。
    - **属性校验**：更新属性前必须确认属性名准确无误。
3.  **禁止假设**：禁止盲目尝试对不存在的对象或属性进行修改。

## 更新日志

请查阅 [UPDATE_LOG.md](./UPDATE_LOG.md) 了解详细的版本更新历史、功能优化与修复过程。

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个插件！

## 许可证

GNU AFFERO GENERAL PUBLIC LICENSE
Version 3, 19 November 2007

允许任何人获取、使用、修改和分发本软件，但必须遵守以下条件：

1. 分发修改后的版本时，必须以相同的许可证公开源代码
2. 通过网络提供服务时，也必须向用户提供源代码
3. 任何衍生作品也必须遵循相同的许可证条款

完整的许可证文本可在项目根目录的 LICENSE 文件中找到。
