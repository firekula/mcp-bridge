# 更新日志 (UPDATE_LOG)

## [1.3.4] - 2026-07-24

### Fixed & Feature
- **Codex 配置路径与 TOML 格式适配**：更正 Codex 配置文件路径为标准 `~/.codex/config.toml` (TOML 格式)，实现 TOML 区块 (`[mcp_servers.mcp-bridge]`) 精准匹配与安全增量合并，解决全量写入导致 Codex 原全局配置丢失的问题。
- **Zed 编辑器格式与键名适配**：修正 Zed 配置文件路径为 `settings.json`，并将根节点更新为 Zed 官方指定的 `context_servers` 键名。
- **配置写入前自动备份 (.bak)**：所有 AI 客户端在注入配置前统一增量生成同名 `.bak` 备份文件（如 `config.toml.bak` / `settings.json.bak`），保障用户配置文件不丢失。
- **JSON 深度增量合并**：JSON 配置注入时保留用户既有的全部根节点属性（如主题、字体、按键绑定等），避免全量覆盖。

## [1.3.3] - 2026-07-15

### Changed
- **默认端口改为 8200**：将 HTTP 服务器默认端口从 3456 改为 8200，规避 Windows Hyper-V/WSL 端口排除范围（3441–3540）导致的 `EACCES` 权限拒绝错误。扫描范围同步从 3456–3466 调整为 8200–8210。
- **服务器绑定地址改为 127.0.0.1**：MCP 服务仅需本地回环通信，绑定 `0.0.0.0` 会与 Hyper-V NAT 端口保留机制冲突，改为 `127.0.0.1` 彻底消除该问题。

### Fixed
- **EACCES 端口绑定错误修复**：`HttpServer` 错误处理器原先仅处理 `EADDRINUSE`（端口被占用），未处理 Windows 端口排除范围返回的 `EACCES`。现在 `EACCES` 与 `EADDRINUSE` 统一处理，自动滚动到下一端口重试。

### Security
- **未激活项目工具隔离**：未通过 `set_active_instance` 激活项目前，`tools/list` 仅返回 `get_active_instances` 和 `set_active_instance` 两个基础管理工具。离线编辑工具（`modify_prefab_offline`、`modify_scene_offline`）及其他编辑器工具必须在激活项目后方可使用，防止未授权访问项目文件。

## [1.3.2] - 2026-07-12

### Changed
- **设置面板布局重构与宽窄自适应**：重构「MCP 配置」设置页的 HTML 为双卡片 Flexbox 容器布局。在横屏或较宽的窗口中，两个配置组以双列卡片并排显示，提高信息密度并消除水平无限制拉伸的缺陷；在窄屏状态下自动堆叠。保持所有原表单和按钮的 DOM ID 绑定不变，复用已有 JS 代码逻辑，并实现对矮窗口的滚动条适配。

## [1.3.1] - 2026-07-12

### Changed
- **按钮点击黑圈缺陷修复与配色还原**：将设置面板中的 `<ui-button>` 整体重构为标准的 HTML5 `<button>`，并将事件监听由 `"confirm"` 改为 `"click"`，彻底杜绝了由于内置控件 Shadow DOM 聚焦导致的内凹黑框缺陷；同时复原了原版的深灰色配色体系，并为灰色、绿色、红色按钮增加了专属 Hover 变亮与 Active 按下变暗的视觉反馈。

## [1.3.0] - 2026-07-02

### Feature & Performance

