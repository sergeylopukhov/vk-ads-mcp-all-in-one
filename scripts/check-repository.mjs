import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const forbiddenPaths = [
  /(^|\/)AGENTS\.md$/u,
  /(^|\/)\.env(?:\..*)?$/u,
  /(^|\/)auth(?:[-.][^/]*)?\.env$/u,
  /(^|\/)\.vk-ads-audit\.jsonl(?:\..*)?$/u,
  /(^|\/)\.vk-community-research\.json(?:\..*)?$/u,
  /(^|\/)\.project-questionnaire\//u,
  /(^|\/)node_modules\//u,
  /(^|\/)dist\//u,
  /(^|\/)coverage\//u,
  /^vk-api\//u,
];

const secretPatterns = [
  {
    label: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})\b/gu,
  },
  {
    label: "OpenAI API key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/gu,
  },
  {
    label: "private key",
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/gu,
  },
];

const failures = [];

for (const file of trackedFiles) {
  if (forbiddenPaths.some((pattern) => pattern.test(file))) {
    failures.push(`Forbidden tracked path: ${file}`);
    continue;
  }

  const stats = statSync(file);
  if (!stats.isFile() || stats.size > 1_000_000) {
    continue;
  }

  const buffer = readFileSync(file);
  if (buffer.includes(0)) {
    continue;
  }

  const text = buffer.toString("utf8");
  for (const { label, pattern } of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      failures.push(`${label} pattern in tracked file: ${file}`);
    }
  }
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const version = packageJson.version;

if (packageLock.version !== version) {
  failures.push(
    `Version mismatch: package.json=${version}, package-lock.json=${packageLock.version}`,
  );
}

if (packageLock.packages?.[""]?.version !== version) {
  failures.push(
    `Version mismatch: package.json=${version}, package-lock root=${packageLock.packages?.[""]?.version}`,
  );
}

const readme = readFileSync("README.md", "utf8");
if (!readme.includes(`version-${version}-`)) {
  failures.push(`README version badge does not match package.json ${version}`);
}

const changelog = readFileSync("docs/CHANGELOG.md", "utf8");
if (!changelog.includes(`## ${version} `)) {
  failures.push(`CHANGELOG has no ${version} release heading`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `Checked ${trackedFiles.length} tracked files, repository boundaries, secret patterns, and version synchronization.`,
);
