import { lstat } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
} from "node:path";
import { z } from "zod";

import type {
  VkAdsCurrentUser,
  VkAdsLeadForm,
} from "../vk-ads/client.js";
import type {
  ActionContract,
  ActionReadiness,
  RequirementIssue,
} from "./types.js";

const idSchema = z.number().int().positive();
const idListSchema = z.array(idSchema).min(1).max(200);
const absolutePathSchema = z
  .string()
  .min(1)
  .refine(isAbsolute, "Путь должен быть абсолютным.");
const contactFieldSchema = z.enum([
  "first_name",
  "email",
  "phone",
  "birth_date",
  "city",
  "social_media_profile",
]);
const questionAnswerSchema = z
  .object({
    type: z.union([
      z.literal(0),
      z.literal(2),
      z.literal(3),
      z.literal(4),
    ]),
    text: z.string().min(1).max(40).optional(),
  })
  .strict()
  .superRefine((answer, context) => {
    if (answer.type === 0 && answer.text === undefined) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message:
          "Для пользовательского варианта ответа нужен text.",
      });
    }
    if (answer.type !== 0 && answer.text !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message:
          "Для особого варианта ответа text указывать нельзя.",
      });
    }
  });
const questionSchema = z
  .object({
    is_required: z.literal(true),
    text: z.string().min(1).max(68),
    type: z.enum([
      "one_answer",
      "multiple_answers",
      "text_answer",
    ]),
    answers: z.array(questionAnswerSchema).max(7),
  })
  .strict()
  .superRefine((question, context) => {
    if (
      question.type === "text_answer" &&
      question.answers.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["answers"],
        message:
          "У текстового вопроса список answers должен быть пустым.",
      });
    }
    if (
      question.type !== "text_answer" &&
      question.answers.length < 2
    ) {
      context.addIssue({
        code: "custom",
        path: ["answers"],
        message:
          "Для вопроса с выбором нужны минимум два варианта.",
      });
    }

    const specialTypes = question.answers
      .filter((answer) => answer.type !== 0)
      .map((answer) => answer.type);

    if (new Set(specialTypes).size !== specialTypes.length) {
      context.addIssue({
        code: "custom",
        path: ["answers"],
        message:
          "Особые типы вариантов ответа не должны повторяться.",
      });
    }
  });