- **截图性能调优 (MacBook 发热优化)**：限制高 DPI 视网膜（Retina）屏幕下的截图尺寸上限，支持在主进程中等比例 resize 缩放图片（默认上限 1280px），大幅降低大图 Base64 编码的 CPU 耗时；
- **截图节流缓存控制**：支持设置默认 1500ms 的截图防抖节流保护，防止 AI 客户端高频密集请求截图导致 GPU 过热发热。
- **指令高精度耗时与慢指令告警**：在 McpRouter 层面记录工具真实执行耗时（排除在 CommandQueue 中的排队等待时间），对执行超过 1000ms 的慢操作打印警告日志，同时收集并输出加载时的系统指纹日志，辅助定位硬件瓶颈。
- **写操作缓存清除**：添加针对写操作工具（如 `update_node_transform`, `create_node` 等）的联动，在写操作成功时主动清空截图节流缓存，保证下次截图时必定能拉取最新的场景状态，消除状态不同步问题。
- **可视化性能配置 UI**：在插件的「MCP 配置」页签中新增“性能与截图优化”控制模块，支持图形化配置截屏限制宽度和防抖节流毫秒数，并支持 Editor.Profile 项目级配置本地持久化存储。
## [1.2.4] - 2026-07-01
### Feature
- **离线场景修改工具 (modify_scene_offline)**:
  - 新增 `modify_scene_offline` MCP 工具，将离线编辑能力从预制体 (.prefab) 扩展到场景文件 (.fire)。
  - 泛化 `OfflinePrefabEditor` 引擎，自动识别 `cc.SceneAsset` 与 `cc.Prefab` 两种入口格式，共享全部 8 大声明式原子操作（update_property、add_node、remove_node、clone_node、reorder_child、add_component、remove_component、set_reference）。
  - 场景模式下新增节点不生成 `cc.PrefabInfo`，避免引擎反序列化报错。
  - 支持"无中生有"自动创建空场景骨架。

### Changed
- `OfflinePrefabEditor.findNodeByPath` 重构为双类型入口检测（`cc.Prefab` / `cc.SceneAsset`），保持预制体功能完全向后兼容。

## [1.2.3] - 2026-06-09
### Feature
- **离线预制体修改工具 (modify_prefab_offline) 重大功能增强**:
  - **自定义脚本 UUID 自动压缩适配**：内置 Cocos Creator 特有的 r=5 UUID 压缩算法，自动将 36 位标准 UUID 压缩转换为 23 位格式，解决离线挂载自定义脚本时编辑器显示为 `cc.MissingScript` 的缺陷。
  - **平铺对象自动提升平铺 (Lift & Flat)**：新增 `liftObject` 属性过滤与提升机制。当检测到 `cc.ClickEvent` 等非内联 `cc.Object` 对象时，自动在预制体平铺 JSON 尾部进行提升声明，并通过 `{ "__id__": x }` 重算索引进行关联引用，自动补齐 `_componentId` 参数并清空 `component` 字段，100% 还原引擎反序列化格式。
  - **组件与资源检索兼容性**：扩展组件查找与引用设置（`add_component`、`remove_component`、`set_reference`、`update_property`），全面支持 UUID 的原始格式与压缩格式自动解析。

## [1.2.2] - 2026-05-29

### Fixed

- **预制体根节点错误修复**: 修复 `create_prefab` / `prefab_management` 创建的预制体内部根节点永远为 Canvas 而非目标节点的问题。
  > **根因分析**：`Editor.serialize(node)` 在 Cocos Creator 2.x 中会从场景根节点开始序列化整个场景树，无论传入哪个节点，序列化输出的第一个 `cc.Node` 始终是场景根节点（Canvas）。后处理管线以第一个 `cc.Node` 作为预制体根节点，导致预制体内部永远包含 Canvas 及其完整祖先链。
  > **修复方案**：在 scene-script 的 `create-prefab` 中，调用 `Editor.serialize()` 之前将目标节点临时 detach（`node.parent = null`），欺骗序列化器使其仅序列化目标节点及其子树。序列化完成后立即恢复 `node.parent` 和 `node.name`，保证场景状态不受影响。同时将节点重命名逻辑从不可靠的异步 IPC（`scene:set-property` + `setTimeout(300ms)`）移至 scene-script 内部同步执行，消除竞态条件。

### Changed

- **`_createPrefabViaSceneScript` 签名变更**: 新增 `nodeName` 参数，传递给 scene-script 的 `create-prefab` 方法，用于在序列化前同步设置根节点名称。
- **移除异步重命名**: `create_prefab` 和 `prefab_management` (create) 两个入口不再通过 `Editor.Ipc.sendToPanel("scene", "scene:set-property", ...)` 异步重命名节点，改为由 scene-script 内部同步处理。

## [1.2.1] - 2026-05-20

### Fixed

