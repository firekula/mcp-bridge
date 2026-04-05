# mcp-bridge 项目结构优化规范

## 1. 背景
当前 `mcp-bridge` 项目采用原生 JavaScript 编写，核心逻辑高度集中于 [main.js:L10](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/src/main.js#L10) 等巨大的单体文件中（超过3000行）。随着功能的不断增加，代码可读性、维护性和扩展性显著降低。
相较之下，参考项目 [mcp-inspector-bridge](file:///C:/Users/Firekula/.CocosCreator/packages/mcp-inspector-bridge/package.json#L1) 采用了 TypeScript 编写，结合 `esbuild` 和 `tsc` 进行模块化拆分打包，代码结构清晰。本次需求旨在借鉴该模式，将当前原生的 JS 项目重构为 TypeScript 模块化工程，并构建打包流程。

## 2. 视觉需求 (Visual Requirements)
虽然本次主要是项目底层结构与工程化改造，不涉及直接的 UI 面板改版，但目录结构的改变在开发视角有以下层级对比变化：

```
优化前结构:                 优化后结构:
mcp-bridge/               mcp-bridge/
  ├─ src/                   ├─ src/ (纯 TypeScript 源码)
  │   ├─ main.js            │   ├─ main.ts 
  │   ├─ scene-script.js    │   ├─ scene-script.ts 
  │   └─ ...                │   ├─ tools/ 
  ├─ package.json           │   ├─ mcp/ 
                            │   └─ panel/
                            ├─ dist/ (esbuild/tsc 编译产物，插件实际执行目录)
                            │   ├─ main.js
                            │   ├─ scene-script.js
                            │   └─ panel/
                            ├─ package.json
                            └─ tsconfig.json
```

## 3. 功能需求 (Functional Requirements)

### 3.1 根因分析
* **单体文件过大**: `main.js` 包含 MCP 服务器、工具定义、IPC 通信等所有逻辑如 [main.js:L435](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/src/main.js#L435) （获取工具列表的冗长定义），导致定位问题困难。
* **缺乏类型安全**: 纯 JS 无静态类型检查，易出现未定义属性访问错误。
* **运行时与源码未隔离**: 插件直接运行 `src/` 中的源码，无法使用现代 TS 新特性和方便的分包机制。

### 3.2 具体修复方案
* **引入 TypeScript 与 ESBuild 构建体系**: 
  参考目标项目的打包方案，在 [package.json:L6](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/package.json#L6) 中修改 `main` 和 `scene-script` 指向 `dist` 目录，并添加构建脚本。
  
  ```json
  // 改动前 package.json
  {
    "main": "src/main.js",
    "scene-script": "src/scene-script.js",
    "scripts": {}
  }
  ```
  ```json
  // 改动后 package.json
  {
    "main": "dist/main.js",
    "scene-script": "dist/scene-script.js",
    "scripts": {
      "build": "tsc && esbuild src/main.ts --bundle --platform=node --outfile=dist/main.js"
    }
  }
  ```

* **模块化拆分 (工具处理器)**:
  将原来集中在 `main.js` 中的 MCP 工具注册提取出来，建立单独的 tools 文件夹，使用类或者独立模块注册。

### 3.3 现有机制复用说明
* **IPC 通信机制**: 完全保留并复用 `IpcManager.js` 和 `Editor.Ipc` 的跨进程通信体系，仅做 TypeScript 类型化包裹（`declare const Editor: any;`）。
* **场景 API**: 复用现有的获取 uuid、生成模版数据函数，只需移入 utils 子模块。

## 4. 涉及文件清单

| 文件路径/模式 | 修改类型 | 说明 |
| --- | --- | --- |
| `package.json` | 修改 | 添加 `devDependencies` (typescript, esbuild)，修改入口路径为 `dist/` |
| `tsconfig.json` | 新增 | 配置 TS 编译环境（CommonJS, es2018） |
| `src/**/*.js` -> `src/**/*.ts` | 重命名 | 将所有 JS 文件转为 TS 文件并处理基础类型报错 |
| `src/main.ts` | 重构拆分 | 抽离原 `main.js`，仅保留生命周期与 IPC 通道接入，引出 `tools` 等逻辑目录 |
| `src/tools/` | 新增目录 | 各个 MCP 工具拆分为独立文件（如 `node-tools.ts`, `scene-tools.ts`） |

## 5. 边界情况 (Edge Cases)

| 场景描述 | 风险分析 | 缓解策略 |
| --- | --- | --- |
| 1. 打包体积过大与原生依赖丢失 | esbuild bundle 如果全量打包 Node 原生模块会导致崩溃或体积过大 | 配置 `--external` 过滤如 `ws`、外部 sdk 等核心原生依赖包，保持其在 node_modules 外置加载。 |
| 2. `__dirname` 路径错位 | 面板的入口 HTML 文件加载路径会因为迁移到 dist/ 发生错配 | 统一改写 HTML 读取路径或利用相对路径后退逻辑 `join(__dirname, '../panel/index.html')` 处理面板路径加载。 |
| 3. TS 编译全局对象报错 | `Editor` 和 `cc` 全局环境缺失类型声明阻塞编译 | 引入并配置 `globals.d.ts` 提供 `declare const Editor: any;` 并设置 `skipLibCheck: true`。 |
| 4. 插件未热加载或找不到入口 | `package.json` 配置不对齐 `dist` 输出会导致 Cocos 不识别插件 | 必须保障 `npm run build` 生成 `dist` 目录并且里面结构保持与 `package.json` 引用兼容再走 Cocos 扩展重载。 |
