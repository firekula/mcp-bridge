# Cocos Creator MCP Bridge 更新与修复日志

本文件详细记录了本次开发周期内的所有功能更新、性能改进以及关键问题的修复过程。

## 一、 新增功能与工具

### 1. `manage_shader` 工具 (新增)

- **功能**: 实现了对着色器 (`.effect`) 资源的全生命周期管理。
- **操作**: 支持 `create` (带默认模板), `read`, `write`, `delete`, `get_info`。
- **意义**: 补全了资源管理链条，使得从编写代码到应用材质的流程可以完全通过 MCP 驱动。

### 2. 材质管理增强 (`manage_material`)

- **2.4.x 深度适配**: 彻底重构了材质存储结构，支持 Cocos Creator 2.4.x 的 `_effectAsset` 和 `_techniqueData` 格式。
- **新增 `update` 操作**: 支持增量更新材质的宏定义 (`defines`) 和 Uniform 参数 (`props`)，无需覆盖整个文件。

### 3. 组件管理增强 (`manage_components`)

- **资源数组支持**: 攻克了 `materials` 等数组属性无法通过 UUID 赋值的难题。
- **智能异步加载**: 实现了并发加载多个资源 UUID 的逻辑，并在加载完成后自动同步到场景节点。

---

## 二、 关键问题修复 (Technical Post-mortem)

### 1. 材质在 Inspector 面板中显示为空

- **原因**: 初始代码使用了错误的 JSON 字段 (如 `effects`)，不符合 2.4.x 的私有属性序列化规范。
- **修复**: 将字段改为 `_effectAsset` (UUID 引用) 和 `_techniqueData` (包含 `props` 和 `defines`)。

### 2. Sprite 材质赋值失效

- **原因**: 直接向 `cc.Sprite.materials` 赋值字符串数组会导致引擎内部类型不匹配；且直接修改内存属性不会触发编辑器 UI 刷新。
- **修复**: 在 `scene-script.js` 中拦截数组型资源赋值，先通过 `cc.AssetLibrary` 加载资源对象，再使用 `scene:set-property` IPC 消息强制刷新编辑器 Inspector 面板。

### 3. 场景克隆与 `Editor.assetdb` 兼容性

- **原因**: Cocos 2.4.x 的主进程 `Editor.assetdb` 缺少 `loadAny` 方法，导致原本的 `duplicate` 逻辑崩溃。
- **修复**: 改用 Node.js 原生 `fs` 模块直接读取源文件流并创建新资源。

---

## 三、 文档与规范化建设

### 1. 全域本地化 (Simplified Chinese)

- **代码注释**: 将 `main.js` 和 `scene-script.js` 中所有关键逻辑的英文注释转换为准确的中文说明。
- **JSDoc 补充**: 为核心函数补充了详尽的 JSDoc 参数说明，提升代码可读性。
- **日志输出**: 所有控制台日志 (`addLog`) 和错误提示均已中文化，方便国内开发者排查。

### 2. AI 安全守则 (Safety Rules)

- **守则注入**: 在所有 MCP 工具的描述中注入了【AI 安全守则】，强调“先校验再操作”、“资源赋 UUID”等原则。
- **Schema 优化**: 优化了工具的描述文本，使其在 AI 客户端（如 Cursor）中展现更清晰的引导。

---

## 四、 纹理与节点变换增强 (Texture & Transform Updates)

### 1. `manage_texture` 工具增强

- **新增 `update` 操作**: 支持修改现有纹理的类型（如 `texture` -> `sprite`）和九宫格边距 (`border`)。
- **Meta 加载健壮性**: 修复了 `Editor.assetdb.loadMeta` 在某些情况下返回空值的问题，增加了读取文件系统 `.meta` 文件的 Fallback 机制。
- **多版本兼容**: 针对 Cocos Creator 不同版本 `.meta` 文件结构差异（数组 vs 独立字段），实现了对 9-slice 数据写入的自动兼容。