- **刷新编辑器死锁修复**: 彻底解决 `refresh_editor` 对目录级路径执行 `Editor.assetdb.refresh()` 导致编辑器卡死的问题。
  > **根因分析**：`Editor.assetdb.refresh()` 在可可斯内部通过 `fastGlob.sync` 同步扫描目录，对脚本目录会触发 TypeScript 编译，编译产物写入 `library/` 后被 chokidar 文件监听器检测到，触发内部 `_processChanges` → `syncChanges` → 再次调用 `tasks.refresh()`，形成 **刷新 → 编译 → 写入 → 检测 → 刷新** 的级联循环。每次循环都阻塞主线程，持续数分钟直至编辑器彻底卡死。
  > **修复方案**：`refresh_editor` 增加文件后缀名检测（`pathModule.extname`），目录级路径（无后缀）直接拒绝并返回明确错误提示，仅允许单文件刷新。同时完善 `CommandQueue` 超时清理机制（`onTimeout` 回调）和 HTTP 响应保护（`responseSent` 标志），防止连接悬挂。

## [1.2.0] - 2026-06-15

### Feature

- **项目构建闭环**: 新增 `build_project` MCP 工具，首次打通大模型驱动 Cocos Creator 2.4.x 直接触发 `Editor.Builder.build` 进行真机或 Web 项目的端到端编译。
  > _核心防线补丁_：完美解决 Cocos 底层未设置默认启动场景时的打包静默崩溃。现已引入 `Editor.assetdb` 深层接管：若面板空置 `startScene`，将全自动提取库中首个 `.fire` 进行智能组装，绝对确保一键构建可靠性。同时支持了 `project.json` 中 `excluded-modules` 的自动同步。
- **获取宏观工程信息**: 新增 `get_project_info` MCP 工具，使 AI Client 可以全局知悉当前工程目录、引擎版本号以及运行时激活的 Scene UUID，以此做出更准确的环境策略决策。
- **项目管理可视化**: 针对 MCP Client 难以观察项目构建状况的痛点，在控制台入口页面增加并抽离专门的「项目操作」子级配置和日志调试台。
- **多客户端实例支持 (Multi-Instance Concurrency)**: 实现了多项目双开支持，解决了 AI 并发操纵错乱问题。通过重写底层代理（mcp-proxy），引入了动态端口群集扫描机制，自动拦截并代理指令。新增了 `get_active_instances` 探测机制和 `set_active_instance` 显式强制路由锚定，并添加了单实例安全退化的自动兜底策略。
  > _UI 面板增强_：引入全新的增量端口自动漂移侦测机制，在配置面板中可清晰获取真实的端口状态偏移，实时监控实例隔离情况。

### Changed

- **工具描述更新**: `manage_editor` 的 `refresh_editor` 描述从"建议指定路径"改为"硬性限制：仅接受单文件路径，目录路径已被代码层拒绝"。

## [1.1.0] - 2026-04-05

### Feature

- **截图工具**: 新增 `capture_editor_screenshot` 工具，可以通过向编辑器发送缩放 IPC `scene:init-scene-view` 后截图，为 AI 提供全局场景搭建反馈机制。
- **AI 客户端自动化接入**: 新增一键注入 MCP Server 配置到多个主流 AI 客户端（Claude Desktop, Cline, Roo Code, Trae 等）的功能，支持全局及工作区级别的智能探测与配置分发。

### Refactor

- **核心架构重构**: 将原生 JavaScript 代码升级为 TypeScript，并加入 `esbuild` 与 `tsc` 进行现代化的分发打包编译，产物统一输出至 `dist/` 目录。
- **配置声明迁移**: 补齐 `tsconfig.json` 与外围依赖的类型定义入口 `globals.d.ts`，为长期维护奠定全类型智能提示基础。
- **模块化拆分**: 完成长期累积的 `main.js` 巨无霸逻辑瘦身，将庞大的工具阵列硬编码（`getToolsList`）迁移为独立的 `tools/ToolRegistry.ts`，主进程将只专注于拓展生命周期及跨进程请求派发。
- **渲染进程模块化**: 将扩展面板代码(`panel/index.js`)纯净迁移到 TypeScript `src/panel` 目录层级，补充了强制类型保护，并顺利纳入全生命周期的 ESBuild 同步构建体系。
- **界面精简**: 移除测试与废弃的调试子面板，清理了冗杂的 HTML 及前端交互监听库源码（剥离 `IpcUi` 与内部 `runTest` 方法），收拢精简化纯净交互流程。

### Fixed

- **组件系统鲁棒性升级**: 增强 `manage_components`，加入自动对 `cc.BoxCollider2D`、`cc.UITransform` 等 3.x 命名幻觉词条的定向修复防暴词典；拦截 `cc.Widget` 等唯一组件带来的软拒报错引发的二次空指针解析崩溃，自动转换为覆盖重用模式，保障全流程可用性。
