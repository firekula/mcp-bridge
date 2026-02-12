# MCP 指令执行分析报告 (导致编辑器卡死)

## 故障描述

在执行资源刷新与搜索组合操作时，Cocos Creator 编辑器出现卡死/无响应状态。疑似原因为 AssetDB 锁定期间并发了 IPC 请求或资源扫描冲突。

## 执行的指令流水线

### 1. 删除节点 (delete-node)

- **工具**: `mcp-cocos-creator:execute_menu_item`
- **参数**:
    ```json
    {
    	"menuPath": "delete-node:6fboVM8YBPGKYocObhha8Y"
    }
    ```
- **目的**: 清理层级错误的 LibTool 节点。

### 2. 刷新编辑器 (refresh_editor) - 关键怀疑点

- **工具**: `mcp-cocos-creator:manage_editor`
- **参数**:
    ```json
    {
    	"action": "refresh_editor"
    }
    ```
- **目的**: 强制编辑器同步最新创建的 `assets/resources/sdk_config.json`。
- **风险分析**: 对应引擎内部 `AssetDB.refresh()`。若此时涉及大量 meta 文件变更未完成，可能导致死锁。

### 3. 项目搜索 (search_project)

- **工具**: `mcp-cocos-creator:search_project`
- **参数**:
    ```json
    {
    	"matchType": "file_name",
    	"query": "sdk_config.json"
    }
    ```
- **目的**: 通过文件名获取新创建资产的 UUID，以便执行后续挂载属性赋值。
- **风险分析**: 此操作可能与 `refresh_editor` 产生的写操作或重索引操作并发，导致 IPC 通道阻塞。

## 异常日志参考

在卡死前，MCP Bridge 曾上报以下错误：
`Error: ipc failed to send, panel not found. panel: scene, message: mcp-bridge:get-hierarchy`
这表明 Scene 面板由于主线程阻塞已无法响应 IPC 消息。

## 建议修复方向

1.  **排队机制**：在 MCP 插件内部实现指令队列，确保 `refresh_editor` 等高开销操作完成后再进行读操作。
2.  **超时控制**：增加 IPC 请求的超时丢弃机制，防止单次卡顿导致整个插件逻辑层崩溃。

---

## 修复状态：✅ 已实施 (2025-02-12)

### 已实施的修复措施

1.  **指令队列 (CommandQueue)**：在 `/call-tool` 入口实现了 `enqueueCommand` / `processNextCommand` 串行化队列，所有 MCP 请求强制按顺序执行。
2.  **IPC 超时保护 (callSceneScriptWithTimeout)**：为全部 9 处 `callSceneScript` 调用添加 15 秒超时包装，防止 Scene 面板无响应时 callback 永挂。
3.  **batchExecute 串行化**：从并行 `forEach` 改为链式串行执行。
4.  **refresh_editor 路径参数**：支持 `properties.path` 指定精确刷新路径，避免全量刷新耗时过长。

详见 `UPDATE_LOG.md` 第七章和 `注意事项.md` 第 9 章。
