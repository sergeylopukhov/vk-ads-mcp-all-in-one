import { describe, expect, it } from "vitest";

import { validateConfirmedTestBannerDraft, type KnownStaticImage } from "../src/banner-preflight.js";

const image = (id: number, width: number, height: number): KnownStaticImage => ({
  id,
  width,
  height,
  mimeType: "image/png",
  sha256: "a".repeat(64),
});

describe("локальный preflight подтверждённого banner-шаблона", () => {
  it("принимает только обязательные размеры и непустые тексты", () => {
    const result = validateConfirmedTestBannerDraft({
      landscape_image_id: 1,
      icon_image_id: 2,
      title: "Тест",
      text: "Тестовый текст",
    }, new Map([[1, image(1, 1080, 607)], [2, image(2, 256, 256)]]));

    expect(result.ready).toBe(true);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "landscape_image", status: "pass" }),
      expect.objectContaining({ code: "icon_image", status: "pass" }),
    ]));
  });

  it("отклоняет квадрат вместо обязательного горизонтального изображения до API-вызова", () => {
    const result = validateConfirmedTestBannerDraft({
      landscape_image_id: 1,
      icon_image_id: 2,
      title: "Тест",
      text: "Тестовый текст",
    }, new Map([[1, image(1, 1254, 1254)], [2, image(2, 256, 256)]]));

    expect(result.ready).toBe(false);
    expect(result.checks[0]).toMatchObject({ code: "landscape_image", status: "fail" });
    expect(result.checks[0]?.message).toContain("1080×607");
  });

  it("не разрешает непроверенный content_id", () => {
    const result = validateConfirmedTestBannerDraft({
      landscape_image_id: 1,
      icon_image_id: 2,
      title: "Тест",
      text: "Тестовый текст",
    }, new Map([[1, image(1, 1080, 607)]]));

    expect(result.ready).toBe(false);
    expect(result.checks[1]).toMatchObject({ code: "icon_image", status: "fail" });
  });
});
