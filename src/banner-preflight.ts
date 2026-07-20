/**
 * Локальные правила для единственного подтверждённого banner-шаблона:
 * appinstalls, package 2860, pattern 284. Это не универсальные лимиты VK Ads.
 */
export interface KnownStaticImage {
  id: number;
  width: number;
  height: number;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sha256: string;
}

export interface TestBannerDraft {
  landscape_image_id: number;
  icon_image_id: number;
  title: string;
  text: string;
}

export interface BannerPreflightCheck {
  code: "landscape_image" | "icon_image" | "title" | "text";
  status: "pass" | "fail";
  message: string;
}

export interface BannerPreflightResult {
  ready: boolean;
  checks: BannerPreflightCheck[];
}

function imageCheck(
  code: "landscape_image" | "icon_image",
  imageId: number,
  expected: { width: number; height: number },
  knownImages: ReadonlyMap<number, KnownStaticImage>,
): BannerPreflightCheck {
  const image = knownImages.get(imageId);
  const label = code === "landscape_image" ? "Горизонтальное изображение" : "Иконка";
  if (!image) {
    return {
      code,
      status: "fail",
      message: `${label}: content_id=${imageId} не был загружен в текущем MCP-сеансе. Нельзя подтвердить обязательный размер ${expected.width}×${expected.height}.`,
    };
  }
  if (image.width !== expected.width || image.height !== expected.height) {
    return {
      code,
      status: "fail",
      message: `${label}: нужен размер ${expected.width}×${expected.height}, получен ${image.width}×${image.height}.`,
    };
  }
  return {
    code,
    status: "pass",
    message: `${label}: размер ${image.width}×${image.height} подтверждён локально.`,
  };
}

/** Не отправляет запросы и не пытается угадать правила других пакетов или шаблонов. */
export function validateConfirmedTestBannerDraft(
  draft: TestBannerDraft,
  knownImages: ReadonlyMap<number, KnownStaticImage>,
): BannerPreflightResult {
  const checks: BannerPreflightCheck[] = [
    imageCheck("landscape_image", draft.landscape_image_id, { width: 1080, height: 607 }, knownImages),
    imageCheck("icon_image", draft.icon_image_id, { width: 256, height: 256 }, knownImages),
    draft.title.trim().length >= 1 && draft.title.trim().length <= 40
      ? { code: "title", status: "pass", message: "Заголовок: длина от 1 до 40 символов подтверждена." }
      : { code: "title", status: "fail", message: "Заголовок: требуется непустой текст длиной от 1 до 40 символов." },
    draft.text.trim().length >= 1 && draft.text.trim().length <= 90
      ? { code: "text", status: "pass", message: "Текст: длина от 1 до 90 символов подтверждена." }
      : { code: "text", status: "fail", message: "Текст: требуется непустой текст длиной от 1 до 90 символов." },
  ];
  return { ready: checks.every((check) => check.status === "pass"), checks };
}
