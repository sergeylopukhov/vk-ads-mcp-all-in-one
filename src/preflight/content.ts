import { lstat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import { z } from "zod";

import type { VkAdsCurrentUser } from "../vk-ads/client.js";
import type {
  ActionContract,
  ActionReadiness,
  RequirementIssue,
} from "./types.js";

const pathSchema = z
  .string()
  .min(1)
  .refine(isAbsolute, "Путь к файлу должен быть абсолютным.");
const dimensionsSchema = {
  width: z.number().int().positive(),
  height: z.number().int().positive(),
} as const;
const html5Schema = z.object({ filePath: pathSchema });
const staticSchema = z.object({
  filePath: pathSchema,
  ...dimensionsSchema,
});
const videoSchema = z.object({
  filePath: pathSchema,
  ...dimensionsSchema,
});

type ContentInput =
  | z.infer<typeof html5Schema>
  | z.infer<typeof staticSchema>
  | z.infer<typeof videoSchema>;

export interface ContentPreflightClient {
  getCurrentUser(): Promise<VkAdsCurrentUser>;
}

interface FileState {
  exists: boolean;
  regular: boolean;
  symbolicLink: boolean;
  size: number;
}

interface ContentContext {
  user: VkAdsCurrentUser;
  file: FileState;
}

async function inspectFile(path: string): Promise<FileState> {
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

function issue(
  code: string,
  message: string,
): RequirementIssue {
  return {
    code,
    path: "filePath",
    message,
    source: "provider_contract",
  };
}

function readiness(
  action: string,
  context: ContentContext,
  extension: string,
  allowedExtensions: string[],
): ActionReadiness {
  const incompatible: RequirementIssue[] = [];

  if (!context.file.exists) {
    incompatible.push(
      issue("file_not_found", "Файл не найден."),
    );
  } else if (
    !context.file.regular ||
    context.file.symbolicLink
  ) {
    incompatible.push(
      issue(
        "file_not_regular",
        "Нужен обычный файл, а не каталог или символическая ссылка.",
      ),
    );
  } else if (context.file.size === 0) {
    incompatible.push(
      issue("file_empty", "Нельзя загрузить пустой файл."),
    );
  }

  if (!allowedExtensions.includes(extension)) {
    incompatible.push(
      issue(
        "file_extension_not_supported",
        `Допустимые расширения: ${allowedExtensions.join(", ")}.`,
      ),
    );
  }

  return {
    ready: incompatible.length === 0,
    action,
    stage: "compatibility",
    target: { resource: "content" },
    missingFields: [],
    incompatibleFields: incompatible,
    warnings: [],
    allowedValues: [
      {
        path: "filePath",
        values: allowedExtensions,
      },
    ],
    nextAction:
      incompatible.length === 0
        ? "Выполните соответствующий инструмент загрузки."
        : "Исправьте файл и повторите подготовку.",
    requiresConfirmation: false,
  };
}

function contract<TInput extends ContentInput>(
  action: string,
  schema: z.ZodType<TInput>,
  allowedExtensions: string[],
  client: ContentPreflightClient,
): ActionContract<TInput, ContentContext> {
  return {
    action,
    staticSchema: schema,
    target: () => ({ resource: "content" }),
    async loadContext(input, reads) {
      const [user, file] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`file:${input.filePath}`, () =>
          inspectFile(input.filePath),
        ),
      ]);
      return { user, file };
    },
    async validate(input, context) {
      return readiness(
        action,
        context,
        extname(input.filePath).toLowerCase(),
        allowedExtensions,
      );
    },
    buildRequest(input) {
      return {
        ...("width" in input ? { width: input.width } : {}),
        ...("height" in input ? { height: input.height } : {}),
      };
    },
  };
}

export function createContentActionContracts(
  client: ContentPreflightClient,
): Array<ActionContract<unknown, ContentContext>> {
  return [
    contract(
      "content.html5.upload",
      html5Schema,
      [".zip"],
      client,
    ),
    contract(
      "content.static.upload",
      staticSchema,
      [".jpg", ".jpeg", ".png"],
      client,
    ),
    contract(
      "content.video.upload",
      videoSchema,
      [".mp4", ".mov"],
      client,
    ),
  ] as Array<ActionContract<unknown, ContentContext>>;
}
