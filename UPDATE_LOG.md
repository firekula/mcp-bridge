# 更新日志 (UPDATE_LOG)

## [1.3.0] - 2026-07-02

### Feature & Performance

- **截图性能调优 (MacBook 发热优化)**：限制高 DPI 视网膜（Retina）屏幕下的截图尺寸上限，支持在主进程中等比例 resize 缩放图片（默认上限 1280px），大幅降低大图 Base64 编码的 CPU 耗时；
- **截图节流缓存控制**：支持设置默认 1500ms 的截图防抖节流保护，防止 AI 客户端高频密集请求截图导致 GPU 过热发热。
- **指令高精度耗时与慢指令告警**：在 McpRouter 层面记录工具真实执行耗时（排除在 CommandQueue 中的排队等待时间），对执行超过 1000ms 的慢操作打印警告日志，同时收集并输出加载时的系统指纹日志，辅助定位硬件瓶颈。
- **写操作缓存清除**：添加针对写操作工具（如 `update_node_transform`, `create_node` 等）的联动，在写操作成功时主动清空截图节流缓存，保证下次截图时必定能拉取最新的场景状态，消除状态不同步问题。
- **可视化性能配置 UI**：在插件的「MCP 配置」页签中新增“性能与截图优化”控制模块，支持图形化配置截屏限制宽度和防抖节流毫秒数，并支持 Editor.Profile 项目级配置本地持久化存储。

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
