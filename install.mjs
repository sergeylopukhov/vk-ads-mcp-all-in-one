#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const REPOSITORY = "sergeylopukhov/vk-ads-mcp-all-in-one";
const SERVER_ROOT = "mcp-server/";
const MANAGED_ENTRIES = ["dist", "node_modules", ".env.example", "package.json", "package-lock.json"];

export function defaultInstallDirectory(platform = process.platform, home = homedir(), environment = process.env) {
  const platformPath = platform === "win32" ? win32 : posix;
  if (platform === "win32") {
    return platformPath.join(environment.LOCALAPPDATA || platformPath.join(home, "AppData", "Local"), "VK Ads MCP");
  }
  if (platform === "darwin") return platformPath.join(home, "Library", "Application Support", "VK Ads MCP");
  return platformPath.join(environment.XDG_DATA_HOME || platformPath.join(home, ".local", "share"), "vk-ads-mcp");
}

export function selectServerFiles(tree) {
  return tree
    .filter((item) => item.type === "blob" && item.path?.startsWith(SERVER_ROOT))
    .map((item) => item.path)
    .filter((path) =>
      path === `${SERVER_ROOT}.env.example`
      || path === `${SERVER_ROOT}package.json`
      || path === `${SERVER_ROOT}package-lock.json`
      || path === `${SERVER_ROOT}tsconfig.json`
      || path.startsWith(`${SERVER_ROOT}src/`),
    );
}

function serializeEnvValue(value) {
  return /^[A-Za-z0-9_./:@+-]*$/.test(value) ? value : JSON.stringify(value);
}

export function applyEnvValues(template, values) {
  let output = template;
  for (const [name, value] of Object.entries(values)) {
    if (/[\r\n]/.test(value)) throw new Error(`${name} должен занимать одну строку.`);
    const line = `${name}=${serializeEnvValue(value)}`;
    const pattern = new RegExp(`^(?:#\\s*)?${name}=.*$`, "m");
    output = pattern.test(output) ? output.replace(pattern, line) : `${output.trimEnd()}\n${line}\n`;
  }
  return output;
}

export function fillCredentials(template, clientId, clientSecret) {
  return applyEnvValues(template, { VK_ADS_CLIENT_ID: clientId, VK_ADS_CLIENT_SECRET: clientSecret });
}

export function parseEnvValues(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { /* dotenv сообщит об ошибке при запуске. */ }
    }
    values[match[1]] = value;
  }
  return values;
}

export function parseInstalledVersion(content) {
  try {
    const value = JSON.parse(content);
    return typeof value?.ref === "string" && value.ref ? value.ref : undefined;
  } catch {
    return undefined;
  }
}

export function requiresConfiguration(values) {
  return !values.VK_ADS_CLIENT_ID || !values.VK_ADS_CLIENT_SECRET;
}

function parseArguments(argv) {
  const options = { ref: undefined, installDirectory: undefined, register: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--no-register") options.register = false;
    else if (argument === "--ref") options.ref = argv[++index];
    else if (argument.startsWith("--ref=")) options.ref = argument.slice(6);
    else if (argument === "--install-dir") options.installDirectory = argv[++index];
    else if (argument.startsWith("--install-dir=")) options.installDirectory = argument.slice(14);
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Неизвестный параметр: ${argument}`);
  }
  return options;
}

function printHelp() {
  console.log(`VK Ads MCP installer

Использование: node install.mjs [параметры]
  --ref <tag|branch>       установить указанный тег или ветку
  --install-dir <path>     изменить каталог установки
  --no-register            не подключать сервер к Codex
  -h, --help               показать справку`);
}

async function fetchJson(url, { allowNotFound = false } = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "vk-ads-mcp-installer" },
  });
  if (allowNotFound && response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GitHub вернул HTTP ${response.status} для ${url}`);
  return response.json();
}

