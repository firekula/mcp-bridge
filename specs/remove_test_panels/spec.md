# 背景 (Background)
用户要求彻底去除开发者为了调试自己编写的 "工具测试" (Tool Test) 视图和 "IPC 测试" (IPC Test) 视图，以及配套的前端测试执行逻辑。这是为了净化拓展面板的界面表达，去掉对最终用户无直接价值的开发期辅助部件，从而减小最终发版包的体积并提高前端面板 JS 加载维护的速度。

# 视觉需求 (Visual Requirements)
本次调整需要隐藏（剔除）UI 菜单栏的两处冗余标签及其下的整个主操控面板：

```text
优化前 (四选项卡布局):
正常视图: [主页] [工具测试] [IPC 测试] [MCP 配置]
           ────────────────────────────────────────
           [左侧工具表] [|| 拖拽条] [右侧详情与表单]

优化后 (极简功能布局):
正常视图: [主页] [MCP 配置]
           ────────────────────────────────────────
           [纯净的状态面板 / 纯净的安装设置面板无缝承接]
```

# 功能需求 (Functional Requirements)

### 1. HTML 节点缩减
目标文件：[panel/index.html:L4](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/panel/index.html#L4)
```html
<!-- 改动前 -->
<div class="tabs">
    <ui-button id="tabMain" class="tab-button active">主页</ui-button>
    <ui-button id="tabTest" class="tab-button">工具测试</ui-button>
    <ui-button id="tabIpc" class="tab-button">IPC 测试</ui-button>
    <ui-button id="tabConfig" class="tab-button">MCP 配置</ui-button>
</div>
```
```html
<!-- 改动后 -->
<div class="tabs">
    <ui-button id="tabMain" class="tab-button active">主页</ui-button>
    <ui-button id="tabConfig" class="tab-button">MCP 配置</ui-button>
</div>
<!-- 并同步删除整个 <div id="panelTest"> 和 <div id="panelIpc"> 及对应的 CSS (.test-layout, .ipc-container 等专用样式) -->
```

### 2. 交互逻辑清理与 IpcUi 类抛弃
目标文件：[src/panel/index.ts:L97](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/src/panel/index.ts#L97)
```typescript
// 改动前
import { IpcUi } from "../IpcUi";
Editor.Panel.extend({
    // ...
    ready() {
        // ...
        new IpcUi(root);
        if (els.tabTest) {
            els.tabTest.addEventListener("confirm", () => {
                switchTab(els.tabTest, els.panelTest);
                this.fetchTools(els); 
            });
        }
        // ...
    }
});
```
```typescript
// 改动后
// 删除 import { IpcUi } 
// 删除所有 fetchTools, showToolDescription, getExample, runTest 的方法定义
Editor.Panel.extend({
    ready() {
        // 删去 new IpcUi() 及相关 els 属性映射 (testBtn, ipcList 等)，仅保留 tabMain / tabConfig 的逻辑钩子
    }
});
```

### 3. IPC 测试类下线
目标文件：[src/IpcUi.ts:L8](file:///c:/Users/Firekula/.CocosCreator/packages/mcp-bridge/src/IpcUi.ts#L8)
直接物理删除整个类文件，因为其仅为面板前端“IPC测试”标签单向服役。

### 4. 现有机制复用清单
* 本次仅作“减法”。原设定的主页 `tabMain` 与 配置 `tabConfig` 的切换核心机制（如 `switchTab` 函数和面板的 CSS `display` 高低频显隐控制）**被原样复用**，不新增重构 JS 的路由链路。

# 涉及文件清单
| 文件名 | 改动类型 | 说明 |
| :--- | :--- | :--- |
| `panel/index.html` | 修改 | 删除 tabTest / tabIpc 相关 HTML 节点及测试页面专供的所有冗余 CSS 样式 |
| `src/panel/index.ts` | 修改 | 卸载这2个页面的事件注册并删除发往外部服务器及内部通信的探针方法体 (`fetchTools`等) |
| `src/IpcUi.ts` | 删除 | 因为面板的 IPC 手动沙盒测试需求已废除，此类应连根拔起 |

# 边界情况 (Edge Cases)

### 1. 场景：UI 选择器找不到遗留抛异常
**风险**：如果在 `src/panel/index.ts` 的 `const els = { ... }` 映射定义区去掉了属性，但在底下类似 `switchTab` 切换调用中忘记移除对应的 `.forEach`，很容易出现 Cannot read property 'classList' of undefined。
**缓解策略**：在代码修改时，全局搜索被删除元素的 id (`tabTest`, `tabIpc`, `panelTest`, `panelIpc`)，严密剥离每一处 `els.` 的访问引用。

### 2. 场景：MCP 配置面板的定位不自然
**风险**：去除前，选项卡有足够的内容撑开布局。移除后如果样式未能正确处理 flex 的自动延展，右侧或底部可能出现异常留白。
**缓解策略**：复用既有的 `.tab-content` 中的 `flex: 1` 占据剩余空间配置，不需要修改底层 CSS，只删除无用内容。

### 3. 场景：仍有主进程向前端推送“IPC测试”导致溢出日志
**风险**：`src/main.ts` 中针对这部分可能仍暴露出接受探查的指令接口并向 renderer 推送反馈内容，而此时接收方已注销。
**缓解策略**：前端剥离后这些接口不再会被调用，但在后期可进行统一主进程废弃 IPC 名单回收，目前仅确保前端完全无感知且不崩溃即可。

### 4. 场景：package.json / MAIN menu 定义错位
**风险**：原 package.json 中配置的菜单触发命令仍是 `mcp-bridge:open-test-panel`。
**缓解策略**：保留此命名作为“打开控制面板”的兜底意图或仅仅只在面板内部精简内容，暂无需强改菜单 ID 防止旧用户找不到入口。但需知悉其实际已化身为配置和主控总成，可暂时共存。
