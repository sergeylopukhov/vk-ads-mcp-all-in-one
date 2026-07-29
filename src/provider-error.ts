const MAX_PROVIDER_ISSUES = 12;
const MAX_PROVIDER_TEXT_LENGTH = 300;
const MAX_PROVIDER_PATH_LENGTH = 160;

const ISSUE_METADATA_KEYS = new Set([
  "code",
  "error_code",
  "message",
  "error_msg",
  "min_value",
  "max_value",
  "min_length",
  "max_length",
  "line_number",
]);

const SENSITIVE_VALUE_KEYS = new Set([
  "access_token",
  "authorization",
  "client_id",
  "client_secret",
  "line",
  "password",
  "refresh_token",
  "request_params",
  "token",
  "value",
]);

export interface ProviderFieldIssue {
  path: string;
  code?: string;
  message?: string;
  constraints?: string[];
}

export interface NormalizedProviderError {
  code: string;
  message?: string;
  fieldIssues: ProviderFieldIssue[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asProviderCode(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return sanitizeProviderText(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function sanitizeProviderText(value: string): string {
  const compact = value.replace(/[\u0000-\u001f\u007f]+/gu, " ").trim();
  const redacted = compact
    .replace(
      /\b(access_token|authorization|client_id|client_secret|password|refresh_token|token)\s*[:=]\s*[^\s,;&]+/giu,
      "$1=[redacted]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/giu, "Bearer [redacted]")
    .replace(/\bhttps?:\/\/[^\s"'<>]+/giu, "[url]")
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
      "[email]",
    )
    .replace(/\b[A-Za-z0-9_-]{40,}\b/gu, "[redacted]");

  return redacted.length <= MAX_PROVIDER_TEXT_LENGTH
    ? redacted
    : `${redacted.slice(0, MAX_PROVIDER_TEXT_LENGTH - 1)}…`;
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replace(/[^\p{L}\p{N}_.-]+/gu, "_");
  return sanitized === "" ? "field" : sanitized;
}

function appendPath(path: string, segment: string): string {
  const next =
    path === ""
      ? sanitizePathSegment(segment)
      : `${path}.${sanitizePathSegment(segment)}`;

  return next.length <= MAX_PROVIDER_PATH_LENGTH
    ? next
    : `${next.slice(0, MAX_PROVIDER_PATH_LENGTH - 1)}…`;
}

function readIssueMetadata(
  record: Record<string, unknown>,
  path: string,
): ProviderFieldIssue | undefined {
  const code =
    asProviderCode(record.code) ?? asProviderCode(record.error_code);
  const messageSource =
    typeof record.message === "string"
      ? record.message
      : typeof record.error_msg === "string"
        ? record.error_msg
        : undefined;
  const message =
    messageSource === undefined
      ? undefined
      : sanitizeProviderText(messageSource);
  const constraints = [
    "min_value",
    "max_value",
    "min_length",
    "max_length",
    "line_number",
  ].flatMap((key) => {
    const value = record[key];

    return typeof value === "string" || typeof value === "number"
      ? [`${key}=${sanitizeProviderText(String(value))}`]
      : [];
  });

  if (
    path === "" ||
    (code === undefined &&
      message === undefined &&
      constraints.length === 0)
  ) {
    return undefined;
  }

  return {
    path,
    ...(code === undefined ? {} : { code }),
    ...(message === undefined ? {} : { message }),
    ...(constraints.length === 0 ? {} : { constraints }),
  };
}

function collectFieldIssues(
  value: unknown,
  path: string,
  issues: ProviderFieldIssue[],
): void {
  if (issues.length >= MAX_PROVIDER_ISSUES) {
    return;
  }

  if (typeof value === "string") {
    if (path !== "") {
      issues.push({
        path,
        message: sanitizeProviderText(value),
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (issues.length < MAX_PROVIDER_ISSUES) {
        collectFieldIssues(item, `${path}[${index}]`, issues);
      }
    });
    return;
  }

  const record = asRecord(value);

  if (record === undefined) {
    return;
  }

  const issue = readIssueMetadata(record, path);

  if (issue !== undefined) {
    issues.push(issue);
  }

  for (const [key, child] of Object.entries(record)) {
    if (
      issues.length >= MAX_PROVIDER_ISSUES ||
      ISSUE_METADATA_KEYS.has(key) ||
      SENSITIVE_VALUE_KEYS.has(key)
    ) {
      continue;
    }

    collectFieldIssues(child, appendPath(path, key), issues);
  }
}

export function normalizeProviderError(
  payload: unknown,
  fallbackCode: string,
): NormalizedProviderError {
  const envelope = asRecord(payload);
  const nestedError = asRecord(envelope?.error);
  const source = nestedError ?? envelope;
  const directError =
    typeof envelope?.error === "string" ? envelope.error : undefined;
  const code =
    asProviderCode(source?.code) ??
    asProviderCode(source?.error_code) ??
    asProviderCode(directError) ??
    fallbackCode;
  const messageSource =
    typeof source?.message === "string"
      ? source.message
      : typeof source?.error_msg === "string"
        ? source.error_msg
        : typeof envelope?.error_description === "string"
          ? envelope.error_description
          : undefined;
  const fieldIssues: ProviderFieldIssue[] = [];

  collectFieldIssues(source?.fields, "", fieldIssues);

  return {
    code,
    ...(messageSource === undefined
      ? {}
      : { message: sanitizeProviderText(messageSource) }),
    fieldIssues,
  };
}

export function formatProviderErrorSuffix(
  error: NormalizedProviderError,
): string {
  const parts: string[] = [];

  if (
    error.message !== undefined &&
    error.message.toLowerCase() !== error.code.toLowerCase()
  ) {
    parts.push(`Provider message: ${error.message}.`);
  }

  if (error.fieldIssues.length > 0) {
    const fields = error.fieldIssues
      .map((issue) => {
        const metadata = [
          issue.code === undefined ? undefined : `[${issue.code}]`,
          issue.message,
          ...(issue.constraints ?? []),
        ].filter((value): value is string => value !== undefined);

        return metadata.length === 0
          ? issue.path
          : `${issue.path}: ${metadata.join("; ")}`;
      })
      .join(" | ");

    parts.push(`Provider fields: ${fields}.`);
  }

  return parts.length === 0 ? "" : ` ${parts.join(" ")}`;
}
