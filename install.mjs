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
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

const REPOSITORY = "sergeylopukhov/vk-ads-mcp-all-in-one";
export const DEFAULT_AUTH_ENV_TEMPLATE = `VK_ADS_CLIENT_ID=
VK_ADS_CLIENT_SECRET=
VK_ADS_TOKEN=
VK_ADS_REFRESH_TOKEN=
VK_ADS_TOKEN_EXPIRES_AT=
VK_API_TOKEN=
VK_API_TOKEN_TYPE=legacy
VK_API_CLIENT_ID=6270012
VK_API_DEVICE_ID=
VK_API_REFRESH_TOKEN=
VK_API_TOKEN_EXPIRES_AT=
VK_COMMUNITY_RESEARCH_TTL_DAYS=30
`;
const MANAGED_ENTRIES = [
  "dist",
  "node_modules",
  "package.json",
  "package-lock.json",
  "codex-skill",
  "docs",
];
export const MCP_CLIENTS = [
  {
    id: "codex",
    label: "Codex CLI (OpenAI)",
    commands: ["codex"],
    markers: [".codex"],
  },
  {
    id: "claude",
    label: "Claude Code",
    commands: ["claude"],
    markers: [".claude"],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    commands: ["gemini"],
    markers: [".gemini"],
  },
  {
    id: "qwen",
    label: "Qwen Code",
    commands: ["qwen"],
    markers: [".qwen"],
  },
  {
    id: "kimi",
    label: "Kimi Code CLI",
    commands: ["kimi"],
    markers: [".kimi-code"],
    configurableWithoutCli: true,
  },
  {
    id: "opencode",
    label: "OpenCode",
    commands: ["opencode"],
    markers: [".config/opencode", ".opencode"],
    configurableWithoutCli: true,
  },
  {
    id: "cursor",
    label: "Cursor",
    commands: ["cursor-agent", "cursor"],
    markers: [".cursor"],
    configurableWithoutCli: true,
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    commands: ["openclaw"],
    markers: [".openclaw"],
  },
  {
    id: "hermes",
    label: "Hermes Agent",
    commands: ["hermes"],
    markers: [".hermes"],
  },
];
const MCP_CLIENT_ALIASES = new Map([
  ["chatgpt", "codex"],
  ["openai", "codex"],
  ["claude-code", "claude"],
  ["gemini-cli", "gemini"],
  ["qwen-code", "qwen"],
  ["kimi-code", "kimi"],
  ["open-code", "opencode"],
  ["open-claw", "openclaw"],
  ["openclow", "openclaw"],
  ["hermes-agent", "hermes"],
]);

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
        path === "package.json" ||
        path === "package-lock.json" ||
        path === "tsconfig.json" ||
        path.startsWith("src/") ||
        path.startsWith("codex-skill/") ||
        path.startsWith("docs/"),
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

export function parseInstalledMetadata(content) {
  try {
    const value = JSON.parse(content);
    if (!value || typeof value !== "object") {
      return undefined;
    }

    const metadata = {
      ref:
        typeof value.ref === "string" && value.ref
          ? value.ref
          : undefined,
      selectedClients: undefined,
    };

    if (Array.isArray(value.selectedClients)) {
      const supportedIds = new Set(
        MCP_CLIENTS.map((client) => client.id),
      );
      if (
        value.selectedClients.every(
          (id) => typeof id === "string" && supportedIds.has(id),
        )
      ) {
        metadata.selectedClients = [
          ...new Set(value.selectedClients),
        ];
      }
    }

    return metadata.ref || metadata.selectedClients !== undefined
      ? metadata
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseInstalledVersion(content) {
  return parseInstalledMetadata(content)?.ref;
}

export function requiresConfiguration(values) {
  return !values.VK_ADS_CLIENT_ID || !values.VK_ADS_CLIENT_SECRET;
}

function parseArguments(argv) {
  const options = {
    ref: undefined,
    installDirectory: undefined,
    register: true,
    clients: undefined,
    allDetected: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--no-register") {
      options.register = false;
    } else if (argument === "--clients") {
      options.clients = argv[++index];
    } else if (argument.startsWith("--clients=")) {
      options.clients = argument.slice(10);
    } else if (argument === "--all-detected") {
      options.allDetected = true;
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

  if (!options.register && (options.clients || options.allDetected)) {
    throw new Error(
      "--no-register нельзя использовать вместе с --clients или --all-detected.",
    );
  }

  return options;
}

function printHelp() {
  console.log(`VK Ads MCP installer

Использование: npx --yes github:sergeylopukhov/vk-ads-mcp-all-in-one [параметры]
  --ref <tag|branch>       установить указанный тег или ветку
  --install-dir <path>     изменить каталог установки
  --clients <список>       настроить указанные клиенты через запятую
  --all-detected           настроить все найденные клиенты без вопроса
  --no-register            не настраивать MCP-клиенты
  -h, --help               показать справку`);
}

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
    shell: false,
  });

  return !result.error && result.status === 0;
}

