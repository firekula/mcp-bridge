## 背景
`main.ts` 是现阶段 `mcp-bridge` 插件的主入口文件，当前代码行数已经达到了 2678 行。所有的流程：HTTP 服务器、请求路由分发、MCP Tool 业务逻辑处理、日志与数据封装等全部写在此文件中 [main.ts:L1](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/src/main.ts#L1)。这不仅使得单文件过于臃肿、降低了可维护性，也极其容易导致合并冲突和代码阅读困难。需要将其职责进行合理的拆分，使其结构更加清晰模块化。

## 视觉需求 (Visual Requirements)
虽然该拆分属于纯 Node.js 主进程级别的重构，并没有强烈的 UI 级视觉改动，但就**架构布局 (Architectural Layout)**来看，重构前后的元素模块排列对比如下：

```text
拆分前架构模式:
[main.ts (单体巨石)]
 ├── 日志与指令队列系统 (logBuffer, commandQueue)
 ├── HTTP Server 接收与过滤
 ├── MCP 调用分发中心 (handleMcpCall)
 ├── 各种业务逻辑聚合 (manageScript, manageTexture, 等等...)
 └── Creator IPC 消息处理中心 (messages)

拆分后架构模式:
[main.ts] 仅仅作为主骨架，暴露声明周期与 IPC 入口，并装配其他服务。
 ├── [HttpServer.ts] 独立负责服务器监听及 413 大数据量拒绝。
 ├── [McpRouter.ts] 专注解析 JSON RPC 参数与鉴权。
 ├── [CommandQueue.ts] 单独维护多任务串行执行锁。
 ├── [Logger.ts] 将文件系统记录和 UI 面板 IPC 通知结合。
 └── [tools/] (文件夹) 分类挂载各类型业务代理类
      ├── AssetTool.ts
      ├── PrefabTool.ts
      └── ...
```

## 功能需求 (Functional Requirements)

1. **核心逻辑拆分根因**：
`main.ts` 目前把所有的底层资源操作杂糅在 `handleMcpCall` 内的巨大 `switch...case` 以及附带的几百行私有方法中。
例如对于资源类操作，在 [main.ts:L1217](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/src/main.ts#L1217) 的 `manageAsset` 以及 [main.ts:L1099](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/src/main.ts#L1099) 的 `manageScript` 这种巨型函数处理。这使得对任意特性的扩展不仅容易影响别的逻辑区块，而且测试成本极高。

2. **具体修复方案与拆解点**：

- **分离 HTTP 服务生命周期与网关**
  将 `startServer`、`stopServer` 与 `_handleRequest` 网络拦截器移出，见 [main.ts:L506](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/src/main.ts#L506)。
```ts
// 拆分前: (main.ts)
export = {
    startServer(port) {
        mcpServer = http.createServer((req, res) => { this._handleRequest(req, res); });
        //...
    }
}
```
```ts
// 拆分后改写: (HttpServer.ts)
export class HttpServer {
    private static server: http.Server | null = null;
    static start(port: number, requestHandler: (req, res) => void) {
        // 发挥独立配置能力，监听分离
    }
    static stop() { /*...*/ }
}
```

- **分离时序控制指令编排队列**
  为防止 `AssetDB.refresh` 等并发引发死锁，目前的序列同步逻辑与 HTTP 完全互斥，位于 [main.ts:L30](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/src/main.ts#L30) 的 `enqueueCommand`。拆分后必须封装它的全局状态池。
```ts
// 拆分前逻辑:
let commandQueue = [];
let isProcessingCommand = false;
function enqueueCommand(fn: any): Promise<void> { ... }
```
```ts
// 拆分后改写: (CommandQueue.ts)
export class CommandQueue {
    private static maxQueue = 100;
    private static queue: any[] = [];
    private static busy = false;
    static enqueue(task: Function): Promise<void> { ... }
}
```

3. **现有机制复用说明**：
- **`addLog` 日志发送通道**: 继续复用已有的 `Editor.Ipc.sendToPanel` 持久化通知通道及文件系统记录算法，不破坏原始业务逻辑，只是独立到 `Logger.ts` 中管理状态。
- **`callSceneScriptWithTimeout` 代理器**: 必须全样复印其 15s 超时重试及异常回捞代码，封装到公用 Utils 里，因其被几十个独立命令调用。
- **资源安全写隔离方案 (`_safeCreateAsset`)**: 不需废弃，仍然依靠临时隔离区（os.tmpdir）+ 原子 Import 的方式来写新资源，将其归档到单独的 `utils/AssetPatcher.ts` 中复用即可。

## 涉及文件清单

| 文件路径 | 改动类型 | 说明 |
|----------|----------|------|
| `src/main.ts` | 修改 | 将大量逻辑削减剥离，保留基于 `export = {}` 结构的入口主钩子以及部分系统级别的 `messages`，压缩并瘦身。 |
| `src/core/HttpServer.ts` | 新增 | 包含 Node `http.createServer` 服务管理与请求头与协议大小过滤。 |
| `src/core/McpRouter.ts` | 新增 | MCP 路由网关处理和 JSON 参数结构解包校验。 |
| `src/core/CommandQueue.ts`| 新增 | 管理队列串锁 (Queue lock) 与超时处理调度。 |
| `src/core/Logger.ts` | 新增 | 涵盖了落盘文件逻辑和 IPC 面板刷新功能及缓冲管理。 |
| `src/tools/index.ts` | 新增 | 负责搜集、分类整理所有针对编辑器资源和节点的 API 实现逻辑。 |

## 边界情况 (Edge Cases)

1. **场景：服务启动与主进程实例的回收生命周期交错**
   - **风险**：如果 `HttpServer.ts` 在热重载中因为对象重建导致遗忘了关闭，之前的底层端口并不会被妥善释放（EADDRINUSE）。
   - **缓解策略**：强制要求 `HttpServer` 持有其实例对象的强缓存引用的单例释放方法，并在 `main.ts` 的 `unload()` 中强制主动调用一次全量卸载清理。

2. **场景：`isProcessingCommand` 全局状态撕裂**
   - **风险**：原本在单个文件闭包内的全局布尔变量随着被移动到 `CommandQueue.ts` 后，如果被不同的请求模块用 `require()` 解析为多个相对路径，可能导致不同模块获得不共用的状态实例。
   - **缓解策略**：把 `CommandQueue.ts` 编写为包含静态不可变配置的 ES module class，利用 TS `private static` 严格防范状态外泄，仅提供 `enqueue` 入口。

3. **场景：模块循环引入死锁**
   - **风险**：`Logger.ts` 试图引入 `main.ts` 或 `AssetManager.ts` 以获取部分 Cocos 对象状态，而这些文件恰好都在导入 `Logger.ts` 来打印日志。
   - **缓解策略**：底层公共模块（`Logger.ts`/`CommandQueue.ts`）严格保证"无业务特征"，绝不导入任何处理具体业务逻辑或 Editor API 高级包装的功能。

4. **场景：TS/JS 编译后模块导入导出对 Cocos 运行时污染**
   - **风险**：在不同文件中采用 `export default` 给其他文件导入，可能受到 Cocos 中 `tsc` target 配置或模块解析差异影响而导致出现 `module is undefined`。
   - **缓解策略**：在抽离的文件中统一采用具名导出（`export class XYZ`）或明确的 Node `require/module.exports` 处理相互间依赖，`main.ts` 则因引擎制约依然使用 `export = { ... }` 维系旧规。
