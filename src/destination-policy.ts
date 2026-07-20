import { isIP } from "node:net";

export interface ValidatedAdvertisingDestination {
  url: string;
  hostname: string;
}

/** Не выполняет DNS-запросы: для рекламной ссылки разрешает только публичный HTTPS domain. */
export function validateAdvertisingDestination(value: string): ValidatedAdvertisingDestination {
  if (value.length < 1 || value.length > 2_048) throw new Error("URL должен содержать от 1 до 2048 символов.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Некорректный URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) {
    throw new Error("Разрешён только абсолютный HTTPS URL без логина и пароля.");
  }
  const hostname = parsed.hostname.toLowerCase();
  const bareIp = hostname.replace(/^\[|\]$/g, "");
  if (isIP(bareIp) !== 0 || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Для рекламной ссылки нужен публичный домен, а не IP-адрес или localhost.");
  }
  if (hostname.length > 253 || !hostname.includes(".") || hostname.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    throw new Error("В URL нужен корректный публичный домен.");
  }
  return { url: parsed.toString(), hostname };
}
