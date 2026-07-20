import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { VK_ADS_API_DOCS_INDEX_URL, createApiDocsInventory, diffApiDocsInventory, hasApiDocsInventoryChanges } from "../dist/api-docs-inventory.js";

const snapshotPath = resolve(process.cwd(), "vk-ads-api-docs-snapshot.json");
const strict = process.argv.includes("--strict");
const update = process.argv.includes("--update");
const response = await fetch(VK_ADS_API_DOCS_INDEX_URL, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(20_000), redirect: "follow" });
const destination = new URL(response.url);
if (!response.ok || destination.protocol !== "https:" || !["ads.vk.com", "ads.vk.ru"].includes(destination.hostname)) throw new Error("Официальный индекс VK Ads недоступен или перенаправлен на запрещённый host.");
const current = createApiDocsInventory(await response.text(), new Date().toISOString());
if (current.resources.length === 0 || current.endpoint_paths.length === 0) throw new Error("Индекс VK Ads не содержит ожидаемых API-ресурсов.");
let previous = null;
try { previous = JSON.parse(await readFile(snapshotPath, "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
if (!previous || update) {
  await writeFile(snapshotPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
  console.log(`Снимок VK Ads API создан или обновлён: ${current.endpoint_paths.length} путей.`);
} else {
  const diff = diffApiDocsInventory(previous, current);
  console.log(JSON.stringify({ status: hasApiDocsInventoryChanges(diff) ? "changes_detected" : "up_to_date", diff }));
  if (strict && hasApiDocsInventoryChanges(diff)) process.exitCode = 2;
}
