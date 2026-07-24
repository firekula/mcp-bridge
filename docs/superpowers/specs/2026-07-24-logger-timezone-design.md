# 日志时区与本地时间格式化设计文档 (Logger Timezone & Local Time Design)

## 1. 背景与问题描述 (Background & Context)

在现有的 MCP Bridge 插件中，`src/core/Logger.ts` 记录日志时使用 `new Date().toISOString()` 生成时间戳字符串。

* **问题**：`toISOString()` 始终输出 **UTC 协调世界时**（例如 `2026-07-24 02:59:07.123`），而东八区（UTC+8）用户的本地系统时间为 `10:59:07`。这导致用户查看面板及日志文件 `.log` 时，发现日志时间与本地电脑系统时间相差 8 个小时，造成混淆。
* **目标**：将日志时间修正为**电脑本地时间**，并带上明确的**时区偏移量（Timezone Offset）**，既满足本地排查直观性，又符合跨时区分析规范。

---

## 2. 详细设计 (Detailed Design)

### 2.1 时间格式规范 (Time Format Standard)

修改后的日志时间格式定义如下：
`YYYY-MM-DD HH:mm:ss.SSS ±HH:mm`

**示例**：
- 北京时间 (UTC+8): `2026-07-24 10:59:07.123 +08:00`
- 伦敦时间 (UTC+0): `2026-07-24 02:59:07.123 +00:00`
- 纽约时间 (UTC-4): `2026-07-24 22:59:07.123 -04:00`

### 2.2 核心实现逻辑 (Core Implementation)

在 `src/core/Logger.ts` 中添加本地时间及时区格式化私有/辅助方法：

```typescript
/**
 * 格式化 Date 为本地时间 + 时区偏移量字符串
 * @param date 目标 Date 对象，默认为当前时间
 * @returns 格式如 "2026-07-24 10:59:07.123 +08:00"
 */
private static formatLocalTimeWithOffset(date: Date = new Date()): string {
    const pad = (num: number, len: number = 2) => String(num).padStart(len, "0");

    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    const ms = pad(date.getMilliseconds(), 3);

    // getTimezoneOffset() 返回 UTC 与本地的差值（分钟数），东八区为 -480
    const offsetMinutes = date.getTimezoneOffset();
    const sign = offsetMinutes <= 0 ? "+" : "-";
    const absOffset = Math.abs(offsetMinutes);
    const offsetHours = pad(Math.floor(absOffset / 60));
    const offsetMins = pad(absOffset % 60);

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms} ${sign}${offsetHours}:${offsetMins}`;
}
```

在 `Logger.log()` 中使用此函数：

```typescript
public static log(type: 'info' | 'success' | 'warn' | 'error' | 'mcp', message: string) {
    const logEntry = {
        time: Logger.formatLocalTimeWithOffset(),
        type: type,
        content: message,
    };
    // ...其余逻辑保持不变
}
```

---

## 3. 兼容性与影响分析 (Impact & Compatibility)

1. **面板渲染 (`src/panel/index.ts`)**：
   - 面板日志控制台使用 `logEntry.time` 直接渲染显示，更新后将无缝展示带时区的本地时间。
2. **文件日志 (`mcp-bridge.log`)**：
   - 追加写入的文本形如 `[2026-07-24 10:59:07.123 +08:00] [info] ...`，完全向后兼容解析。
3. **IPC 通信**：
   - `mcp-bridge:on-log` 消息结构中 `time` 仍然是 `string` 类型，无破坏性改动。

---

## 4. 验证计划 (Verification Plan)

1. **单元/功能测试**：
   - 执行构建与 TypeScript 校验 (`npm run build` 或 `tsc`) 确保类型无误。
   - 调用 `Logger.log()` 验证生成的日志时间格式符合 `YYYY-MM-DD HH:mm:ss.SSS ±HH:mm`。
2. **模拟多时区测试**：
   - 验证 `getTimezoneOffset()` 计算在正数偏移与负数偏移下的符号和数值输出正确。