export async function detectMcpClients({
  platform = process.platform,
  home = homedir(),
  environment = process.env,
  hasCommand = commandAvailable,
  exists = pathExists,
} = {}) {
  const detected = [];

  for (const client of MCP_CLIENTS) {
    const commands = client.commands.filter((command) =>
      hasCommand(command),
    );
    const markerPaths = client.markers.map((marker) => {
      if (client.id === "kimi" && environment.KIMI_CODE_HOME) {
        return resolve(environment.KIMI_CODE_HOME);
      }
      if (
        client.id === "openclaw" &&
        environment.OPENCLAW_STATE_DIR
      ) {
        return resolve(environment.OPENCLAW_STATE_DIR);
      }
      if (client.id === "hermes" && environment.HERMES_HOME) {
        return resolve(environment.HERMES_HOME);
      }
      return join(home, marker);
    });

    if (client.id === "opencode" && environment.XDG_CONFIG_HOME) {
      markerPaths.push(
        join(environment.XDG_CONFIG_HOME, "opencode"),
      );
    }

    if (client.id === "cursor") {
      if (platform === "darwin") {
        markerPaths.push(
          "/Applications/Cursor.app",
          join(home, "Applications", "Cursor.app"),
        );
      } else if (platform === "win32") {
        for (const parent of [
          environment.LOCALAPPDATA,
          environment.ProgramFiles,
        ]) {
          if (parent) {
            markerPaths.push(join(parent, "Programs", "Cursor"));
          }
        }
      }
    }

    const existingMarkers = [];
    for (const markerPath of markerPaths) {
      if (await exists(markerPath)) {
        existingMarkers.push(markerPath);
      }
    }

    if (
      commands.length > 0 ||
      (client.configurableWithoutCli && existingMarkers.length > 0)
    ) {
      detected.push({
        ...client,
        command: commands[0],
        markers: existingMarkers,
      });
    }
  }

  return detected;
}

export function parseClientSelection(
  answer,
  detectedIds,
  knownIds = MCP_CLIENTS.map((client) => client.id),
) {
  const value = answer.trim().toLocaleLowerCase("ru-RU");

  if (!value || value === "all" || value === "все") {
    return [...detectedIds];
  }

  if (["0", "none", "нет"].includes(value)) {
    throw new Error("Выберите хотя бы один MCP-клиент.");
  }

  const selected = [];
  for (const token of value.split(/[\s,;]+/u).filter(Boolean)) {
    const number = Number(token);
    const id = Number.isInteger(number) && number > 0
      ? detectedIds[number - 1]
      : MCP_CLIENT_ALIASES.get(token) || token;

    if (!id || !knownIds.includes(id)) {
      throw new Error(`Неизвестный MCP-клиент: ${token}`);
    }

    if (!detectedIds.includes(id)) {
      throw new Error(`MCP-клиент не найден: ${id}`);
    }

    if (!selected.includes(id)) {
      selected.push(id);
    }
  }

  if (selected.length === 0) {
    throw new Error("Выберите хотя бы один MCP-клиент.");
  }

  return selected;
}

