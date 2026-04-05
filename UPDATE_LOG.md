# 更新日志 (UPDATE_LOG)

## [1.1.0] - 2026-04-05
### Feature
- **AI 客户端自动化接入**: 新增一键注入 MCP Server 配置到多个主流 AI 客户端（Claude Desktop, Cline, Roo Code, Trae 等）的功能，支持全局及工作区级别的智能探测与配置分发。

### Refactor
- **核心架构重构**: 将原生 JavaScript 代码升级为 TypeScript，并加入 `esbuild` 与 `tsc` 进行现代化的分发打包编译，产物统一输出至 `dist/` 目录。
- **配置声明迁移**: 补齐 `tsconfig.json` 与外围依赖的类型定义入口 `globals.d.ts`，为长期维护奠定全类型智能提示基础。
- **模块化拆分**: 完成长期累积的 `main.js` 巨无霸逻辑瘦身，将庞大的工具阵列硬编码（`getToolsList`）迁移为独立的 `tools/ToolRegistry.ts`，主进程将只专注于拓展生命周期及跨进程请求派发。
- **渲染进程模块化**: 将扩展面板代码(`panel/index.js`)纯净迁移到 TypeScript `src/panel` 目录层级，补充了强制类型保护，并顺利纳入全生命周期的 ESBuild 同步构建体系。
- **界面精简**: 移除测试与废弃的调试子面板，清理了冗杂的 HTML 及前端交互监听库源码（剥离 `IpcUi` 与内部 `runTest` 方法），收拢精简化纯净交互流程。

### Fixed
- **组件系统鲁棒性升级**: 增强 `manage_components`，加入自动对 `cc.BoxCollider2D`、`cc.UITransform` 等 3.x 命名幻觉词条的定向修复防暴词典；拦截 `cc.Widget` 等唯一组件带来的软拒报错引发的二次空指针解析崩溃，自动转换为覆盖重用模式，保障全流程可用性。