const pageSchema = z
  .object({
    blocks: z
      .array(
        z
          .object({
            block_data: z
              .object({
                type: z.literal("question"),
                data: questionSchema,
              })
              .strict(),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();
const resultInfoSchema = z
  .object({
    title: z.string().min(1).max(25),
    description: z.string().max(160).optional(),
    site_url: z.url().max(2000).optional(),
    phone: z
      .string()
      .regex(/^\+\d+$/)
      .optional(),
    promo_code: z.string().min(1).optional(),
  })
  .strict();
const agreementSchema = z
  .object({
    usage: z.literal("template_document"),
    template_document: z
      .object({
        company_title: z.string().min(1).max(255),
        registration_address: z.string().min(1).max(255),
        email: z.email().max(255).optional(),
        ogrn_or_inn: z.string().min(1).max(32).optional(),
      })
      .strict(),
  })
  .strict();
const notificationSchema = z
  .object({
    type: z.literal("new_lead"),
    conditions: z.object({}).strict(),
    destinations: z
      .array(
        z
          .object({
            type: z.enum(["email", "vk"]),
            settings: z
              .object({
                email: z.email(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .superRefine((destination, context) => {
            if (
              destination.type === "email" &&
              destination.settings === undefined
            ) {
              context.addIssue({
                code: "custom",
                path: ["settings"],
                message:
                  "Для email-уведомления нужен settings.email.",
              });
            }
            if (
              destination.type === "vk" &&
              destination.settings !== undefined
            ) {
              context.addIssue({
                code: "custom",
                path: ["settings"],
                message:
                  "Для VK-уведомления settings указывать нельзя.",
              });
            }
          }),
      )
      .min(1)
      .max(16),
  })
  .strict();
const gradientSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(100),
  z.literal(101),
]);

export const leadFormCreateInputShape = {
  name: z.string().min(1).max(255),
  firstScreenType: z.enum(["compact", "long_text", "award"]),
  title: z.string().min(1).max(50),
  description: z.string().min(1).max(35).optional(),
  longDescription: z.string().min(1).max(350).optional(),
  companyTitle: z.string().min(1).max(30),
  logoId: z.string().min(1),
  award: z.record(z.string(), z.unknown()).optional(),
  gradient: gradientSchema.optional(),
  contactFields: z.array(contactFieldSchema).min(1),
  resultInfo: resultInfoSchema,
  agreement: agreementSchema,
  notifications: z.array(notificationSchema).optional(),
  pages: z.array(pageSchema).max(1).optional(),
  requiredAnswers: z.boolean().optional(),
  mainColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  mainImageId: z.string().min(1).optional(),
} as const;

export const leadFormUpdateInputShape = {
  id: idSchema,
  ...Object.fromEntries(
    Object.entries(leadFormCreateInputShape).map(
      ([name, schema]) => [name, schema.optional()],
    ),
  ),
} as {
  id: typeof idSchema;
} & {
  [Key in keyof typeof leadFormCreateInputShape]: z.ZodOptional<
    (typeof leadFormCreateInputShape)[Key]
  >;
};

const createSchema = z.object(leadFormCreateInputShape);
const updateSchema = z
  .object(leadFormUpdateInputShape)
  .refine(
    (input) =>
      Object.entries(input).some(
        ([name, value]) => name !== "id" && value !== undefined,
      ),
    "Нужно указать хотя бы одно изменяемое поле.",
  );
const logoUploadSchema = z.object({
  filePath: absolutePathSchema,
});
const copySchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(255).optional(),
});
const archiveSchema = z.object({ ids: idListSchema });
const exportSchema = z.object({
  formId: idSchema,
  format: z.enum(["csv", "xlsx"]),
  outputPath: absolutePathSchema,
  adPlanIds: idListSchema.optional(),
  adGroupIds: idListSchema.optional(),
  bannerIds: idListSchema.optional(),
  createdAtFrom: z.string().min(1).max(64).optional(),
  createdAtTo: z.string().min(1).max(64).optional(),
});
const testLeadSchema = z.object({ formId: idSchema });

type CreateInput = z.infer<typeof createSchema>;
type UpdateInput = z.infer<typeof updateSchema>;
type PartialCreateInput = {
  [Key in keyof CreateInput]?: CreateInput[Key] | undefined;
};
type LogoUploadInput = z.infer<typeof logoUploadSchema>;
type CopyInput = z.infer<typeof copySchema>;
type ArchiveInput = z.infer<typeof archiveSchema>;
type ExportInput = z.infer<typeof exportSchema>;
type TestLeadInput = z.infer<typeof testLeadSchema>;

export interface LeadFormPreflightClient {
  getCurrentUser(): Promise<VkAdsCurrentUser>;
  getLeadForm(id: number): Promise<VkAdsLeadForm>;
}

interface FileState {
  exists: boolean;
  file: boolean;
  directory: boolean;
  symbolicLink: boolean;
  size: number;
}

interface LeadFormContext {
  user: VkAdsCurrentUser;
  form?: VkAdsLeadForm;
  forms?: VkAdsLeadForm[];
  file?: FileState;
  parent?: FileState;
  targetExists?: boolean;
}

async function inspectPath(path: string): Promise<FileState> {
  try {
    const info = await lstat(path);
    return {
      exists: true,
      file: info.isFile(),
      directory: info.isDirectory(),
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
        file: false,
        directory: false,
        symbolicLink: false,
        size: 0,
      };
    }
    throw error;
  }
}

function issue(
  code: string,
  path: string,
  message: string,
  source: RequirementIssue["source"] = "provider_contract",
): RequirementIssue {
  return { code, path, message, source };
}

function result(
  action: string,
  resource: string,
  incompatibleFields: RequirementIssue[],
  warnings: RequirementIssue[] = [],
  id?: number,
): ActionReadiness {
  return {
    ready: incompatibleFields.length === 0,
    action,
    stage: "compatibility",
    target: {
      resource,
      ...(id === undefined ? {} : { id }),
    },
    missingFields: [],
    incompatibleFields,
    warnings,
    nextAction:
      incompatibleFields.length === 0
        ? "Выполните соответствующий write-инструмент."
        : "Исправьте условия и повторите подготовку.",
    requiresConfirmation: false,
  };
}

function firstScreenIssues(
  input: PartialCreateInput,
  current?: VkAdsLeadForm,
): RequirementIssue[] {
  const type = input.firstScreenType ?? current?.firstScreenType;
  const description =
    input.description ?? current?.description;
  const longDescription =
    input.longDescription ?? current?.longDescription;
  const incompatible: RequirementIssue[] = [];

  if (type === "compact" && description === undefined) {
    incompatible.push(
      issue(
        "lead_form_description_required",
        "description",
        "Для compact-экрана нужно description.",
      ),
    );
  }
  if (type === "long_text" && longDescription === undefined) {
    incompatible.push(
      issue(
        "lead_form_long_description_required",
        "longDescription",
        "Для long_text-экрана нужно longDescription.",
      ),
    );
  }
  if (type === "award" && input.award === undefined) {
    incompatible.push(
      issue(
        "lead_form_award_required",
        "award",
        "Для award-экрана нужен объект award.",
      ),
    );
  }
  if (
    input.longDescription !== undefined &&
    /\n{4,}/.test(input.longDescription)
  ) {
    incompatible.push(
      issue(
        "lead_form_long_description_line_breaks",
        "longDescription",
        "Допустимо не более двух пустых строк подряд.",
      ),
    );
  }
  if (
    input.contactFields !== undefined &&
    new Set(input.contactFields).size !==
      input.contactFields.length
  ) {
    incompatible.push(
      issue(
        "lead_form_contact_fields_duplicate",
        "contactFields",
        "Контактные поля не должны повторяться.",
      ),
    );
  }

  return incompatible;
}

function providerRequest(
  input: PartialCreateInput,
): Record<string, unknown> {
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.firstScreenType === undefined
      ? {}
      : { first_screen_type: input.firstScreenType }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.description === undefined
      ? {}
      : { description: input.description }),
    ...(input.longDescription === undefined
      ? {}
      : { long_description: input.longDescription }),
    ...(input.companyTitle === undefined
      ? {}
      : { company_title: input.companyTitle }),
    ...(input.logoId === undefined
      ? {}
      : { logo_id: input.logoId }),
    ...(input.award === undefined ? {} : { award: input.award }),
    ...(input.gradient === undefined
      ? {}
      : { gradient: input.gradient }),
    ...(input.contactFields === undefined
      ? {}
      : { contact_fields: input.contactFields }),
    ...(input.resultInfo === undefined
      ? {}
      : { result_info: input.resultInfo }),
    ...(input.agreement === undefined
      ? {}
      : { agreement: input.agreement }),
    ...(input.notifications === undefined
      ? {}
      : { notifications: input.notifications }),
    ...(input.pages === undefined ? {} : { pages: input.pages }),
    ...(input.requiredAnswers === undefined
      ? {}
      : { required_answers: input.requiredAnswers }),
    ...(input.mainColor === undefined
      ? {}
      : { main_color: input.mainColor }),
    ...(input.mainImageId === undefined
      ? {}
      : { main_image_id: input.mainImageId }),
  };
}

function stateIssue(
  form: VkAdsLeadForm,
  expected: 1 | 2,
): RequirementIssue[] {
  if (form.status === expected) {
    return [];
  }
  return [
    issue(
      expected === 1
        ? "lead_form_not_active"
        : "lead_form_not_archived",
      "formId",
      expected === 1
        ? "Лид-форма должна быть активной."
        : "Лид-форма должна находиться в архиве.",
      "provider_state",
    ),
  ];
}

export function createLeadFormActionContracts(
  client: LeadFormPreflightClient,
): Array<ActionContract<unknown, LeadFormContext>> {
  const create: ActionContract<CreateInput, LeadFormContext> = {
    action: "lead_form.create",
    staticSchema: createSchema,
    target: () => ({ resource: "lead_form" }),
    async loadContext(_input, reads) {
      return {
        user: await reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
      };
    },
    async validate(input) {
      return result(
        "lead_form.create",
        "lead_form",
        firstScreenIssues(input),
        [
          issue(
            "lead_form_logo_provider_validation",
            "logoId",
            "При записи VK дополнительно проверит доступность загруженного логотипа.",
          ),
        ],
      );
    },
    buildRequest: providerRequest,
  };

  const update: ActionContract<UpdateInput, LeadFormContext> = {
    action: "lead_form.update",
    staticSchema: updateSchema,
    target: (input) => ({
      resource: "lead_form",
      id: input.id,
    }),
    async loadContext(input, reads) {
      const [user, form] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`lead-form:${input.id}`, () =>
          client.getLeadForm(input.id),
        ),
      ]);
      return { user, form };
    },
    async validate(input, context) {
      const incompatible = firstScreenIssues(
        input,
        context.form,
      );
      if (context.form?.status === 2) {
        incompatible.push(
          issue(
            "lead_form_archived",
            "id",
            "Архивную лид-форму нельзя обновить.",
            "provider_state",
          ),
        );
      }
      return result(
        "lead_form.update",
        "lead_form",
        incompatible,
        ["contactFields", "resultInfo", "agreement", "notifications", "pages"].some(
          (field) => input[field as keyof UpdateInput] !== undefined,
        )
          ? [
              issue(
                "lead_form_section_replaced",
                "",
                "Переданные вложенные секции полностью заменят сохранённые значения.",
              ),
            ]
          : [],
        input.id,
      );
    },
    buildRequest(input) {
      return providerRequest(input);
    },
  };

  const logoUpload: ActionContract<
    LogoUploadInput,
    LeadFormContext
  > = {
    action: "lead_form.logo_upload",
    staticSchema: logoUploadSchema,
    target: () => ({ resource: "lead_form_logo" }),
    async loadContext(input, reads) {
      const [user, file] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`file:${input.filePath}`, () =>
          inspectPath(input.filePath),
        ),
      ]);
      return { user, file };
    },
    async validate(input, context) {
      const extension = extname(input.filePath).toLowerCase();
      const incompatible: RequirementIssue[] = [];
      if (![".jpg", ".jpeg", ".png"].includes(extension)) {
        incompatible.push(
          issue(
            "lead_form_logo_extension",
            "filePath",
            "Допустимы только JPG, JPEG и PNG.",
          ),
        );
      }
      if (!context.file?.exists) {
        incompatible.push(
          issue(
            "lead_form_logo_not_found",
            "filePath",
            "Файл не найден.",
          ),
        );
      } else if (
        !context.file.file ||
        context.file.symbolicLink
      ) {
        incompatible.push(
          issue(
            "lead_form_logo_not_regular",
            "filePath",
            "Нужен обычный файл, не символическая ссылка.",
          ),
        );
      } else if (
        context.file.size === 0 ||
        context.file.size > 5 * 1024 * 1024
      ) {
        incompatible.push(
          issue(
            "lead_form_logo_size",
            "filePath",
            "Размер должен быть от 1 байта до 5 МБ.",
          ),
        );
      }
      return result(
        "lead_form.logo_upload",
        "lead_form_logo",
        incompatible,
      );
    },
    buildRequest(_input, context) {
      return {
        extension: "validated",
        size: context.file?.size,
      };
    },
  };

  const copy: ActionContract<CopyInput, LeadFormContext> = {
    action: "lead_form.copy",
    staticSchema: copySchema,
    target: (input) => ({
      resource: "lead_form",
      id: input.id,
    }),
    async loadContext(input, reads) {
      const [user, form] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`lead-form:${input.id}`, () =>
          client.getLeadForm(input.id),
        ),
      ]);
      return { user, form };
    },
    async validate(input) {
      return result(
        "lead_form.copy",
        "lead_form",
        [],
        [],
        input.id,
      );
    },
    buildRequest(input) {
      return input.name === undefined ? {} : { name: input.name };
    },
  };

  function archiveContract(
    archived: boolean,
  ): ActionContract<ArchiveInput, LeadFormContext> {
    const action = archived
      ? "lead_form.archive"
      : "lead_form.unarchive";
    return {
      action,
      staticSchema: archiveSchema,
      target: () => ({ resource: "lead_form" }),
      async loadContext(input, reads) {
        const [user, forms] = await Promise.all([
          reads.loadOnce("current-user", () =>
            client.getCurrentUser(),
          ),
          Promise.all(
            input.ids.map((id) =>
              reads.loadOnce(`lead-form:${id}`, () =>
                client.getLeadForm(id),
              ),
            ),
          ),
        ]);
        return { user, forms };
      },
      async validate(input, context) {
        const expectedCurrent = archived ? 1 : 2;
        const incompatible = (context.forms ?? []).flatMap(
          (form) =>
            stateIssue(form, expectedCurrent).map((value) => ({
              ...value,
              path: `ids.${input.ids.indexOf(form.id)}`,
            })),
        );
        return result(action, "lead_form", incompatible);
      },
      buildRequest(input) {
        return { ids: input.ids };
      },
    };
  }

  const exportLeads: ActionContract<
    ExportInput,
    LeadFormContext
  > = {
    action: "lead_form.leads_export",
    staticSchema: exportSchema,
    target: (input) => ({
      resource: "lead_form",
      id: input.formId,
    }),
    async loadContext(input, reads) {
      const parentPath = dirname(input.outputPath);
      const [user, form, parent, target] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`lead-form:${input.formId}`, () =>
          client.getLeadForm(input.formId),
        ),
        reads.loadOnce(`path:${parentPath}`, () =>
          inspectPath(parentPath),
        ),
        reads.loadOnce(`path:${input.outputPath}`, () =>
          inspectPath(input.outputPath),
        ),
      ]);
      return {
        user,
        form,
        parent,
        targetExists: target.exists,
      };
    },
    async validate(input, context) {
      const incompatible: RequirementIssue[] = [];
      if (
        extname(input.outputPath).toLowerCase() !==
        `.${input.format}`
      ) {
        incompatible.push(
          issue(
            "lead_export_extension_mismatch",
            "outputPath",
            "Расширение должно совпадать с format.",
          ),
        );
      }
      if (
        !context.parent?.exists ||
        !context.parent.directory ||
        context.parent.symbolicLink
      ) {
        incompatible.push(
          issue(
            "lead_export_parent_invalid",
            "outputPath",
            "Родительский каталог не существует или небезопасен.",
          ),
        );
      }
      if (context.targetExists) {
        incompatible.push(
          issue(
            "lead_export_target_exists",
            "outputPath",
            "Файл уже существует; экспорт не перезаписывает данные.",
          ),
        );
      }
      if (
        input.createdAtFrom !== undefined &&
        Number.isNaN(Date.parse(input.createdAtFrom))
      ) {
        incompatible.push(
          issue(
            "lead_export_date_invalid",
            "createdAtFrom",
            "Дата не распознана.",
          ),
        );
      }
      if (
        input.createdAtTo !== undefined &&
        Number.isNaN(Date.parse(input.createdAtTo))
      ) {
        incompatible.push(
          issue(
            "lead_export_date_invalid",
            "createdAtTo",
            "Дата не распознана.",
          ),
        );
      }
      if (
        input.createdAtFrom !== undefined &&
        input.createdAtTo !== undefined &&
        Date.parse(input.createdAtTo) <
          Date.parse(input.createdAtFrom)
      ) {
        incompatible.push(
          issue(
            "lead_export_date_range",
            "createdAtTo",
            "Конец периода не может быть раньше начала.",
          ),
        );
      }
      return result(
        "lead_form.leads_export",
        "lead_form",
        incompatible,
        [
          issue(
            "lead_export_contains_personal_data",
            "outputPath",
            "Экспорт содержит персональные данные и будет сохранён с правами 0600.",
          ),
        ],
        input.formId,
      );
    },
    buildRequest(input) {
      return {
        form_id: input.formId,
        format: input.format,
        ...(input.adPlanIds === undefined
          ? {}
          : { ad_plan_ids: input.adPlanIds }),
        ...(input.adGroupIds === undefined
          ? {}
          : { ad_group_ids: input.adGroupIds }),
        ...(input.bannerIds === undefined
          ? {}
          : { banner_ids: input.bannerIds }),
        ...(input.createdAtFrom === undefined
          ? {}
          : { created_at_from: input.createdAtFrom }),
        ...(input.createdAtTo === undefined
          ? {}
          : { created_at_to: input.createdAtTo }),
      };
    },
  };

  const testLead: ActionContract<
    TestLeadInput,
    LeadFormContext
  > = {
    action: "lead_form.test_lead_send",
    staticSchema: testLeadSchema,
    target: (input) => ({
      resource: "lead_form",
      id: input.formId,
    }),
    async loadContext(input, reads) {
      const [user, form] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`lead-form:${input.formId}`, () =>
          client.getLeadForm(input.formId),
        ),
      ]);
      return { user, form };
    },
    async validate(input, context) {
      return result(
        "lead_form.test_lead_send",
        "lead_form",
        context.form === undefined
          ? []
          : stateIssue(context.form, 1),
        [
          issue(
            "lead_form_test_lead_rate_limit",
            "formId",
            "VK может ограничить частоту повторной отправки тестового лида.",
          ),
        ],
        input.formId,
      );
    },
    buildRequest(input) {
      return { form_id: input.formId };
    },
  };

  return [
    logoUpload,
    create,
    update,
    copy,
    archiveContract(true),
    archiveContract(false),
    exportLeads,
    testLead,
  ] as Array<ActionContract<unknown, LeadFormContext>>;
}
