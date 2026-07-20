import { describe, expect, it } from "vitest";

import { statisticsToExportRows, toCsv, toXlsx } from "../src/export.js";

describe("экспорт CSV", () => {
  it("экранирует формулы и кавычки без записи файла", () => {
    expect(toCsv([{ spent: 12.5, text: '=SUM(A1:A2)', note: '"тест"' }])).toEqual({
      columns: ["note", "spent", "text"],
      content: '\uFEFF"note","spent","text"\r\n"\"\"тест\"\"","12.5","\'=SUM(A1:A2)"\r\n',
    });
  });

  it("создаёт XLSX в памяти и не превращает текст в формулу", () => {
    const result = toXlsx([{ spent: 12.5, text: "=SUM(A1:A2)", enabled: true }]);
    const archive = Buffer.from(result.content, "base64");
    expect(archive.subarray(0, 4).toString("ascii")).toBe("PK\u0003\u0004");
    expect(archive.toString("utf8")).toContain("xl/worksheets/sheet1.xml");
    expect(archive.toString("utf8")).toContain("=SUM(A1:A2)");
    expect(archive.toString("utf8")).not.toContain("<f>");
    expect(result.columns).toEqual(["enabled", "spent", "text"]);
  });

  it("разворачивает statistics в безопасные плоские строки с total", () => {
    expect(statisticsToExportRows({
      items: [{ id: 10, base: { spent: 12.5, clicks: 3 } }],
      total: { base: { spent: 12.5, clicks: 3 } },
      includeTotal: true,
    })).toEqual([
      { row_type: "item", id: 10, "base.spent": 12.5, "base.clicks": 3 },
      { row_type: "total", "base.spent": 12.5, "base.clicks": 3 },
    ]);
  });
});