export async function resolveRef(requestedRef, loadLatestRelease = () => fetchJson(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, { allowNotFound: true })) {
  if (requestedRef) return requestedRef;
  const release = await loadLatestRelease();
  return release?.tag_name || "main";
}

async function downloadServer(ref, destination) {
  console.log(`Получаю VK Ads MCP (${ref})…`);
  const tree = await fetchJson(`https://api.github.com/repos/${REPOSITORY}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  if (tree.truncated) throw new Error("GitHub вернул неполное дерево файлов. Повторите установку позже.");
  const paths = selectServerFiles(tree.tree || []);
  for (const required of ["package.json", "package-lock.json", "tsconfig.json", ".env.example"]) {
    if (!paths.includes(`${SERVER_ROOT}${required}`)) throw new Error(`В релизе отсутствует ${SERVER_ROOT}${required}`);
  }
  if (!paths.some((path) => path.startsWith(`${SERVER_ROOT}src/`))) {
    throw new Error("В релизе отсутствуют исходники MCP-сервера.");
  }

  await Promise.all(paths.map(async (repositoryPath) => {
    const relativePath = repositoryPath.slice(SERVER_ROOT.length);
    const outputPath = join(destination, relativePath);
    const url = `https://raw.githubusercontent.com/${REPOSITORY}/${tree.sha}/${repositoryPath}`;
    const response = await fetch(url, { headers: { "User-Agent": "vk-ads-mcp-installer" } });
    if (!response.ok) throw new Error(`Не удалось скачать ${repositoryPath}: HTTP ${response.status}`);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, new Uint8Array(await response.arrayBuffer()));
  }));
  return tree.sha;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Команда завершилась с кодом ${result.status}: ${command} ${args.join(" ")}`);
}

async function buildServer(directory) {
  console.log("Устанавливаю зависимости и собираю сервер…");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["ci", "--no-audit", "--no-fund"], { cwd: directory });
  run(npm, ["run", "build"], { cwd: directory });
  run(npm, ["prune", "--omit=dev", "--no-audit", "--no-fund"], { cwd: directory });
}

async function pathExists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error?.code === "EISDIR") return true;
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function installedVersion(installDirectory) {
  try {
    return parseInstalledVersion(await readFile(join(installDirectory, ".vk-ads-install.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function chooseInstallMode(installed, available, hasEnv) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || (!installed && !hasEnv)) return "update";
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`Установлена версия: ${installed || "неизвестна"}. Доступна версия: ${available}.`);
    while (true) {
      const answer = await ask(readline, "Действие: 1 — обновить без изменения настроек, 2 — установить заново", "1");
      if (answer === "1") return "update";
      if (answer === "2") return "reinstall";
      console.log("Введите 1 или 2.");
    }
  } finally {
    readline.close();
  }
}

async function deployServer(stagingDirectory, installDirectory, ref, commitSha) {
  await mkdir(installDirectory, { recursive: true });
  const backupDirectory = join(installDirectory, ".installer-backup");
  await rm(backupDirectory, { recursive: true, force: true });
  await mkdir(backupDirectory, { recursive: true });
  const replaced = [];

  try {
    for (const entry of MANAGED_ENTRIES) {
      const target = join(installDirectory, entry);
      if (await pathExists(target)) {
        await rename(target, join(backupDirectory, entry));
        replaced.push(entry);
      }
      await cp(join(stagingDirectory, entry), target, { recursive: true });
    }
    await writeFile(join(installDirectory, ".vk-ads-install.json"), `${JSON.stringify({ repository: REPOSITORY, ref, commitSha, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  } catch (error) {
    for (const entry of MANAGED_ENTRIES) {
      await rm(join(installDirectory, entry), { recursive: true, force: true });
    }
    for (const entry of replaced) {
      await rename(join(backupDirectory, entry), join(installDirectory, entry));
    }
    throw error;
  }
}

async function promptHidden(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== "function") return undefined;
  process.stdout.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let value = "";
  try {
    await new Promise((resolve, reject) => {
      const finish = (error) => {
        process.stdin.off("data", onData);
        process.stdin.off("error", onError);
        process.stdin.off("end", onEnd);
        if (error) reject(error); else resolve();
      };
      const onError = (error) => finish(error);
      const onEnd = () => finish(new Error("Скрытый ввод был прерван. Повторите установку в обычном терминале."));
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === "\r" || character === "\n") return finish();
          if (character === "\u0003") return finish(new Error("Установка отменена."));
          if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
          else value += character;
        }
      };
      process.stdin.on("data", onData);
      process.stdin.once("error", onError);
      process.stdin.once("end", onEnd);
    });
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\n");
  }
  return value.trim();
}

