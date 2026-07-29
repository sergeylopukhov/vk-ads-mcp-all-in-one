import { lstat } from "node:fs/promises";
import { dirname, extname, isAbsolute } from "node:path";
import { z } from "zod";

import type {
  VkAdsCurrentUser,
  VkAdsSurvey,
} from "../vk-ads/client.js";
import type {
  ActionContract,
  ActionReadiness,
  RequirementIssue,
} from "./types.js";

const idSchema = z.number().int().positive();
const surveyFieldsShape = {
  name: z.string().min(1).max(255),
  firstScreenType: z.literal("text"),
  title: z.string().min(1).max(50),
  description: z.string().max(35).optional(),
  companyTitle: z.string().min(1).max(30),
  resultInfo: z.record(z.string(), z.unknown()),
  pages: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(24),
  logoId: z.string().min(1),
  gradient: z.number().int().min(0).max(6),
} as const;

export const surveyCreateInputShape = surveyFieldsShape;
export const surveyChangesShape = Object.fromEntries(
  Object.entries(surveyFieldsShape).map(([name, schema]) => [
    name,
    schema.optional(),
  ]),
) as {
  [Key in keyof typeof surveyFieldsShape]: z.ZodOptional<
    (typeof surveyFieldsShape)[Key]
  >;
};

const createSchema = z.object(surveyFieldsShape);
const updateSchema = z.object({
  id: idSchema,
  changes: z
    .object(surveyChangesShape)
    .refine(
      (changes) =>
        Object.values(changes).some(
          (value) => value !== undefined,
        ),
      "Укажите хотя бы одно изменение.",
    ),
});
const copySchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(255).optional(),
});
const stateSchema = z.object({
  ids: z
    .array(idSchema)
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length),
});
const exportSchema = z.object({
  surveyId: idSchema,
  outputPath: z
    .string()
    .min(1)
    .refine(isAbsolute, "Путь должен быть абсолютным."),
});

type CreateInput = z.infer<typeof createSchema>;
type UpdateInput = z.infer<typeof updateSchema>;
type PartialCreateInput = {
  [Key in keyof CreateInput]?: CreateInput[Key] | undefined;
};
type CopyInput = z.infer<typeof copySchema>;
type StateInput = z.infer<typeof stateSchema>;
type ExportInput = z.infer<typeof exportSchema>;

export interface SurveyPreflightClient {
  getCurrentUser(): Promise<VkAdsCurrentUser>;
  getSurvey(id: number): Promise<VkAdsSurvey>;
}

interface PathState {
  exists: boolean;
  directory: boolean;
  symbolicLink: boolean;
}

interface SurveyContext {
  user: VkAdsCurrentUser;
  survey?: VkAdsSurvey;
  surveys?: VkAdsSurvey[];
  parent?: PathState;
  targetExists?: boolean;
}

