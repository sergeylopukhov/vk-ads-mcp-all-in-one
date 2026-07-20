import { describe, expect, it } from "vitest";

import { validateTestAdGroupParent, validateTestAdPlanDraft } from "../src/write-preflight.js";

describe("локальный preflight test plan и group", () => {
  const packages = [{ id: 2860, objective: ["appinstalls"] }];

  it("останавливает неизвестную или несовместимую цель до create ad plan", () => {
    expect(validateTestAdPlanDraft({ package_id: 2860, objective: "traffic" }, packages)).toMatchObject({
      ready: false,
      checks: [expect.anything(), { code: "objective", status: "fail" }],
    });
    expect(validateTestAdPlanDraft({ package_id: 999, objective: "appinstalls" }, packages)).toMatchObject({ ready: false });
  });

  it("подтверждает только test-родителя и существующий package для group", () => {
    expect(validateTestAdGroupParent({ id: 1, name: "__MCP_TEST__ plan" }, 2860, packages).ready).toBe(true);
    expect(validateTestAdGroupParent({ id: 1, name: "Рабочий план" }, 2860, packages)).toMatchObject({ ready: false });
  });
});
