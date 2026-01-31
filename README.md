# MCP Bridge 插件

这是一个为 Cocos Creator 设计的 MCP (Model Context Protocol) 桥接插件，用于连接外部 AI 工具与 Cocos Creator 编辑器，实现对场景、节点等资源的自动化操作。

## 适用版本

此插件适用于 Cocos Creator 2.4.x 版本。由于使用了特定的编辑器 API，可能不兼容较新或较老的版本。

## 功能特性

- **HTTP 服务接口**: 提供标准 HTTP 接口，外部工具可以通过 MCP 协议调用 Cocos Creator 编辑器功能
- **场景节点操作**: 获取、创建、修改场景中的节点
- **资源管理**: 创建场景、预制体，打开指定资源
- **组件管理**: 添加、删除、获取节点组件
- **脚本管理**: 创建、删除、读取、写入脚本文件
- **批处理执行**: 批量执行多个 MCP 工具操作，提高效率
- **资产管理**: 创建、删除、移动、获取资源信息
- **实时日志**: 提供详细的操作日志记录和展示
- **自动启动**: 支持编辑器启动时自动开启服务

## 安装与使用

### 安装

将此插件复制到 Cocos Creator 项目的 `packages` 目录下即可。

### 启动

1. 打开 Cocos Creator 编辑器
2. 在菜单栏选择 `Packages/MCP Bridge/Open Test Panel` 打开测试面板
3. 在面板中点击 "Start" 按钮启动服务
4. 服务默认运行在端口 3456 上

### 配置选项

- **端口**: 可以自定义 HTTP 服务监听的端口，默认为 3456
- **自动启动**: 可以设置编辑器启动时自动开启服务

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

- **描述**: 获取当前场景的完整节点树结构（包括 UUID、名称和层级关系）
- **参数**: 无

### 5. update_node_transform

- **描述**: 修改节点的坐标、缩放或颜色
- **参数**:
    - `id`: 节点 UUID
    - `x`, `y`: 坐标
    - `scaleX`, `scaleY`: 缩放值
    - `color`: HEX 颜色代码（如 #FF0000）

### 6. open_scene

- **描述**: 在编辑器中打开指定的场景文件
- **参数**:
    - `url`: 场景资源路径，如 `db://assets/NewScene.fire`

### 7. create_node

- **描述**: 在当前场景中创建一个新节点
- **参数**:
    - `name`: 节点名称
    - `parentId`: 父节点 UUID (可选，不传则挂在场景根部)
    - `type`: 节点预设类型（`empty`, `sprite`, `label`, `canvas`）

### 8. manage_components

- **描述**: 管理节点组件
- **参数**:
    - `nodeId`: 节点 UUID
    - `action`: 操作类型（`add`, `remove`, `get`）
    - `componentType`: 组件类型，如 `cc.Sprite`（用于 `add` 操作）
    - `componentId`: 组件 ID（用于 `remove` 操作）
    - `properties`: 组件属性（用于 `add` 操作）

### 9. manage_script

- **描述**: 管理脚本文件，默认创建 TypeScript 脚本
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

- **描述**: 场景管理
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

插件会记录所有操作的日志，包括：

- 服务启动/停止
- MCP 请求接收
- 操作成功/失败状态
- 错误信息

## 注意事项

- 插件需要在 Cocos Creator 环境中运行
- HTTP 服务会占用指定端口，请确保端口未被其他程序占用
- 插件会自动标记场景为"已修改"，请注意保存场景
- 不同版本的 Cocos Creator 可能会有 API 差异，请根据实际情况调整

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
