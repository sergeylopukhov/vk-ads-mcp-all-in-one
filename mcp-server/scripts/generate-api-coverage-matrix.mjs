import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const matrixPath = resolve(root, "docs", "VK_ADS_API_ENDPOINT_MATRIX.json");
const markdownPath = resolve(root, "docs", "VK_ADS_API_ENDPOINT_MATRIX.md");

const markdownCell = (value) => String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", "<br>");

export function renderMatrixMarkdown(matrix) {
  const statuses = ["missing", "docs_verified", "implemented", "live_read_verified", "live_write_verified"];
  const counts = Object.fromEntries(statuses.map((status) => [status, matrix.records.filter((record) => record.status === status).length]));
  const rows = matrix.records.map((record, index) =>
    `| ${index + 1} | ${markdownCell(record.endpoint)} | ${record.http_method} | ${record.api_version} | ${markdownCell(record.mcp_tool)} | ${record.status} | ${markdownCell(record.test)} | ${markdownCell(record.limitation)} |`,
  );

  return [
    "# Матрица покрытия официального VK Ads API",
    "",
    `Источник: [официальная документация VK Ads API](${matrix.source_url}). Реестр сгенерирован из \`VK_ADS_API_ENDPOINT_MATRIX.json\`; вручную не редактируется.`,
    "",
    `Проверка индекса: ${matrix.generated_at}. Счётная единица — уникальная каноническая пара endpoint + HTTP-метод; OAuth и aliases исключены.`,
    "",
    `Всего: **${matrix.count}**. missing: ${counts.missing}; docs_verified: ${counts.docs_verified}; implemented: ${counts.implemented}; live_read_verified: ${counts.live_read_verified}; live_write_verified: ${counts.live_write_verified}.`,
    "",
    "| # | Endpoint | Метод | Версия | MCP tool | Статус | Тест | Ограничение |",
    "|---:|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

export async function readMatrix() {
  return JSON.parse(await readFile(matrixPath, "utf8"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const matrix = await readMatrix();
  await writeFile(markdownPath, renderMatrixMarkdown(matrix));
  console.log(`Матрица Markdown сгенерирована: ${matrix.count} операций.`);
}
