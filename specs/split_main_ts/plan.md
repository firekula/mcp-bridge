# 架构设计 (Architecture)

## 文件清单

| 文件路径 | 层级 | 改动性质 | 说明 |
|----------|------|----------|------|
| `src/main.ts` | `[Backend]` | 修改 | 瘦身入口文件，仅保留 `module.exports` 骨架及基础 IPC 注册。 |
| `src/core/Logger.ts` | `[Backend]` | 新增 | 剥离原有的 `logBuffer` 缓冲与落盘/面板同步逻辑。 |
| `src/core/CommandQueue.ts` | `[Backend]` | 新增 | 剥离 `enqueueCommand` 和 `callSceneScriptWithTimeout` 控制逻辑。 |
| `src/core/HttpServer.ts` | `[Backend]` | 新增 | 独立负责 Node `http` 服务器的绑定、鉴权与报文 413 过滤。 |
| `src/core/McpRouter.ts` | `[Backend]` | 新增 | 承接具体的 `/call-tool` 和 `/read-resource` 的 JSON 报文分流。 |
| `src/tools/ToolRegistry.ts` | `[Backend]` | 修改 | 引入统一处理映射分发逻辑，替换原本庞大的 switch case。 |
| `src/tools/*Manager.ts` | `[Backend]` | 新增 | （包含如 `AssetManager`, `ScriptManager` 等功能类）隔离各种业务资源库。 |
| `src/utils/AssetPatcher.ts` | `[Backend]` | 新增 | 提取跨多方法的共有工具 `_safeCreateAsset`，避免重复散落。 |

## 架构影响评估
改动不会改变插件对外提供的接口形态（HTTP 端口及 MCP 标准协议不受影响），属于纯粹的代码解耦重构。**架构变化点在于：**
底层通信和公共资源的调用（如指令限流锁、日志缓存区）从函数作用域级闭包，升级为模块级严格的（Singleton Class）静态属性管理。在保持原有 IPC/Editor 包依赖的同时，防止了全局命名空间的严重污染。

## 关键流程图

```mermaid
graph TD
    A[main.ts (入口加载)] -->|1.注册 IPC| B(Cocos 面板)
    A -->|2.启动服务| C[HttpServer.ts]
    C -->|接收 HTTP Req| D[McpRouter.ts]
    D -->|JSON Decode| E[tools/ToolRegistry.ts]
    E -->|下发指令| F[McpManager Classes]
    F -->|加异步排队锁| G[CommandQueue.ts]
    G -->|状态与错误报告| H[Logger.ts]
```

---

# 分步实施 (Step-by-Step)

### 阶段 A: 底层基建分离 (基础设施)
- [ ] `[Backend]` 创建 `src/core/Logger.ts` 组件。重构原先松散位于顶部的 `logBuffer` 并暴露。
  ```ts
  // 修改前 (main.ts)
  let logBuffer: any[] = [];
  function addLog(type, message) { logBuffer.push({type, message}) }
  
  // 修改后 (src/core/Logger.ts)
  export class Logger {
      private static logs: any[] = [];
      public static info(msg: string) { /*...*/ }
      public static error(msg: string) { /*...*/ }
  }
  ```
- [ ] `[Backend]` 创建 `src/core/CommandQueue.ts` 和 `src/utils/AssetPatcher.ts`，摘出异步死锁防护控制及特质化的系统文件修改支持逻辑。

### 阶段 B: 核心调度解耦 (HTTP / 路由)
- [ ] `[Backend]` 新建 `src/core/HttpServer.ts`，将长达数百行的原生 Node 服务逻辑及心跳重启抽离为静态类方法单例。
  ```ts
  // 修改后 (src/core/HttpServer.ts)
  import * as http from "http";
  export class HttpServer {
      static start(port: number, handler: (req: any, res: any) => void) {
          // 初始化逻辑
      }
      static stop() { /*...*/ }
  }
  ```
- [ ] `[Backend]` 剥离工具网关与业务功能：将 `handleMcpCall` 内长达千行的独立路由及各个功能（Asset/Material/Script）分置到 `src/tools/` 与 `src/core/McpRouter.ts` 中。

### 阶段 C: 入口瘦身与编译拼接
- [ ] `[Backend]` 修改 `src/main.ts`。清空之前已抽出的上千行代码，改为按需导入上述分离好的各模块，确保导出结构的干净并连接生命周期：
  ```ts
  // 修改后最终清爽的 main.ts
  import { HttpServer } from "./core/HttpServer";
  import { McpRouter } from "./core/McpRouter";
  import { Logger } from "./core/Logger";

  export = {
      "scene-script": "scene-script.js",
      load() { Logger.info("加载"); /* 配置加载并准备 HttpServer */ },
      unload() { HttpServer.stop(); },
      messages: { /* IPC 的绑定回调保留 */ }
  }
  ```

### 阶段 D: 编译验证
- [ ] `[Build]` 在终端执行 `npm run build`，依靠 TypeScript 编译器扫描所有的依赖注入链路并确认构建结果。排查任何丢失的原 `Editor.*` 上下文变量。

### 阶段 E: 文档更新
- [ ] `[Docs]` 在 `UPDATE_LOG.md` 中填写本次大幅度架构重构 (Architecture Splitting) 之变更条目和测试报告。