async function promptVisible(question) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await readline.question(question)).trim();
  } finally {
    readline.close();
  }
}

async function ask(readline, question, defaultValue = "") {
  const answer = (await readline.question(`${question}${defaultValue ? ` (${defaultValue})` : ""}: `)).trim();
  return answer || defaultValue;
}

async function askBoolean(readline, question, defaultValue = false) {
  const hint = defaultValue ? "Д/н" : "д/Н";
  while (true) {
    const answer = (await readline.question(`${question} [${hint}]: `)).trim().toLowerCase();
    if (!answer) return defaultValue;
    if (["д", "да", "y", "yes"].includes(answer)) return true;
    if (["н", "нет", "n", "no"].includes(answer)) return false;
    console.log("Введите «да» или «нет».");
  }
}

async function askInteger(readline, question, defaultValue, minimum, maximum) {
  while (true) {
    const value = Number(await ask(readline, question, String(defaultValue)));
    if (Number.isInteger(value) && value >= minimum && value <= maximum) return value;
    console.log(`Введите целое число от ${minimum} до ${maximum}.`);
  }
}

async function askIdentifier(readline, question, defaultValue) {
  while (true) {
    const value = await ask(readline, question, defaultValue);
    if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) return value;
    console.log("Разрешены буквы, цифры, _ и -; длина — до 64 символов.");
  }
}

async function askMode(readline, defaultValue) {
  while (true) {
    const value = await ask(readline, "Режим: 1 — только чтение (рекомендуется), 2 — чтение и запись", defaultValue === "write" ? "2" : "1");
    if (value === "1") return "readonly";
    if (value === "2") return "write";
    console.log("Введите 1 или 2.");
  }
}

async function askOptionalAbsolutePath(readline, question, defaultValue = "") {
  while (true) {
    const value = await ask(readline, question, defaultValue);
    if (!value || isAbsolute(value)) return value;
    console.log("Укажите абсолютный путь или оставьте поле пустым.");
  }
}

const COMMUNITY_REDIRECT_URI = "https://vk.ru/blank.html";
const COMMUNITY_LEGACY_REDIRECT_URI = "https://oauth.vk.ru/blank.html";
const DEFAULT_COMMUNITY_LEGACY_CLIENT_ID = "6270012";

function printCommunityOAuthSetup() {
  console.log("Создайте приложение VK ID: https://id.vk.com/about/business/go/");
  console.log(`В его настройках добавьте доверенный redirect URL: ${COMMUNITY_REDIRECT_URI}`);
  console.log("Для Core VK API включите права groups и wall. Затем вставьте только client_id приложения.");
}

async function askCommunityTokenType(readline, defaultValue = "legacy") {
  while (true) {
    const value = await ask(readline, "Токен сообществ: 1 — legacy OAuth (рекомендуется), 2 — VK ID OAuth", defaultValue === "vk_id" ? "2" : "1");
    if (value === "1") return "legacy";
    if (value === "2") return "vk_id";
    console.log("Введите 1 или 2.");
  }
}

