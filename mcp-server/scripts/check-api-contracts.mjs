import { toolCatalog } from "../dist/tool-catalog.js";

const names = toolCatalog.map((tool) => tool.name);
const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
const invalid = toolCatalog.filter((tool) => !["planned", "implemented", "docs_verified", "live_read_verified", "live_write_verified"].includes(tool.status));

if (duplicates.length > 0) throw new Error(`В каталоге повторяются инструменты: ${[...new Set(duplicates)].join(", ")}`);
if (invalid.length > 0) throw new Error(`Инструменты с недопустимым статусом: ${invalid.map((tool) => tool.name).join(", ")}`);
if (!names.includes("analytics_anomalies") || !names.includes("analytics_delivery_issues")) {
  throw new Error("В каталоге отсутствуют реализованные инструменты аналитики.");
}

console.log(`Каталог контрактов проверен: ${toolCatalog.length} инструментов.`);
