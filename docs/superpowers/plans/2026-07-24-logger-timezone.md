# 日志时区与本地时间格式化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MCP Bridge 日志记录的时间格式从 UTC 转换格式修改为带时区偏移量的电脑本地时间格式（例如 `2026-07-24 10:59:07.123 +08:00`）。

**Architecture:** 在 `src/core/Logger.ts` 中实现本地时间与 UTC 时区偏移量格式化辅助函数 `formatLocalTimeWithOffset`，并在 `Logger.log()` 入口统一进行时间标记。

**Tech Stack:** TypeScript, Node.js (`Date.prototype.getTimezoneOffset`)

## Global Constraints

- 遵从 TypeScript (`.ts`) 代码规范与 JSDoc 注释要求。
- 格式规范：`YYYY-MM-DD HH:mm:ss.SSS ±HH:mm`。
- 不改变 `Logger.log()` 的 IPC 通信结构与日志缓冲区 API 签名。

---

### Task 1: 在 Logger.ts 中实现本地时间及时区格式化方法并替代旧有逻辑

**Files:**
- Modify: `src/core/Logger.ts`
- Create: `test/test_logger_timezone.js`

**Interfaces:**
- Produces: `Logger.formatLocalTimeWithOffset(date?: Date): string`

- [ ] **Step 1: 创建测试验证脚本 `test/test_logger_timezone.js`**

```javascript
const assert = require("assert");

// 模拟格式化测试
function formatLocalTimeWithOffset(date = new Date()) {
    const pad = (num, len = 2) => String(num).padStart(len, "0");

    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    const ms = pad(date.getMilliseconds(), 3);

    const offsetMinutes = date.getTimezoneOffset();
    const sign = offsetMinutes <= 0 ? "+" : "-";
    const absOffset = Math.abs(offsetMinutes);
    const offsetHours = pad(Math.floor(absOffset / 60));
    const offsetMins = pad(absOffset % 60);

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms} ${sign}${offsetHours}:${offsetMins}`;
}

// 验证输出格式正则匹配：YYYY-MM-DD HH:mm:ss.SSS ±HH:mm
const nowStr = formatLocalTimeWithOffset();
const pattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [\+\-]\d{2}:\d{2}$/;
console.log("测试生成的时间字符串:", nowStr);
assert.strictEqual(pattern.test(nowStr), true, "时间格式必须符合 YYYY-MM-DD HH:mm:ss.SSS ±HH:mm");
console.log("✅ 测试通过");
```

- [ ] **Step 2: 运行测试脚本**

Run: `node test/test_logger_timezone.js`
Expected: 打印 `测试生成的时间字符串: ...` 并输出 `✅ 测试通过`

- [ ] **Step 3: 在 `src/core/Logger.ts` 中增加格式化函数并替换旧有的 UTC 时间生成逻辑**

修改 `src/core/Logger.ts`：

```typescript
	/**
	 * 格式化 Date 为本地时间 + 时区偏移量字符串
	 * @param date 目标 Date 对象，默认为当前时间
	 * @returns 格式如 "2026-07-24 10:59:07.123 +08:00"
	 */
	public static formatLocalTimeWithOffset(date: Date = new Date()): string {
		const pad = (num: number, len: number = 2) => String(num).padStart(len, "0");

		const year = date.getFullYear();
		const month = pad(date.getMonth() + 1);
		const day = pad(date.getDate());
		const hours = pad(date.getHours());
		const minutes = pad(date.getMinutes());
		const seconds = pad(date.getSeconds());
		const ms = pad(date.getMilliseconds(), 3);

		const offsetMinutes = date.getTimezoneOffset();
		const sign = offsetMinutes <= 0 ? "+" : "-";
		const absOffset = Math.abs(offsetMinutes);
		const offsetHours = pad(Math.floor(absOffset / 60));
		const offsetMins = pad(absOffset % 60);

		return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms} ${sign}${offsetHours}:${offsetMins}`;
	}
```

并将 `Logger.log` 方法中的：
```typescript
		const logEntry = {
			time: new Date().toISOString().replace("T", " ").substring(0, 23),
			type: type,
			content: message,
		};
```
替换为：
```typescript
		const logEntry = {
			time: Logger.formatLocalTimeWithOffset(),
			type: type,
			content: message,
		};
```

- [ ] **Step 4: 在 `test/test_logger_timezone.js` 中直接引入编译/转换后的组件或测试运行 Logger**

验证 Logger.log 生成的 `logEntry.time` 格式。

- [ ] **Step 5: 提交更改**

```bash
git add src/core/Logger.ts test/test_logger_timezone.js docs/superpowers/specs/2026-07-24-logger-timezone-design.md docs/superpowers/plans/2026-07-24-logger-timezone.md
git commit -m "feat: use local time with timezone offset in logger"
```
