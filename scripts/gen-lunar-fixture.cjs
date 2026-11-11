"use strict";

// 生成农历对照向量：桌面端 vendor/lunar（6tail 的 JS 实现）与 Android 端
// cn.6tail:lunar（同作者 Java 实现）对同一天的输出必须一致。
//
// 用法：node scripts/gen-lunar-fixture.cjs > test/fixtures/lunar-2026.json

const Lunar = require("../vendor/lunar/lunar.js");

const days = [];

function pad(n) { return String(n).padStart(2, "0"); }

for (let year = 2026; year <= 2027; year++) {
  const monthCount = year === 2026 ? 12 : 1;
  for (let month = 1; month <= monthCount; month++) {
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const solar = Lunar.Solar.fromYmd(year, month, day);
      const lunar = solar.getLunar();
      days.push({
        date: `${year}-${pad(month)}-${pad(day)}`,
        lunarYear: lunar.getYear(),
        lunarMonth: lunar.getMonth(),
        lunarDay: lunar.getDay(),
        monthCn: lunar.getMonthInChinese(),
        dayCn: lunar.getDayInChinese(),
        jieQi: lunar.getJieQi(),
        lunarFestivals: lunar.getFestivals(),
        solarFestivals: solar.getFestivals(),
      });
    }
  }
}

process.stdout.write(JSON.stringify({ version: 1, source: "vendor/lunar (6tail lunar-js)", days }, null, 2) + "\n");
