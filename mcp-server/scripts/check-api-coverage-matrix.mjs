import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readMatrix, renderMatrixMarkdown } from "./generate-api-coverage-matrix.mjs";

const root = resolve(process.cwd(), "..");
const matrixPath = resolve(root, "docs", "VK_ADS_API_ENDPOINT_MATRIX.json");
const markdownPath = resolve(root, "docs", "VK_ADS_API_ENDPOINT_MATRIX.md");
const catalogPath = resolve(process.cwd(), "dist", "tool-catalog.js");
const serverPath = resolve(process.cwd(), "src", "server.ts");
const matrix = await readMatrix();
const { toolCatalog } = await import(catalogPath);
const serverSource = await readFile(serverPath, "utf8");
const registeredToolNames = new Set();
for (const registration of ["registerTool", "registerCatalog", "registerList", "registerWritePreviewAlias"]) {
  for (const match of serverSource.matchAll(new RegExp(`${registration}\\(\\s*"([^"\\n]+)"`, "g"))) registeredToolNames.add(match[1]);
}
const toolNames = new Set([...toolCatalog.map(({ name }) => name), ...registeredToolNames]);
const requiredFields = ["endpoint", "http_method", "api_version", "resource", "mcp_tool", "status", "docs_url", "input_schema", "output_schema", "test", "docs_index_verified_at", "contract_verified_at", "verification_profile_role", "limitation"];
const statuses = new Set(["missing", "docs_verified", "implemented", "live_read_verified", "live_write_verified"]);
const seen = new Set();
const errors = [];

if (matrix.schema_version !== 1) errors.push(`Ожидалась schema_version=1, получено ${matrix.schema_version}`);
if (matrix.source_url !== "https://ads.vk.com/ru/doc/api") errors.push("Источник матрицы не совпадает с официальной документацией VK Ads.");
if (!Array.isArray(matrix.records)) errors.push("records должен быть массивом.");
if (matrix.count !== matrix.records?.length) errors.push(`count=${matrix.count} не равен числу records=${matrix.records?.length}.`);

for (const [index, record] of (matrix.records ?? []).entries()) {
  for (const field of requiredFields) if (!(field in record)) errors.push(`records[${index}] не содержит поле ${field}.`);
  const key = `${record.http_method} ${record.endpoint}`;
  if (seen.has(key)) errors.push(`Дублируется canonical operation: ${key}`);
  seen.add(key);
  if (!statuses.has(record.status)) errors.push(`${key}: неизвестный status=${record.status}`);
  if (record.status === "live_read_verified" && record.http_method !== "GET") errors.push(`${key}: live_read_verified допустим только для GET.`);
  if (record.status === "live_write_verified" && record.http_method === "GET") errors.push(`${key}: live_write_verified недопустим для GET.`);
  if (/\/oauth\b|\/token\b/.test(record.endpoint)) errors.push(`${key}: OAuth endpoint не должен входить в рекламную матрицу.`);
  if (!/^https:\/\/ads\.vk\.com\/ru\/doc\/api(?:\/resource\/[A-Za-z0-9_]+)?(?:#.*)?$/.test(record.docs_url)) errors.push(`${key}: docs_url должен вести на официальный источник.`);
  if (typeof record.docs_index_verified_at !== "string" || Number.isNaN(Date.parse(record.docs_index_verified_at))) errors.push(`${key}: docs_index_verified_at должен быть датой ISO 8601.`);
  if (typeof record.contract_verified_at !== "string" || Number.isNaN(Date.parse(record.contract_verified_at))) errors.push(`${key}: contract_verified_at должен быть датой ISO 8601.`);
  if (typeof record.verification_profile_role !== "string" || record.verification_profile_role.length === 0) errors.push(`${key}: verification_profile_role обязателен и не должен содержать PII.`);
  if (record.mcp_tool && !toolNames.has(record.mcp_tool)) errors.push(`${key}: MCP tool ${record.mcp_tool} отсутствует в tool-catalog.`);
  if (record.test) {
    try {
      await access(resolve(root, record.test));
    } catch {
      errors.push(`${key}: тест ${record.test} не найден.`);
    }
  }
  if (record.status === "implemented" || record.status === "live_read_verified" || record.status === "live_write_verified") {
    for (const field of ["mcp_tool", "input_schema", "output_schema", "test"]) {
      if (record[field] === null || record[field] === "") errors.push(`${key}: для ${record.status} обязательно поле ${field}.`);
    }
  }
}

const markdown = await readFile(markdownPath, "utf8");
if (markdown !== renderMatrixMarkdown(matrix)) errors.push("Markdown-матрица не совпадает с JSON. Запустите npm run matrix:generate.");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const counts = Object.fromEntries([...statuses].map((status) => [status, matrix.records.filter((record) => record.status === status).length]));
console.log(JSON.stringify({ count: matrix.count, unique_operations: seen.size, statuses: counts }, null, 2));
