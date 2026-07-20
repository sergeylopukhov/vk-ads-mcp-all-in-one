import { describe, expect, it } from "vitest";

import { validateAdvertisingDestination } from "../src/destination-policy.js";

describe("проверка рекламной посадочной страницы", () => {
  it("принимает публичный HTTPS-домен", () => {
    expect(validateAdvertisingDestination("https://example.test/offer?utm_source=vk")).toMatchObject({ hostname: "example.test" });
  });

  it.each(["http://example.test", "https://localhost:3000", "https://127.0.0.1/", "https://user:pass@example.test/"])("блокирует %s", (url) => {
    expect(() => validateAdvertisingDestination(url)).toThrow();
  });
});