### 2. `update_node_transform` 工具增强

- **新增尺寸控制**: 添加了 `width` 和 `height` 参数，允许 AI 直接调整节点大小（对于测试九宫格拉伸效果至关重要）。

### 3. 关键 Bug 修复

- **属性批量应用中断**: 修复了 `scene-script.js` 中 `applyProperties` 函数在处理 Asset 类型属性时错误使用 `return` 导致后续属性（如 `type`）被忽略的问题。现在改为 `continue`，确保所有属性都能被正确应用。

### 6.2 菜单映射清理

- **移除冗余**: 清理了 `execute_menu_item` 中过时或不稳定的菜单映射 (如 `File/Save`, `Edit/Delete` 等)。
- **规范操作**: 强制引导 AI 使用 `delete-node:UUID` 或专用 MCP 工具 (`save_scene`, `manage_undo`)，提高了自动化流程的稳定性。

## 六、 总结

本次更新不仅修复了制约生产力的材质与资源同步 bug，还通过引入 `manage_shader` 和全方位的文档中文化，极大提升了开发者（及 AI 助手）在 Cocos Creator 2.4.x 环境下的操作体验。针对菜单执行工具的清理进一步规范了自动化操作流程，减少了潜在的不稳定性。

---

## 七、 并发安全与防卡死机制 (2025-02-12)

### 1. 指令队列 (CommandQueue) — 核心防卡死改造

- **问题**: AI 客户端连续快速发送 `delete-node` → `refresh_editor` → `search_project` 时，多个请求并发进入 `handleMcpCall`，`AssetDB.refresh()` 与后续操作争夺 I/O 和 IPC 通道，导致编辑器主线程阻塞、Scene 面板无响应。
- **修复**: 在 HTTP `/call-tool` 入口新增 `enqueueCommand` / `processNextCommand` 队列机制，所有 MCP 工具调用强制串行执行，前一个指令回调完成后才处理下一个。
- **异常保护**: 队列在 `processNextCommand` 的 `catch` 块中有防死锁保护，即使某个指令抛出异常也不会永久阻塞后续指令。
- **可观测性**: 每条请求日志中显示 `(队列长度: N)`，方便排查积压问题。

### 2. IPC 超时保护 (callSceneScriptWithTimeout)

- **问题**: `Editor.Scene.callSceneScript` 无超时机制，Scene 面板阻塞时回调永不返回，导致 HTTP 连接和队列双重堆积。
- **修复**: 新增 `callSceneScriptWithTimeout` 统一包装函数（默认 15 秒超时），覆盖全部 9 处 `callSceneScript` 调用点。
- **超时日志**: `[超时] callSceneScript "方法名" 超过 15000ms 未响应`。

### 3. `batchExecute` 串行化

- **问题**: 原实现使用 `forEach` 并行派发所有子操作，多个 `AssetDB` 操作同时执行引发编辑器卡死。
- **修复**: 改为串行链式执行（`next()` 递归调用），确保每个操作完成后再执行下一个。

### 4. `refresh_editor` 路径参数优化

- **问题**: 默认刷新 `db://assets/scripts`（后改为 `db://assets`），在大型生产项目中 `AssetDB.refresh()` 耗时可达 3 分钟。
- **修复**: 工具 Schema 新增 `properties.path` 参数说明，支持指定精确刷新路径（如单个文件 `db://assets/resources/sdk_config.json` 或目录 `db://assets/resources`），大幅减少刷新耗时。
- **实测效果**: 生产项目中，从默认全量刷新 **172 秒** 降至指定目录刷新 **19 秒**。

### 5. 杂项修复

- **清理死代码**: 删除 `/list-tools` 路由中重复的 `res.writeHead / res.end` 调用。
- **文档更新**: `注意事项.md` 新增第 9 章「并发安全与防卡死机制」，记录 CommandQueue 和 IPC 超时两个防护机制。
