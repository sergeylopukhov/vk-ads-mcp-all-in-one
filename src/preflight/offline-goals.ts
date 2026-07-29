import { lstat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";

import type {
  VkAdsCurrentUser,
  VkAdsRemarketingOfflineGoalsResult,
} from "../vk-ads/client.js";
import type {
  ActionContract,
  ActionReadiness,
  RequirementIssue,
} from "./types.js";

const filePathSchema = z
  .string()
  .min(1)
  .refine(isAbsolute, "Путь к файлу должен быть абсолютным.");
const createSchema = z.object({
  filePath: filePathSchema,
  name: z.string().min(1),
  type: z.enum(["email", "phone"]),
  attributionPeriod: z.number().int().positive(),
});
const updateSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1).optional(),
    filePath: filePathSchema.optional(),
  })
  .refine(
    ({ name, filePath }) =>
      name !== undefined || filePath !== undefined,
    "Укажите name или filePath.",
  );
const deleteSchema = z.object({
  id: z.number().int().positive(),
});

type CreateInput = z.infer<typeof createSchema>;
type UpdateInput = z.infer<typeof updateSchema>;
type DeleteInput = z.infer<typeof deleteSchema>;

export interface OfflineGoalPreflightClient {
  getCurrentUser(): Promise<VkAdsCurrentUser>;
  listRemarketingOfflineGoals(): Promise<VkAdsRemarketingOfflineGoalsResult>;
}

interface OfflineGoalContext {
  user: VkAdsCurrentUser;
  goals: VkAdsRemarketingOfflineGoalsResult["items"];
  file?: {
    exists: boolean;
    regular: boolean;
    symbolicLink: boolean;
    size: number;
    sampledRows: number;
    invalidSample: boolean;
  };
}

