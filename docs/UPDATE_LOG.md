# Cocos Creator MCP Bridge 更新与修复日志

本文件详细记录了本次开发周期内的所有功能更新、性能改进以及关键问题的修复过程。

## 离线场景修改工具 - 支持场景文件 (.fire) 修改 (2026-07-01)

### 问题背景

之前实现的离线预制体修改工具（`modify_prefab_offline`）极大提升了大语言模型修改、创建节点组件的工作效率与稳定性。然而，面对大批量的场景配置更新或场景节点离线初始化，在线打开场景（`open_scene`）再保存依然可能导致主线程阻塞。我们需要让该离线编辑引擎同样能够支持场景文件（`.fire`）的直接物理读写。

### 修复方案与原理

1. **寻路根起点泛化**：
   - 场景与预制体在 Cocos Creator 2.x 中均基于平铺的 JSON 对象数组实现，但顶层骨架不同。预制体以 `cc.Prefab` 为首元素并引用唯一根节点，而场景以 `cc.SceneAsset` 为首元素并引用一个 `cc.Scene` 节点容器。
   - 重构了 `OfflinePrefabEditor.findNodeByPath` 的寻路起点：若检测到入口为 `cc.SceneAsset`，则自动将其引用的 `cc.Scene` 作为寻路根容器。由于 `cc.Scene` 在平铺结构中和普通节点一样拥有 `_children` 属性，后续子树寻路算法得以 100% 共享。
2. **差异化 PrefabInfo 挂载拦截**：
   - 在预制体模式下添加子节点（`add_node`）时，强制要求伴随创建并挂载 `cc.PrefabInfo`；而在普通的场景模式下，新增的节点默认没有预制体绑定，`_prefab` 属性必须设为 `null` 且无需在物理数组中插入 `cc.PrefabInfo`。引擎在 `add_node` 时对这两类入口作了精确的差异化判定和安全拦截。
3. **新增场景分发**：
   - 注册了 `modify_scene_offline` MCP 工具，与预制体离线修改共享完全相同的 Operations 操作结构；并支持在文件不存在时，自动写入包含 `cc.SceneAsset` 与 `cc.Scene` 的极简场景物理骨架以实现“无中生有”的新建场景能力。

### 改动范围

| 文件 | 修改性质 | 详细内容 |
|------|------|------|
| `src/utils/OfflinePrefabEditor.ts` | 修改 | 新增 `isSceneData` 判断；重构 `findNodeByPath` 支持 `cc.SceneAsset` 和 `cc.Prefab` 检索起点；在 `add_node` 中拦截场景下的 `cc.PrefabInfo` 创建。 |
| `src/tools/ToolDispatcher.ts` | 修改 | 增加对 `modify_scene_offline` case 的路由处理、场景空骨架物理写入及非阻塞刷新资产动作。 |
| `src/tools/ToolRegistry.ts` | 修改 | 注册全新的 `modify_scene_offline` 工具 schema 参数接口描述。 |
| `UPDATE_LOG.md` | 修改 | 追加离线场景编辑支持的 Feature/Changed 说明。 |

---

## 离线预制体修改工具 - UUID 压缩与平铺对象提升适配 (2026-06-09)

### 问题背景

在前一阶段的离线预制体修改工具（`modify_prefab_offline`）实际测试中，我们发现了两个直接阻碍自定义脚本及事件挂载的缺陷：
1. **MissingScript 报错**：离线直接挂载自定义脚本组件时，如果填入原始 of 36 位 UUID，Cocos Creator 引擎在反序列化时无法将其匹配映射到具体的类，从而在编辑器中显示为 `cc.MissingScript` 并导致其下的全部属性连线失效。
2. **ClickEvent 点击事件失效**：在 Cocos 序列化规范中，`cc.ClickEvent` 属于 `cc.Object` 的派生类。这类对象在属性存储时**不能内联嵌套**，必须作为一个平铺项追加在物理预制体 JSON 数组的尾部，并通过 `{ "__id__": index }` 引入。并且其在物理对象上的 `component` 字段必须设为空 `""`，并且必须包含一个 `_componentId` 填入脚本压缩后的 23 位 UUID。

### 修复方案与原理

我们在 `OfflinePrefabEditor.ts` 内部进行了深层的算法拓展：
1. **自动 UUID 压缩（r=5 压缩）**：内置了纯离线的 23 位 UUID 压缩互转算法。当挂载、检索或移除自定义组件时，若检测到传入了标准 36 位的原始 UUID，会自动在后台计算并替换为 Cocos Creator 特有的 23 位压缩版 UUID 作为组件的 `__type__`，确保编辑器能完美反序列化识别该类。
2. **平铺提升器 (liftObject)**：新增了 `liftObject` 属性提取机制。当写入 `clickEvents` 等事件属性时，自动识别其中的内联事件对象并将其转换为平铺在预制体 JSON 尾部的独立对象（排除通用的 `cc.ValueType` 如 Size/Vec3/Color），重新 realign 所有受影响元素的 `__id__` 指向，并自动匹配对应 target 节点的脚本组件，计算并填入 `_componentId` 指向和清空 `component` 字段，100% 贴合了 Cocos 引擎的物理反序列化规范。

### 改动范围

| 文件 | 修改性质 | 详细内容 |
|------|------|------|
| `src/utils/OfflinePrefabEditor.ts` | 修改 | 新增自定义 `compressUuid` 算法、`isUuid` 校验以及 `liftObject` 对象自动提升平铺机制；在 `add_component`, `remove_component`, `set_reference`, `update_property` 中全面介入 UUID 自动压缩以及复杂类型属性的提取，彻底解决离线绑定失效及脚本丢失问题。 |

---

## 离线预制体修改工具 (2026-06-08)

### 问题背景