async function inspectPath(path: string): Promise<PathState> {
  try {
    const info = await lstat(path);
    return {
      exists: true,
      directory: info.isDirectory(),
      symbolicLink: info.isSymbolicLink(),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {
        exists: false,
        directory: false,
        symbolicLink: false,
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
  incompatibleFields: RequirementIssue[],
  warnings: RequirementIssue[] = [],
  id?: number,
): ActionReadiness {
  return {
    ready: incompatibleFields.length === 0,
    action,
    stage: "compatibility",
    target: {
      resource: "survey",
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validateResultInfo(
  value: Record<string, unknown>,
): RequirementIssue[] {
  const positive = asRecord(value.positive);
  const title = positive?.title;

  if (
    positive === undefined ||
    typeof title !== "string" ||
    title.length === 0 ||
    title.length > 25
  ) {
    return [
      issue(
        "survey_positive_result_required",
        "resultInfo.positive.title",
        "Нужен положительный финальный экран с title до 25 символов.",
      ),
    ];
  }
  return [];
}

function validatePages(
  pages: Array<Record<string, unknown>>,
  requireTemporaryIds = false,
): RequirementIssue[] {
  const incompatible: RequirementIssue[] = [];
  const blockIds = new Set<string>();
  const answerIds = new Set<string>();

  pages.forEach((page, pageIndex) => {
    const blocks = Array.isArray(page.blocks)
      ? page.blocks
      : undefined;
    if (blocks === undefined || blocks.length !== 1) {
      incompatible.push(
        issue(
          "survey_page_single_block_required",
          `pages.${pageIndex}.blocks`,
          "На странице опроса должен быть ровно один блок.",
        ),
      );
      return;
    }

    const block = asRecord(blocks[0]);
    const blockId = block?.id;
    if (
      typeof blockId !== "string" ||
      blockId.length === 0 ||
      (requireTemporaryIds && !blockId.startsWith("new_")) ||
      blockIds.has(blockId)
    ) {
      incompatible.push(
        issue(
          "survey_block_id_invalid",
          `pages.${pageIndex}.blocks.0.id`,
          requireTemporaryIds
            ? "Для нового блока нужен уникальный временный id с префиксом new_."
            : "Для блока нужен уникальный id.",
        ),
      );
    } else {
      blockIds.add(blockId);
    }
    const blockData = asRecord(block?.block_data);
    const question = asRecord(blockData?.data);
    const type = question?.type;
    const answers = Array.isArray(question?.answers)
      ? question.answers
      : [];

    if (
      blockData?.type !== "question" ||
      question === undefined ||
      question.is_required !== true ||
      typeof question.text !== "string" ||
      question.text.length === 0 ||
      question.text.length > 68 ||
      ![
        "one_answer",
        "multiple_answers",
        "text_answer",
        "scale_answer",
      ].includes(String(type))
    ) {
      incompatible.push(
        issue(
          "survey_question_invalid",
          `pages.${pageIndex}.blocks.0.block_data.data`,
          "Проверьте обязательность, текст и тип вопроса.",
        ),
      );
      return;
    }

    if (
      (type === "text_answer" || type === "scale_answer") &&
      answers.length !== 0
    ) {
      incompatible.push(
        issue(
          "survey_question_answers_forbidden",
          `pages.${pageIndex}.blocks.0.block_data.data.answers`,
          "Для текстового вопроса и шкалы answers должен быть пустым.",
        ),
      );
    }
    if (
      type !== "text_answer" &&
      type !== "scale_answer" &&
      (answers.length < 2 || answers.length > 7)
    ) {
      incompatible.push(
        issue(
          "survey_question_answers_count",
          `pages.${pageIndex}.blocks.0.block_data.data.answers`,
          "Для вопроса с выбором нужны от 2 до 7 вариантов.",
        ),
      );
    }

    const specialTypes: number[] = [];
    answers.forEach((rawAnswer, answerIndex) => {
      const answer = asRecord(rawAnswer);
      const answerId = answer?.id;
      const answerType = answer?.type;
      const validType =
        typeof answerType === "number" &&
        [0, 1, 2, 3, 4].includes(answerType);
      const text = answer?.text;
      if (
        typeof answerId !== "string" ||
        answerId.length === 0 ||
        (requireTemporaryIds && !answerId.startsWith("new_")) ||
        answerIds.has(answerId)
      ) {
        incompatible.push(
          issue(
            "survey_answer_id_invalid",
            `pages.${pageIndex}.blocks.0.block_data.data.answers.${answerIndex}.id`,
            requireTemporaryIds
              ? "Для нового ответа нужен уникальный временный id с префиксом new_."
              : "Для ответа нужен уникальный id.",
          ),
        );
      } else {
        answerIds.add(answerId);
      }
      if (
        !validType ||
        (answerType === 0 &&
          (typeof text !== "string" ||
            text.length === 0 ||
            text.length > 40)) ||
        (answerType !== 0 && text !== undefined)
      ) {
        incompatible.push(
          issue(
            "survey_answer_invalid",
            `pages.${pageIndex}.blocks.0.block_data.data.answers.${answerIndex}`,
            "Проверьте тип и текст варианта ответа.",
          ),
        );
      }
      if (
        typeof answerType === "number" &&
        answerType !== 0
      ) {
        specialTypes.push(answerType);
      }
    });
    if (new Set(specialTypes).size !== specialTypes.length) {
      incompatible.push(
        issue(
          "survey_special_answer_duplicate",
          `pages.${pageIndex}.blocks.0.block_data.data.answers`,
          "Особые типы вариантов ответа не должны повторяться.",
        ),
      );
    }

    const scale = asRecord(question.scale);
    if (
      type === "scale_answer" &&
      (scale === undefined ||
        !Number.isInteger(scale.min_value) ||
        !Number.isInteger(scale.max_value) ||
        Number(scale.min_value) < 0 ||
        Number(scale.min_value) > 1 ||
        Number(scale.max_value) < 1 ||
        Number(scale.max_value) > 10 ||
        Number(scale.min_value) >= Number(scale.max_value))
    ) {
      incompatible.push(
        issue(
          "survey_scale_invalid",
          `pages.${pageIndex}.blocks.0.block_data.data.scale`,
          "Для шкалы задайте min_value 0–1 и max_value 1–10.",
        ),
      );
    }
    if (type !== "scale_answer" && scale !== undefined) {
      incompatible.push(
        issue(
          "survey_scale_forbidden",
          `pages.${pageIndex}.blocks.0.block_data.data.scale`,
          "scale допустим только для scale_answer.",
        ),
      );
    }
  });

  return incompatible;
}

function contentIssues(
  input: Pick<CreateInput, "resultInfo" | "pages">,
  requireTemporaryIds = false,
): RequirementIssue[] {
  return [
    ...validateResultInfo(input.resultInfo),
    ...validatePages(input.pages, requireTemporaryIds),
  ];
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
    ...(input.companyTitle === undefined
      ? {}
      : { company_title: input.companyTitle }),
    ...(input.resultInfo === undefined
      ? {}
      : { result_info: input.resultInfo }),
    ...(input.pages === undefined ? {} : { pages: input.pages }),
    ...(input.logoId === undefined
      ? {}
      : { logo_id: input.logoId }),
    ...(input.gradient === undefined
      ? {}
      : { gradient: input.gradient }),
  };
}

export function createSurveyActionContracts(
  client: SurveyPreflightClient,
): Array<ActionContract<unknown, SurveyContext>> {
  const create: ActionContract<CreateInput, SurveyContext> = {
    action: "survey.create",
    staticSchema: createSchema,
    target: () => ({ resource: "survey" }),
    async loadContext(_input, reads) {
      return {
        user: await reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
      };
    },
    async validate(input) {
      return result(
        "survey.create",
        contentIssues(input, true),
        [
          issue(
            "survey_logo_provider_validation",
            "logoId",
            "При записи VK дополнительно проверит доступность логотипа.",
          ),
        ],
      );
    },
    buildRequest: providerRequest,
  };

  const update: ActionContract<UpdateInput, SurveyContext> = {
    action: "survey.update",
    staticSchema: updateSchema,
    target: (input) => ({ resource: "survey", id: input.id }),
    async loadContext(input, reads) {
      const [user, survey] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`survey:${input.id}`, () =>
          client.getSurvey(input.id),
        ),
      ]);
      return { user, survey };
    },
    async validate(input, context) {
      const incompatible =
        input.changes.resultInfo !== undefined &&
        input.changes.pages !== undefined
          ? contentIssues({
              resultInfo: input.changes.resultInfo,
              pages: input.changes.pages,
            })
          : [
              ...(input.changes.resultInfo === undefined
                ? []
                : validateResultInfo(input.changes.resultInfo)),
              ...(input.changes.pages === undefined
                ? []
                : validatePages(input.changes.pages)),
            ];
      if (context.survey?.status === 2) {
        incompatible.push(
          issue(
            "survey_archived",
            "id",
            "Архивный опрос нельзя обновить.",
            "provider_state",
          ),
        );
      }
      return result(
        "survey.update",
        incompatible,
        input.changes.resultInfo !== undefined ||
          input.changes.pages !== undefined
          ? [
              issue(
                "survey_section_replaced",
                "changes",
                "Переданные resultInfo и pages полностью заменят сохранённые секции.",
              ),
            ]
          : [],
        input.id,
      );
    },
    buildRequest(input) {
      return providerRequest(input.changes);
    },
  };

  const copy: ActionContract<CopyInput, SurveyContext> = {
    action: "survey.copy",
    staticSchema: copySchema,
    target: (input) => ({ resource: "survey", id: input.id }),
    async loadContext(input, reads) {
      const [user, survey] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`survey:${input.id}`, () =>
          client.getSurvey(input.id),
        ),
      ]);
      return { user, survey };
    },
    async validate(input) {
      return result("survey.copy", [], [], input.id);
    },
    buildRequest(input) {
      return input.name === undefined ? {} : { name: input.name };
    },
  };

  function stateContract(
    archived: boolean,
  ): ActionContract<StateInput, SurveyContext> {
    const action = archived
      ? "survey.archive"
      : "survey.unarchive";
    return {
      action,
      staticSchema: stateSchema,
      target: () => ({ resource: "survey" }),
      async loadContext(input, reads) {
        const [user, surveys] = await Promise.all([
          reads.loadOnce("current-user", () =>
            client.getCurrentUser(),
          ),
          Promise.all(
            input.ids.map((id) =>
              reads.loadOnce(`survey:${id}`, () =>
                client.getSurvey(id),
              ),
            ),
          ),
        ]);
        return { user, surveys };
      },
      async validate(input, context) {
        const expected = archived ? 1 : 2;
        const incompatible = (context.surveys ?? []).flatMap(
          (survey) =>
            survey.status === expected
              ? []
              : [
                  issue(
                    archived
                      ? "survey_not_active"
                      : "survey_not_archived",
                    `ids.${input.ids.indexOf(survey.id)}`,
                    archived
                      ? "Архивировать можно только активный опрос."
                      : "Восстановить можно только архивный опрос.",
                    "provider_state",
                  ),
                ],
        );
        return result(action, incompatible);
      },
      buildRequest(input) {
        return { ids: input.ids };
      },
    };
  }

  const exportRespondents: ActionContract<
    ExportInput,
    SurveyContext
  > = {
    action: "survey.respondents_export",
    staticSchema: exportSchema,
    target: (input) => ({
      resource: "survey",
      id: input.surveyId,
    }),
    async loadContext(input, reads) {
      const parentPath = dirname(input.outputPath);
      const [user, survey, parent, target] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`survey:${input.surveyId}`, () =>
          client.getSurvey(input.surveyId),
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
        survey,
        parent,
        targetExists: target.exists,
      };
    },
    async validate(input, context) {
      const incompatible: RequirementIssue[] = [];
      if (extname(input.outputPath).toLowerCase() !== ".xlsx") {
        incompatible.push(
          issue(
            "survey_export_extension",
            "outputPath",
            "Экспорт респондентов должен иметь расширение .xlsx.",
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
            "survey_export_parent_invalid",
            "outputPath",
            "Родительский каталог не существует или небезопасен.",
          ),
        );
      }
      if (context.targetExists) {
        incompatible.push(
          issue(
            "survey_export_target_exists",
            "outputPath",
            "Файл уже существует; экспорт его не перезаписывает.",
          ),
        );
      }
      return result(
        "survey.respondents_export",
        incompatible,
        [
          issue(
            "survey_export_contains_personal_data",
            "outputPath",
            "Экспорт будет сохранён в новом файле с правами 0600.",
          ),
        ],
        input.surveyId,
      );
    },
    buildRequest(input) {
      return { survey_id: input.surveyId, format: "xlsx" };
    },
  };

  return [
    create,
    update,
    copy,
    stateContract(true),
    stateContract(false),
    exportRespondents,
  ] as Array<ActionContract<unknown, SurveyContext>>;
}
