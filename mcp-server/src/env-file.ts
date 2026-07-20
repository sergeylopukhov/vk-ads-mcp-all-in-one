import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Локальное .env-хранилище без платформенных Keychain/Registry API.
 * Значения не возвращаются и не попадают в ответы MCP.
 */
export class EnvFile {
  public constructor(private readonly filePath: string) {}

  public async set(values: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n]/u.test(value)) {
        throw new Error("Небезопасное значение для локального .env.");
      }
    }

    let source = "";
    try {
      source = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }

    const pending = new Map(Object.entries(values));
    const lines = source.split(/\r?\n/u).map((line) => {
      const match = /^([A-Z][A-Z0-9_]*)=.*/u.exec(line);
      if (!match) return line;
      const key = match[1]!;
      const value = pending.get(key);
      if (value === undefined) return line;
      pending.delete(key);
      return `${key}=${value}`;
    });
    for (const [key, value] of pending) lines.push(`${key}=${value}`);
    const result = `${lines.join("\n").replace(/\n+$/u, "")}\n`;
    const temporaryPath = join(dirname(this.filePath), `.${Date.now()}.vk-ads-mcp.env`);
    await writeFile(temporaryPath, result, { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, this.filePath);
    await chmod(this.filePath, 0o600);
  }
}