为了在 Cocos Creator 2.4.x 环境下完整对接并实现参考项目 [cc-3-8-x-mcp](https://github.com/HappyLifeOk/cc-3-8-x-mcp) 针对 3.8.x 版本所提供的 26 个离线预制体原子修改命令，我们在本插件中实现了全功能的离线预制体修改引擎。

原本要修改预制体的内容，AI 必须调用 `open_prefab` 打开预制体编辑模式，并在完成属性修改后，调用 `save_prefab` 和 `close_prefab` 退出。这套在线流程强依赖 Cocos 编辑器的运行态，当遇到复杂的预制体时，不仅极其缓慢（每次操作需耗时数秒），而且极易因渲染进程卡死或 IPC 消息冲突发生死锁。

### 修复方案与原理

引入了 `modify_prefab_offline` 工具，实现无需打开编辑器预制体窗口即可直接修改、克隆、重排序和删除节点组件的机制，100% 覆盖了参考项目 [cc-3-8-x-mcp](https://github.com/HappyLifeOk/cc-3-8-x-mcp) 提供的所有离线编辑能力。为解决物理读写与复杂层级引用的健壮性，进行了如下深层优化：

1. **全生命周期原子操作**：在主进程中实现了 `OfflinePrefabEditor` 类，直接通过纯 Node.js 处理平铺 JSON 对象。支持 8 大声明式核心原子操作。
2. **防移位克隆与深拷贝引用重算**：在 `clone_node` 操作中，提取目标子树包含的所有对象，追加到平铺 JSON 尾部。利用映射表重算子树内部所有的 `__id__` 相对引用，而将子树外部的引用原样保留。
3. **全深度递归引用重算（致命卡死修复）**：在 `remove_node` 和 `remove_component` 操作中，抛弃了会导致引擎崩溃的 `null` 占位方案，采用物理 `splice` 删除元素并全面启用深度递归重映射 `remapAllIdRefs` 算法。这不仅重排了扁平属性的 `__id__` 指向，也彻底递归更新了如 `clickEvents`、`Widget` 等深度嵌套属性/数组中的引用，杜绝了反序列化越界崩溃。
4. **无中生有去套娃与根节点寻址容错**：优化了离线新建预制体时的逻辑。写入骨架后自动 `shift()` 剔除首个用于创建根节点的冗余 `add_node` 操作；并在寻址中对带根节点名称前缀的路径加入智能剔除，彻底消除了寻址歧义。
5. **补全原生节点默认属性**：在新创建的节点及空骨架中，补齐 `_eulerAngles`、`_skewX`、`_skewY`、`_is3DNode`、`_groupIndex`、`groupIndex` 等原生基础属性，确保在 Cocos 2.4.x 中的完美兼容。
6. **非阻塞异步重载机制（防止死锁）**：本地物理文件写入成功后立即向 MCP 工具队列回调成功并释放锁，而对于 `Editor.assetdb.refresh` 同步，则通过 `setTimeout` 延迟 200 毫秒异步触发。这消除了 Watcher 与插件在主线程中争夺文件锁的微秒级竞态死锁，彻底解决了编辑器卡在“检查文件更新”与 MCP 超时强释队列的死锁顽疾。
7. **属性引用连线绑定**：在 `set_reference` 操作中，支持直接对属性关联外部资源 `{__uuid__: "..."}`，或通过相对路径动态定位内部其它节点或组件的相对 `__id__` 索引进行写入。

### 改动范围

| 文件 | 修改性质 | 详细内容 |
|------|------|------|
| `src/utils/OfflinePrefabEditor.ts` | 修改 | 重构 8 大声明式操作；**实现 `remapAllIdRefs` 深度递归引用重算算法**，解决 `clickEvents` 等嵌套属性引用损坏；在 `findNodeByPath` 中加入根节点前缀智能过滤。 |
| `src/tools/ToolDispatcher.ts` | 修改 | 在“无中生有”骨架落盘后，**执行 `args.operations.shift()` 剔除首个冗余 add_node 操作**解决根套娃；在空骨架中补全原生属性。 |
| `src/tools/ToolRegistry.ts` | 修改 | 扩展工具 `inputSchema` 以暴露新动作参数描述及字段映射约束。 |

---

## 预制体根节点错误修复 (2026-05-29)

### 问题背景

AI 调用 `create_prefab` 或 `prefab_management` (action=create) 创建预制体时，保存的 `.prefab` 文件名正确（如 `HomeView.prefab`），但文件内部根节点始终是 Canvas 而非目标节点。例如场景结构为 `Canvas → ViewManager → HomeView → TitleLabel`，期望以 HomeView 为根创建预制体，但实际预制体内部包含完整的 `Canvas → ViewManager → HomeView → TitleLabel` 祖先链。

### 根因分析

`Editor.serialize(node)` 在 Cocos Creator 2.x 中的行为是**从场景根节点开始序列化整个场景树**，而非仅序列化传入的 `node` 及其子树。序列化输出的 JSON 数组中，第一个 `cc.Node` 始终是场景根节点（Canvas），其 `_parent` 指向 `cc.Scene`。

后处理管线（9 步转换）的逻辑是：
1. 找到 `_parent.__id__` 指向 `cc.Scene` 的节点作为预制体根节点
2. 由于 Canvas 的 `_parent` 指向 `cc.Scene`，Canvas 被识别为根
3. Canvas 以下的完整子树被保留

因此无论传入哪个目标节点，预制体根永远锁定为 Canvas。

同时，原先的节点重命名使用异步 IPC `Editor.Ipc.sendToPanel("scene", "scene:set-property", ...)` + `setTimeout(300ms)`，存在 IPC 竞态风险（重命名在 scene panel 进程执行，序列化经由 `Editor.Scene.callSceneScript` 走另一条 IPC 通道），`prefab_management` 入口甚至完全无延迟等待。

### 修复内容

| 文件 | 修改 |
|------|------|
| `src/scene-script.ts` | `create-prefab` handler: 序列化前临时 detach 节点 (`node.parent = null`)，序列化后立即恢复 `node.parent` 和 `node.name`；新增 `nodeName` 参数支持同步重命名 |
| `src/tools/ToolDispatcher.ts` | `_createPrefabViaSceneScript` 新增 `nodeName` 参数；`create_prefab` 入口移除异步 IPC 重命名 + setTimeout，直接传 `nodeName`；`prefabManagement` (create) 入口同样移除异步重命名，传 `prefabName` |

### 核心修复代码

```javascript
// scene-script.ts: create-prefab handler
// 保存原始状态
const originalParent = node.parent;
const originalName = node.name;

// 临时 detach：欺骗 Editor.serialize 使其仅序列化目标节点及其子树
node.parent = null;
if (nodeName) node.name = nodeName;

const serializedStr = Editor.serialize(node);

// 立即恢复，保证场景状态不受影响
node.parent = originalParent;
node.name = originalName;
```

### 设计权衡

不采用在 ToolDispatcher 层面增加更长 `setTimeout` 延迟的方案，因为：
1. 无法根本解决 `Editor.serialize` 序列化整个场景树的问题
2. IPC 异步延迟是启发式的，不同机器/负载下表现不一致
3. 在 scene-script 内部同步 detach/rename/serialize/restore 是唯一能 100% 保证正确性的方案

### 验证

通过 MCPTest 项目实测：创建 `Canvas → ViewManager → HomeView(含Sprite) → TitleLabel(含Label)` 结构，以 HomeView (UUID: `4dFvcOwftDLoTiUFzWXqe6`) 为节点创建 `HomeView.prefab`。

验证结果：
- 预制体文件 `cc.Prefab.data.__id__` 指向索引 1 的 `cc.Node`
- 索引 1 节点 `_name: "HomeView"`, `_parent: null` ✓
- 索引 2 节点 `_name: "TitleLabel"`, `_parent.__id__: 1` ✓
- 无 Canvas / ViewManager 祖先节点 ✓
- 根节点 `cc.PrefabInfo.fileId` 已正确填充 ✓
- 场景中 HomeView 节点名称和父子关系未受影响 ✓

---

## refresh_editor 编辑器卡死修复 (2026-05-20)

### 问题背景

AI 调用 `refresh_editor` 时传入目录级路径（如 `db://assets/_script`），`Editor.assetdb.refresh()` 耗时 60-95 秒并导致编辑器彻底卡死，只能强制关闭。

### 根因分析（结合编辑器源码 `D:\Cocos\Editor\cocos-creator\resources\app\asset-db\`）

通过解包 Cocos Creator 编辑器源码，完整追踪了 `Editor.assetdb.refresh()` 的内部执行链路：

1. **`interface.js:refresh()`** → 将请求推入 `_tasks` 队列（并发度=1）
2. **`tasks.js:F()`** 分四个阶段执行：
   - `b()`: `fastGlob.sync("**/*")` 同步扫描目录所有文件（阻塞主线程）
   - `$()`: 逐个检查文件是否需要重新导入
   - `S()`: 对每个脚本文件调用导入器 → **触发 TypeScript 编译**
   - `w()`: 后处理
3. 编译在 worker 进程中异步执行，产物写入 `library/imports/`
4. **chokidar** 文件监听器（`watch.js`）检测到写入事件
5. 事件进入 `ChangeCollector`（200ms debounce）→ `syncChanges()`
6. `_processChanges` 推入 `_tasks` 队列 → 第 91 行调用 **`tasks.refresh(assetdb, updates)`**
7. 回到步骤 2，形成 **refresh → compile → write → watcher → refresh** 闭环级联

**每次循环都在主线程执行 `fastGlob.sync` 和 `fs.statSync`，持续数分钟不释放。**

### 与手动改脚本切回编辑器的对比

手动修改脚本后切回编辑器，走的是 `submitChanges()` 中的 **fsnap 快照对比**（非 chokidar），只检测到用户修改的 1 个文件。级联链条长度仅 2-3 节（文件刷新 → 编译 → library 文件同步），总耗时约 1 秒，无感。

插件刷新 200 个文件的目录时，级联链条可达 10-20 节，每节都阻塞主线程，最终导致编辑器死亡。

### 修复内容

| 文件 | 修改 |
|------|------|
| `src/core/CommandQueue.ts` | `enqueue` 新增 `onTimeout` 可选回调参数，超时时执行清理逻辑并正确关闭 HTTP 连接 |
| `src/core/McpRouter.ts` | 传入超时清理函数，发送 504 错误响应；新增 `responseSent` 标志防止超时后重复写入响应 |
| `src/tools/ToolDispatcher.ts` | `refresh_editor` 新增 `pathModule.extname()` 检查，**目录级路径（无后缀名）直接拒绝并返回明确错误提示**，仅允许单文件刷新 |
| `src/tools/ToolRegistry.ts` | 更新 `manage_editor` 工具描述，从"建议指定路径"改为"硬性限制：目录路径已被代码层拒绝" |

### 设计权衡

不采用 `setTimeout` 异步化方案的原因：异步化破坏了 `CommandQueue` 的串行保证（`callback` 在刷新执行前就释放了队列锁），后续命令可能与刷新并发执行，引入竞态条件。在级联链条的**起点**阻止目录级刷新是唯一安全的方案。

---

## Claude Code 技能体系搭建 (2026-05-14)

### 1. 新增 6 个 Claude Code 技能

- **内容**: 在 `.claude/skills/` 目录下创建 6 个技能文件，完整映射 `.agent/workflows/` 的开发工作流。
- **技能清单**:
  - `/mcp-rules` — 加载开发规范与编码约定
  - `/mcp-define` — 创建功能 Spec（≥ 5 次深度调研 + 6 项交付标准）
  - `/mcp-architect` — 创建实施 Plan（文件清单 + 分步复选框 + 代码片段）
  - `/mcp-execute` — 逐步执行计划（强制 `npm run build` + 状态同步）
  - `/mcp-refactor` — 代码审计与清理（先列清单后改代码）
  - `/mcp-verify` — 功能验证（视觉审计 + 边界测试 + 回归检查，集成 MCP bridge 截图/日志/性能工具）
- **意义**: 使 Claude Code 具备与 Cursor/Roo Code 等同的结构化开发流程能力。

---

## `search_project` 搜索路径兜底修复 (2026-05-14)

### 1. `db://` 根路径自动纠正为 `db://assets`

- **问题**: 用户在 `search_project` 工具中使用 `path: “db://”` 进行搜索时，`Editor.assetdb.urlToFspath(“db://”)` 返回无效路径，导致报错”无效的搜索路径: db://”。
- **修复**: 在 `McpWrappers.ts` 的 `searchProject` 方法中增加路径规范化逻辑。当 `searchPath` 为 `”db://”` 或 `”db:”` 时，自动纠正为 `”db://assets”`，确保搜索能够正常执行。

---

## 菜单执行幻觉修复 (2026-04-14)

### 1. `execute_menu_item` 防幻觉改造

- **问题**: 在找不到映射关系时，代码试图盲猜并强制调用 `Editor.Ipc.sendToMain(“menu:click”, menuPath)`，虽然此 IPC 并不存在且不会获得结果，但在当前逻辑下最终仍会返回成功。这种静默阻塞极大地引发了大模型陷入自我欺骗的连续幻觉并阻碍工具链推进。
- **修复**: 正式切除对该”不存在动作”的尽力而为模拟尝试。当发生非预设路径请求时，立即回调返回中断信号，严正通报不支持的行为，促使 AI 回到正确的执行路线。

---

## 新增功能与工具 (2026-02-10)


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

## 关键问题修复 (Technical Post-mortem) (2026-02-10)

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

## 文档与规范化建设 (2026-02-10)

### 1. 全域本地化 (Simplified Chinese)

- **代码注释**: 将 `main.js` 和 `scene-script.js` 中所有关键逻辑的英文注释转换为准确的中文说明。
- **JSDoc 补充**: 为核心函数补充了详尽的 JSDoc 参数说明，提升代码可读性。
- **日志输出**: 所有控制台日志 (`addLog`) 和错误提示均已中文化，方便国内开发者排查。

### 2. AI 安全守则 (Safety Rules)

- **守则注入**: 在所有 MCP 工具的描述中注入了【AI 安全守则】，强调“先校验再操作”、“资源赋 UUID”等原则。
- **Schema 优化**: 优化了工具的描述文本，使其在 AI 客户端（如 Cursor）中展现更清晰的引导。

---

## 纹理与节点变换增强 (Texture & Transform Updates) (2026-02-10)

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

## 总结 (2026-02-10)

本次更新不仅修复了制约生产力的材质与资源同步 bug，还通过引入 `manage_shader` 和全方位的文档中文化，极大提升了开发者（及 AI 助手）在 Cocos Creator 2.4.x 环境下的操作体验。针对菜单执行工具的清理进一步规范了自动化操作流程，减少了潜在的不稳定性。

---

## 并发安全与防卡死机制 (2026-02-12)

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

## Token 消耗深度优化 (2026-02-24)

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

## 脚本管理修复与强化 (2026-02-25)

### 1. `manage_script` 路径引用错误修复

- **问题**: AI 在调用 `manage_script` 工具执行 `create` 创建脚本时，出现 `path is not defined` 报错。
- **原因**: 传入的变量 `path` 已经被解构重命名为 `scriptPath`，而在后续获取物理路径时，错误地调用了 `path.dirname()`，导致引用错误。
- **修复**: 将 `path.dirname` 修正为全局正确引入的 `pathModule.dirname`，彻底解决了使用此工具生成自定义脚本库时的崩溃问题。

### 2. 强制生成 Script Meta 文件的提示词 (Prompt) 优化

- **问题**: AI 助手创建或修改脚本后，若不主动触发系统刷新，后续试图通过 `manage_components` 将该新脚本挂载为组件时，会由于缺乏有效的 `.meta` 扫描和 UUID 索引而失败。
- **优化**: 在 `main.js` 中的 `manage_script` 工具 `description` 提示词中，将原本建议性质的刷新语气，修改为严格指令：“**创建后必须调用 refresh_editor (务必指定 path) 生成 meta 文件，否则无法作为组件添加**”。
- **效益**: 在不增加 Token 开销的前提下，强制规范了大语言模型的行为，保障了脚本创建到组件挂载工作流的健壮性。

---

## AI 幻觉容错与调试体验增强 (2026-02-25)

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
- **价值**: 通过将冰冷的底层异常翻译为"手把手教 AI 怎么重试"的指导性异常，彻底根治了 AI 在操作组件时乱认对象、反复撞墙的通病。

---

## 面板加载修复 (2026-02-24)

### 1. `panel/index.js` 语法错误修复

- **问题**: 面板加载时出现 `SyntaxError: Invalid or unexpected token`，导致 MCP Bridge 插件面板完全无法渲染。
- **原因**: `index.js` 中存在非法字符或格式错误，被 Cocos Creator 的面板加载器拒绝解析。
- **修复**: 清理了文件中的语法问题，确保面板能够正常加载和初始化。

---

## 防止核心属性被篡改崩溃 (2026-02-26)

### 1. `manage_components` 核心属性保护

- **问题**: AI 助手在使用 `manage_components` 尝试修改 `Label` 位置时，错误地对组件传参 `{ node: { position: ... } }`，导致 Label 的 `this.node` 强引用被覆写为普通对象。引发渲染报错 (`Cannot read property 'a' of undefined`) 和删除卡死 (`this.node._removeComponent is not a function`)。
- **修复**: 在 `scene-script.js` 的 `applyProperties` 中增加了核心属性黑名单机制。强制拦截对 `node`, `uuid`, `_id` 的直接写入并给出警告。彻底杜绝由于组件的节点引用被破坏所引发的场景崩溃和编辑器卡死问题。

### 2. 资源管理层 `save` 动作幻觉别名兼容

- **问题**: AI 偶尔会幻觉以为 `prefab_management`/`manage_script`/`manage_material`/`manage_texture`/`manage_shader` 的更新动作为 `save`，而不是标准定义的 `update` 或 `write`，导致抛出"未知的管理操作"报错。
- **修复**: 在 `main.js` 所有这些管理工具的核心路由表中，为 `update` 和 `write` 操作均显式添加了 `case "save":` 作为后备兼容，极大地增强了不同大模型在不同提示词上下文环境下的操作容错率。

---

## 素材库与面板工具优化 (2026-02-26)

### 1. 材质与 SpriteFrame 赋值增强

- **问题**: 虽然支持了加载 Texture2D，但如果 AI 传给 `Sprite.spriteFrame` 属性的是原生贴图 UUID，在 `scene-script.js` 层面直接强转为 `new cc.SpriteFrame(asset)` 容易丢掉原图片配置信息，例如九宫格参数。
- **重构**: 新增底层 IPC 消息 `query-spriteframe-uuid`。现在当场景脚本识别到目标属性为精灵材质时，会通过跨进程向主进程查询目标 UUID 关联物理文件所属的 `.meta`。提取真实的 `subMetas` 内 SpriteFrame 的长 UUID 并返回。之后再基于该长 UUID 调用标准的 `loadAsset`。彻底保证资源结构的稳定性。

### 2. 测试面板输出全量解析

- **问题**: 为了防止大体积结构传递给 AI 时引发 OOM 截断崩溃，`main.js` 后台强行限制了所有日志向 Webview 输出的边界值 (默认不超过 100~500 字符)，导致人类开发者从面板查看时无法追溯长内容如 Base64 和完整序列化返回值。
- **修复**: 拆分了拦截逻辑。剔除 `argsPreview` 与 `preview` 针对主面板渲染视图输出 `addLog` 时的预备阶段的 `substring` 剪裁。如今编辑器 UI 内将能看到完整、原生的调用参数和回调结果，而对于通过 HTTP 接口返还给 AI 的载荷依然安全拦截。

## 日志系统持久化与健壮性优化 (2026-02-27)

### 1. 日志文件持久化

- **问题**: 插件的所有运行日志只保存在内存中（`logBuffer`），编辑器重启后日志全部丢失，无法进行会话级别的问题回溯。
- **优化**: 在 `main.js` 的 `addLog` 函数中新增文件写入逻辑。所有日志实时追加写入项目目录下的 `settings/mcp-bridge.log` 文件（懒初始化路径）。
- **实现细节**:
    - 新增 `getLogFilePath()` 辅助函数，通过 `Editor.assetdb.urlToFspath` 推导项目根目录，将日志存放在 `settings/` 子目录中。
    - 日志格式统一为 `[时间戳] [类型] 内容`，与面板日志保持一致。
    - 文件写入使用 `fs.appendFileSync` 同步追加，失败时静默不影响主流程。

### 2. 日志缓冲区内存保护

- **问题**: 长时间运行的编辑器会话中，`logBuffer` 数组无限增长，最终导致内存压力。
- **优化**: 在 `addLog` 中增加上限检查，当日志条数超过 2000 时自动截断旧日志，仅保留最近 1500 条。

### 3. 请求关联计数器 (`_requestCounter`)

- **优化**: 新增全局 `_requestCounter` 变量，为每个 HTTP 请求分配唯一的自增序号，便于在高并发场景下追踪同一请求的完整生命周期（从入队到执行到响应）。

### 4. CommandQueue 兜底超时保护

- **问题**: 原有的 `processNextCommand` 队列机制依赖每个指令主动调用 `done()` 回调来释放队列。如果某个工具函数内部逻辑异常导致 `done()` 未被调用，整个队列将永久停滞。
- **优化**: 在 `enqueueCommand` 中为每个入队指令注册 60 秒兜底超时定时器 (`setTimeout`)。超时后强制释放队列位置并记录错误日志 `[CommandQueue] 指令执行超时(60s)，强制释放队列`，确保后续指令不被阻塞。
- **正常路径**: 指令正常完成时通过 `clearTimeout` 取消定时器，无额外开销。

### 5. 日志仅输出关键信息到编辑器控制台

- **优化**: `addLog` 函数不再将所有类型的日志输出到编辑器控制台，仅 `error` 和 `warn` 级别日志通过 `Editor.error()` / `Editor.warn()` 输出，防止 `info` / `success` / `mcp` 类型日志刷屏干扰开发者。

---

## 性能与可靠性优化 (2026-02-28)

### 1. CommandQueue 超时保护恢复

- **问题**: 合并冲突解决时 `enqueueCommand` 中的 60 秒兜底超时保护代码丢失，导致如果工具函数内部异常未调用 `done()`，整个指令队列将永久停滞，后续所有操作将卡死不再响应。
- **修复**: 在 `enqueueCommand` 中为每个入队指令注册 `setTimeout(60000)` 超时定时器，正常完成时通过 `clearTimeout` 取消。

### 2. HTTP 请求体大小限制

- **问题**: `_handleRequest` 中 `body += chunk` 无上限保护，超大请求体（恶意或异常客户端）可能耗尽编辑器进程内存。
- **修复**: 新增 5MB (`5 * 1024 * 1024`) 请求体上限，超出时返回 HTTP 413 并销毁连接。

### 3. 日志文件轮转机制

- **问题**: `settings/mcp-bridge.log` 文件持续追加写入，长期使用会无限增长占用磁盘空间。
- **修复**: 在 `getLogFilePath()` 初始化时检查文件大小，超过 2MB 自动将旧日志重命名为 `.old` 备份后创建新文件。

### 4. 清理冗余调试日志

- **问题**: `scene-script.js` 中 `update-node-transform` 和 `applyProperties` 共有 8 处 `Editor.log` 调试日志，每次操作都输出到编辑器控制台造成刷屏。
- **修复**: 移除所有冗余 `Editor.log` 调试输出，保留必要的 `Editor.warn` 警告（如资源加载失败、属性解析失败等）。

### 5. `applyProperties` 逻辑修复

- **问题**: `applyProperties` 启发式资源解析分支中使用了 `return` 而非 `continue`，导致处理到该分支后会直接退出整个 `for...of` 循环，跳过后续属性的设置。
- **修复**: 将 `return` 改为 `continue`，确保多属性同时更新时所有属性都能被正确处理。

### 6. `instantiate-prefab` 统一使用 `findNode`

- **问题**: `instantiate-prefab` 中查找父节点直接调用 `cc.engine.getInstanceById(parentId)`，绕过了 `findNode` 函数的压缩 UUID 解压与兼容逻辑。
- **修复**: 统一改用 `findNode(parentId)`，确保所有场景操作对压缩和非压缩 UUID 格式的兼容性一致。

---

## 编辑器体验与容错增强 (2026-02-28)

### 1. SpriteFrame 智能识别与自动转换

- **问题**: 当 AI 大模型尝试给 `cc.Sprite` 等组件的 `spriteFrame` 属性赋值时，常常会错误传递为其父级 `Texture2D` (原图) 的 UUID。Cocos 引擎由于类型不匹配会导致赋值无效，且静默失败（或陷入 IPC 死锁导致编辑器卡死）。
- **优化**: 在 `scene-script.js` 中的 `applyProperties` 环节新增了类型容错机制。当识别到传入的 UUID 对应 `Texture2D` 但该属性（例如含 `sprite` 关键字）需要 `SpriteFrame` 时，脚本会利用 Node.js `fs` 直接读取对应的 `.meta` 文件，提取出实际子资源 (`SpriteFrame`) 的正确 UUID，从而实现自动转换与安全赋值。
- **降级**: 若自动转换失败（如 `meta` 结构改变或读取失败），则会通过 `Editor.warn` 在控制台明确提示类型错误，拦截强制赋值操作，彻底消除潜在的隐性崩溃。

---

## 预制体创建 IPC 调用签名修复 (2026-02-28)

### 1. `create_prefab` IPC 调用方式修复 (`src/main.js`)

- **问题**: `create_prefab` 工具调用创建预制体时，控制台报 `Error: Invalid path: null` 和 `TypeError: e.reply is not a function`，预制体创建失败。
- **原因**: 原代码使用了错误的 IPC 调用签名：
    - ❌ `Editor.Ipc.sendToMain("scene:create-prefab", nodeId, fullFilePath)` — 错误使用了 `sendToMain`，且参数格式不正确。
- **修复**: 修正为 Cocos Creator 2.4.x 的正确签名：
    - ✅ `Editor.Ipc.sendToPanel("scene", "scene:create-prefab", [nodeId], dirPath)` — 三个关键修正：
        1. 使用 `sendToPanel` 而非 `sendToMain`（该消息由 Scene 面板的渲染进程处理）。
        2. 节点 ID 必须包裹在数组中 `[nodeId]`（支持多选创建场景）。
        3. 第二个参数必须是 **目录路径**（如 `db://assets`），而非完整文件路径（如 `db://assets/XXX.prefab`）。
- **补充**: 创建前先通过 `scene:set-property` 将节点重命名为目标预制体名称，确保生成的 `.prefab` 文件名与节点名一致。

### 2. `prefabManagement` 创建功能 `targetDir` 未定义修复 (`src/main.js`)

- **问题**: `prefabManagement` 的 `create` 分支中，`targetDir` 变量在使用时未被定义，导致创建预制体时目录路径为 `undefined`。
- **修复**: 在使用前从 `prefabPath` 中正确提取目录路径：`const targetDir = prefabPath.substring(0, prefabPath.lastIndexOf("/"))`。

---

## 引用查找与资源 UUID 自动解析 (2026-03-01)

### 1. 新增 `find_references` 工具

- **功能**: 查找当前场景中引用了指定节点或资源的所有位置。支持节点引用 (`cc.Node`) 和资源引用 (`cc.Prefab`, `cc.SpriteFrame`, `sp.SkeletonData` 等)。
- **实现**:
    - 在 `src/scene-script.js` 中新增 `find-references` IPC 处理函数，递归遍历场景所有节点的所有组件属性，检查属性值是否引用了目标对象。
    - 支持直接属性值、数组元素、`EventHandler.target` 的深层检查。
    - 在 `src/main.js` 中新增工具定义和路由。
- **返回结构**: 包含 `targetId`、`targetType` (检测类型)、`referenceCount` (引用计数) 和详细的 `references` 数组，每项包含引用所在节点、组件类型、属性名等信息。

### 2. UUID 格式自动规范化

- **问题**: Cocos Creator 2.x 中 `cc.Asset._uuid` 使用 22 位压缩格式，而 `Editor.assetdb` 返回标准 36 位带连字符格式，直接字符串比较无法匹配。
- **修复**: 在 `find-references` 处理函数中通过 `Editor.Utils.UuidUtils` 预计算目标 UUID 的压缩和解压格式，将所有变体存入 `targetVariants` 数组进行全量匹配。

### 3. Texture2D -> SpriteFrame 子资源 UUID 自动解析

- **问题**: AI 传入图片 (Texture2D) 的 UUID 时，`cc.Sprite.spriteFrame` 实际引用的是该图片的子资源 SpriteFrame（具有不同的 UUID），导致直接查找返回空结果。
- **修复**: 在 `src/main.js` 的 `find_references` 路由中，调用 scene-script 前自动读取目标 UUID 对应资源的 `.meta` 文件，提取所有 `subMetas` 中的子资源 UUID (如 SpriteFrame)，作为 `additionalIds` 传递给 scene-script。scene-script 将这些额外 UUID 及其压缩/解压变体一并加入匹配列表，实现 "传入 Texture2D UUID 也能查到 SpriteFrame 引用" 的透明体验。

---

## 节点变换属性修复与数据增强 (2026-03-01)

### 1. `update-node-transform` 属性设置方式修复 (`src/scene-script.js`)

- **问题**: `update-node-transform` 中 `x`, `y`, `width`, `height`, `scaleX`, `scaleY` 六个属性通过异步 IPC `Editor.Ipc.sendToPanel("scene", "scene:set-property", ...)` 设置，存在 fire-and-forget 问题，函数在属性实际生效前就已返回成功回复。导致宽高不生效（Sprite 的 sizeMode 可能在异步消息到达前重置）、坐标不生效（异步 IPC 竞态条件）、批量操作属性丢失等问题。
- **修复**: 将所有属性设置统一改为在 scene-script（渲染进程）中直接对节点属性同步赋值（如 `node.x = Number(x)`），与 `set-property` 和 `create-node` 中的处理方式保持一致。`color` 同步改为直接赋值 `node.color = new cc.Color().fromHEX(color)`。
- **已验证**: 全部 7 个属性（x, y, width, height, scaleX, scaleY, color）批量设置后均即时生效。

### 2. `update_node_transform` 工具参数扩展 (`src/main.js` + `src/scene-script.js`)

- **问题**: 编辑器属性面板中的 Rotation、Anchor、Opacity、Skew 四类属性无法通过 `update_node_transform` MCP 工具设置和获取。
- **修复**:
    - 在 `src/main.js` 的工具 `inputSchema` 中新增 `rotation`, `anchorX`, `anchorY`, `opacity`, `skewX`, `skewY` 六个参数定义。
    - 在 `src/scene-script.js` 的 `update-node-transform` 处理函数中新增对应的直接赋值逻辑（`node.angle`, `node.anchorX`, `node.anchorY`, `node.opacity`, `node.skewX`, `node.skewY`）。
- **已验证**: 全部 13 个属性（x, y, rotation, width, height, scaleX, scaleY, anchorX, anchorY, color, opacity, skewX, skewY）批量设置后均即时生效。

### 3. `get_scene_hierarchy` 节点详情数据增强 (`src/scene-script.js`)

- **问题**: `includeDetails` 模式仅返回 position, scale, size 三类数据，缺少 rotation, anchor, color, opacity, skew, group 信息，无法通过 API 完整验证节点属性。
- **修复**: 在 `dumpNodes` 函数的 `includeDetails` 分支中新增六个返回字段：
    - `rotation`: `node.angle`
    - `anchor`: `{ x: node.anchorX, y: node.anchorY }`
    - `color`: `{ r: node.color.r, g: node.color.g, b: node.color.b }`
    - `opacity`: `node.opacity`
    - `skew`: `{ x: node.skewX, y: node.skewY }`
    - `group`: `node.group`
- **效果**: `includeDetails` 现在返回与编辑器属性面板完全一致的所有节点属性。

### 4. Scene 面板未就绪友好提示 (`src/main.js`)

- **问题**: 插件重载或场景切换期间调用 scene-script 方法时，原始错误 `Error: ipc failed to send, panel not found` 信息晦涩，容易让用户误以为插件出现严重故障。
- **修复**: 在 `callSceneScriptWithTimeout` 的回调中检测 `panel not found` 错误，自动替换为友好中文提示：`场景面板尚未就绪（可能正在重载插件或切换场景），请等待几秒后重试`。日志级别从 `error` 降为 `warn`。

---

## 预制体序列化格式修复 (2026-03-02)

### 1. `create-prefab` 序列化输出格式修复 (`src/scene-script.js`)

- **问题**: 通过 `create_prefab` 工具创建的预制体虽然不报错，但文件内容格式不正确，导致在编辑器中打开或使用时出现异常行为。
- **原因**: `Editor.serialize(node)` 输出的是**场景格式**而非**预制体格式**，具体表现为：
    1. ❌ 数组首元素为 `cc.Node` 而非 `cc.Prefab` 包装器。
    2. ❌ 包含 `cc.Scene` 对象，根节点 `_parent` 指向 Scene。
    3. ❌ 所有节点的 `_prefab` 字段为 `null`，缺少 `cc.PrefabInfo`。
    4. ❌ 节点保留了运行时 `_id` 值（如 `"f6WlEh4IdCcKIheBW4zwk5"`），而预制体中应为空字符串。
- **修复**: 在 `src/scene-script.js` 中重写 `create-prefab` 处理器，增加 9 步后处理管线将场景格式数据转换为标准预制体格式：
    1. 解析 `Editor.serialize()` 返回的 JSON。
    2. 识别并移除 `cc.Scene` 对象。
    3. 构建旧索引到新索引的映射表。
    4. 添加 `cc.Prefab` 根包装器（索引 0，`data` 指向根节点）。
    5. 更新所有 `__id__` 引用为新索引。
    6. 修复根节点 `_parent` 为 `null`。
    7. 清空所有节点的 `_id` 为空字符串。
    8. 为每个 `cc.Node` 生成 `cc.PrefabInfo`（含唯一 `fileId`、`root` 指向根节点、`asset` 指向 `cc.Prefab`）。
    9. 序列化为 JSON 字符串返回。
- **验证**: 创建的预制体文件结构与编辑器原生拖拽创建的预制体完全一致，可正常打开编辑、实例化使用，控制台零报错。

ps: 感谢 @亮仔😂 😁 🐔否？ 提供的反馈以及操作日志

---

## 性能优化与防御性增强 (2026-03-04)

### 1. JSON 响应压缩输出 (`src/main.js`)

- **问题**: MCP 工具调用返回结果时使用 `JSON.stringify(result, null, 2)` 格式化输出，凭空增加约 20-40% 的响应体积，消耗额外 Token 且对 AI 工具毫无意义。
- **修复**: 移除缩进参数，改为 `JSON.stringify(result)` 压缩输出。
- **效果**: 响应体积减少 20-40%，直接降低 AI 模型的 Token 消耗成本。

### 2. 指令队列长度限制 (`src/main.js`)

- **问题**: `commandQueue` 数组无最大长度限制，理论上在极端情况下可能无限增长。
- **修复**: 新增 `MAX_QUEUE_LENGTH = 100` 常量。`enqueueCommand` 入口检查队列长度，超限时直接 reject 并返回 HTTP 429 状态码，同时记录告警日志。
- **保护**: 在 `enqueueCommand` 调用处补充 `.catch()` 处理 reject，确保 HTTP 响应正常关闭，避免 unhandled promise rejection。

### 3. 层级树子节点数量上限 (`src/scene-script.js`)

- **问题**: `get-hierarchy` 的 `dumpNodes` 递归遍历子节点时无数量限制，若某个节点下有数百个同级子节点，返回数据量巨大。
- **修复**: 新增 `MAX_CHILDREN_PER_LEVEL = 50` 安全上限。每层最多返回 50 个子节点，超出部分在返回数据中通过 `childrenTruncated` 字段标注被截断的数量，帮助 AI 知悉还有更多子节点未列出。

---

## 预制体全生命周期编辑与状态流转修复 (2026-03-08)

### 1. `save_prefab` 与 `close_prefab` 原生化改造

- **问题**: AI 尝试从 `McpTestPrefab.prefab` 等文件中通过 `scene:save-prefab` 和 `scene:close-prefab` 保存并退出预制体模式时，报错找不到事件。分析源码发现，这些直觉上的 IPC 消息实际上并不存在，导致一旦用 `open_prefab` 进入隔离的编辑空间后，无法正确将修改落盘，且无法安全退出返回原大场景。
- **修复**:
    1. **直接调用内部 API**: 完全废弃尝试通过常规 IPC 发送伪装指令的想法。在 `scene-script.js` 内部直接 `require("scene://edit-mode")`，获取到负责管理场景所有状态机（如大场景模式、预制体模式、动画编辑模式）的核心模块。
    2. **真实状态机驱动**:
        - 对于 `save_prefab`，直接调用无参的 `editMode.save()`。这100%等同于人工点击编辑器左上角的“保存”按钮。也因此**移除了多余的 `rootNodeId` 参数**限制。
        - 对于 `close_prefab`，直接调用 `editMode.pop()`。彻底将当前编辑的预制体上下文从堆栈中弹出，干净利落地回落回原始场景，并自动更新引擎各面板 (Inspector、层级管理器等) 状态。
- **意义**: 到目前为止，涵盖**创建 (`create_prefab`) -> 打开 (`open_prefab`) -> 修改 -> (可选)保存 (`save_prefab`) -> 退出 (`close_prefab`)** 的完整大模型端到端自动化预制体流水线被彻底打通。没有任何妥协，一切就像是有一个看不见的高手坐在引擎主控面板前帮你点按按钮。

---

## 终极嵌套资源创建修复 (V8 Atomic Cascade Import) (2026-03-13)

### 1. 根除微秒级 `fs` 目录竞态引发的 UUID 碰撞

- **问题**: 在用 MCP 创建包含多级未注册目录深度的子资源资产（如 `manage_texture` 创建含 `SpriteFrame` 的图片）时，`Editor.assetdb.create` 无跨级建目录能力且伴随异步崩溃。早期替代方案 (V6) 使用 Node `fs.mkdirSync` 预建物理文件夹，但不可避免地与底层 DB Watcher 监视器发生微秒级竞态，导致 UUID 互相倾轧爆错，资产被抛弃退化为根目录孤儿节点。
- **修复**: 彻底抛弃物理空间直接侵入式的节点创建。设计了终极的 V8“原子级联导入”体系 (`Atomic Cascade Import`)：
    1. 通过向上迭代查询，精确找出当前 AssetDB 内部真实且已有的最底端锚点文件夹。
    2. 巧妙使用操作系统级垃圾区 `os.tmpdir()` 建立起与 Cocos Watcher 彻底隔离的沙盒。在这个沙盒内放肆地 1:1 建立缺失的长效目录树及写入资源本体。
    3. 通过 `Editor.assetdb.import` 这个原生且专用于“处理纯外部未处理拖拽”的超级接口，将包含资源本体的微型假树完整、一次性原子化导入至定好锚点的真实路径下。引擎的任务管线会自然屏蔽掉内部过程并生成所有附带的 UUID 与 `subMetas`。
- **效果**: 实现对包含材质、Shader、贴图和预制体的极深级并发跨层级矩阵测试，**100% 免疫竞态引发的任何错误和冲突**。至此，“UUID Collision”与“is not exists”的历史遗留疑难杂症彻底清盘。

---

## 智能 Canvas-Aware UI 架构升级 (2026-03-26)

### 1. 场景创建模板升级 (`getNewSceneTemplate`)

- **功能**: 重构了 `create_scene` 的模板返回策略，将纯空数组替换为了模拟编辑器内置 `new-scene.fire` 的基础结构。
- **效果**: 新创建的场景现在出厂自带 `Canvas` 节点（默认配置 `960x640` 设计分辨率结构）和 `Main Camera` 节点，并为其生成了独立唯一的随机 UUID。保障了新建场景开箱即用。

### 2. UI 节点智能挂载 (Canvas Sniffing)

- **问题**: AI 生成的 UI 元素（Sprite、Label、Button）如果不带 `parentId`，会被直接挂载到 Scene 根目录。非预期的挂载会导致这些 UI 在屏幕中脱离 Canvas 比例缩放控制，出现失真或溢出。
- **修复**: 在 `scene-script.js` 的 node 创建流程中新增自动嗅探逻辑。当检测到产生针对UI的类型请求且为空 `parentId` 时，代码将扫描挂载树并通过 `cc.director.getScene().getComponentInChildren(cc.Canvas)` 将其强行绑定并派生至存在的基础大幕布（Canvas）下。

### 3. 本地组件自动排版引擎 (Auto Widget Layout)

- **功能**: 在 `create_node` 工具定义中加入了 `layout` （如 `center`, `bottom-right`, `full`）面向人类直觉语义的宏参。
- **效果**: 创建完毕后自动为该节点依附 `cc.Widget` 模块。
- **致命坑点防御 (Vital Transform Fix)**: 
  - 过去在脚本注入对齐约束完成时，试图调用 `widget.updateAlignment()` 在同一帧刷新坐标，直接诱发了 `Editor Viewport` 在当前未满刷新状态带来的底层世界矩阵(World Transform Matrix) 数据被引擎内部反写并篡改对齐边距的问题，最终导出可怕的 2x 屏幕尺寸溢出（例如计算 405 正确但受脏数据重算变成了 810）。
  - **当前策略**: 只注册 Widget 的边距挂载逻辑但不触发当帧对齐，放手交给游戏引擎的异步渲染生命周期自己执行 Widget 队列结算。经过严实验证，运行时自适应对齐与编辑器设计视窗内的坐标展示已达成 100% 校准（"完美位置" 体验）。

### 4. IPC 后处理情报反馈

- **功能**: 组件及节点的构造结果不仅上报 UUID，同时通过 IPC 高效附上落点区域的解析报告（例如报告所依附的 Canvas 它的设计坐标与当前实时 Size），以便大语言模型即刻掌控全局视图坐标结构，减少后续调优瞎猜的次数。

---

## 主进程 API 健壮性与兼容防范 (2026-03-30)

### 1. AssetDB 查询接口后备降级 (`manage_asset`)

- **问题**: AI 调用 `manage_asset` 获取资源信息时，所依赖的 `Editor.assetdb.queryInfoByUrl` 被证实在不同编辑器的 IPC 代理层或特定版本中断言缺失，导致 `TypeError: Editor.assetdb.queryInfoByUrl is not a function` 报错使得获取流程阻断。
- **修复**: 
  - 引入了引擎对象级别的运行时防御拦截(`!Editor.assetdb`)。
  - 引入了方法探针检查(`typeof queryInfoByUrl === 'function'`) 决定是否调用。
  - 若探测到缺失，则实施安全降级处理：先行抽出资源的 UUID (`urlToUuid`)，再通过更为泛用的原生方法 `queryInfoByUuid` 完成请求闭环。
- **效果**: 彻底清除了对资源查询时容易出现的各种空指针与未定义方法崩溃，同时修复完善了在知识库文档中的幻觉推断。

## 节点变换增强与 Bug 修复 (2026-03-27)

### 1. `update-node-transform` 支持 `active` 参数

- **问题**: `update-node-transform` 中遗漏了对节点显隐 (`active`) 的参数处理，AI 无法直接修改节点的激活状态。
- **修复**: 在 `src/scene-script.js` 的 `update-node-transform` 处理器中添加了对 `args.active` 的处理逻辑 (`node.active = !!args.active;`)。
- **致谢**: 感谢社区245781780反馈并提供修复方案！

---

## 自动化工具链配置 (2026-04-05)

### 1. 新增 MCP 客户端自动化配置扫描与注入 (`auto-mcp-settings`)

- **功能**: 添加了一键扫描并向宿主端 AI 平台（如 Claude, Trae, Antigravity 等）注入 MCP 本地服务地址到其全局配置文件的功能。
- **UI 面板**: 在测试面板中新增"MCP 配置"选项卡，提供直观的下拉列表以及系统配置破坏检测分析机制。
- **原理解耦**: 新增底层逻辑 `src/McpConfigurator.js`。通过增加数个不涉及操作场景渲染周期的纯 Node.js I/O 的 IPC 总线解决写入需求，百分百不引入架构风险。
