#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const REPOSITORY = "sergeylopukhov/vk-ads-mcp-all-in-one";
const MANAGED_ENTRIES = [
  "dist",
  "node_modules",
  ".env.example",
  "package.json",
  "package-lock.json",
  "codex-skill",
];

let cachedGitHubToken;

export function defaultInstallDirectory(
  platform = process.platform,
  home = homedir(),
  environment = process.env,
) {
  const platformPath = platform === "win32" ? win32 : posix;

  if (platform === "win32") {
    return platformPath.join(
      environment.LOCALAPPDATA ??
        platformPath.join(home, "AppData", "Local"),
      "VK Ads MCP",
    );
  }

  if (platform === "darwin") {
    return platformPath.join(
      home,
      "Library",
      "Application Support",
      "VK Ads MCP",
    );
  }

  return platformPath.join(
    environment.XDG_DATA_HOME ??
      platformPath.join(home, ".local", "share"),
    "vk-ads-mcp",
  );
}

export function selectServerFiles(tree) {
  return tree
    .filter((item) => item.type === "blob" && typeof item.path === "string")
    .map((item) => item.path)
    .filter(
      (path) =>
        path === ".env.example" ||
        path === "package.json" ||
        path === "package-lock.json" ||
        path === "tsconfig.json" ||
        path.startsWith("src/") ||
        path.startsWith("codex-skill/"),
    );
}

function encodeEnvValue(value) {
  if (/[\r\n]/u.test(value)) {
    throw new Error("Значение auth.env должно занимать одну строку.");
  }

  return /^[A-Za-z0-9._~+/=-]*$/u.test(value)
    ? value
    : JSON.stringify(value);
}

export function applyEnvValues(template, values) {
  let output = template;

  for (const [name, value] of Object.entries(values)) {
    const line = `${name}=${encodeEnvValue(value)}`;
    const pattern = new RegExp(`^(?:#\\s*)?${name}=.*$`, "mu");
    output = pattern.test(output)
      ? output.replace(pattern, line)
      : `${output.trimEnd()}\n${line}\n`;
  }

  return output;
}

export function parseEnvValues(content) {
  const values = {};

  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/u);

    if (!match) {
      continue;
    }

    let value = match[2].trim();

    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        // Сам сервер вернёт точную ошибку, если файл изменили вручную.
      }
    }

    values[match[1]] = value;
  }

  return values;
}

export function parseInstalledVersion(content) {
  try {
    const value = JSON.parse(content);
    return typeof value?.ref === "string" && value.ref
      ? value.ref
      : undefined;
  } catch {
    return undefined;
  }
}

export function requiresConfiguration(values) {
  return !values.VK_ADS_CLIENT_ID || !values.VK_ADS_CLIENT_SECRET;
}

function parseArguments(argv) {
  const options = {
    ref: undefined,
    installDirectory: undefined,
    register: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--no-register") {
      options.register = false;
    } else if (argument === "--ref") {
      options.ref = argv[++index];
    } else if (argument.startsWith("--ref=")) {
      options.ref = argument.slice(6);
    } else if (argument === "--install-dir") {
      options.installDirectory = argv[++index];
    } else if (argument.startsWith("--install-dir=")) {
      options.installDirectory = argument.slice(14);
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Неизвестный параметр: ${argument}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`VK Ads MCP installer

Использование: node install.mjs [параметры]
  --ref <tag|branch>       установить указанный тег или ветку
  --install-dir <path>     изменить каталог установки
  --no-register            не настраивать Codex
  -h, --help               показать справку`);
}

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    shell: false,
  });

  return !result.error && result.status === 0;
}

function resolveGitHubToken() {
  if (cachedGitHubToken !== undefined) {
    return cachedGitHubToken;
  }

  const environmentToken =
    process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();

  if (environmentToken) {
    cachedGitHubToken = environmentToken;
    return cachedGitHubToken;
  }

  if (commandAvailable("gh")) {
    const result = spawnSync("gh", ["auth", "token"], {
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
    });

    if (!result.error && result.status === 0 && result.stdout.trim()) {
      cachedGitHubToken = result.stdout.trim();
      return cachedGitHubToken;
    }
  }

  cachedGitHubToken = "";
  return cachedGitHubToken;
}

