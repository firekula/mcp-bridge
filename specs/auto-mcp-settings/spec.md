# 自动化添加MCP设置 (Auto MCP Settings)

## 背景
由于 Cocos Creator 的原生支持局限，目前的 `mcp-bridge` 要求用户必须手动修改各大 AI 编辑器（如 Claude Code、Roo Code、Trae 等）的设置（`mcp.json` 或 `cline_mcp_settings.json` 等）以挂载 MCP 服务，体验不够流畅，容易发生路径错误。
参考 `mcp-inspector-bridge` 的成熟实现方案，我们应当将多平台配置文件的检查和注入能力平移至当前项目，并在面板内部直接提供可视化扫描和“一键注入”的能力。

## 视觉需求 (Visual Requirements)
在 `[index.html:L2](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/panel/index.html#L2)` 的顶部选项卡区域新增 "MCP 配置" 选项卡。

```ascii
改动前:
[主页] [工具测试] [IPC 测试]

改动后:
[主页] [工具测试] [IPC 测试] [MCP 配置]

当切换到 MCP 配置面板时:
------------------------------------------------------
| ⚡ 自动化工具链配置                                  |
| 宿主平台: [ Claude Code        ▼ ]                 |
| 状态: 🔴未安装 / 🟢已连通          [一键配置(按钮)]|
|                                                    |
| -------------------------------------------------- |
|              [尝试向所有平台分发配置]              |
------------------------------------------------------
```

## 功能需求 (Functional Requirements)

### 原始机制与缺乏点分析
目前在 `[main.js:L3000](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/src/main.js#L3000)` 附近仅注册了撤销重做、搜索等基础业务指令，但对于外部的 AI 客户端缺乏联动能力：

```javascript
	messages: {
		searchProject(args, callback) {
            // ...
		},
		manageUndo(args, callback) {
            // ...
		},
		getSha(args, callback) {
            // ...
		},
		manageAnimation(args, callback) {
			callSceneScriptWithTimeout("mcp-bridge", "manage-animation", args, callback);
		},
	},
};
```
在界面控制层 `[index.js:L94](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/panel/index.js#L94)` 也没有预留任何与跨应用配置操作相关的接驳点。由于本项目不支持 ES Modules，所有机制必须要转换成 Node 原生的 `require` 风格。

### 具体修复（新增）方案
1. **新建 `src/McpConfigurator.js`**：
将基于系统环境推导主流编辑器配置文件路径（AppSupport/AppData 等）并检测与修改 JSON 的核心逻辑抽象成独立模块，仅通过 `module.exports` 暴露核心方法 `scanMcpClients`, `getPayload`, `injectMcpConfig` 供引擎引用。

2. **追加 IPC 暴露 (目标文件：`main.js`)**：
在导出处直接集成路由分配，以便接受到前台面板的遥控指令：
```javascript
	messages: {
        // ... 原有逻辑保持不变
		manageAnimation(args, callback) {
			callSceneScriptWithTimeout("mcp-bridge", "manage-animation", args, callback);
		},
        "mcp-scan-clients"(event) {
            const configurator = require('./McpConfigurator');
            if (event.reply) event.reply(null, configurator.scanMcpClients());
        },
        "mcp-inject-client"(event, clientId) {
            const configurator = require('./McpConfigurator');
            const log = configurator.injectMcpConfig(clientId === -1 ? undefined : clientId);
            if (event.reply) event.reply(null, log);
        }
	},
};
```

3. **视图与控制逻辑绑定**：
在 `panel/index.js` 添加基于已有封装特性的 UI 点击事件控制，获取到的写入日志则直接重定向调用原有内置函数的日志功能展示回屏面上。

### 现有机制复用清单
* `addLog()` / `this.renderLog`：直接复用原本的主页日志信息打印格式引擎进行调试回显反馈，避开为了显示操作回执信息而多造一套状态栏的无效功耗。
* `Editor.Ipc.sendToMain` 双向回调体系：无需使用 fetch HTTP 请求，依靠 Cocos 既有通道即刻贯通。
* 样式库：遵循使用现成的 `<ui-button>` 和内置样式体系。

## 涉及文件清单
| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/McpConfigurator.js` | 新增 | 纯 JavaScript 实现的底层 JSON 配置侦测和注入管理器包。 |
| `src/main.js` | 修改 | 于 `messages` 内暴露出新增的相关能力供渲染面板和外界触发操作。 |
| `panel/index.html` | 修改 | 追加一个 Tab 卡及一键配置相关表单布局元素。 |
| `panel/index.js` | 修改 | 控制 Tab 的切换映射，并支持向 Main 发起查询并重绘本地信息的状态树。 |

## 边界情况 (Edge Cases)
1. **场景**：目标文件（例如 `.claude.json`）由于上次断电保存时文件结构破损，导致 `JSON.parse` 抛出错误。
   - **风险**：配置器不经判断直接强行用新的字串覆盖保存，导致原文件内容被抹除全损。
   - **缓解策略**：必须将其解析包围于 `try...catch` 语句下。捕获异常后，拦截写入操作并在控制台抛出提示“文件损坏，放弃写入”。
2. **场景**：某些全新安装的 AI 工具的初始配置文件极为精简，没有 `mcpServers` 的根字典键存在。
   - **风险**：直接链式分配 `mcpData.mcpServers['...']` 必然引发属性不存在的 undefined 错误从而中止崩溃。
   - **缓解策略**：赋值配置前需增加存在性防呆校验规则 `if (!mcpData.mcpServers) mcpData.mcpServers = {};`。
3. **场景**：Windows 系统与 MacOS 系统的系统级主配置文件存放目录结构完全背离。
   - **风险**：如果完全使用 `process.env.HOME` 或硬编码的方式，则另一个平台的代码将直接失效。
   - **缓解策略**：在文件操作前显式判断操作系统 `process.platform === 'win32'` 区分出 Windows 的 `%USERPROFILE%\AppData\Roaming` 与 Unix 系统的 `HOME/Library/Application Support` 等差异。
4. **场景**：用户的编辑环境目录权限高度锁定，由于跨磁盘等行为阻断 Node JS（Error: EACCES 权限被拒）。
   - **风险**：`fs.writeFileSync` 时无异常隔离触发崩溃，令编辑器中的外挂进程挂起死亡。
   - **缓解策略**：必须配合将 `fs.writeFileSync` 并入 Try 异常拦截区中。若是抛错将被拒原因连带系统提示平滑地返回通过 IPC 的界面警告。