async function authorizeCommunityToolsLegacy(clientId) {
  if (!/^\d+$/.test(clientId)) throw new Error("VK client_id должен состоять из цифр.");
  const authorizationUrl = new URL("https://oauth.vk.com/authorize");
  authorizationUrl.search = new URLSearchParams({ client_id: clientId, scope: "335876", redirect_uri: COMMUNITY_LEGACY_REDIRECT_URI, display: "page", response_type: "token", revoke: "1" }).toString();
  console.log("Открываю legacy OAuth в браузере. После входа скопируйте полный URL страницы oauth.vk.ru/blank.html и вернитесь сюда.");
  openBrowser(authorizationUrl.toString());
  const callbackUrl = await promptVisible("URL страницы oauth.vk.ru/blank.html: ");
  let callback;
  try { callback = new URL(callbackUrl); } catch { throw new Error("Нужен полный URL страницы oauth.vk.ru/blank.html после авторизации."); }
  if (!new Set(["https://oauth.vk.com", "https://oauth.vk.ru"]).has(callback.origin) || callback.pathname !== "/blank.html") throw new Error("Нужен URL страницы oauth.vk.ru/blank.html после авторизации.");
  const accessToken = new URLSearchParams(callback.hash.slice(1)).get("access_token");
  if (!accessToken) throw new Error("OAuth не вернул access_token. Повторите авторизацию.");
  return { accessToken, tokenType: "legacy" };
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function randomUrlValue() {
  return randomBytes(32).toString("base64url");
}

async function authorizeCommunityToolsVkId(clientId) {
  if (!/^\d+$/.test(clientId)) throw new Error("VK ID client_id должен состоять из цифр.");
  const state = randomUrlValue();
  const verifier = randomUrlValue();
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorizationUrl = new URL("https://id.vk.ru/authorize");
  authorizationUrl.search = new URLSearchParams({ response_type: "code", client_id: clientId, scope: "groups wall", redirect_uri: COMMUNITY_REDIRECT_URI, state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
  console.log("Открываю VK ID в браузере. После входа скопируйте полный URL страницы vk.ru/blank.html и вернитесь сюда.");
  openBrowser(authorizationUrl.toString());
  const callbackUrl = await promptVisible("URL страницы vk.ru/blank.html: ");
  let callback;
  try { callback = new URL(callbackUrl); } catch { throw new Error("Нужен полный URL страницы vk.ru/blank.html после авторизации."); }
  if (callback.origin !== "https://vk.ru" || callback.pathname !== "/blank.html") throw new Error("Нужен URL страницы https://vk.ru/blank.html после авторизации.");
  const code = callback.searchParams.get("code");
  const returnedState = callback.searchParams.get("state");
  const deviceId = callback.searchParams.get("device_id");
  if (!code || !deviceId || returnedState !== state) throw new Error("VK ID вернул неполный или неподтверждённый callback.");
  const tokenResponse = await fetch("https://id.vk.ru/oauth2/auth", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: clientId, grant_type: "authorization_code", code_verifier: verifier, device_id: deviceId, code, redirect_uri: COMMUNITY_REDIRECT_URI }),
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  const payload = await tokenResponse.json().catch(() => undefined);
  if (!tokenResponse.ok || !payload || typeof payload !== "object" || typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string") throw new Error("VK ID не выдал access_token и refresh_token. Проверьте доступы приложения groups и wall.");
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token, expiresIn: Number(payload.expires_in), deviceId, tokenType: "vk_id" };
}

async function authorizeCommunityTools(clientId, tokenType) {
  return tokenType === "legacy" ? authorizeCommunityToolsLegacy(clientId) : authorizeCommunityToolsVkId(clientId);
}

async function ensureConfiguration(installDirectory, reinstall = false) {
  const envPath = join(installDirectory, ".env");
  const envExists = await pathExists(envPath);

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    if (reinstall) throw new Error("Для установки заново нужен интерактивный терминал.");
    if (!envExists) {
      await cp(join(installDirectory, ".env.example"), envPath);
      await chmod(envPath, 0o600).catch(() => {});
      console.log(`Создан ${envPath}. Заполните VK_ADS_CLIENT_ID и VK_ADS_CLIENT_SECRET.`);
    } else {
      console.log("Существующий .env сохранён.");
    }
    const current = envExists ? parseEnvValues(await readFile(envPath, "utf8")) : {};
    return {
      mode: current.VK_ADS_MODE === "write" ? "write" : "readonly",
      profileName: current.VK_ADS_PROFILE || "default",
    };
  }

  const currentContent = envExists ? await readFile(envPath, "utf8") : "";
  const saved = parseEnvValues(currentContent);
  const current = reinstall ? {} : saved;
  if (!reinstall && envExists && !requiresConfiguration(current)) {
    console.log("Настройки сохранены; обновление не запрашивает учётные данные.");
    return { mode: current.VK_ADS_MODE === "write" ? "write" : "readonly", profileName: current.VK_ADS_PROFILE || "default" };
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });

  console.log("\nНастройка VK Ads MCP. Нажмите Enter, чтобы принять значение в скобках.\n");
  const clientId = await ask(readline, "VK Ads client_id", current.VK_ADS_CLIENT_ID || "");
  const replaceSecret = !current.VK_ADS_CLIENT_SECRET || await askBoolean(readline, "Заменить сохранённый client_secret?", false);
  const mode = await askMode(readline, current.VK_ADS_MODE === "write" ? "write" : "readonly");
  const configureAdvanced = mode === "write"
    && await askBoolean(readline, "Настроить дополнительные возможности записи?", false);

  let profileName = current.VK_ADS_PROFILE || "default";
  let connectionId = current.VK_ADS_CONNECTION_ID || profileName;
  let timeoutMs = Number(current.VK_ADS_TIMEOUT_MS) || 30_000;
  let logging = current.VK_ADS_LOG === "1";
  let auditFile = current.VK_ADS_AUDIT_FILE || "";
  let uploadDir = current.VK_ADS_UPLOAD_DIR || "";
  let allowPiiUploads = current.VK_ADS_ALLOW_PII_UPLOADS === "1";
  let piiUploadDir = current.VK_ADS_PII_UPLOAD_DIR || "";
  let allowAgencyWrites = current.VK_ADS_ALLOW_AGENCY_WRITES === "1";
  let allowSharingKeyRevoke = current.VK_ADS_ALLOW_SHARING_KEY_REVOKE === "1";
  let allowSkAdNetworkWrites = current.VK_ADS_ALLOW_SKADNETWORK_WRITES === "1";
  let allowInAppEventCategoryWrites = current.VK_ADS_ALLOW_INAPP_EVENT_CATEGORY_WRITES === "1";
  let allowRemarketingCounterWrites = current.VK_ADS_ALLOW_REMARKETING_COUNTER_WRITES === "1";
  const enableCommunityTools = await askBoolean(readline, "Включить поиск и анализ публичных сообществ VK?", Boolean(current.VK_API_TOKEN));
  const authorizeCommunities = enableCommunityTools && (!current.VK_API_TOKEN || await askBoolean(readline, "Авторизовать токен сообществ заново?", false));
  let communityTokenType = current.VK_API_TOKEN_TYPE || (current.VK_API_REFRESH_TOKEN ? "vk_id" : "legacy");
  let communityClientId = current.VK_API_CLIENT_ID || (communityTokenType === "legacy" ? DEFAULT_COMMUNITY_LEGACY_CLIENT_ID : "");
  if (authorizeCommunities) {
    communityTokenType = await askCommunityTokenType(readline, communityTokenType);
    if (communityTokenType === "vk_id") printCommunityOAuthSetup();
    if (communityTokenType === "legacy" && current.VK_API_TOKEN_TYPE !== "legacy") communityClientId = DEFAULT_COMMUNITY_LEGACY_CLIENT_ID;
    communityClientId = await ask(readline, communityTokenType === "legacy" ? "VK client_id приложения (Enter — встроенное)" : "VK ID client_id приложения", communityClientId || (communityTokenType === "legacy" ? DEFAULT_COMMUNITY_LEGACY_CLIENT_ID : ""));
  }

  if (configureAdvanced) {
    console.log("\nДополнительные разрешения записи. Оставляйте «нет», если функция не нужна.\n");
    profileName = await askIdentifier(readline, "Имя профиля", profileName);
    connectionId = await askIdentifier(readline, "ID подключения", connectionId);
    timeoutMs = await askInteger(readline, "Таймаут запросов, мс", timeoutMs, 1_000, 120_000);
    logging = await askBoolean(readline, "Включить обезличенный журнал HTTP-запросов?", logging);
    auditFile = await ask(readline, "Файл аудита записей; пусто — стандартный путь", auditFile);
    uploadDir = await askOptionalAbsolutePath(readline, "Каталог разрешённых медиафайлов", current.VK_ADS_UPLOAD_DIR || "");
    allowPiiUploads = await askBoolean(readline, "Разрешить загрузку PII-аудиторий?", current.VK_ADS_ALLOW_PII_UPLOADS === "1");
    if (allowPiiUploads) piiUploadDir = await askOptionalAbsolutePath(readline, "Каталог разрешённых PII-файлов", current.VK_ADS_PII_UPLOAD_DIR || "");
    allowAgencyWrites = await askBoolean(readline, "Разрешить изменения агентских клиентов?", current.VK_ADS_ALLOW_AGENCY_WRITES === "1");
    allowSharingKeyRevoke = await askBoolean(readline, "Разрешить отзыв ключей шаринга?", current.VK_ADS_ALLOW_SHARING_KEY_REVOKE === "1");
    allowSkAdNetworkWrites = await askBoolean(readline, "Разрешить изменения SKAdNetwork?", current.VK_ADS_ALLOW_SKADNETWORK_WRITES === "1");
    allowInAppEventCategoryWrites = await askBoolean(readline, "Разрешить изменение категорий in-app событий?", current.VK_ADS_ALLOW_INAPP_EVENT_CATEGORY_WRITES === "1");
    allowRemarketingCounterWrites = await askBoolean(readline, "Разрешить изменение счётчиков ремаркетинга?", current.VK_ADS_ALLOW_REMARKETING_COUNTER_WRITES === "1");
  }
  readline.close();
  const clientSecret = replaceSecret ? await promptHidden("VK Ads client_secret (ввод скрыт): ") : current.VK_ADS_CLIENT_SECRET;
  const communityAuth = authorizeCommunities ? await authorizeCommunityTools(communityClientId, communityTokenType) : undefined;
  if (!clientId || !clientSecret) throw new Error("client_id и client_secret не могут быть пустыми.");
  const template = await readFile(join(installDirectory, ".env.example"), "utf8");
  const base = envExists && !reinstall ? currentContent : template;
  const content = applyEnvValues(base, {
    VK_ADS_PROFILE: profileName,
    VK_ADS_MODE: mode,
    VK_ADS_LOG: logging ? "1" : "0",
    VK_ADS_AUDIT_FILE: auditFile,
    VK_ADS_CLIENT_ID: clientId,
    VK_ADS_CLIENT_SECRET: clientSecret,
    VK_ADS_CONNECTION_ID: connectionId,
    VK_ADS_TIMEOUT_MS: String(timeoutMs),
    VK_ADS_UPLOAD_DIR: uploadDir,
    VK_ADS_ALLOW_PII_UPLOADS: allowPiiUploads ? "1" : "0",
    VK_ADS_PII_UPLOAD_DIR: piiUploadDir,
    VK_ADS_ALLOW_AGENCY_WRITES: allowAgencyWrites ? "1" : "0",
    VK_ADS_ALLOW_SHARING_KEY_REVOKE: allowSharingKeyRevoke ? "1" : "0",
    VK_ADS_ALLOW_SKADNETWORK_WRITES: allowSkAdNetworkWrites ? "1" : "0",
    VK_ADS_ALLOW_INAPP_EVENT_CATEGORY_WRITES: allowInAppEventCategoryWrites ? "1" : "0",
    VK_ADS_ALLOW_REMARKETING_COUNTER_WRITES: allowRemarketingCounterWrites ? "1" : "0",
    VK_API_TOKEN: enableCommunityTools ? (communityAuth?.accessToken || current.VK_API_TOKEN || "") : "",
    VK_API_TOKEN_TYPE: enableCommunityTools ? (communityAuth?.tokenType || communityTokenType) : "",
    VK_API_REFRESH_TOKEN: enableCommunityTools ? (communityAuth?.refreshToken || (communityTokenType === "vk_id" ? current.VK_API_REFRESH_TOKEN || "" : "")) : "",
    VK_API_TOKEN_EXPIRES_AT: enableCommunityTools ? (communityAuth && Number.isInteger(communityAuth.expiresIn) && communityAuth.expiresIn > 0 ? new Date(Date.now() + communityAuth.expiresIn * 1000).toISOString() : current.VK_API_TOKEN_EXPIRES_AT || "") : "",
    VK_API_CLIENT_ID: enableCommunityTools ? (communityAuth ? communityClientId : current.VK_API_CLIENT_ID || "") : "",
    VK_API_DEVICE_ID: enableCommunityTools ? (communityAuth?.deviceId || current.VK_API_DEVICE_ID || "") : "",
  });
  await writeFile(envPath, content, { mode: 0o600 });
  await chmod(envPath, 0o600).catch(() => {});
  console.log(`Настройки сохранены: ${envPath}`);
  return { mode, profileName };
}

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore", shell: false });
  return !result.error && result.status === 0;
}

