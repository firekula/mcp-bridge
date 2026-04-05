# 背景 (Background)
用户希望将 `panel` 目录下的纯 JavaScript 脚本整合到 `src` 目录，并全量使用 `esbuild` 与 `TypeScript` 进行工程化构建。该改动是对 `UPDATE_LOG.md` 中记录的“核心架构重构”工作的延展，旨在达成产线代码 100% 可编译检查，使插件面板的 DOM 交互逻辑也能获得强类型推导与现代化打包支持。

# 视觉需求 (Visual Requirements)
由于本次涉及架构层级的构建管道变更，实际插件交互视图不会改变，但工程目录将进行重新规划编排：
```text
优化前（纯JS运行视图）：
[资源树]
├── package.json
├── src/
│   └── IpcUi.ts         (通信类模块)
└── panel/
    ├── index.js         (直接被主进程加载执行的源码)
    └── index.html       (DOM 界面模板)

优化后（全量 ESBuild 构建视图）：
[资源树]
├── package.json
├── src/
│   ├── IpcUi.ts
│   └── panel/
│       └── index.ts     (TS 化后的源码)
├── panel/
│   └── index.html       (仅维持视图 HTML 承载)
└── dist/
    └── panel/
        └── index.js     (经 esbuild 打包混淆后的 Cocos 可识别产物)
```

# 功能需求 (Functional Requirements)

### 1. 代码迁移与模块化改写：
目标文件：[panel/index.js:L8](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/panel/index.js#L8)
```javascript
// 修改前
const fs = require("fs");
const { IpcUi } = require("../src/IpcUi");

Editor.Panel.extend({
    style: fs.readFileSync(Editor.url("packages://mcp-bridge/panel/index.html"), "utf-8"),
```
将原 `require` 改作 ES Module 导入及 TypeScript 标准扩展，用以结合 `tsc` 检查与构建：
```typescript
// 修改后 (src/panel/index.ts)
import * as fs from "fs";
import { IpcUi } from "../IpcUi";

Editor.Panel.extend({
    style: fs.readFileSync(Editor.url("packages://mcp-bridge/panel/index.html"), "utf-8"),
```

### 2. 构建脚本调整
更改 `esbuild` 构建的目标入口点。
目标文件：[package.json:L8](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/package.json#L8)
```json
// 修改前
"scripts": {
    "build": "tsc && esbuild src/main.ts ... && esbuild panel/index.js --bundle --platform=node --external:electron --outfile=dist/panel/index.js ..."
}
```
```json
// 修改后
"scripts": {
    "build": "tsc && esbuild src/main.ts ... && esbuild src/panel/index.ts --bundle --platform=node --external:electron --outfile=dist/panel/index.js ..."
}
```

### 3. 现有机制复用说明：
* **复用 UI 组件类**：通过路径微调继续复用类 [IpcUi.ts:L8](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/src/IpcUi.ts#L8)。原来的 `../src/IpcUi` 在移入 `src/panel` 后可以直接使用 `../IpcUi` 引入合并编绎。
* **复用生命周期**：复用原生 `Editor.Panel.extend` 生命周期不变，这确保了 Cocos Creator 编辑器底座机制不受破坏，且不引发新 bug。
* **复用视图与样式**：原有的 HTML/CSS 结构完整闭环于 `panel/index.html` 维持不动，保持和源码加载隔离。

# 涉及文件清单
| 文件名 | 改动类型 | 说明 |
| :--- | :--- | :--- |
| `src/panel/index.ts` | 新增 | 从原 `panel/index.js` 迁移并转换成 TypeScript |
| `panel/index.js` | 删除 | 舍弃项目根深处的散装 js 行为，被 dist 生成版替代 |
| `package.json` | 修改 | 更新 npm 打包命令使其指向正确的 TS 入口 |
| `tsconfig.json` | 检查 | 保证 `src/panel` 被涵括进入配置的检查阵列 |

# 边界情况 (Edge Cases)

### 1. 场景：面板 HTML 模板解析路径报错
**风险**：由于打包生成的逻辑文件转移到了 `dist/panel/index.js`，若对 `fs.readFileSync` 取网页模板拼接使用了 `__dirname`，会导致打包后错位白屏。
**缓解策略**：沿用目前内置的 `Editor.url("packages://mcp-bridge/panel/index.html")`，因其基于引擎层封装直接代理项目绝对路径映射，彻底与物理产物路径脱钩。

### 2. 场景：`electron` Native API 被编译内敛报错
**风险**：旧代码存在原生的 `require("electron").clipboard`，ESBuild 此处若进行普通依赖树抓取可能会导致打包直接崩溃。
**缓解策略**：需保持并在 `package.json` 构建命令中严格核实 `--external:electron` 配置的存在，确保在 AST 转译时作为 Runtime External 忽略处理。

### 3. 场景：Cocos 编辑器 `require` 寻找模块报错/报不支持异常
**风险**：`package.json` 中的 `panel.main` 为 `dist/panel/index.js`，Cocos 2.4 的面板宿主处于特定 V8 态无法支持裸露的纯 ESM Native 处理。
**缓解策略**：维持 ESBuild 预设 `--platform=node` 让其降为 CommonJS（CJS）暴露接口格式，保证 Editor 层顺畅无缝 require。

### 4. 场景：DOM 强弱类型冲突导致构建断裂
**风险**：原本属于弱类型的面板中有极其频繁的 DOM 查询（如 `this.shadowRoot.querySelector`），在全量转 TS 后会遭遇大规模类型缺失及 `tsc --noEmit` 阻塞。
**缓解策略**：针对原项目先建立部分 `as unknown as any` 、 `as HTMLInputElement` DOM 断言保护，并借由对声明文件 `mcp.d.ts` 提供 `Editor.Panel` 等全聚合定义，屏蔽类型风暴。