async function inspectFile(path: string) {
  try {
    const info = await lstat(path);

    const state = {
      exists: true,
      regular: info.isFile(),
      symbolicLink: info.isSymbolicLink(),
      size: info.size,
      sampledRows: 0,
      invalidSample: false,
    };

    if (
      !state.regular ||
      state.symbolicLink ||
      state.size === 0
    ) {
      return state;
    }

    const lines = createInterface({
      input: createReadStream(path, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    try {
      for await (const line of lines) {
        if (line.trim() === "") {
          continue;
        }

        state.sampledRows += 1;
        const columns = line.split(",");

        if (
          columns.length !== 2 ||
          columns[0]?.trim() === "" ||
          !/^\d{2}\.\d{2}\.\d{4}$/u.test(
            columns[1]?.trim() ?? "",
          )
        ) {
          state.invalidSample = true;
        }

        if (state.sampledRows >= 10) {
          break;
        }
      }
    } finally {
      lines.close();
    }

    return state;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {
        exists: false,
        regular: false,
        symbolicLink: false,
        size: 0,
        sampledRows: 0,
        invalidSample: false,
      };
    }

    throw error;
  }
}

function issue(
  code: string,
  path: string,
  message: string,
  source: RequirementIssue["source"],
): RequirementIssue {
  return { code, path, message, source };
}

function result(
  action: string,
  id: number | undefined,
  incompatibleFields: RequirementIssue[],
): ActionReadiness {
  return {
    ready: incompatibleFields.length === 0,
    action,
    stage: "compatibility",
    target: {
      resource: "remarketing_offline_goal",
      ...(id === undefined ? {} : { id }),
    },
    missingFields: [],
    incompatibleFields,
    warnings: [],
    nextAction:
      incompatibleFields.length === 0
        ? "Выполните соответствующий write-инструмент."
        : "Исправьте условия и повторите подготовку.",
    requiresConfirmation: false,
  };
}

function fileIssues(
  file: OfflineGoalContext["file"],
): RequirementIssue[] {
  if (file === undefined) {
    return [];
  }

  if (!file.exists) {
    return [
      issue(
        "file_not_found",
        "filePath",
        "Файл офлайн-конверсий не найден.",
        "provider_contract",
      ),
    ];
  }

  return !file.regular ||
    file.symbolicLink ||
    file.size === 0
    ? [
        issue(
          "offline_goal_file_invalid",
          "filePath",
          "Нужен непустой обычный файл, не являющийся символической ссылкой.",
          "provider_contract",
        ),
      ]
    : [
        ...(file.invalidSample
          ? [
              issue(
                "offline_goal_csv_invalid",
                "filePath",
                "CSV должен содержать строки ID,date с датой DD.MM.YYYY.",
                "provider_contract",
              ),
            ]
          : []),
        ...(file.sampledRows < 10
          ? [
              issue(
                "offline_goal_rows_too_few",
                "filePath",
                "CSV должен содержать не меньше десяти строк.",
                "provider_contract",
              ),
            ]
          : []),
      ];
}

export function createOfflineGoalActionContracts(
  client: OfflineGoalPreflightClient,
): Array<ActionContract<unknown, OfflineGoalContext>> {
  const create: ActionContract<
    CreateInput,
    OfflineGoalContext
  > = {
    action: "offline_goal.create",
    staticSchema: createSchema,
    target: () => ({
      resource: "remarketing_offline_goal",
    }),
    async loadContext(input, reads) {
      const [user, goals, file] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads
          .loadOnce("offline-goals", () =>
            client.listRemarketingOfflineGoals(),
          )
          .then((value) => value.items),
        reads.loadOnce(`file:${input.filePath}`, () =>
          inspectFile(input.filePath),
        ),
      ]);
      return { user, goals, file };
    },
    async validate(_input, context) {
      return result(
        "offline_goal.create",
        undefined,
        fileIssues(context.file),
      );
    },
    buildRequest: ({ filePath: _filePath, ...input }) => input,
  };

  const update: ActionContract<
    UpdateInput,
    OfflineGoalContext
  > = {
    action: "offline_goal.update",
    staticSchema: updateSchema,
    target: ({ id }) => ({
      resource: "remarketing_offline_goal",
      id,
    }),
    async loadContext(input, reads) {
      const [user, goals, file] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads
          .loadOnce("offline-goals", () =>
            client.listRemarketingOfflineGoals(),
          )
          .then((value) => value.items),
        input.filePath === undefined
          ? Promise.resolve(undefined)
          : reads.loadOnce(`file:${input.filePath}`, () =>
              inspectFile(input.filePath!),
            ),
      ]);
      return {
        user,
        goals,
        ...(file === undefined ? {} : { file }),
      };
    },
    async validate(input, context) {
      const incompatible = fileIssues(context.file);

      if (!context.goals.some((goal) => goal.id === input.id)) {
        incompatible.push(
          issue(
            "offline_goal_not_found",
            "id",
            "Офлайн-цель не найдена в текущем кабинете.",
            "provider_state",
          ),
        );
      }

      return result(
        "offline_goal.update",
        input.id,
        incompatible,
      );
    },
    buildRequest: ({ id: _id, filePath: _filePath, ...input }) =>
      input,
  };

  const remove: ActionContract<
    DeleteInput,
    OfflineGoalContext
  > = {
    action: "offline_goal.delete",
    staticSchema: deleteSchema,
    target: ({ id }) => ({
      resource: "remarketing_offline_goal",
      id,
    }),
    async loadContext(_input, reads) {
      const [user, goals] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads
          .loadOnce("offline-goals", () =>
            client.listRemarketingOfflineGoals(),
          )
          .then((value) => value.items),
      ]);
      return { user, goals };
    },
    async validate(input, context) {
      return result(
        "offline_goal.delete",
        input.id,
        context.goals.some((goal) => goal.id === input.id)
          ? []
          : [
              issue(
                "offline_goal_not_found",
                "id",
                "Офлайн-цель не найдена в текущем кабинете.",
                "provider_state",
              ),
            ],
      );
    },
    buildRequest: ({ id }) => ({ id }),
  };

  return [create, update, remove] as Array<
    ActionContract<unknown, OfflineGoalContext>
  >;
}
