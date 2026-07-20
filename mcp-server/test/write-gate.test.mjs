import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WriteGate } from "../dist/write-gate.js";

test("preview нельзя выполнить повторно", () => {
  const gate = new WriteGate(true, () => 1_000, () => "00000000-0000-4000-8000-000000000001");
  const preview = gate.prepare("create_url", { url: "https://example.test" });
  gate.consume(preview.id, preview.confirmation_statement);
  assert.throws(() => gate.consume(preview.id, preview.confirmation_statement), /уже использован/);
});

test("audit переживает перезапуск и не хранит payload", () => {
  const directory = mkdtempSync(join(tmpdir(), "vk-ads-mcp-test-"));
  const auditFile = join(directory, "audit.json");
  try {
    const gate = new WriteGate(true, () => 1_000, () => "00000000-0000-4000-8000-000000000002", auditFile);
    const preview = gate.prepare("create_url", { url: "https://private.example.test/path" });
    gate.complete(preview, "succeeded", { id: 42 });

    const restored = new WriteGate(true, () => 1_000, () => "00000000-0000-4000-8000-000000000003", auditFile);
    assert.equal(restored.listAudit().length, 1);
    const raw = readFileSync(auditFile, "utf8");
    assert.equal(raw.includes("private.example.test"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
