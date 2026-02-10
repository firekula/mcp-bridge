# Cocos Creator MCP Bridge 更新与修复日志

本文件详细记录了本次开发周期内的所有功能更新、性能改进以及关键问题的修复过程。

## 一、 新增功能与工具

### 1. `manage_shader` 工具 (新增)
- **功能**: 实现了对着色器 (`.effect`) 资源的全生命周期管理。
- **操作**: 支持 `create` (带默认模板), `read`, `write`, `delete`, `get_info`。
- **意义**: 补全了资源管理链条，使得从编写代码到应用材质的流程可以完全通过 MCP 驱动。

### 2. 材质管理增强 (`manage_material`)
- **2.4.x 深度适配**: 彻底重构了材质存储结构，支持 Cocos Creator 2.4.x 的 `_effectAsset` 和 `_techniqueData` 格式。
- **新增 `update` 操作**: 支持增量更新材质的宏定义 (`defines`) 和 Uniform 参数 (`props`)，无需覆盖整个文件。

### 3. 组件管理增强 (`manage_components`)
- **资源数组支持**: 攻克了 `materials` 等数组属性无法通过 UUID 赋值的难题。
- **智能异步加载**: 实现了并发加载多个资源 UUID 的逻辑，并在加载完成后自动同步到场景节点。

---

## 二、 关键问题修复 (Technical Post-mortem)

### 1. 材质在 Inspector 面板中显示为空
- **原因**: 初始代码使用了错误的 JSON 字段 (如 `effects`)，不符合 2.4.x 的私有属性序列化规范。
- **修复**: 将字段改为 `_effectAsset` (UUID 引用) 和 `_techniqueData` (包含 `props` 和 `defines`)。

### 2. Sprite 材质赋值失效
- **原因**: 直接向 `cc.Sprite.materials` 赋值字符串数组会导致引擎内部类型不匹配；且直接修改内存属性不会触发编辑器 UI 刷新。
- **修复**: 在 `scene-script.js` 中拦截数组型资源赋值，先通过 `cc.AssetLibrary` 加载资源对象，再使用 `scene:set-property` IPC 消息强制刷新编辑器 Inspector 面板。

### 3. 场景克隆与 `Editor.assetdb` 兼容性
- **原因**: Cocos 2.4.x 的主进程 `Editor.assetdb` 缺少 `loadAny` 方法，导致原本的 `duplicate` 逻辑崩溃。
- **修复**: 改用 Node.js 原生 `fs` 模块直接读取源文件流并创建新资源。

---

## 三、 文档与规范化建设

### 1. 全域本地化 (Simplified Chinese)
- **代码注释**: 将 `main.js` 和 `scene-script.js` 中所有关键逻辑的英文注释转换为准确的中文说明。
- **JSDoc 补充**: 为核心函数补充了详尽的 JSDoc 参数说明，提升代码可读性。
- **日志输出**: 所有控制台日志 (`addLog`) 和错误提示均已中文化，方便国内开发者排查。

### 2. AI 安全守则 (Safety Rules)
- **守则注入**: 在所有 MCP 工具的描述中注入了【AI 安全守则】，强调“先校验再操作”、“资源赋 UUID”等原则。
- **Schema 优化**: 优化了工具的描述文本，使其在 AI 客户端（如 Cursor）中展现更清晰的引导。

---

## 四、 总结
本次更新不仅修复了制约生产力的材质与资源同步 bug，还通过引入 `manage_shader` 和全方位的文档中文化，极大提升了开发者（及 AI 助手）在 Cocos Creator 2.4.x 环境下的操作体验。