function githubHeaders(accept = "application/vnd.github+json") {
  const token = resolveGitHubToken();

  return {
    Accept: accept,
    "User-Agent": "vk-ads-mcp-installer",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchJson(url, { allowNotFound = false } = {}) {
  const response = await fetch(url, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(30_000),
  });

  if (allowNotFound && response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    throw new Error(`GitHub вернул HTTP ${response.status} для ${url}`);
  }

  return await response.json();
}

export async function resolveRef(
  requestedRef,
  loadLatestRelease = () =>
    fetchJson(
      `https://api.github.com/repos/${REPOSITORY}/releases/latest`,
      { allowNotFound: true },
    ),
) {
  if (requestedRef) {
    return requestedRef;
  }

  const release = await loadLatestRelease();
  return release?.tag_name || "main";
}

async function downloadFile(ref, repositoryPath, destination) {
  const response = await fetch(
    `https://api.github.com/repos/${REPOSITORY}/contents/${repositoryPath}?ref=${encodeURIComponent(ref)}`,
    {
      headers: githubHeaders("application/vnd.github.raw+json"),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Не удалось скачать ${repositoryPath}: HTTP ${response.status}`,
    );
  }

  const outputPath = join(destination, repositoryPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    new Uint8Array(await response.arrayBuffer()),
  );
}

async function downloadServer(ref, destination) {
  console.log(`Получаю VK Ads MCP (${ref})…`);

  const tree = await fetchJson(
    `https://api.github.com/repos/${REPOSITORY}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );

  if (tree.truncated) {
    throw new Error(
      "GitHub вернул неполное дерево файлов. Повторите установку позже.",
    );
  }

  const paths = selectServerFiles(tree.tree ?? []);
  const required = [
    ".env.example",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "codex-skill/SKILL.md",
  ];

  for (const path of required) {
    if (!paths.includes(path)) {
      throw new Error(`В выбранной версии отсутствует ${path}`);
    }
  }

  if (!paths.some((path) => path.startsWith("src/"))) {
    throw new Error("В выбранной версии отсутствуют исходники MCP-сервера.");
  }

  await Promise.all(
    paths.map((path) => downloadFile(tree.sha, path, destination)),
  );

  return tree.sha;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `Команда завершилась с кодом ${result.status}: ${command} ${args.join(" ")}`,
    );
  }
}

async function buildServer(directory) {
  console.log("Устанавливаю зависимости и собираю сервер…");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["ci", "--no-audit", "--no-fund"], { cwd: directory });
  run(npm, ["run", "build"], { cwd: directory });
  run(npm, ["prune", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: directory,
  });
}

