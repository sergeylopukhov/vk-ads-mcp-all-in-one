import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  VK_ADS_API_DOCS_INDEX_URL,
  createApiDocsInventory,
  diffApiDocsInventory,
  hasApiDocsInventoryChanges,
  type ApiDocsInventory,
} from "../src/api-docs-inventory.js";

const snapshotPath = resolve(process.cwd(), "vk-ads-api-docs-snapshot.json");
const update = process.argv.includes("--update");
const strict = process.argv.includes("--strict");
const timeoutMs = 20_000;
const maxReadAttempts = 3;

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function fetchText(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxReadAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
      const destination = new URL(response.url);
      if (destination.protocol !== "https:" || !["ads.vk.com", "ads.vk.ru"].includes(destination.hostname)) {
        throw new Error("Документация VK Ads перенаправила запрос на неразрешённый host.");
      }
      if (response.ok) return response.text();
      if (response.status < 500 && response.status !== 429) throw new Error(`VK Ads documentation returned HTTP ${response.status} for ${url}.`);
      lastError = new Error(`VK Ads documentation returned retryable HTTP ${response.status} for ${url}.`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < maxReadAttempts) await wait(attempt * 500);
  }
  throw lastError instanceof Error ? lastError : new Error("Не удалось получить документацию VK Ads.");
}

async function readSnapshot(): Promise<ApiDocsInventory | null> {
  try {
    return JSON.parse(await readFile(snapshotPath, "utf8")) as ApiDocsInventory;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

const indexHtml = await fetchText(VK_ADS_API_DOCS_INDEX_URL);
const current = createApiDocsInventory(indexHtml, new Date().toISOString());
if (current.resources.length === 0 || current.endpoint_paths.length === 0) throw new Error("Не удалось извлечь ресурсы или API-пути из официального индекса VK Ads API.");
const previous = await readSnapshot();

if (update || !previous) {
  await writeFile(snapshotPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: previous ? "snapshot_updated" : "snapshot_created", snapshot: snapshotPath, resources: current.resources.length, endpoint_paths: current.endpoint_paths.length }, null, 2));
} else {
  const diff = diffApiDocsInventory(previous, current);
  console.log(JSON.stringify({ status: hasApiDocsInventoryChanges(diff) ? "changes_detected" : "up_to_date", resources: current.resources.length, endpoint_paths: current.endpoint_paths.length, diff }, null, 2));
  if (strict && hasApiDocsInventoryChanges(diff)) process.exitCode = 2;
}
