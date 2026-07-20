import { describe, expect, it } from "vitest";

import { createApiDocsInventory, diffApiDocsInventory, extractApiDocsResourceNames, hasApiDocsInventoryChanges } from "../src/api-docs-inventory.js";

describe("инвентарь официальной документации VK Ads", () => {
  it("извлекает resource-страницы и нормализует API-пути", () => {
    const index = '<a href="/ru/doc/api/resource/LeadForm">Lead form</a><a href="/ru/doc/api/resource/Content">Content</a>';
    const inventory = createApiDocsInventory(`${index}<code>/api/v1/lead_ads/lead_forms/17.json?get_active_form_ad_plans=1</code><code>/api/v1/lead_ads/lead_forms/17/copy</code>`, "2026-07-20T00:00:00.000Z");

    expect(extractApiDocsResourceNames(index)).toEqual(["Content", "LeadForm"]);
    expect(inventory.endpoint_paths).toEqual(["/api/v1/lead_ads/lead_forms/{id}.json", "/api/v1/lead_ads/lead_forms/{id}/copy"]);
  });

  it("показывает только новые, удалённые и реально изменившиеся ресурсы", () => {
    const before = createApiDocsInventory('<a href="/ru/doc/api/resource/LeadForm">Lead form</a>/api/v1/lead_ads/lead_forms/17.json', "2026-07-20T00:00:00.000Z");
    const after = createApiDocsInventory('<a href="/ru/doc/api/resource/LeadForm">Lead form</a><a href="/ru/doc/api/resource/Survey">Survey</a>/api/v1/lead_ads/lead_forms/17.json /api/v1/lead_ads/lead_forms/17/copy', "2026-07-20T01:00:00.000Z");

    const diff = diffApiDocsInventory(before, after);
    expect(diff.added_resources).toEqual(["Survey"]);
    expect(diff.added_endpoints).toEqual(["/api/v1/lead_ads/lead_forms/{id}/copy"]);
    expect(hasApiDocsInventoryChanges(diff)).toBe(true);
  });
});