async function pathExists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error?.code === "EISDIR") {
      return true;
    }

    if (error?.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function installedVersion(installDirectory) {
  try {
    return parseInstalledVersion(
      await readFile(
        join(installDirectory, ".vk-ads-install.json"),
        "utf8",
      ),
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function chooseInstallMode(installed, available, hasAuth) {
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    (!installed && !hasAuth)
  ) {
    return "update";
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log(
      `Установлена версия: ${installed || "неизвестна"}. Доступна версия: ${available}.`,
    );

    while (true) {
      const answer = await ask(
        readline,
        "Действие: 1 — обновить без изменения настроек, 2 — установить заново",
        "1",
      );

      if (answer === "1") {
        return "update";
      }

      if (answer === "2") {
        return "reinstall";
      }

      console.log("Введите 1 или 2.");
    }
  } finally {
    readline.close();
  }
}

async function deployServer(
  stagingDirectory,
  installDirectory,
  ref,
  commitSha,
) {
  await mkdir(installDirectory, { recursive: true });
  const backupDirectory = join(
    installDirectory,
    ".installer-backup",
  );
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

      await cp(join(stagingDirectory, entry), target, {
        recursive: true,
      });
    }

    await writeFile(
      join(installDirectory, ".vk-ads-install.json"),
      `${JSON.stringify(
        {
          repository: REPOSITORY,
          ref,
          commitSha,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );

    await rm(backupDirectory, { recursive: true, force: true });
  } catch (error) {
    for (const entry of MANAGED_ENTRIES) {
      await rm(join(installDirectory, entry), {
        recursive: true,
        force: true,
      });
    }

    for (const entry of replaced) {
      await rename(
        join(backupDirectory, entry),
        join(installDirectory, entry),
      );
    }

    throw error;
  }
}

async function promptHidden(question) {
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    typeof process.stdin.setRawMode !== "function"
  ) {
    return undefined;
  }

  process.stdout.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let value = "";

  try {
    await new Promise((resolvePromise, rejectPromise) => {
      const finish = (error) => {
        process.stdin.off("data", onData);
        process.stdin.off("error", onError);
        process.stdin.off("end", onEnd);

        if (error) {
          rejectPromise(error);
        } else {
          resolvePromise();
        }
      };
      const onError = (error) => finish(error);
      const onEnd = () =>
        finish(
          new Error(
            "Скрытый ввод прерван. Повторите установку в обычном терминале.",
          ),
        );
      const onData = (chunk) => {
        for (const character of chunk) {
          if (character === "\r" || character === "\n") {
            finish();
            return;
          }

          if (character === "\u0003") {
            finish(new Error("Установка отменена."));
            return;
          }

          if (character === "\u007f" || character === "\b") {
            value = value.slice(0, -1);
          } else {
            value += character;
          }
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

async function ask(readline, question, defaultValue = "") {
  const answer = (
    await readline.question(
      `${question}${defaultValue ? ` (${defaultValue})` : ""}: `,
    )
  ).trim();

  return answer || defaultValue;
}

async function askBoolean(readline, question, defaultValue = false) {
  while (true) {
    const answer = (
      await ask(readline, question, defaultValue ? "да" : "нет")
    ).toLocaleLowerCase("ru-RU");
    if (["д", "да", "y", "yes"].includes(answer)) return true;
    if (["н", "нет", "n", "no"].includes(answer)) return false;
    console.log("Введите «да» или «нет».");
  }
}

async function promptVisible(question) {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await readline.question(question)).trim();
  } finally {
    readline.close();
  }
}

const COMMUNITY_REDIRECT_URI = "https://vk.ru/blank.html";
const COMMUNITY_LEGACY_REDIRECT_URI =
  "https://oauth.vk.ru/blank.html";
export const DEFAULT_COMMUNITY_LEGACY_CLIENT_ID = "6270012";

async function askCommunityTokenType(readline, defaultValue = "legacy") {
  while (true) {
    const value = await ask(
      readline,
      "Токен сообществ: 1 — legacy OAuth, 2 — VK ID OAuth",
      defaultValue === "vk_id" ? "2" : "1",
    );
    if (value === "1") return "legacy";
    if (value === "2") return "vk_id";
    console.log("Введите 1 или 2.");
  }
}

function openBrowser(url) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    process.platform === "win32"
      ? ["/c", "start", "", url]
      : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function authorizeCommunityLegacy(clientId) {
  if (!/^\d+$/u.test(clientId)) {
    throw new Error("VK client_id должен состоять из цифр.");
  }
  const authorizationUrl = new URL("https://oauth.vk.com/authorize");
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    scope: "335876",
    redirect_uri: COMMUNITY_LEGACY_REDIRECT_URI,
    display: "page",
    response_type: "token",
    revoke: "1",
  }).toString();
  console.log(
    "Открываю OAuth VK. После входа скопируйте полный URL страницы oauth.vk.ru/blank.html.",
  );
  openBrowser(authorizationUrl.toString());
  const callbackUrl = await promptVisible(
    "URL страницы oauth.vk.ru/blank.html: ",
  );
  let callback;
  try {
    callback = new URL(callbackUrl);
  } catch {
    throw new Error(
      "Нужен полный URL страницы oauth.vk.ru/blank.html.",
    );
  }
  if (
    !new Set(["https://oauth.vk.com", "https://oauth.vk.ru"]).has(
      callback.origin,
    ) ||
    callback.pathname !== "/blank.html"
  ) {
    throw new Error(
      "Нужен URL страницы oauth.vk.ru/blank.html после авторизации.",
    );
  }
  const accessToken = new URLSearchParams(callback.hash.slice(1)).get(
    "access_token",
  );
  if (!accessToken) {
    throw new Error("OAuth не вернул access_token.");
  }
  return { accessToken, tokenType: "legacy" };
}

async function authorizeCommunityVkId(clientId) {
  if (!/^\d+$/u.test(clientId)) {
    throw new Error("VK ID client_id должен состоять из цифр.");
  }
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const authorizationUrl = new URL("https://id.vk.ru/authorize");
  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: "groups wall",
    redirect_uri: COMMUNITY_REDIRECT_URI,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  console.log(
    "Открываю VK ID. После входа скопируйте полный URL страницы vk.ru/blank.html.",
  );
  openBrowser(authorizationUrl.toString());
  const callbackUrl = await promptVisible(
    "URL страницы vk.ru/blank.html: ",
  );
  let callback;
  try {
    callback = new URL(callbackUrl);
  } catch {
    throw new Error("Нужен полный URL страницы vk.ru/blank.html.");
  }
  const code = callback.searchParams.get("code");
  const returnedState = callback.searchParams.get("state");
  const deviceId = callback.searchParams.get("device_id");
  if (
    callback.origin !== "https://vk.ru" ||
    callback.pathname !== "/blank.html" ||
    !code ||
    !deviceId ||
    returnedState !== state
  ) {
    throw new Error("VK ID вернул неподтверждённый callback.");
  }
  const response = await fetch("https://id.vk.ru/oauth2/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code_verifier: verifier,
      device_id: deviceId,
      code,
      redirect_uri: COMMUNITY_REDIRECT_URI,
    }),
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  const payload = await response.json().catch(() => undefined);
  if (
    !response.ok ||
    typeof payload?.access_token !== "string" ||
    typeof payload?.refresh_token !== "string"
  ) {
    throw new Error(
      "VK ID не выдал access_token и refresh_token. Проверьте права groups и wall.",
    );
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: Number(payload.expires_in),
    deviceId,
    tokenType: "vk_id",
  };
}

async function authorizeCommunity(clientId, tokenType) {
  return tokenType === "legacy"
    ? authorizeCommunityLegacy(clientId)
    : authorizeCommunityVkId(clientId);
}

async function ensureConfiguration(installDirectory, reinstall = false) {
  const authPath = join(installDirectory, "auth.env");
  const authExists = await pathExists(authPath);

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    if (reinstall) {
      throw new Error(
        "Для установки заново нужен интерактивный терминал.",
      );
    }

    if (!authExists) {
      await cp(join(stagingTemplateDirectory, ".env.example"), authPath);
      await chmod(authPath, 0o600).catch(() => {});
      console.log(
        `Создан ${authPath}. Заполните VK_ADS_CLIENT_ID и VK_ADS_CLIENT_SECRET.`,
      );
    } else {
      console.log("Существующий auth.env сохранён.");
    }

    return;
  }

  const currentContent = authExists
    ? await readFile(authPath, "utf8")
    : "";
  const current = reinstall ? {} : parseEnvValues(currentContent);

  if (!reinstall && authExists && !requiresConfiguration(current)) {
    console.log(
      "Настройки и токены сохранены; обновление не запрашивает учётные данные.",
    );
    return;
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(
    "\nНастройка VK Ads MCP. Нажмите Enter, чтобы принять значение в скобках.\n",
  );

  let clientId;
  let enableCommunityTools = false;
  let authorizeCommunities = false;
  let communityTokenType =
    current.VK_API_TOKEN_TYPE ||
    (current.VK_API_REFRESH_TOKEN ? "vk_id" : "legacy");
  let communityClientId =
    current.VK_API_CLIENT_ID ||
    (communityTokenType === "legacy"
      ? DEFAULT_COMMUNITY_LEGACY_CLIENT_ID
      : "");

  try {
    clientId = await ask(
      readline,
      "VK Ads client_id",
      current.VK_ADS_CLIENT_ID || "",
    );
    enableCommunityTools = await askBoolean(
      readline,
      "Включить поиск и анализ публичных сообществ VK?",
      Boolean(current.VK_API_TOKEN),
    );
    authorizeCommunities =
      enableCommunityTools &&
      (!current.VK_API_TOKEN ||
        (await askBoolean(
          readline,
          "Авторизовать токен сообществ заново?",
          false,
        )));
    if (authorizeCommunities) {
      communityTokenType = await askCommunityTokenType(
        readline,
        communityTokenType,
      );
      if (
        communityTokenType === "legacy" &&
        current.VK_API_TOKEN_TYPE !== "legacy"
      ) {
        communityClientId = DEFAULT_COMMUNITY_LEGACY_CLIENT_ID;
      }
      if (communityTokenType === "vk_id") {
        console.log(
          `Создайте приложение VK ID и добавьте redirect URL ${COMMUNITY_REDIRECT_URI}.`,
        );
      }
      communityClientId = await ask(
        readline,
        communityTokenType === "legacy"
          ? "VK client_id приложения (Enter — встроенное)"
          : "VK ID client_id приложения",
        communityClientId ||
          (communityTokenType === "legacy"
            ? DEFAULT_COMMUNITY_LEGACY_CLIENT_ID
            : ""),
      );
    }
  } finally {
    readline.close();
  }

  const clientSecret = await promptHidden(
    "VK Ads client_secret (ввод скрыт): ",
  );

  if (!clientId || !clientSecret) {
    throw new Error(
      "client_id и client_secret не могут быть пустыми.",
    );
  }
  const communityAuth = authorizeCommunities
    ? await authorizeCommunity(communityClientId, communityTokenType)
    : undefined;

  const template = await readFile(
    join(stagingTemplateDirectory, ".env.example"),
    "utf8",
  );
  const content = applyEnvValues(template, {
    VK_ADS_CLIENT_ID: clientId,
    VK_ADS_CLIENT_SECRET: clientSecret,
    VK_ADS_TOKEN: "",
    VK_ADS_REFRESH_TOKEN: "",
    VK_ADS_TOKEN_EXPIRES_AT: "",
    VK_API_TOKEN: enableCommunityTools
      ? communityAuth?.accessToken || current.VK_API_TOKEN || ""
      : "",
    VK_API_TOKEN_TYPE: enableCommunityTools
      ? communityAuth?.tokenType || communityTokenType
      : "",
    VK_API_CLIENT_ID: enableCommunityTools
      ? communityAuth
        ? communityClientId
        : current.VK_API_CLIENT_ID || ""
      : "",
    VK_API_DEVICE_ID: enableCommunityTools
      ? communityAuth?.deviceId || current.VK_API_DEVICE_ID || ""
      : "",
    VK_API_REFRESH_TOKEN: enableCommunityTools
      ? communityAuth?.refreshToken ||
        (communityTokenType === "vk_id"
          ? current.VK_API_REFRESH_TOKEN || ""
          : "")
      : "",
    VK_API_TOKEN_EXPIRES_AT: enableCommunityTools
      ? communityAuth &&
        Number.isInteger(communityAuth.expiresIn) &&
        communityAuth.expiresIn > 0
        ? new Date(
            Date.now() + communityAuth.expiresIn * 1_000,
          ).toISOString()
        : current.VK_API_TOKEN_EXPIRES_AT || ""
      : "",
  });

  await writeFile(authPath, content, { mode: 0o600 });
  await chmod(authPath, 0o600).catch(() => {});
  console.log(`Настройки сохранены: ${authPath}`);
}

export function codexSkillDirectory(home = homedir()) {
  return join(home, ".codex", "skills", "vk-ads-mcp");
}

export async function installCodexSkill(
  installDirectory,
  home = homedir(),
) {
  const source = join(installDirectory, "codex-skill");
  const destination = codexSkillDirectory(home);
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const temporaryParent = await mkdtemp(
    join(parent, ".vk-ads-mcp-skill-"),
  );
  const staged = join(temporaryParent, "vk-ads-mcp");
  const backup = `${destination}.previous-${randomBytes(8).toString("hex")}`;
  let previousMoved = false;

  try {
    await cp(source, staged, { recursive: true });

    if (await pathExists(destination)) {
      await rename(destination, backup);
      previousMoved = true;
    }

    await rename(staged, destination);

    if (previousMoved) {
      await rm(backup, { recursive: true, force: true });
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true });

    if (previousMoved && (await pathExists(backup))) {
      await rename(backup, destination);
    }

    throw error;
  } finally {
    await rm(temporaryParent, { recursive: true, force: true });
  }

  return join(destination, "SKILL.md");
}

async function setupCodex(installDirectory) {
  const skillPath = await installCodexSkill(installDirectory);

  if (!commandAvailable("codex")) {
    console.log(
      "Codex CLI не найден. Навык установлен, но MCP-сервер не подключён.",
    );
    return { registered: false, skillPath };
  }

  spawnSync("codex", ["mcp", "remove", "vk-ads"], {
    stdio: "ignore",
    shell: false,
  });
  run("codex", [
    "mcp",
    "add",
    "vk-ads",
    "--",
    process.execPath,
    join(installDirectory, "dist", "index.js"),
  ]);

  return { registered: true, skillPath };
}

let stagingTemplateDirectory = "";

export async function main(argv = process.argv.slice(2)) {
  if (Number(process.versions.node.split(".")[0]) < 22) {
    throw new Error("Нужен Node.js 22 или новее.");
  }

  const options = parseArguments(argv);

  if (options.help) {
    printHelp();
    return;
  }

  const installDirectory = resolve(
    options.installDirectory || defaultInstallDirectory(),
  );
  const ref = await resolveRef(options.ref);
  const installMode = await chooseInstallMode(
    await installedVersion(installDirectory),
    ref,
    await pathExists(join(installDirectory, "auth.env")),
  );
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "vk-ads-mcp-"),
  );
  const stagingDirectory = join(temporaryRoot, "server");
  await mkdir(stagingDirectory, { recursive: true });
  stagingTemplateDirectory = stagingDirectory;

  try {
    const commitSha = await downloadServer(ref, stagingDirectory);
    await buildServer(stagingDirectory);
    await deployServer(
      stagingDirectory,
      installDirectory,
      ref,
      commitSha,
    );
    await ensureConfiguration(
      installDirectory,
      installMode === "reinstall",
    );
    const codex = options.register
      ? await setupCodex(installDirectory)
      : undefined;

    console.log(`\nVK Ads MCP установлен: ${installDirectory}`);
    console.log(
      `Версия источника: ${ref} (${commitSha.slice(0, 12)})`,
    );

    if (codex) {
      console.log(`Навык Codex установлен: ${codex.skillPath}`);

      if (codex.registered) {
        console.log(
          "Codex: подключение vk-ads установлено. Перезапустите Codex.",
        );
      }
    } else {
      console.log(
        `Команда сервера: ${process.execPath} ${join(
          installDirectory,
          "dist",
          "index.js",
        )}`,
      );
    }
  } finally {
    stagingTemplateDirectory = "";
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const isDirectExecution =
  import.meta.url.startsWith("data:") ||
  (import.meta.url.startsWith("file:") &&
    process.argv[1] &&
    realpathSync(fileURLToPath(import.meta.url)) ===
      realpathSync(process.argv[1]));

if (isDirectExecution) {
  try {
    await main();
  } catch (error) {
    console.error(
      `\nОшибка установки: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}
