import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const publicRootFiles = new Set([".gitignore", "install.mjs", "install.ps1", "install.sh", "LICENSE", "NOTICE.md", "README.md", "SECURITY.md", "TOOLS.md"]);
const allowedRoots = new Set([".github", "assets", "mcp-server", "readme"]);
const forbiddenNames = new Set(["AGENTS.md", "plan.md", "secret.md"]);
const tracked = execFileSync("git", ["-C", repositoryRoot, "ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const violations = tracked.filter((file) => {
  const firstPart = file.split("/")[0];
  if (forbiddenNames.has(file) || file.startsWith("docs/") || file.startsWith(".project-questionnaire/") || (/(^|\/)\.env(?:\.|$)/.test(file) && file !== "mcp-server/.env.example")) return true;
  if (!file.includes("/")) return !publicRootFiles.has(file);
  return !allowedRoots.has(firstPart);
});

if (violations.length > 0) {
  throw new Error(`Запрещённые tracked-пути:\n${violations.map((file) => `- ${file}`).join("\n")}`);
}

const packageJson = resolve(repositoryRoot, "mcp-server/package.json");
if (!existsSync(packageJson)) throw new Error("Не найден mcp-server/package.json.");

console.log(`Границы репозитория проверены: ${tracked.length} tracked-файлов.`);
