import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const markdownFiles = trackedFiles.filter((file) => file.endsWith(".md"));
const failures = [];
const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/gu;

for (const file of markdownFiles) {
  const text = readFileSync(file, "utf8");

  for (const match of text.matchAll(linkPattern)) {
    let target = match[1].trim();

    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1);
    } else {
      target = target.split(/\s+"/u, 1)[0];
    }

    if (
      target.startsWith("#") ||
      /^(?:https?|mailto|tel|data):/iu.test(target)
    ) {
      continue;
    }

    const [pathPart] = target.split("#", 1);
    if (!pathPart) {
      continue;
    }

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathPart);
    } catch {
      failures.push(`${file}: malformed link ${target}`);
      continue;
    }

    const destination = resolve(dirname(file), decodedPath);
    if (!existsSync(destination)) {
      failures.push(`${file}: missing link target ${target}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Checked relative links in ${markdownFiles.length} Markdown files.`);
