# 更新日志 (UPDATE_LOG)

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
## [1.2.0] - 最新
### Feature
- **项目构建闭环**: 新增 `build_project` MCP 工具，首次打通大模型驱动 Cocos Creator 2.4.x 直接触发 `Editor.Builder.build` 进行真机或 Web 项目的端到端编译。
  > _核心防线补丁_：完美解决 Cocos 底层未设置默认启动场景时的打包静默崩溃。现已引入 `Editor.assetdb` 深层接管：若面板空置 `startScene`，将全自动提取库中首个 `.fire` 进行智能组装，绝对确保一键构建可靠性。同时支持了 `project.json` 中 `excluded-modules` 的自动同步。
- **获取宏观工程信息**: 新增 `get_project_info` MCP 工具，使 AI Client 可以全局知悉当前工程目录、引擎版本号以及运行时激活的 Scene UUID，以此做出更准确的环境策略决策。
- **项目管理可视化**: 针对 MCP Client 难以观察项目构建状况的痛点，在控制台入口页面增加并抽离专门的「项目操作」子级配置和日志调试台。
- **多客户端实例支持 (Multi-Instance Concurrency)**: 实现了多项目双开支持，解决了 AI 并发操纵错乱问题。通过重写底层代理（mcp-proxy），引入了动态端口群集扫描机制，自动拦截并代理指令。新增了 `get_active_instances` 探测机制和 `set_active_instance` 显式强制路由锚定，并添加了单实例安全退化的自动兜底策略。
  > _UI 面板增强_：引入全新的增量端口自动漂移侦测机制，在配置面板中可清晰获取真实的端口状态偏移，实时监控实例隔离情况。
