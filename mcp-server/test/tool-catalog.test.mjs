import assert from "node:assert/strict";
import test from "node:test";

import { isExecutableTool, searchCatalog, toolCatalog } from "../dist/tool-catalog.js";
import { callableReadTools } from "../dist/server.js";

test("аналитические инструменты присутствуют в едином каталоге", () => {
  const names = new Set(toolCatalog.map((tool) => tool.name));
  assert.ok(names.has("analytics_anomalies"));
  assert.ok(names.has("analytics_delivery_issues"));
});

test("planned-инструменты скрываются из исполняемого каталога", () => {
  const planned = toolCatalog.find((tool) => tool.status === "planned");
  assert.ok(planned);
  assert.equal(isExecutableTool(planned), false);
  assert.equal(searchCatalog(planned.name).length, 1);
});

test("каждый callable read-инструмент зарегистрирован в каталоге", () => {
  const names = new Set(toolCatalog.map((tool) => tool.name));
  const missing = callableReadTools.filter((name) => !names.has(name));
  assert.deepEqual(missing, []);
});
