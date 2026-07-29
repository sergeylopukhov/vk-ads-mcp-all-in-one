import {
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { JsonLinesVkAdsAuditLog } from "../src/audit-log.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("JsonLinesVkAdsAuditLog", () => {
  it("writes a sanitized event to a private JSONL file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vk-ads-audit-"));
    const path = join(directory, "audit.jsonl");
    temporaryDirectories.push(directory);
    const auditLog = new JsonLinesVkAdsAuditLog(
      path,
      () => new Date("2026-07-27T20:00:00.000Z"),
    );

    await auditLog.record({
      operation: "ad_plans.create",
      outcome: "success",
    });

    await expect(readFile(path, "utf8")).resolves.toBe(
      '{"timestamp":"2026-07-27T20:00:00.000Z","operation":"ad_plans.create","outcome":"success"}\n',
    );
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
  });

  it("rejects a symbolic-link audit path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vk-ads-audit-"));
    const target = join(directory, "target.jsonl");
    const path = join(directory, "audit.jsonl");
    temporaryDirectories.push(directory);
    await symlink(target, path);
    const auditLog = new JsonLinesVkAdsAuditLog(path);

    await expect(auditLog.ensureReady()).rejects.toMatchObject({
      code: "audit_log_invalid",
    });
  });
});
