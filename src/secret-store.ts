import { execFileSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const KEYCHAIN_SERVICE = "vk-ads-mcp";
const ENCRYPTED_FILE_VERSION = 1;

export interface SecretStore {
  get(account: string): string | undefined;
  set(account: string, value: string): void;
}

interface EncryptedFilePayload {
  version: number;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

function defaultSecretFile(): string {
  const configDirectory = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(configDirectory, "vk-ads-mcp", "secrets.enc");
}

class MacOsKeychainStore implements SecretStore {
  get(account: string): string | undefined {
    try {
      return execFileSync(
        "security",
        ["find-generic-password", "-a", account, "-s", KEYCHAIN_SERVICE, "-w"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  set(account: string, value: string): void {
    try {
      execFileSync(
        "security",
        ["add-generic-password", "-U", "-a", account, "-s", KEYCHAIN_SERVICE, "-w", value],
        { stdio: ["ignore", "ignore", "ignore"] },
      );
    } catch {
      throw new Error("Не удалось сохранить секрет в macOS Keychain.");
    }
  }
}

class EncryptedFileStore implements SecretStore {
  public constructor(
    private readonly filePath: string,
    private readonly passphrase: string,
  ) {}

  get(account: string): string | undefined {
    return this.readAll()[account];
  }

  set(account: string, value: string): void {
    if (!value) throw new Error("Нельзя сохранить пустой секрет.");
    const entries = this.readAll();
    entries[account] = value;
    this.writeAll(entries);
  }

  private readAll(): Record<string, string> {
    if (!existsSync(this.filePath)) return {};

    let payload: EncryptedFilePayload;
    try {
      payload = JSON.parse(readFileSync(this.filePath, "utf8")) as EncryptedFilePayload;
    } catch {
      throw new Error("Зашифрованное хранилище секретов повреждено или имеет неверный формат.");
    }
    if (payload.version !== ENCRYPTED_FILE_VERSION || !payload.salt || !payload.iv || !payload.tag || !payload.ciphertext) {
      throw new Error("Зашифрованное хранилище секретов имеет неподдерживаемый формат.");
    }

    try {
      const key = scryptSync(this.passphrase, Buffer.from(payload.salt, "base64url"), 32);
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64url"));
      decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64url")), decipher.final()]).toString("utf8");
      const parsed: unknown = JSON.parse(plaintext);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid payload");
      if (Object.values(parsed).some((value) => typeof value !== "string")) throw new Error("invalid secret value");
      return parsed as Record<string, string>;
    } catch {
      throw new Error("Не удалось открыть зашифрованное хранилище: проверьте пароль VK_ADS_SECRET_PASSPHRASE.");
    }
  }

  private writeAll(entries: Record<string, string>): void {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(this.passphrase, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(entries), "utf8"), cipher.final()]);
    const payload: EncryptedFilePayload = {
      version: ENCRYPTED_FILE_VERSION,
      salt: salt.toString("base64url"),
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
    const directory = dirname(this.filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const tempPath = `${this.filePath}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      writeFileSync(tempPath, JSON.stringify(payload), { mode: 0o600, flush: true });
      renameSync(tempPath, this.filePath);
    } catch {
      throw new Error("Не удалось атомарно обновить зашифрованное хранилище секретов.");
    }
  }
}

class UnavailableSecretStore implements SecretStore {
  get(_account: string): string | undefined { return undefined; }

  set(_account: string, _value: string): void {
    throw new Error("Постоянное хранилище секретов не настроено. Укажите VK_ADS_SECRET_STORE=encrypted-file и VK_ADS_SECRET_PASSPHRASE либо используйте macOS Keychain.");
  }
}

export function createSecretStore(environment: NodeJS.ProcessEnv = process.env): SecretStore {
  const configuredStore = environment.VK_ADS_SECRET_STORE?.trim().toLowerCase() || "auto";
  if (!["auto", "keychain", "encrypted-file"].includes(configuredStore)) {
    throw new Error("VK_ADS_SECRET_STORE допускает значения auto, keychain или encrypted-file.");
  }
  if (configuredStore === "keychain") {
    if (process.platform !== "darwin") throw new Error("VK_ADS_SECRET_STORE=keychain доступен только в macOS.");
    return new MacOsKeychainStore();
  }

  const passphrase = environment.VK_ADS_SECRET_PASSPHRASE?.trim();
  if (configuredStore === "encrypted-file" || passphrase) {
    if (!passphrase) throw new Error("Для VK_ADS_SECRET_STORE=encrypted-file нужен VK_ADS_SECRET_PASSPHRASE. Пароль не сохраняется сервером.");
    const requestedPath = environment.VK_ADS_SECRETS_FILE?.trim();
    return new EncryptedFileStore(resolve(requestedPath || defaultSecretFile()), passphrase);
  }
  if (process.platform === "darwin") return new MacOsKeychainStore();
  return new UnavailableSecretStore();
}
