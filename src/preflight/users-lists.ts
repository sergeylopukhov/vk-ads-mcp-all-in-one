import { lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";

import type {
  VkAdsCurrentUser,
  VkAdsRemarketingUsersList,
} from "../vk-ads/client.js";
import type {
  ActionContract,
  ActionReadiness,
  RequirementIssue,
} from "./types.js";

const usersListTypeSchema = z.enum([
  "ok",
  "mm",
  "phones",
  "emails",
  "device_id",
  "android_id",
  "advertising_id",
  "idfa",
  "dmp_id",
  "dmp_top",
  "vk",
  "mac",
  "mparticle",
  "human",
]);
const createSchema = z.object({
  filePath: z
    .string()
    .min(1)
    .refine(isAbsolute, "Путь к файлу должен быть абсолютным."),
  name: z.string().min(1),
  type: usersListTypeSchema,
  base: z.number().int().refine((value) => value !== 0).optional(),
});
const updateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
});
const deleteSchema = z.object({
  id: z.number().int().positive(),
});

type CreateInput = z.infer<typeof createSchema>;
type UpdateInput = z.infer<typeof updateSchema>;
type DeleteInput = z.infer<typeof deleteSchema>;

export interface UsersListPreflightClient {
  getCurrentUser(): Promise<VkAdsCurrentUser>;
  getRemarketingUsersList(
    id: number,
  ): Promise<VkAdsRemarketingUsersList>;
}

interface UsersListContext {
  user: VkAdsCurrentUser;
  usersList?: VkAdsRemarketingUsersList;
  base?: VkAdsRemarketingUsersList;
  file?: {
    exists: boolean;
    regular: boolean;
    symbolicLink: boolean;
    size: number;
  };
}

function problem(
  code: string,
  path: string,
  message: string,
  source: RequirementIssue["source"] = "provider_state",
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
      resource: "remarketing_users_list",
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

async function inspectFile(path: string) {
  try {
    const info = await lstat(path);

    return {
      exists: true,
      regular: info.isFile(),
      symbolicLink: info.isSymbolicLink(),
      size: info.size,
    };
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
      };
    }

    throw error;
  }
}

export function createUsersListActionContracts(
  client: UsersListPreflightClient,
): Array<ActionContract<unknown, UsersListContext>> {
  const create: ActionContract<
    CreateInput,
    UsersListContext
  > = {
    action: "users_list.create",
    staticSchema: createSchema,
    target: () => ({
      resource: "remarketing_users_list",
    }),
    async loadContext(input, reads) {
      const [user, file, base] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`file:${input.filePath}`, () =>
          inspectFile(input.filePath),
        ),
        input.base === undefined
          ? Promise.resolve(undefined)
          : reads.loadOnce(`users-list:${input.base}`, () =>
              client.getRemarketingUsersList(input.base!),
            ),
      ]);
      return {
        user,
        file,
        ...(base === undefined ? {} : { base }),
      };
    },
    async validate(_input, context) {
      const incompatible: RequirementIssue[] = [];

      if (!context.file?.exists) {
        incompatible.push(
          problem(
            "file_not_found",
            "filePath",
            "Файл пользовательского списка не найден.",
            "provider_contract",
          ),
        );
      } else if (
        !context.file.regular ||
        context.file.symbolicLink ||
        context.file.size === 0 ||
        context.file.size > 128 * 1024 * 1024
      ) {
        incompatible.push(
          problem(
            "users_list_file_invalid",
            "filePath",
            "Нужен непустой обычный файл не больше 128 МиБ.",
            "provider_contract",
          ),
        );
      }

      return result("users_list.create", undefined, incompatible);
    },
    buildRequest: ({ filePath: _filePath, ...input }) => input,
  };

  const update: ActionContract<
    UpdateInput,
    UsersListContext
  > = {
    action: "users_list.update",
    staticSchema: updateSchema,
    target: ({ id }) => ({
      resource: "remarketing_users_list",
      id,
    }),
    async loadContext(input, reads) {
      const [user, usersList] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`users-list:${input.id}`, () =>
          client.getRemarketingUsersList(input.id),
        ),
      ]);
      return { user, usersList };
    },
    async validate(input) {
      return result("users_list.update", input.id, []);
    },
    buildRequest: ({ id: _id, ...input }) => input,
  };

  const remove: ActionContract<
    DeleteInput,
    UsersListContext
  > = {
    action: "users_list.delete",
    staticSchema: deleteSchema,
    target: ({ id }) => ({
      resource: "remarketing_users_list",
      id,
    }),
    async loadContext(input, reads) {
      const [user, usersList] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`users-list:${input.id}`, () =>
          client.getRemarketingUsersList(input.id),
        ),
      ]);
      return { user, usersList };
    },
    async validate(input) {
      return result("users_list.delete", input.id, []);
    },
    buildRequest: ({ id }) => ({ id }),
  };

  return [create, update, remove] as Array<
    ActionContract<unknown, UsersListContext>
  >;
}
