#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, posix, resolve, win32 } from "node:path";
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

export function fillCredentials(template, clientId, clientSecret) {
  const replace = (source, name, value) => {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    return pattern.test(source) ? source.replace(pattern, line) : `${source.trimEnd()}\n${line}\n`;
  };
  return replace(replace(template, "VK_ADS_CLIENT_ID", clientId), "VK_ADS_CLIENT_SECRET", clientSecret);
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

async function resolveRef(requestedRef) {
  if (requestedRef) return requestedRef;
  const release = await fetchJson(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, { allowNotFound: true });
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

async function ensureCredentials(installDirectory) {
  const envPath = join(installDirectory, ".env");
  if (await pathExists(envPath)) {
    console.log("Существующий .env сохранён.");
    return;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    await cp(join(installDirectory, ".env.example"), envPath);
    await chmod(envPath, 0o600).catch(() => {});
    console.log(`Создан ${envPath}. Заполните VK_ADS_CLIENT_ID и VK_ADS_CLIENT_SECRET.`);
    return;
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const clientId = (await readline.question("VK Ads client_id: ")).trim();
  readline.close();
  const clientSecret = await promptHidden("VK Ads client_secret (ввод скрыт): ");
  if (!clientId || !clientSecret) throw new Error("client_id и client_secret не могут быть пустыми.");
  if (/[\r\n]/.test(clientId) || /[\r\n]/.test(clientSecret)) {
    throw new Error("client_id и client_secret должны занимать одну строку.");
  }
  const template = await readFile(join(installDirectory, ".env.example"), "utf8");
  await writeFile(envPath, fillCredentials(template, clientId, clientSecret), { mode: 0o600 });
  await chmod(envPath, 0o600).catch(() => {});
}

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore", shell: false });
  return !result.error && result.status === 0;
}

function registerCodex(installDirectory) {
  if (!commandAvailable("codex")) {
    console.log("Codex CLI не найден. Сервер установлен, но не подключён к клиенту.");
    return false;
  }
  spawnSync("codex", ["mcp", "remove", "vk-ads"], { stdio: "ignore", shell: false });
  run("codex", ["mcp", "add", "vk-ads", "--env", "VK_ADS_PROFILE=default", "--", process.execPath, join(installDirectory, "dist", "index.js")]);
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
    await ensureCredentials(installDirectory);
    const registered = options.register ? registerCodex(installDirectory) : false;
    console.log(`\nVK Ads MCP установлен: ${installDirectory}`);
    console.log(`Версия источника: ${ref} (${commitSha.slice(0, 12)})`);
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
