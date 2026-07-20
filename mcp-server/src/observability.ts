import { randomUUID } from "node:crypto";

export interface RequestLogEvent {
  request_id: string;
  tool: "provider_request";
  method: string;
  endpoint: string;
  duration_ms: number;
  http_status?: number;
  retry: boolean;
  error_class?: "network";
}

/** Логирует только безопасную metadata: без query, headers, token, payload и URL назначения. */
export function instrumentFetch(fetchImplementation: typeof fetch, enabled: boolean): typeof fetch {
  if (!enabled) return fetchImplementation;
  return async (input, init) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    try {
      const response = await fetchImplementation(input, init);
      writeLog({
        request_id: requestId,
        tool: "provider_request",
        method: init?.method ?? "GET",
        endpoint: url.pathname,
        duration_ms: Date.now() - startedAt,
        http_status: response.status,
        retry: false,
      });
      return response;
    } catch (error) {
      writeLog({
        request_id: requestId,
        tool: "provider_request",
        method: init?.method ?? "GET",
        endpoint: url.pathname,
        duration_ms: Date.now() - startedAt,
        retry: false,
        error_class: "network",
      });
      throw error;
    }
  };
}

function writeLog(event: RequestLogEvent): void {
  process.stderr.write(`${JSON.stringify(event)}\n`);
}
