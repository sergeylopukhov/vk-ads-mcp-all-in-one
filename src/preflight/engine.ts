import { sanitizeProviderRequestDraft } from "./sanitize.js";
import type {
  ActionContract,
  ActionReadiness,
  PreflightReadScope,
  RequirementIssue,
} from "./types.js";

function normalizeIssues(
  issues: RequirementIssue[],
): RequirementIssue[] {
  const unique = new Map<string, RequirementIssue>();

  for (const issue of issues) {
    unique.set(
      `${issue.code}\u0000${issue.path}\u0000${issue.source}`,
      issue,
    );
  }

  return [...unique.values()].sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code),
  );
}

class RequestReadScope implements PreflightReadScope {
  private readonly reads = new Map<string, Promise<unknown>>();

  loadOnce<T>(
    key: string,
    loader: () => Promise<T>,
  ): Promise<T> {
    const existing = this.reads.get(key);

    if (existing !== undefined) {
      return existing as Promise<T>;
    }

    const pending = loader();
    this.reads.set(key, pending);
    return pending;
  }
}

export class ActionContractRegistry {
  private readonly contracts = new Map<
    string,
    ActionContract<unknown, unknown>
  >();

  register<TInput, TContext>(
    contract: ActionContract<TInput, TContext>,
  ): void {
    if (this.contracts.has(contract.action)) {
      throw new Error(
        `Action contract is already registered: ${contract.action}`,
      );
    }

    this.contracts.set(
      contract.action,
      contract as ActionContract<unknown, unknown>,
    );
  }

  get(action: string): ActionContract<unknown, unknown> | undefined {
    return this.contracts.get(action);
  }

  actions(): string[] {
    return [...this.contracts.keys()].sort();
  }
}

export class ActionPreflightEngine {
  constructor(
    private readonly registry: ActionContractRegistry,
  ) {}

  async prepare(
    action: string,
    rawInput: unknown,
  ): Promise<ActionReadiness> {
    const contract = this.registry.get(action);

    if (contract === undefined) {
      const actions = this.registry.actions();

      return {
        ready: false,
        action,
        stage: "input",
        target: { resource: "unknown" },
        missingFields: [],
        incompatibleFields: [
          {
            code: "action_not_supported",
            path: "action",
            message:
              "Для действия ещё нет проверенного контракта подготовки.",
            source: "schema",
          },
        ],
        warnings: [],
        allowedValues: actions.length
          ? [{ path: "action", values: actions }]
          : undefined,
        nextAction: "Выберите поддерживаемое действие.",
        requiresConfirmation: false,
      };
    }

    const parsed = contract.staticSchema.safeParse(rawInput);

    if (!parsed.success) {
      return {
        ready: false,
        action,
        stage: "input",
        target: { resource: "unknown" },
        missingFields: normalizeIssues(
          parsed.error.issues.map((issue) => ({
            code:
              issue.code === "invalid_type"
                ? "required_or_invalid_field"
                : "invalid_field",
            path: issue.path.join("."),
            message: issue.message,
            source: "schema" as const,
          })),
        ),
        incompatibleFields: [],
        warnings: [],
        requiresConfirmation: false,
      };
    }

    const input = parsed.data;
    let context: unknown;

    try {
      try {
        context = await contract.loadContext(
          input,
          new RequestReadScope(),
        );
      } catch {
        context = await contract.loadContext(
          input,
          new RequestReadScope(),
        );
      }
    } catch {
      return {
        ready: false,
        action,
        stage: "context",
        target: contract.target(input),
        missingFields: [],
        incompatibleFields: [
          {
            code: "provider_context_unavailable",
            path: "",
            message:
              "Не удалось загрузить свежие данные VK для предварительной проверки.",
            source: "provider_state",
          },
        ],
        warnings: [],
        nextAction:
          "Повторите подготовку после восстановления чтения VK.",
        requiresConfirmation: false,
      };
    }

    const readiness = await contract.validate(input, context);
    const normalized: ActionReadiness = {
      ...readiness,
      missingFields: normalizeIssues(readiness.missingFields),
      incompatibleFields: normalizeIssues(
        readiness.incompatibleFields,
      ),
      warnings: normalizeIssues(readiness.warnings),
    };

    if (normalized.ready) {
      normalized.requestDraft = sanitizeProviderRequestDraft(
        contract.buildRequest(input, context),
      );
    }

    return normalized;
  }
}