export function parseRequestedClients(value) {
  const knownIds = MCP_CLIENTS.map((client) => client.id);
  const selected = [];

  for (const token of value.split(/[\s,;]+/u).filter(Boolean)) {
    const normalized = token.toLocaleLowerCase("en-US");
    const id = MCP_CLIENT_ALIASES.get(normalized) || normalized;

    if (!knownIds.includes(id)) {
      throw new Error(`Неизвестный MCP-клиент: ${token}`);
    }

    if (!selected.includes(id)) {
      selected.push(id);
    }
  }

  if (selected.length === 0) {
    throw new Error("--clients требует хотя бы один MCP-клиент.");
  }

  return selected;
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
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "codex-skill/SKILL.md",
    "docs/tools.md",
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

async function installedMetadata(installDirectory) {
  try {
    return parseInstalledMetadata(
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

function supportsInteractiveMenu(
  input = process.stdin,
  output = process.stdout,
) {
  return Boolean(
    input.isTTY &&
      output.isTTY &&
      typeof input.setRawMode === "function",
  );
}

async function runInteractiveMenu(
  render,
  handleKey,
  input = process.stdin,
  output = process.stdout,
) {
  const wasRaw = input.isRaw === true;

  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  try {
    render(output);
    return await new Promise((resolvePromise, rejectPromise) => {
      const finish = (error, value) => {
        input.off("keypress", onKeypress);
        input.off("error", onError);
        input.off("end", onEnd);

        if (error) {
          rejectPromise(error);
        } else {
          resolvePromise(value);
        }
      };
      const onError = (error) => finish(error);
      const onEnd = () =>
        finish(
          new Error(
            "Выбор прерван. Повторите установку в обычном терминале.",
          ),
        );
      const onKeypress = (character, key = {}) => {
        if (key.ctrl && key.name === "c") {
          finish(new Error("Установка отменена."));
          return;
        }

        const result = handleKey(character, key, output);
        if (result?.done) {
          finish(undefined, result.value);
        }
      };

      input.on("keypress", onKeypress);
      input.once("error", onError);
      input.once("end", onEnd);
    });
  } finally {
    input.setRawMode(wasRaw);
    input.pause();
  }
}

function createMenuRenderer(linesFactory) {
  let renderedLineCount = 0;

  return (output) => {
    const lines = linesFactory();
    if (renderedLineCount > 0) {
      output.write(`\u001b[${renderedLineCount}A\r\u001b[0J`);
    }
    output.write(`${lines.join("\n")}\n`);
    renderedLineCount = lines.length;
  };
}

export async function promptSingleChoice(
  question,
  choices,
  defaultValue,
  {
    input = process.stdin,
    output = process.stdout,
  } = {},
) {
  if (choices.length === 0) {
    throw new Error("Для выбора нужен хотя бы один вариант.");
  }

  let selectedIndex = Math.max(
    0,
    choices.findIndex((choice) => choice.value === defaultValue),
  );

  if (!supportsInteractiveMenu(input, output)) {
    const readline = createInterface({ input, output });
    try {
      output.write(`${question}\n`);
      choices.forEach((choice, index) => {
        output.write(`  ${index + 1}. ${choice.label}\n`);
      });
      while (true) {
        const answer = await ask(
          readline,
          "Выберите вариант",
          String(selectedIndex + 1),
        );
        const index = Number(answer) - 1;
        if (Number.isInteger(index) && choices[index]) {
          return choices[index].value;
        }
        output.write(`Введите число от 1 до ${choices.length}.\n`);
      }
    } finally {
      readline.close();
    }
  }

  const render = createMenuRenderer(() => [
    question,
    "↑/↓ — выбрать, Enter — продолжить",
    ...choices.map(
      (choice, index) =>
        `${index === selectedIndex ? "›" : " "} ${
          index === selectedIndex ? "●" : "○"
        } ${choice.label}`,
    ),
  ]);

  return runInteractiveMenu(
    render,
    (_character, key, outputStream) => {
      if (key.name === "up") {
        selectedIndex =
          (selectedIndex - 1 + choices.length) % choices.length;
        render(outputStream);
      } else if (key.name === "down") {
        selectedIndex = (selectedIndex + 1) % choices.length;
        render(outputStream);
      } else if (key.name === "return" || key.name === "enter") {
        return { done: true, value: choices[selectedIndex].value };
      }
      return undefined;
    },
    input,
    output,
  );
}

export async function promptMultipleChoices(
  question,
  choices,
  {
    minSelected = 1,
    input = process.stdin,
    output = process.stdout,
  } = {},
) {
  if (choices.length < minSelected) {
    throw new Error(
      `Нужно не меньше ${minSelected} доступных вариантов.`,
    );
  }

  const requirement =
    minSelected === 1
      ? "Нужно выбрать хотя бы один вариант"
      : `Нужно выбрать не меньше ${minSelected} вариантов`;
  let cursorIndex = 0;
  const selectedValues = new Set(
    choices.filter((choice) => choice.selected).map((choice) => choice.value),
  );
  let status = "";

  if (selectedValues.size < minSelected) {
    choices.slice(0, minSelected).forEach((choice) => {
      selectedValues.add(choice.value);
    });
  }

  if (!supportsInteractiveMenu(input, output)) {
    const readline = createInterface({ input, output });
    try {
      output.write(`${question}\n`);
      choices.forEach((choice, index) => {
        output.write(`  ${index + 1}. ${choice.label}\n`);
      });
      while (true) {
        const answer = await ask(
          readline,
          "Укажите номера через запятую",
          choices
            .map((choice, index) =>
              selectedValues.has(choice.value) ? index + 1 : undefined,
            )
            .filter(Boolean)
            .join(","),
        );
        const indexes = [
          ...new Set(
            answer
              .split(/[\s,;]+/u)
              .filter(Boolean)
              .map((token) => Number(token) - 1),
          ),
        ];
        if (
          indexes.length >= minSelected &&
          indexes.every(
            (index) => Number.isInteger(index) && choices[index],
          )
        ) {
          return indexes.map((index) => choices[index].value);
        }
        output.write(`${requirement} из списка.\n`);
      }
    } finally {
      readline.close();
    }
  }

  const render = createMenuRenderer(() => [
    question,
    status ||
      "Пробел — отметить, ↑/↓ — перейти, Enter — продолжить",
    ...choices.map(
      (choice, index) =>
        `${index === cursorIndex ? "›" : " "} ${
          selectedValues.has(choice.value) ? "☑" : "☐"
        } ${choice.label}`,
    ),
  ]);

  return runInteractiveMenu(
    render,
    (character, key, outputStream) => {
      if (key.name === "up") {
        cursorIndex =
          (cursorIndex - 1 + choices.length) % choices.length;
        status = "";
        render(outputStream);
      } else if (key.name === "down") {
        cursorIndex = (cursorIndex + 1) % choices.length;
        status = "";
        render(outputStream);
      } else if (key.name === "space" || character === " ") {
        const value = choices[cursorIndex].value;
        if (selectedValues.has(value)) {
          if (selectedValues.size === minSelected) {
            status = requirement;
          } else {
            selectedValues.delete(value);
            status = "";
          }
        } else {
          selectedValues.add(value);
          status = "";
        }
        render(outputStream);
      } else if (key.name === "return" || key.name === "enter") {
        if (selectedValues.size < minSelected) {
          status = requirement;
          render(outputStream);
          return undefined;
        }
        return {
          done: true,
          value: choices
            .filter((choice) => selectedValues.has(choice.value))
            .map((choice) => choice.value),
        };
      }
      return undefined;
    },
    input,
    output,
  );
}

async function chooseInstallMode(installed, available, hasAuth) {
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    (!installed && !hasAuth)
  ) {
    return "update";
  }

  console.log(
    `Установлена версия: ${installed || "неизвестна"}. Доступна версия: ${available}.`,
  );
  return promptSingleChoice(
    "Что сделать?",
    [
      {
        label: "Обновить без изменения настроек",
        value: "update",
      },
      {
        label: "Установить заново",
        value: "reinstall",
      },
    ],
    "update",
  );
}

async function deployServer(
  stagingDirectory,
  installDirectory,
  ref,
  commitSha,
  selectedClients,
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
          selectedClients,
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

async function promptAnswer(question, defaultValue = "") {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await ask(readline, question, defaultValue);
  } finally {
    readline.close();
  }
}

async function promptBoolean(
  question,
  defaultValue,
  trueLabel,
  falseLabel,
) {
  return promptSingleChoice(
    question,
    [
      { label: trueLabel, value: true },
      { label: falseLabel, value: false },
    ],
    defaultValue,
  );
}

const COMMUNITY_REDIRECT_URI = "https://vk.ru/blank.html";
const COMMUNITY_LEGACY_REDIRECT_URI =
  "https://oauth.vk.ru/blank.html";
export const DEFAULT_COMMUNITY_LEGACY_CLIENT_ID = "6270012";

async function askCommunityTokenType(defaultValue = "legacy") {
  return promptSingleChoice(
    "Как авторизовать поиск сообществ?",
    [
      {
        label: "Legacy OAuth — встроенное приложение",
        value: "legacy",
      },
      {
        label: "VK ID OAuth — своё приложение",
        value: "vk_id",
      },
    ],
    defaultValue,
  );
}

export async function openBrowser(
  url,
  {
    platform = process.platform,
    spawnProcess = spawn,
  } = {},
) {
  const command =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    platform === "win32"
      ? ["/c", "start", "", url]
      : [url];

  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawnProcess(command, args, {
        detached: true,
        stdio: "ignore",
      });
    } catch {
      resolvePromise(false);
      return;
    }

    let settled = false;
    const finish = (opened) => {
      if (settled) {
        return;
      }
      settled = true;
      resolvePromise(opened);
    };

    child.once("error", () => finish(false));
    child.once("spawn", () => {
      child.unref();
      finish(true);
    });
  });
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
  console.log(`Ссылка для входа:\n${authorizationUrl.toString()}`);
  if (!(await openBrowser(authorizationUrl.toString()))) {
    console.log(
      "Не удалось открыть браузер автоматически. Откройте ссылку выше вручную.",
    );
  }
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
  console.log(`Ссылка для входа:\n${authorizationUrl.toString()}`);
  if (!(await openBrowser(authorizationUrl.toString()))) {
    console.log(
      "Не удалось открыть браузер автоматически. Откройте ссылку выше вручную.",
    );
  }
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
      await writeFile(authPath, DEFAULT_AUTH_ENV_TEMPLATE, {
        mode: 0o600,
      });
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

  clientId = await promptAnswer(
    "VK Ads client_id",
    current.VK_ADS_CLIENT_ID || "",
  );
  const clientSecret = await promptHidden(
    "VK Ads client_secret (ввод скрыт): ",
  );

  if (!clientId || !clientSecret) {
    throw new Error(
      "client_id и client_secret не могут быть пустыми.",
    );
  }

  enableCommunityTools = await promptBoolean(
    "Подключить поиск и анализ публичных сообществ VK?",
    Boolean(current.VK_API_TOKEN),
    "Подключить",
    "Не подключать",
  );
  authorizeCommunities =
    enableCommunityTools &&
    (!current.VK_API_TOKEN ||
      (await promptBoolean(
        "Что сделать с текущим токеном сообществ?",
        false,
        "Авторизовать заново",
        "Сохранить текущий токен",
      )));
  if (authorizeCommunities) {
    communityTokenType = await askCommunityTokenType(
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
    communityClientId = await promptAnswer(
      communityTokenType === "legacy"
        ? "VK client_id приложения (Enter — встроенное)"
        : "VK ID client_id приложения",
      communityClientId ||
        (communityTokenType === "legacy"
          ? DEFAULT_COMMUNITY_LEGACY_CLIENT_ID
          : ""),
    );
  }

  const communityAuth = authorizeCommunities
    ? await authorizeCommunity(communityClientId, communityTokenType)
    : undefined;

  const content = applyEnvValues(DEFAULT_AUTH_ENV_TEMPLATE, {
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

export function clientSkillDirectory(
  clientId,
  home = homedir(),
  environment = process.env,
) {
  const openCodeConfigRoot = join(
    environment.XDG_CONFIG_HOME || join(home, ".config"),
    "opencode",
  );
  const openClawStateRoot =
    environment.OPENCLAW_STATE_DIR || join(home, ".openclaw");
  const hermesHome =
    environment.HERMES_HOME || join(home, ".hermes");
  const roots = new Map([
    ["codex", join(home, ".agents", "skills")],
    ["claude", join(home, ".claude", "skills")],
    ["gemini", join(home, ".gemini", "skills")],
    ["qwen", join(home, ".qwen", "skills")],
    [
      "kimi",
      join(
        environment.KIMI_CODE_HOME || join(home, ".kimi-code"),
        "skills",
      ),
    ],
    ["opencode", join(openCodeConfigRoot, "skills")],
    ["cursor", join(home, ".cursor", "skills")],
    ["openclaw", join(openClawStateRoot, "skills")],
    ["hermes", join(hermesHome, "skills")],
  ]);
  const root = roots.get(clientId);

  if (!root) {
    throw new Error(`Неизвестный каталог навыков: ${clientId}`);
  }

  return join(root, "vk-ads-mcp");
}

export function codexSkillDirectory(home = homedir()) {
  return clientSkillDirectory("codex", home);
}

export function legacyCodexSkillDirectory(home = homedir()) {
  return join(home, ".codex", "skills", "vk-ads-mcp");
}

export async function inferInstalledClients(
  detected,
  home = homedir(),
  environment = process.env,
) {
  const installed = [];

  for (const client of detected) {
    const skillPath = join(
      clientSkillDirectory(client.id, home, environment),
      "SKILL.md",
    );
    if (await pathExists(skillPath)) {
      installed.push(client.id);
    }
  }

  return installed;
}

async function installSkillDirectory(source, destination) {
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const temporaryParent = await mkdtemp(
    join(parent, ".vk-ads-mcp-skill-"),
  );
  const staged = join(temporaryParent, "vk-ads-mcp");
  const backup = `${destination}.previous-${randomBytes(8).toString("hex")}`;
  let previousMoved = false;
  let replacementInstalled = false;

  try {
    await cp(source, staged, { recursive: true });

    if (await pathExists(destination)) {
      await rename(destination, backup);
      previousMoved = true;
    }

    await rename(staged, destination);
    replacementInstalled = true;

    if (previousMoved) {
      await rm(backup, { recursive: true, force: true });
    }
  } catch (error) {
    if (replacementInstalled) {
      await rm(destination, { recursive: true, force: true });
    }

    if (previousMoved && (await pathExists(backup))) {
      await rename(backup, destination);
    }

    throw error;
  } finally {
    await rm(temporaryParent, { recursive: true, force: true });
  }

  return join(destination, "SKILL.md");
}

async function migrateLegacyCodexSkill(home) {
  const legacyDirectory = legacyCodexSkillDirectory(home);

  if (!(await pathExists(legacyDirectory))) {
    return undefined;
  }

  const backupDirectory = join(home, ".codex", "skill-backups");
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = join(
    backupDirectory,
    `vk-ads-mcp-${timestamp}-${randomBytes(4).toString("hex")}`,
  );
  await mkdir(backupDirectory, { recursive: true });
  await rename(legacyDirectory, backupPath);
  return backupPath;
}

export async function installClientSkill(
  installDirectory,
  clientId,
  home = homedir(),
  environment = process.env,
) {
  const source = join(installDirectory, "codex-skill");
  const destination = clientSkillDirectory(
    clientId,
    home,
    environment,
  );
  const skillPath = await installSkillDirectory(source, destination);
  const migratedSkillBackup = clientId === "codex"
    ? await migrateLegacyCodexSkill(home)
    : undefined;

  return { skillPath, migratedSkillBackup };
}

export async function installCodexSkill(
  installDirectory,
  home = homedir(),
) {
  const result = await installClientSkill(
    installDirectory,
    "codex",
    home,
  );
  return result.skillPath;
}

export function mergeMcpServerConfig(
  content,
  serverName,
  command,
  args,
  extra = {},
) {
  let configuration = {};

  if (content.trim()) {
    try {
      configuration = JSON.parse(content);
    } catch {
      throw new Error(
        "Конфигурация MCP содержит некорректный JSON.",
      );
    }
  }

  if (
    !configuration ||
    Array.isArray(configuration) ||
    typeof configuration !== "object"
  ) {
    throw new Error("Корень конфигурации MCP должен быть объектом.");
  }

  if (
    configuration.mcpServers !== undefined &&
    (!configuration.mcpServers ||
      Array.isArray(configuration.mcpServers) ||
      typeof configuration.mcpServers !== "object")
  ) {
    throw new Error("Поле mcpServers должно быть объектом.");
  }

  configuration.mcpServers = {
    ...(configuration.mcpServers || {}),
    [serverName]: {
      command,
      args,
      ...extra,
    },
  };

  return `${JSON.stringify(configuration, null, 2)}\n`;
}

export function openCodeConfigPath(
  home = homedir(),
  environment = process.env,
) {
  return join(
    environment.XDG_CONFIG_HOME || join(home, ".config"),
    "opencode",
    "opencode.json",
  );
}

export function mergeOpenCodeConfig(
  content,
  serverName,
  command,
  args,
) {
  let configuration = {};

  if (content.trim()) {
    try {
      configuration = JSON.parse(content);
    } catch {
      throw new Error(
        "Конфигурация OpenCode содержит некорректный JSON.",
      );
    }
  }

  if (
    !configuration ||
    Array.isArray(configuration) ||
    typeof configuration !== "object"
  ) {
    throw new Error(
      "Корень конфигурации OpenCode должен быть объектом.",
    );
  }

  if (
    configuration.mcp !== undefined &&
    (!configuration.mcp ||
      Array.isArray(configuration.mcp) ||
      typeof configuration.mcp !== "object")
  ) {
    throw new Error("Поле mcp в конфигурации OpenCode должно быть объектом.");
  }

  configuration = {
    ...configuration,
    $schema:
      configuration.$schema || "https://opencode.ai/config.json",
    mcp: {
      ...(configuration.mcp || {}),
      [serverName]: {
        type: "local",
        command: [command, ...args],
        enabled: true,
      },
    },
  };

  return `${JSON.stringify(configuration, null, 2)}\n`;
}

export async function updateMcpJsonConfig(
  configPath,
  command,
  args,
  extra = {},
) {
  await mkdir(dirname(configPath), { recursive: true });
  const exists = await pathExists(configPath);
  const content = exists ? await readFile(configPath, "utf8") : "";
  const updated = mergeMcpServerConfig(
    content,
    "vk-ads",
    command,
    args,
    extra,
  );
  let backupPath;

  if (exists) {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/gu, "-");
    backupPath = `${configPath}.backup-${timestamp}`;
    await cp(configPath, backupPath);
  }

  const temporaryPath = `${configPath}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    await writeFile(temporaryPath, updated, { mode: 0o600 });
    await rename(temporaryPath, configPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }

  const verified = JSON.parse(await readFile(configPath, "utf8"));
  const server = verified?.mcpServers?.["vk-ads"];
  if (
    server?.command !== command ||
    JSON.stringify(server?.args) !== JSON.stringify(args)
  ) {
    throw new Error(`Не удалось проверить конфигурацию ${configPath}.`);
  }

  return { configPath, backupPath };
}

export async function updateOpenCodeConfig(
  configPath,
  command,
  args,
) {
  await mkdir(dirname(configPath), { recursive: true });
  const exists = await pathExists(configPath);
  const content = exists ? await readFile(configPath, "utf8") : "";
  const updated = mergeOpenCodeConfig(
    content,
    "vk-ads",
    command,
    args,
  );
  let backupPath;

  if (exists) {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/gu, "-");
    backupPath = `${configPath}.backup-${timestamp}`;
    await cp(configPath, backupPath);
  }

  const temporaryPath = `${configPath}.tmp-${randomBytes(8).toString("hex")}`;
  try {
    await writeFile(temporaryPath, updated, { mode: 0o600 });
    await rename(temporaryPath, configPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }

  const verified = JSON.parse(await readFile(configPath, "utf8"));
  const server = verified?.mcp?.["vk-ads"];
  if (
    server?.type !== "local" ||
    server?.enabled !== true ||
    JSON.stringify(server?.command) !==
      JSON.stringify([command, ...args])
  ) {
    throw new Error(
      `Не удалось проверить конфигурацию OpenCode ${configPath}.`,
    );
  }

  return { configPath, backupPath };
}

export async function chooseMcpClients(
  detected,
  options,
  savedClients,
  {
    input = process.stdin,
    output = process.stdout,
  } = {},
) {
  if (!options.register) {
    return [];
  }

  if (options.clients !== undefined) {
    if (!options.clients) {
      throw new Error("--clients требует список MCP-клиентов.");
    }
    return parseRequestedClients(options.clients);
  }

  if (options.allDetected) {
    return detected.map((client) => client.id);
  }

  const detectedIds = detected.map((client) => client.id);
  if (detectedIds.length === 0) {
    if (savedClients !== undefined) {
      return savedClients;
    }
    throw new Error(
      "Не найден ни один поддерживаемый MCP-клиент. Установите клиент или повторите команду с --no-register.",
    );
  }

  if (
    !input.isTTY ||
    !output.isTTY
  ) {
    return savedClients ?? detectedIds;
  }

  console.log("\nНайдены MCP-клиенты:");
  return promptMultipleChoices(
    "К каким клиентам подключить VK Ads MCP?",
    detected.map((client) => ({
      label: client.label,
      value: client.id,
      selected:
        savedClients === undefined ||
        savedClients.includes(client.id),
    })),
    { minSelected: 1, input, output },
  );
}

function tryRemove(command, args) {
  spawnSync(command, args, {
    stdio: "ignore",
    shell: false,
  });
}

async function setupCodex(installDirectory) {
  if (!commandAvailable("codex")) {
    throw new Error("Codex CLI не найден.");
  }

  tryRemove("codex", ["mcp", "remove", "vk-ads"]);
  run("codex", [
    "mcp",
    "add",
    "vk-ads",
    "--",
    process.execPath,
    join(installDirectory, "dist", "index.js"),
  ]);
  run("codex", ["mcp", "get", "vk-ads"]);

  return {};
}

async function setupClaude(installDirectory) {
  if (!commandAvailable("claude")) {
    throw new Error("Claude Code CLI не найден.");
  }

  tryRemove("claude", [
    "mcp",
    "remove",
    "--scope",
    "user",
    "vk-ads",
  ]);
  run("claude", [
    "mcp",
    "add",
    "--scope",
    "user",
    "vk-ads",
    "--",
    process.execPath,
    join(installDirectory, "dist", "index.js"),
  ]);
  run("claude", ["mcp", "get", "vk-ads"]);
  return {};
}

async function setupGemini(installDirectory) {
  if (!commandAvailable("gemini")) {
    throw new Error("Gemini CLI не найден.");
  }

  tryRemove("gemini", [
    "mcp",
    "remove",
    "--scope",
    "user",
    "vk-ads",
  ]);
  run("gemini", [
    "mcp",
    "add",
    "--scope",
    "user",
    "vk-ads",
    process.execPath,
    join(installDirectory, "dist", "index.js"),
  ]);
  run("gemini", ["mcp", "list"]);
  return {};
}

async function setupQwen(installDirectory) {
  if (!commandAvailable("qwen")) {
    throw new Error("Qwen Code CLI не найден.");
  }

  tryRemove("qwen", [
    "mcp",
    "remove",
    "--scope",
    "user",
    "vk-ads",
  ]);
  run("qwen", [
    "mcp",
    "add",
    "--scope",
    "user",
    "vk-ads",
    process.execPath,
    join(installDirectory, "dist", "index.js"),
  ]);
  run("qwen", ["mcp", "list"]);
  return {};
}

async function setupOpenCode(
  installDirectory,
  home = homedir(),
  environment = process.env,
) {
  const configPath = openCodeConfigPath(home, environment);
  const result = await updateOpenCodeConfig(
    configPath,
    process.execPath,
    [join(installDirectory, "dist", "index.js")],
  );

  if (commandAvailable("opencode")) {
    run("opencode", ["mcp", "list"]);
  }

  return {
    detail: result.backupPath
      ? `конфиг: ${configPath}, резервная копия: ${result.backupPath}`
      : `конфиг: ${configPath}`,
  };
}

async function setupKimi(
  installDirectory,
  home = homedir(),
  environment = process.env,
) {
  const configPath = join(
    environment.KIMI_CODE_HOME || join(home, ".kimi-code"),
    "mcp.json",
  );
  const result = await updateMcpJsonConfig(
    configPath,
    process.execPath,
    [join(installDirectory, "dist", "index.js")],
    { enabled: true },
  );
  return {
    detail: result.backupPath
      ? `конфиг: ${configPath}, резервная копия: ${result.backupPath}`
      : `конфиг: ${configPath}`,
  };
}

async function setupCursor(
  installDirectory,
  home = homedir(),
) {
  const configPath = join(home, ".cursor", "mcp.json");
  const result = await updateMcpJsonConfig(
    configPath,
    process.execPath,
    [join(installDirectory, "dist", "index.js")],
  );
  return {
    detail: result.backupPath
      ? `конфиг: ${configPath}, резервная копия: ${result.backupPath}`
      : `конфиг: ${configPath}`,
  };
}

export function openClawMcpAddArgs(command, args) {
  return [
    "mcp",
    "add",
    "vk-ads",
    "--command",
    command,
    ...args.flatMap((argument) => ["--arg", argument]),
  ];
}

export function hermesMcpAddArgs(command, args) {
  return [
    "mcp",
    "add",
    "vk-ads",
    "--command",
    command,
    "--args",
    ...args,
  ];
}

async function setupOpenClaw(installDirectory) {
  if (!commandAvailable("openclaw")) {
    throw new Error("OpenClaw CLI не найден.");
  }

  const serverPath = join(installDirectory, "dist", "index.js");
  tryRemove("openclaw", ["mcp", "unset", "vk-ads"]);
  run(
    "openclaw",
    openClawMcpAddArgs(process.execPath, [serverPath]),
  );
  run("openclaw", ["mcp", "doctor", "vk-ads", "--probe"]);
  return {};
}

async function setupHermes(installDirectory) {
  if (!commandAvailable("hermes")) {
    throw new Error("Hermes Agent CLI не найден.");
  }

  const serverPath = join(installDirectory, "dist", "index.js");
  tryRemove("hermes", ["mcp", "remove", "vk-ads"]);
  run(
    "hermes",
    hermesMcpAddArgs(process.execPath, [serverPath]),
    {
      input: "y\n",
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  run("hermes", ["mcp", "test", "vk-ads"]);
  return {};
}

async function setupMcpClients(clientIds, installDirectory) {
  const setupById = {
    codex: setupCodex,
    claude: setupClaude,
    gemini: setupGemini,
    qwen: setupQwen,
    opencode: setupOpenCode,
    kimi: setupKimi,
    cursor: setupCursor,
    openclaw: setupOpenClaw,
    hermes: setupHermes,
  };
  const results = [];

  for (const id of clientIds) {
    const client = MCP_CLIENTS.find((item) => item.id === id);
    try {
      const result = await setupById[id](installDirectory);
      const skill = await installClientSkill(
        installDirectory,
        id,
      );
      const details = [
        result.detail,
        `навык: ${skill.skillPath}`,
        skill.migratedSkillBackup
          ? `старая копия Codex сохранена: ${skill.migratedSkillBackup}`
          : undefined,
      ].filter(Boolean);
      results.push({
        id,
        label: client.label,
        ok: true,
        detail: details.join(", "),
      });
    } catch (error) {
      results.push({
        id,
        label: client.label,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

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
  const previousInstallation =
    await installedMetadata(installDirectory);
  const installMode = await chooseInstallMode(
    previousInstallation?.ref,
    ref,
    await pathExists(join(installDirectory, "auth.env")),
  );
  const detectedClients = options.register
    ? await detectMcpClients()
    : [];
  let savedClients;
  if (
    installMode === "update" &&
    options.register &&
    options.clients === undefined &&
    !options.allDetected
  ) {
    savedClients = previousInstallation?.selectedClients;
    if (
      savedClients === undefined &&
      previousInstallation
    ) {
      const inferredClients =
        await inferInstalledClients(detectedClients);
      if (inferredClients.length > 0) {
        savedClients = inferredClients;
        console.log(
          "Выбор MCP-клиентов восстановлен из предыдущей установки.",
        );
      }
    }
  }
  const selectedClients = await chooseMcpClients(
    detectedClients,
    options,
    savedClients,
  );
  const clientsToRemember =
    !options.register &&
    installMode === "update" &&
    previousInstallation?.selectedClients !== undefined
      ? previousInstallation.selectedClients
      : selectedClients;
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "vk-ads-mcp-"),
  );
  const stagingDirectory = join(temporaryRoot, "server");
  await mkdir(stagingDirectory, { recursive: true });
  try {
    const commitSha = await downloadServer(ref, stagingDirectory);
    await buildServer(stagingDirectory);
    await deployServer(
      stagingDirectory,
      installDirectory,
      ref,
      commitSha,
      clientsToRemember,
    );
    await ensureConfiguration(
      installDirectory,
      installMode === "reinstall",
    );
    const clientResults = await setupMcpClients(
      selectedClients,
      installDirectory,
    );

    console.log(`\nVK Ads MCP установлен: ${installDirectory}`);
    console.log(
      `Версия источника: ${ref} (${commitSha.slice(0, 12)})`,
    );

    for (const result of clientResults) {
      if (result.ok) {
        console.log(
          `${result.label}: подключение vk-ads установлено${
            result.detail ? ` (${result.detail})` : ""
          }.`,
        );
      } else {
        console.error(`${result.label}: ${result.error}`);
      }
    }

    if (selectedClients.length === 0) {
      console.log(
        `Команда сервера: ${process.execPath} ${join(
          installDirectory,
          "dist",
          "index.js",
        )}`,
      );
    }

    const failed = clientResults.filter((result) => !result.ok);
    if (failed.length > 0) {
      throw new Error(
        `Не удалось настроить MCP-клиенты: ${failed
          .map((result) => result.label)
          .join(", ")}.`,
      );
    }

    if (clientResults.length > 0) {
      console.log("Перезапустите настроенные MCP-клиенты.");
    }
  } finally {
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
