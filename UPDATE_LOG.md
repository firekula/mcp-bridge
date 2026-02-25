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

### 4. `refresh_editor` 路径参数优化与警示强化

- **工具 Schema 强化**: 在 `manage_editor` 的工具描述中加入红色警示符号 (⚠️) 和“极为重要”字样，明确要求 AI 必须指定 `path`。
- **AI 安全守则第 4 条**: 在全局 `globalPrecautions` 中新增第四条守则，强制要求 AI 避免刷新全局资源。
- **实测效果**: 生产项目中，从默认全量刷新 **172 秒** 降至指定目录刷新 **19 秒**。

### 5. 杂项修复

- **清理死代码**: 删除 `/list-tools` 路由中重复的 `res.writeHead / res.end` 调用。
- **文档更新**: `注意事项.md` 新增第 9 章「并发安全与防卡死机制」，记录 CommandQueue 和 IPC 超时两个防护机制。

### 6. 场景与预制体工具增强

- **新增 `open_prefab` 工具**: 解决了直接打开预制体进入编辑模式的问题。通过使用正确的 IPC 消息 `scene:enter-prefab-edit-mode` (并结合 `Editor.Ipc.sendToAll`)，使得 AI 可以精准操控预制体的编辑流程，而不再局限于场景跳转。
- **优化预制体创建稳定性 (`create_node` + `prefab_management`)**:
    - 在创建物理目录后强制执行 `Editor.assetdb.refresh`，确保 AssetDB 即时同步。
    - 将节点重命名与预制体创建指令之间的安全延迟从 100ms 增加至 300ms，消除了重命名未完成导致创建失败的竞态条件。

---

## 八、 Token 消耗深度优化 (2026-02-24)

### 1. 工具描述精简 (`main.js`)

- **问题**: `globalPrecautions` (AI 安全守则) 被硬编码到所有工具的 `description` 中，导致每次环境初始化或查阅工具列表时浪费约 2200 个 CJK Token。
- **优化**: 收束安全守则的广播范围。目前仅针对高风险的**写操作**（如 `manage_components`, `update_node_transform`, `manage_material`, `create_node` 等）保留警告，低风险或只读分析类工具（如 `get_scene_hierarchy`, `get_selected_node`）已悉数移除该文本。
- **效果**: `/list-tools` 整体负载字符数缩减近 40%。

### 2. 长数据截断保护 (`scene-script.js`)

- **问题**: `manage_components(get)` 会完整序列化多边形坐标集、曲线数据数组以及 Base64 图片，产生极其庞大且对 AI 无用的 JSON 负载。
- **优化**:
    - **数组截断**: 长度超过 10 的数组直接返回 `[Array(length)]`，彻底杜绝数据雪崩。
    - **字符串截断**: 长度超过 200 的字符串限制为截断显示并附带 `...[Truncated, total length: X]` 提示。

### 3. 层级树获取瘦身与分页 (`get_scene_hierarchy`)

- **问题**: 请求场景层级时会一次性返回完整 1000+ 节点的深层结构，包括所有变换矩阵。
- **优化**:
    - 支持 `depth` 深度限制（默认 2 层）。
    - 支持 `nodeId` 参数，允许 AI 缩小作用域，从指定根节点向下探测。
    - 添加 `includeDetails` 参数。默认关闭，此时剥离坐标、缩放与尺寸指标，且将冗长的组件详细结构浓缩成简化的名称数组（如 `["Sprite", "Button"]`）。

### 4. 查找结果精简 (`find_gameobjects`)

- **优化**: 将原本包含 Transform（位移/缩放/尺寸）全量数据的匹配回传，精简为仅包含核心识别特征的基础集 (`uuid`, `name`, `active`, `components`, `childrenCount`)，极大释放了同名大批量查找时的 Token 压力。

### 5. 底层鲁棒性大修

- **问题**: 上述优化在应用过程中暴露出遍历未命名根节点（如 `cc.Scene`）时遭遇 `undefined.startsWith` 报错并引发 IPC 悬挂的致命隐患。
- **修复**: 在 `dumpNodes` 与 `searchNode` 中增设前置安全屏障，并修复 `cc.js.getClassName(c)` 替代底层的 `__typename` 来兼容 2.4 获取有效类名。修复了 `main.js` 中关于 `get_scene_hierarchy` 的参数传递脱节问题。

