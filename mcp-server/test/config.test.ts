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
  });

  it("изолирует token и audit для named profile", () => {
    expect(resolveProfileStorage("/tmp/vk-ads-mcp", "agency_a")).toEqual({
      envFile: "/tmp/vk-ads-mcp/profiles/agency_a.env",
      auditFile: "/tmp/vk-ads-mcp/profiles/agency_a.vk-ads-audit.json",
    });
    expect(resolveProfileStorage("/tmp/vk-ads-mcp", "default")).toEqual({
      envFile: "/tmp/vk-ads-mcp/.env",
      auditFile: "/tmp/vk-ads-mcp/.vk-ads-audit.json",
    });
    expect(() => resolveProfileStorage("/tmp/vk-ads-mcp", "../other")).toThrow("VK_ADS_PROFILE");
  });

  it("объясняет, где указать отсутствующий токен", () => {
    expect(() => loadConfig({}).tokenProvider()).toThrow("Создайте файл .env");
  });

  it("принимает allowlist тестовых iOS app ID только из конфигурации запуска", () => {
    const config = loadConfig({
      VK_ADS_TOKEN: "test-token",
      VK_ADS_ALLOW_SHARING_KEY_REVOKE: "1",
      VK_ADS_ALLOW_SKADNETWORK_WRITES: "1",
      VK_ADS_TEST_IOS_APP_IDS: "10,20,10",
      VK_ADS_ALLOW_INAPP_EVENT_CATEGORY_WRITES: "1",
      VK_ADS_TEST_MOBILE_APP_IDS: "30,40,30",
      VK_ADS_ALLOW_REMARKETING_COUNTER_WRITES: "1",
      VK_ADS_TEST_COUNTER_IDS: "50,60,50",
    });

    expect(config.allowSharingKeyRevoke).toBe(true);
    expect(config.allowSkAdNetworkWrites).toBe(true);
    expect(config.skAdNetworkTestAppIds).toEqual([10, 20]);
    expect(config.allowInAppEventCategoryWrites).toBe(true);
    expect(config.inAppEventTestAppIds).toEqual([30, 40]);
    expect(config.allowRemarketingCounterWrites).toBe(true);
    expect(config.remarketingCounterTestIds).toEqual([50, 60]);
    expect(() => loadConfig({ VK_ADS_TOKEN: "test-token", VK_ADS_TEST_IOS_APP_IDS: "1,not-an-id" })).toThrow("VK_ADS_TEST_IOS_APP_IDS");
    expect(() => loadConfig({ VK_ADS_TOKEN: "test-token", VK_ADS_TEST_MOBILE_APP_IDS: "1,not-an-id" })).toThrow("VK_ADS_TEST_MOBILE_APP_IDS");
    expect(() => loadConfig({ VK_ADS_TOKEN: "test-token", VK_ADS_TEST_COUNTER_IDS: "1,not-an-id" })).toThrow("VK_ADS_TEST_COUNTER_IDS");
  });

  it("держит внешний ключ шаринга только в локальной конфигурации", () => {
    expect(loadConfig({ VK_ADS_TOKEN: "test-token", VK_ADS_EXTERNAL_SHARING_KEY: "safe_key-7" }).externalSharingKey).toBe("safe_key-7");
    expect(() => loadConfig({ VK_ADS_TOKEN: "test-token", VK_ADS_EXTERNAL_SHARING_KEY: "not safe" })).toThrow("VK_ADS_EXTERNAL_SHARING_KEY");
  });
});
