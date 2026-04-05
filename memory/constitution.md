# 项目宪章 — MCP Bridge (Cocos Creator 2.4.x 插件)

## 第一条：产物驱动原则 (The Artifact Mandate)
**AI 智能体在没有生成可见文档产物前，不得直接执行修改。**
- 所有的规划步骤都必须产出 Markdown 格式文档（Plan, Spec, 或 Checklist）。
- 绝不能仅仅依赖“聊天记忆”。关键决策必须写入文件。
- **语言强制约定 (绝对红线)**: 所有的开发阶段文档（项目计划、任务流、验收记录）、代码内部说明（DocStrings、行内注释）、AI 思考推理回答、以及**所有 Git 提交信息（Commit Messages，包含 feat/fix 标头）均必须且只能使用简体中文 (Simplified Chinese)**。

## 第二条：视觉与逻辑验证 (Vision Verification)
**信任但必须验证（眼见为实）。**
- 在实现 UI 或 Panel 时，AI 必须通过相关工具（如浏览器截图或 CV 图像匹配）进行验证。
- 必须将生成的界面与原始需求/预览图对比。
- 如果像素不匹配，则任务视为未完成。

## 第三条：独立性与并发 (Agent Independence)
**为并行工作而设计。**
- 任务必须细化为原子级别。
- `main.js` (主进程) 和 `scene-script.js` (渲染进程) 的工作必须独立设计，松耦合。
- 绝不要让一个线程阻塞等待另一个智能体。

## 第四条：代码健康度 (Code Health)
- **目标运行环境**: Cocos Creator 2.4.x (使用 Node.js 风格的 `require`，**禁止使用 ES Modules**)。
- **语法规范**: 使用主进程支持的 ES6+ 原生特性（箭头函数、模板字符串、const/let、解构）。插件本身**禁止跨端使用 React 或 TypeScript**。
- **摒弃历史包袱**: 凡是能用的地方优先使用 `async/await`；只在 Cocos/Editor 原生 API 强制要求时才使用回调函数 (Callbacks)。
- **自我修正**: 如果测试失败，AI 应在抛出给用户前至少尝试修复**一次**。

## 第五条：架构铁律 (Architecture Rules)
- **严格的核心进程隔离**: `main.js` 运行在主进程（有权访问 `Editor.assetdb`, `Editor.Ipc`）；`scene-script.js` 运行在渲染进程（有权访问 `cc.*`）。**绝不可跨界调用。**
- **路径解析**: 永远在 `main.js` 中将 `db://` 协议路径转换为 UUID，再将其传递给 `scene-script.js`，绝不能在场景脚本中处理 `db://`。
- **IPC 通信模式**: HTTP Request → `main.js` → 调用 `Editor.Scene.callSceneScript()` → 在 `scene-script.js` 内部处理节点 → 携结果返回。
- **日志输出机制**: 必须使用统一的 `addLog(type, message)` ，**严禁使用** `console.log()`。

## 第六条：命名规范 (Naming Conventions)
| 类型 | 规范标准 | 示例 |
|------|-----------|---------|
| 函数名 | 小驼峰 (camelCase) | `handleMcpCall` |
| 常量 | 宏定义蛇形 (SCREAMING_SNAKE_CASE) | `DEFAULT_PORT` |
| MCP 工具名 | 蛇形 (snake_case) | `get_selected_node` |
| IPC 各种消息 | 短横线 (kebab-case) | `get-hierarchy` |

## 第七条：不可触碰的红线 (Forbidden Patterns)
- ❌ **语言红线**: 所有的对话回复、代码注释、以及生成的文档都必须强制使用 **中文**。
- ❌ **打印红线**: 禁用 `console.log()` — 必须使用 `addLog()`。
- ❌ **进程越界**: 不允许在 `main.js` 中访问 `cc.*`。
- ❌ **进程越界**: 不允许在 `scene-script.js` 中访问 `Editor.assetdb`。
- ❌ **重复定义**: 严禁在 `main.js` 中定义重复的函数，修改前必须检索。
- ❌ **模块化规范**: 禁用 ES Modules (`import`/`export`) — 只能使用原生的 `require()`/`module.exports`。

## 第八条：项目文档格式规范 (Documentation Format Standards)
**README.md 和 UPDATE_LOG.md 的格式必须严格受控，禁止退化为密集长文。**

### 8.1 README.md 格式规范
- **结构顺序（强制）**：标题简介 → 快速开始（安装/配置/使用） → 核心特性 → 项目结构 → 开发说明。
- **特性描述风格**：每个特性用 `###` 三级标题 + 2-5 条 `-` 要点列表。每条要点**不超过 2 行**。严禁出现超过 3 行的单段落。
- **项目结构树必须完整**：新增文件后必须同步更新项目结构部分。

### 8.2 UPDATE_LOG.md 格式规范
- **版本章节结构（强制）**：`## [版本号] - 日期` → `### ✨ 新特性` → `### 🐛 缺陷修复` → `### 🧹 代码整理`（可选）。版本之间用 `---` 分隔线隔开。
- **新特性条目格式**：`- **标题 (English Title)**` + 换行后用子弹头 `-` 列出 2-4 条要点。每条要点**不超过 1 行**。
- **缺陷修复条目格式**：`- **修复xxx (English Title)**` + 换行后分为 `**问题**：` 和 `**方案**：` 两行。每行**不超过 2 行**。
- **写作风格红线（绝对禁止）**：
  - ❌ 禁止花哨修辞（如"痛下决心"、"绝杀"等文学化表达）
  - ❌ 禁止单条记录超过 5 行
  - ❌ 禁止在修复描述中嵌入完整代码片段（用 `函数名` 行内代码即可）
  - ✅ 使用精准的技术术语，简明扼要地描述"改了什么"和"为什么改"

## 第九条：异步时序与状态竞态预防 (Async Timing & Race Conditions)
**跨进程交互和生命周期中的状态管理必须秉持“防御性编程”姿态。**
- **强制结果回调驱动**：对于从 `main.js` 调用 `scene-script.js` 的行为，后续逻辑必须等待 IPC 回调，不能超前判定。对于场景回调等依赖引擎处理的事项（如 scene:dirty 通知刷新），通过回调链条或 `setTimeout` 让出主循环确保时序正确。
- **防范时序崩溃**：由于 Cocos 内部采用多进程架构，避免将同步设定用于本应异步下发的组件更新（如 Widget 等组件须在节点挂载并更新 Transform 矩阵后生效，同步调用往往导致坐标膨胀、飞出屏幕等未定义行为）。