#!/usr/bin/env node

import { spawnSync } from "node:child_process";
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
    input: for await (const chunk of process.stdin) {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") break input;
        if (character === "\u0003") throw new Error("Установка отменена.");
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    }
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\n");
  }
  return value.trim();
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

async function askPositiveIds(readline, question, defaultValue = "") {
  while (true) {
    const value = await ask(readline, question, defaultValue);
    if (!value || value.split(",").every((item) => Number.isInteger(Number(item.trim())) && Number(item.trim()) > 0)) return value;
    console.log("Укажите положительные ID через запятую или оставьте поле пустым.");
  }
}

async function askOptionalPositiveId(readline, question, defaultValue = "") {
  while (true) {
    const value = await ask(readline, question, defaultValue);
    if (!value || (Number.isInteger(Number(value)) && Number(value) > 0)) return value;
    console.log("Укажите положительный целый ID или оставьте поле пустым.");
  }
}

async function ensureConfiguration(installDirectory) {
  const envPath = join(installDirectory, ".env");
  const envExists = await pathExists(envPath);

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
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
  const current = parseEnvValues(currentContent);
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  if (envExists && !(await askBoolean(readline, "Изменить сохранённые настройки?", false))) {
    if (!current.VK_API_TOKEN && await askBoolean(readline, "Включить поиск и анализ публичных сообществ VK?", false)) {
      readline.close();
      const token = await promptHidden("Core VK API token для сообществ (ввод скрыт): ");
      if (!token) throw new Error("Core VK API token не может быть пустым.");
      const featureReadline = createInterface({ input: process.stdin, output: process.stdout });
      const accountId = await askOptionalPositiveId(featureReadline, "ID рекламного аккаунта Core VK API (нужен только для добавления в сегмент; можно оставить пустым)", "");
      featureReadline.close();
      const template = await readFile(join(installDirectory, ".env.example"), "utf8");
      await writeFile(envPath, applyEnvValues(currentContent || template, { VK_API_TOKEN: token, VK_API_AD_ACCOUNT_ID: accountId }), { mode: 0o600 });
      await chmod(envPath, 0o600).catch(() => {});
      console.log("Функция публичных сообществ VK включена.");
    } else {
      readline.close();
    }
    console.log("Существующий .env сохранён.");
    return {
      mode: current.VK_ADS_MODE === "write" ? "write" : "readonly",
      profileName: current.VK_ADS_PROFILE || "default",
    };
  }

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
  let skAdNetworkTestAppIds = current.VK_ADS_TEST_IOS_APP_IDS || "";
  let allowInAppEventCategoryWrites = current.VK_ADS_ALLOW_INAPP_EVENT_CATEGORY_WRITES === "1";
  let inAppEventTestAppIds = current.VK_ADS_TEST_MOBILE_APP_IDS || "";
  let allowRemarketingCounterWrites = current.VK_ADS_ALLOW_REMARKETING_COUNTER_WRITES === "1";
  let remarketingCounterTestIds = current.VK_ADS_TEST_COUNTER_IDS || "";
  const enableCommunityTools = await askBoolean(readline, "Включить поиск и анализ публичных сообществ VK?", Boolean(current.VK_API_TOKEN));
  const replaceCommunityToken = enableCommunityTools && (!current.VK_API_TOKEN || await askBoolean(readline, "Заменить сохранённый Core VK API token для сообществ?", false));
  let communityAccountId = current.VK_API_AD_ACCOUNT_ID || "";

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
    if (allowSkAdNetworkWrites) skAdNetworkTestAppIds = await askPositiveIds(readline, "Разрешённые тестовые iOS app ID через запятую", current.VK_ADS_TEST_IOS_APP_IDS || "");
    allowInAppEventCategoryWrites = await askBoolean(readline, "Разрешить изменение категорий in-app событий?", current.VK_ADS_ALLOW_INAPP_EVENT_CATEGORY_WRITES === "1");
    if (allowInAppEventCategoryWrites) inAppEventTestAppIds = await askPositiveIds(readline, "Разрешённые тестовые mobile app ID через запятую", current.VK_ADS_TEST_MOBILE_APP_IDS || "");
    allowRemarketingCounterWrites = await askBoolean(readline, "Разрешить изменение счётчиков ремаркетинга?", current.VK_ADS_ALLOW_REMARKETING_COUNTER_WRITES === "1");
    if (allowRemarketingCounterWrites) remarketingCounterTestIds = await askPositiveIds(readline, "Разрешённые тестовые ID счётчиков через запятую", current.VK_ADS_TEST_COUNTER_IDS || "");
  }
  readline.close();
  const clientSecret = replaceSecret ? await promptHidden("VK Ads client_secret (ввод скрыт): ") : current.VK_ADS_CLIENT_SECRET;
  const communityToken = enableCommunityTools && replaceCommunityToken
    ? await promptHidden("Core VK API token для сообществ (ввод скрыт): ")
    : current.VK_API_TOKEN || "";
  if (enableCommunityTools && !communityToken && !current.VK_API_TOKEN) throw new Error("Core VK API token не может быть пустым, если функция включена.");
  if (enableCommunityTools) {
    const accountReadline = createInterface({ input: process.stdin, output: process.stdout });
    communityAccountId = await askOptionalPositiveId(accountReadline, "ID рекламного аккаунта Core VK API (нужен только для добавления в сегмент; можно оставить пустым)", communityAccountId);
    accountReadline.close();
  }
  if (!clientId || !clientSecret) throw new Error("client_id и client_secret не могут быть пустыми.");
  const template = await readFile(join(installDirectory, ".env.example"), "utf8");
  const base = envExists ? currentContent : template;
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
    VK_ADS_TEST_IOS_APP_IDS: skAdNetworkTestAppIds,
    VK_ADS_ALLOW_INAPP_EVENT_CATEGORY_WRITES: allowInAppEventCategoryWrites ? "1" : "0",
    VK_ADS_TEST_MOBILE_APP_IDS: inAppEventTestAppIds,
    VK_ADS_ALLOW_REMARKETING_COUNTER_WRITES: allowRemarketingCounterWrites ? "1" : "0",
    VK_ADS_TEST_COUNTER_IDS: remarketingCounterTestIds,
    VK_API_TOKEN: enableCommunityTools ? (communityToken || current.VK_API_TOKEN) : "",
    VK_API_AD_ACCOUNT_ID: enableCommunityTools ? communityAccountId : "",
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
  const temporaryRoot = await mkdtemp(join(tmpdir(), "vk-ads-mcp-"));
  const stagingDirectory = join(temporaryRoot, "server");
  await mkdir(stagingDirectory, { recursive: true });

  try {
    const commitSha = await downloadServer(ref, stagingDirectory);
    await buildServer(stagingDirectory);
    await deployServer(stagingDirectory, installDirectory, ref, commitSha);
    const configuration = await ensureConfiguration(installDirectory);
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
