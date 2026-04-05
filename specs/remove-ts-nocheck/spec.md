# 彻底移除 `// @ts-nocheck` 并实现完整 TypeScript 迁移

## 1. 背景

当前项目虽然已经将很多文件后缀改为了 `.ts`，并在之前尝试中配置了 `tsc` 构建通过，但实际上这是通过在所有 TypeScript 文件的顶部添加了 `// @ts-nocheck` 标签来实现的。这种做法相当于将 TypeScript 退化回了原生的 JavaScript，由于禁用了类型检查，我们既无法获得编译期安全的保障，也无法在 IDE 中得到任何智能提示。
我们的目标是全面清理项目中的 `// @ts-nocheck` 标签，为核心对象（特别是 `Editor` 和 `cc` 等全局变量，以及内部的 IPC 通信层）补全类型声明，真正实现从 JS 到纯 TS 的切换。

## 2. 视觉需求与代码结构对比 (Visual Requirements)

由于本次为代码重构任务，没有界面的可视元素变化，但对开发者的「IDE 视觉体验」会有显著改变：

```text
重建前的 IDE 提示面板 (大量 any):
[函数悬浮] -> callSceneScriptWithTimeout(pluginName: any, method: any, args: any, callback: any)
IDE 编辑器显示: 无警告，但调用可能在运行时奔溃。

重建后的 IDE 提示面板 (强类型):
[函数悬浮] -> callSceneScriptWithTimeout(pluginName: string, method: string, args: Record<string, any> | null, callback: (err: any, result: any) => void)
IDE 编辑器显示: 参数类型不匹配时标红，提供自动补全。
```

## 3. 功能需求 (Functional Requirements)

### 3.1 补充环境与全局变量声明
目前直接去掉 `// @ts-nocheck` 会导致大量关于 `Editor` 和 `cc` 找不到的报错。
- **根因分析**：Cocos Creator 2.x 的插件系统依赖注入了 `Editor` 对象到主进程和渲染进程的全局变量中。TypeScript 编译器并不知道这些对象的存在。详见 [main.ts:L3](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/src/main.ts#L3)。
- **修复方案**：在 `src` 目录下新建一个全局声明文件 `global.d.ts`，声明必要的命名空间。

```typescript
// 修改前: main.ts (依赖隐式 any 且跳过检查)
// @ts-nocheck
Editor.Ipc.sendToPanel('mcp-bridge', 'mcp-bridge:state-changed', serverConfig);

// 修改后: 增加 global.d.ts 定义
declare namespace Editor {
    export namespace Ipc {
        export function sendToPanel(panelID: string, message: string, ...args: any[]): void;
        export function sendToMain(message: string, ...args: any[]): void;
        export function sendToAll(message: string, ...args: any[]): void;
    }
    // ...其他 API
}
```

### 3.2 改造基于原生 require 的模块规范
当前代码中依然保留着 `const { IpcManager } = require("./IpcManager");` 和 `module.exports = { ... }` 这种 CommonJS 语法，由于 TS 启用了 `esModuleInterop`，我们需要修改导出系统。
- **目标文件**：[IpcManager.ts:L4](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/src/IpcManager.ts#L4) 和 [McpConfigurator.ts:L2](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/src/McpConfigurator.ts#L2)。

```typescript
// 改动前: IpcManager.ts
// @ts-nocheck
const fs = require("fs");
module.exports = { IpcManager };

// 改动后: IpcManager.ts
import * as fs from 'fs';
export class IpcManager { ... }
```

### 3.3 规范化参数类型声明
大部分 MCP 工具和场景脚本函数参数没有任何类型描述。
- 目标文件：[scene-script.ts:L70](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/src/scene-script.ts#L70)
- 动作：为 `args` 对象添加 Interface 定义。

### 3.4 现有机制复用说明
- **复用 tsconfig 编译流**：目前的 `tsconfig.json` 已经正确设置了 `"module": "commonjs"` 且有向 `./dist` 编译路径输出的逻辑。我们只需复用该构建管线，但去除 `@ts-nocheck` 后，需要确保 `skipLibCheck` 依然为真，避免扫描 `node_modules` 带来的外部库类型报错。
- **复用 IPC 发送逻辑**：不改变任何底层通信通道（`sendToMain`，`callSceneScript`），仅仅将外层的参数用 TypeScript 接口包裹。

## 4. 涉及文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/global.d.ts` | 新增 | 用于声明 `Editor`, `cc` 等全局变量的类型定义 |
| `src/main.ts` | 修改 | 移除 `@ts-nocheck`，引入强类型参数，将 require 切换为 import，调整 module.exports|
| `src/scene-script.ts` | 修改 | 移除 `@ts-nocheck`，为主进程传来的 args 提供类型 |
| `src/IpcManager.ts` | 修改 | 移除 `@ts-nocheck`，转为 ES6 格式的 export/import |
| `src/McpConfigurator.ts`| 修改 | 移除 `@ts-nocheck`，重构类型与导入导出 |
| `src/mcp-proxy.ts` | 修改 | 移除 `@ts-nocheck`，强类型化 request 处理。由于是单独跑在 node 环境独立于 Cocos，需单独处理 Node.js typing |
| `src/IpcUi.ts` | 修改 | 移除 `@ts-nocheck`，处理 DOM 相关对象类型标注 |
| `src/tools/ToolRegistry.ts`| 修改 | 移除 `@ts-nocheck`，为 tool schema 定义 Interface 或 type |

## 5. 边界情况 (Edge Cases)

1. **场景：`scene-script.ts` 中的 `cc` 对象类型不全**
   - **风险**：虽然我们声明了 `cc` 全局对象，但是 Cocos Creator 引擎极其复杂，我们没办法将几千个引擎 API 全部写成 `.d.ts`，很容易在调用深层属性时（如 `cc.Color.fromHEX`）报找不到成员。
   - **缓解策略**：不强求 100% 静态验证引擎 API。在 `global.d.ts` 中将难以推断的深层对象用 `any` 兜底（例如 `export const cc: any;`），首要解决自身插件逻辑的类型化。

2. **场景：`Editor.Ipc` 回调参数的不确定性**
   - **风险**：在调用 `Editor.Scene.callSceneScript` 时，返回的 `result` 结构是多态的，TypeScript 可能会抱怨你尝试访问未声明的属性。
   - **缓解策略**：使用泛型或者显式 `callback: (err: any, metadata: unknown) => void`，并在业务层（比如 main.ts 中接收时）进行类型守卫（Type Guard）或强制类型转换。

3. **场景：入口文件必须是 `commonjs` 的要求**
   - **风险**：如果在 `main.ts` 中我们用了 `export default` 等 ES 规范语法，经过 Babel/TSC 编译之后它可能变成 `exports.default = {...}`，而 Cocos 插件引擎期待的是原本 `module.exports = {...}` 暴露的 `load`, `unload`, `messages`。
   - **缓解策略**：对于主入口脚本 `main.ts` 和 `scene-script.ts`，不要使用 ES 模块的默认导出。应该使用 `export = { load() {}, messages: {} }` 等 TypeScript 专为 CommonJS 设计的支持语法，或者明确保留 `module.exports` 并声明为其忽略严格编译限制。

4. **场景：`apply_text_edits` 等工具的数据结构层层嵌套**
   - **风险**：当没有 `@ts-nocheck` 后，多层嵌套的 payload 使用 `any` 会蔓延污染整个函数上下文。
   - **缓解策略**：为复杂输入数据制定专门的 Interface，如 `interface TextEdit { type: string, start: number... }`。并确保在使用前做好数据的空校验。
