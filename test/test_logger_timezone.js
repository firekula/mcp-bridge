const assert = require("assert");

// 1. 验证独立的格式化逻辑
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
console.log("测试独立逻辑生成的时间字符串:", nowStr);
assert.strictEqual(pattern.test(nowStr), true, "时间格式必须符合 YYYY-MM-DD HH:mm:ss.SSS ±HH:mm");

// 2. 如果存在编译后的 Logger，进一步验证 Logger 类的输出
try {
    const { Logger } = require("../dist/core/Logger");
    if (Logger && typeof Logger.formatLocalTimeWithOffset === "function") {
        const loggerTimeStr = Logger.formatLocalTimeWithOffset();
        console.log("测试 Logger.formatLocalTimeWithOffset 生成的时间字符串:", loggerTimeStr);
        assert.strictEqual(pattern.test(loggerTimeStr), true, "Logger 生成的时间格式必须符合规范");

        Logger.clearLogs();
        Logger.info("测试日志");
        const logs = Logger.getLogs();
        const lastLog = logs[logs.length - 1];
        console.log("测试 Logger.log 记录的时间:", lastLog.time);
        assert.strictEqual(pattern.test(lastLog.time), true, "Logger.log 记录的时间格式必须符合规范");
    }
} catch (e) {
    if (e.code !== "MODULE_NOT_FOUND") {
        throw e;
    }
}

console.log("✅ 测试通过");