function registerCodex(installDirectory, profileName) {
  if (!commandAvailable("codex")) {
    console.log("Codex CLI не найден. Сервер установлен, но не подключён к клиенту.");
    return false;
  }
  spawnSync("codex", ["mcp", "remove", "vk-ads"], { stdio: "ignore", shell: false });
  run("codex", ["mcp", "add", "vk-ads", "--env", `VK_ADS_PROFILE=${profileName}`, "--", process.execPath, join(installDirectory, "dist", "index.js")]);
  return true;
}

export async function main(argv = process.argv.slice(2)) {
  if (Number(process.versions.node.split(".")[0]) < 20) throw new Error("Нужен Node.js 20 или новее.");
  const options = parseArguments(argv);
  if (options.help) return printHelp();

  const installDirectory = resolve(options.installDirectory || defaultInstallDirectory());
  const ref = await resolveRef(options.ref);
  const installMode = await chooseInstallMode(await installedVersion(installDirectory), ref, await pathExists(join(installDirectory, ".env")));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "vk-ads-mcp-"));
  const stagingDirectory = join(temporaryRoot, "server");
  await mkdir(stagingDirectory, { recursive: true });

  try {
    const commitSha = await downloadServer(ref, stagingDirectory);
    await buildServer(stagingDirectory);
    await deployServer(stagingDirectory, installDirectory, ref, commitSha);
    const configuration = await ensureConfiguration(installDirectory, installMode === "reinstall");
    const registered = options.register ? registerCodex(installDirectory, configuration.profileName) : false;
    console.log(`\nVK Ads MCP установлен: ${installDirectory}`);
    console.log(`Версия источника: ${ref} (${commitSha.slice(0, 12)})`);
    console.log(`Профиль: ${configuration.profileName}. Режим: ${configuration.mode}.`);
    if (registered) console.log("Подключение Codex: vk-ads. Перезапустите Codex.");
    else console.log(`Команда сервера: ${process.execPath} ${join(installDirectory, "dist", "index.js")}`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const isDirectExecution = import.meta.url.startsWith("data:")
  || (import.meta.url.startsWith("file:") && process.argv[1]
    && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]));

if (isDirectExecution) {
  try {
    await main();
  } catch (error) {
    console.error(`\nОшибка установки: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
