import { describe, expect, it } from "vitest";

import { loadConfig, resolveProfileStorage } from "../src/config.js";

describe("локальная конфигурация", () => {
  it("выбирает профиль при запуске без переключения из MCP", () => {
    const config = loadConfig({ VK_ADS_TOKEN: "test-token", VK_ADS_PROFILE: "agency_a" });

    expect(config.profileName).toBe("agency_a");
    expect(config.connectionId).toBe("agency_a");
    expect(config.tokenProvider()).toBe("test-token");
  });

  it("отклоняет небезопасное имя профиля", () => {
    expect(() => loadConfig({ VK_ADS_TOKEN: "test-token", VK_ADS_PROFILE: "../other" })).toThrow("VK_ADS_PROFILE");
  });

  it("задаёт ограниченный срок действия write preview только из локальной конфигурации", () => {
    expect(loadConfig({ VK_ADS_TOKEN: "test-token" }).previewTtlMs).toBe(600_000);
    expect(loadConfig({ VK_ADS_TOKEN: "test-token", VK_ADS_PREVIEW_TTL_MINUTES: "60" }).previewTtlMs).toBe(3_600_000);
    expect(() => loadConfig({ VK_ADS_TOKEN: "test-token", VK_ADS_PREVIEW_TTL_MINUTES: "61" })).toThrow("VK_ADS_PREVIEW_TTL_MINUTES");
    expect(loadConfig({ VK_ADS_TOKEN: "test-token", VK_ADS_REQUIRE_WRITE_CONFIRMATION: "0" }).requireWriteConfirmation).toBe(false);
    expect(() => loadConfig({ VK_ADS_TOKEN: "test-token", VK_ADS_REQUIRE_WRITE_CONFIRMATION: "no" })).toThrow("VK_ADS_REQUIRE_WRITE_CONFIRMATION");
    expect(loadConfig({ VK_ADS_TOKEN: "test-token" }).communityResearchTtlMs).toBe(30 * 24 * 60 * 60 * 1_000);
    expect(loadConfig({ VK_ADS_TOKEN: "test-token", VK_COMMUNITY_RESEARCH_TTL_DAYS: "90" }).communityResearchTtlMs).toBe(90 * 24 * 60 * 60 * 1_000);
    expect(() => loadConfig({ VK_ADS_TOKEN: "test-token", VK_COMMUNITY_RESEARCH_TTL_DAYS: "91" })).toThrow("VK_COMMUNITY_RESEARCH_TTL_DAYS");
  });

  it("изолирует token и audit для named profile", () => {
    expect(resolveProfileStorage("/tmp/vk-ads-mcp", "agency_a")).toEqual({
      envFile: "/tmp/vk-ads-mcp/profiles/agency_a.env",
      auditFile: "/tmp/vk-ads-mcp/profiles/agency_a.vk-ads-audit.json",
      communityResearchFile: "/tmp/vk-ads-mcp/profiles/agency_a.vk-community-research.json",
    });
    expect(resolveProfileStorage("/tmp/vk-ads-mcp", "default")).toEqual({
      envFile: "/tmp/vk-ads-mcp/.env",
      auditFile: "/tmp/vk-ads-mcp/.vk-ads-audit.json",
      communityResearchFile: "/tmp/vk-ads-mcp/.vk-community-research.json",
    });
    expect(() => resolveProfileStorage("/tmp/vk-ads-mcp", "../other")).toThrow("VK_ADS_PROFILE");
  });

  it("объясняет, где указать отсутствующий токен", () => {
    expect(() => loadConfig({}).tokenProvider()).toThrow("Создайте файл .env");
  });

  it("в write-режиме включает все реализованные категории записи без отдельных opt-in", () => {
    const config = loadConfig({
      VK_ADS_TOKEN: "test-token",
      VK_ADS_MODE: "write",
    });

    expect(config.allowSharingKeyRevoke).toBe(true);
    expect(config.allowSkAdNetworkWrites).toBe(true);
    expect(config.allowInAppEventCategoryWrites).toBe(true);
    expect(config.allowRemarketingCounterWrites).toBe(true);
    expect(loadConfig({ VK_ADS_TOKEN: "test-token" }).allowRemarketingCounterWrites).toBe(false);
  });

  it("держит внешний ключ шаринга только в локальной конфигурации", () => {
    expect(loadConfig({ VK_ADS_TOKEN: "test-token", VK_ADS_EXTERNAL_SHARING_KEY: "safe_key-7" }).externalSharingKey).toBe("safe_key-7");
    expect(() => loadConfig({ VK_ADS_TOKEN: "test-token", VK_ADS_EXTERNAL_SHARING_KEY: "not safe" })).toThrow("VK_ADS_EXTERNAL_SHARING_KEY");
  });
});
