import { describe, expect, it } from "vitest";

import { WriteGate } from "../src/write-gate.js";

describe("WriteGate", () => {
  it("не готовит запись без явно включённого write-режима", () => {
    const gate = new WriteGate(false);
    expect(() => gate.prepare("delete_test_ad_plan", { ad_plan_id: 1 })).toThrow("VK_ADS_MODE=write");
  });

  it("выдаёт одноразовое подтверждение для неизменённого payload", () => {
    let time = 1_000;
    const gate = new WriteGate(true, () => time, () => "00000000-0000-4000-8000-000000000001");
    const preview = gate.prepare("create_test_ad_plan", {
      name: "__MCP_TEST__ test",
      objective: "traffic",
      package_id: 1,
    });

    expect(preview.payload_hash).toHaveLength(64);
    expect(preview.confirmation_statement).toBe("Любое непустое сообщение пользователя");
    expect(() => gate.consume(preview.id, "   ")).toThrow("Нужно непустое");
    expect(gate.consume(preview.id, "выполняй")).toMatchObject({ id: preview.id });
    expect(() => gate.consume(preview.id, "да")).toThrow("уже использован");
    time += 1;
  });

  it("отклоняет просроченное подтверждение", () => {
    let time = 0;
    const gate = new WriteGate(true, () => time, () => "00000000-0000-4000-8000-000000000002");
    const preview = gate.prepare("delete_test_ad_plan", { ad_plan_id: 1 });
    time = 600_001;
    expect(() => gate.consume(preview.id, preview.confirmation_statement)).toThrow("истёк");
  });

  it("использует явно заданный ограниченный срок preview", () => {
    let time = 0;
    const gate = new WriteGate(true, () => time, () => "00000000-0000-4000-8000-000000000004", undefined, 60 * 60 * 1_000);
    const preview = gate.prepare("delete_test_ad_plan", { ad_plan_id: 1 });
    time = 3_599_999;
    expect(gate.consume(preview.id, preview.confirmation_statement)).toMatchObject({ id: preview.id });
  });

  it("разрешает локально отключить фразу, сохраняя одноразовость preview", () => {
    const gate = new WriteGate(true, () => 1_000, () => "00000000-0000-4000-8000-000000000005", undefined, 600_000, false);
    const preview = gate.prepare("create_test_ad_plan", { name: "__MCP_TEST__ test" });
    expect(gate.consume(preview.id, undefined)).toMatchObject({ id: preview.id });
    expect(() => gate.consume(preview.id, undefined)).toThrow("уже использован");
  });

  it("привязывает preview к подключению и хранит аудит без payload", () => {
    let time = 1_000;
    const gate = new WriteGate(true, () => time, () => "00000000-0000-4000-8000-000000000003");
    const preview = gate.prepare("delete_test_ad_plan", { ad_plan_id: 1 }, "agency-client-a");
    expect(() => gate.consume(preview.id, preview.confirmation_statement, "agency-client-b")).toThrow("другого подключения");
    const consumed = gate.consume(preview.id, preview.confirmation_statement, "agency-client-a");
    time += 1;
    const audit = gate.complete(consumed, "succeeded", { id: 1, name: "__MCP_TEST__" });

    expect(audit).toMatchObject({ connection_id: "agency-client-a", status: "succeeded" });
    expect(audit.result_hash).toHaveLength(64);
    expect(JSON.stringify(gate.listAudit())).not.toContain("__MCP_TEST__");
  });
});
