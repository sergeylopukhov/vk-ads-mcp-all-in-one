const SENSITIVE_KEY =
  /(?:token|secret|password|passphrase|email|authorization|cookie|code|path|file|url)/i;

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 200;
const MAX_OBJECT_KEYS = 200;

function sanitizeValue(
  value: unknown,
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) {
    return "[omitted]";
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value !== "object") {
    return undefined;
  }

  const result: Record<string, unknown> = {};

  for (const [key, nested] of Object.entries(value).slice(
    0,
    MAX_OBJECT_KEYS,
  )) {
    if (SENSITIVE_KEY.test(key)) {
      continue;
    }

    const sanitized = sanitizeValue(nested, depth + 1);

    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  }

  return result;
}

export function sanitizeProviderRequestDraft(
  draft: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeValue(draft, 0) as Record<string, unknown>;
}