---

## 九、 脚本管理修复与强化 (2026-02-25)

### 1. `manage_script` 路径引用错误修复

- **问题**: AI 在调用 `manage_script` 工具执行 `create` 创建脚本时，出现 `path is not defined` 报错。
- **原因**: 传入的变量 `path` 已经被解构重命名为 `scriptPath`，而在后续获取物理路径时，错误地调用了 `path.dirname()`，导致引用错误。
- **修复**: 将 `path.dirname` 修正为全局正确引入的 `pathModule.dirname`，彻底解决了使用此工具生成自定义脚本库时的崩溃问题。

### 2. 强制生成 Script Meta 文件的提示词 (Prompt) 优化

- **问题**: AI 助手创建或修改脚本后，若不主动触发系统刷新，后续试图通过 `manage_components` 将该新脚本挂载为组件时，会由于缺乏有效的 `.meta` 扫描和 UUID 索引而失败。
- **优化**: 在 `main.js` 中的 `manage_script` 工具 `description` 提示词中，将原本建议性质的刷新语气，修改为严格指令：“**创建后必须调用 refresh_editor (务必指定 path) 生成 meta 文件，否则无法作为组件添加**”。
- **效益**: 在不增加 Token 开销的前提下，强制规范了大语言模型的行为，保障了脚本创建到组件挂载工作流的健壮性。

---

## 十、 AI 幻觉容错与调试体验增强 (2026-02-25)

### 1. `manage_components` 参数容错

- **问题**: AI 客户端在调用 `manage_components` 等工具时偶尔会产生“幻觉”，将操作类型参数 `action` 错误拼写为含义相近的 `operation`，导致插件抛出“未知的组件操作类型: undefined”等错误而中断执行。
- **修复**: 在 `scene-script.js` 及其核心操作流中增加了参数别名映射逻辑，允许将 `operation` 作为 `action` 的后备别名（Fallback）。即使 AI 传参名称发生漂移也能顺畅执行后续流程，大幅提升了对大模型无规律输出错漏的容错率。

### 2. MCP 请求日志全览解析 (Full Arguments Logging)

- **问题**: 现有的面板调试终端在记录 AI 工具调用时，只有指令头如 `REQ -> [manage_components]`，无法透视 AI 实际上到底提交了哪些参数。致使类似参数名称写错的幽灵 Bug 极难被常规察觉。
- **优化**: 修改了 `main.js` 中的 `/call-tool` 路由逻辑。现在系统拦截不仅会记录动作名称，还会将完整的 `arguments` 以 JSON 序列化的形态连同日志一并输出在面板中：例如 `参数: {"nodeId":"...","operation":"get"}`。
- **保护机制**: 为防止类似多边形顶点数据等过大的参数体撑爆编辑器控制台缓存或导致 UI 卡顿，日志处理对超过 500 个字符长度的序列化结果启用了自动截断显示 (`...[Truncated]`)。

### 3. `manage_components` 类型安全与防呆校验

- **问题**: 某些不聪明的 AI 会混淆节点树和组件系统，在调用 `manage_components` (action="add") 时错误地将 `cc.Node` 或其他不合法的类名当作组件名传入，导致底层引擎抛出 `Cannot read property 'constructor' of null` 的深层报错并引发 AI 陷入死循环重试。
- **修复**: 在 `scene-script.js` 层加固了前置拦截规则：
    1. **直接拦截节点**: 当检测到传入 `cc.Node` 或 `Node` 作为组件类型时直接驳回，并返回富含指导意义的中文提示词（如“请使用 create-node 创建节点”）。
    2. **继承链校验**: 提取引擎类定义后，强制要求通过 `cc.js.isChildClassOf` 判断该类必须继承自 `cc.Component`。若不合法则即时截断并提示。
- **价值**: 通过将冰冷的底层异常翻译为“手把手教 AI 怎么重试”的指导性异常，彻底根治了 AI 在操作组件时乱认对象、反复撞墙的通病。
