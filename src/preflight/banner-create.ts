import { z } from "zod";

import type {
  VkAdsAdGroup,
  VkAdsCurrentUser,
  VkAdsReferenceCollectionResult,
} from "../vk-ads/client.js";
import type {
  ActionContract,
  ActionReadiness,
  RequirementIssue,
} from "./types.js";

const bannerSectionSchema = z.record(z.string(), z.unknown());

export const bannerCreateActionInputSchema = z
  .object({
    adGroupId: z.number().int().positive(),
    patternId: z.number().int().positive().optional(),
    name: z.string().min(1).optional(),
    status: z
      .enum(["active", "blocked", "deleted"])
      .optional(),
    content: bannerSectionSchema.optional(),
    textblocks: bannerSectionSchema.optional(),
    urls: bannerSectionSchema.optional(),
  })
  .refine(
    ({ adGroupId: _adGroupId, patternId: _patternId, ...banner }) =>
      Object.values(banner).some((value) => value !== undefined),
    {
      message:
        "Укажите хотя бы одно записываемое поле объявления.",
    },
  );

export type BannerCreateActionInput = z.infer<
  typeof bannerCreateActionInputSchema
>;

interface BannerFormatField {
  field: "content" | "textblock" | "url";
  role: string;
  required: boolean;
}

interface BannerPattern {
  id: number;
  status?: string;
  format: BannerFormatField[];
}

interface BannerCreateContext {
  user: VkAdsCurrentUser;
  adGroup: VkAdsAdGroup;
  packageItem: Record<string, unknown> | undefined;
  patterns: BannerPattern[];
}

export interface BannerCreatePreflightClient {
  getCurrentUser(): Promise<VkAdsCurrentUser>;
  getAdGroup(id: number): Promise<VkAdsAdGroup>;
  listReferenceData(
    resource: "packages" | "banner_patterns",
    input: { limit: number; offset: number; ids?: number[] },
  ): Promise<VkAdsReferenceCollectionResult>;
}

function collectPatternIds(value: unknown): number[] {
  const found = new Set<number>();

  const visit = (nested: unknown): void => {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        visit(item);
      }
      return;
    }

    if (nested === null || typeof nested !== "object") {
      return;
    }

    const record = nested as Record<string, unknown>;

    if (
      typeof record.id === "number" &&
      Number.isInteger(record.id) &&
      record.id > 0 &&
      "required" in record
    ) {
      found.add(record.id);
    }

    for (const [key, child] of Object.entries(record)) {
      if (
        key === "patterns" ||
        key === "pads" ||
        key === "targetings" ||
        key === "options"
      ) {
        visit(child);
      }
    }
  };

  visit(value);
  return [...found].sort((left, right) => left - right);
}

function parsePatterns(
  items: Array<Record<string, unknown>>,
): BannerPattern[] {
  const result: BannerPattern[] = [];

  for (const item of items) {
    if (
      typeof item.id !== "number" ||
      !Number.isInteger(item.id) ||
      item.id <= 0 ||
      !Array.isArray(item.format)
    ) {
      continue;
    }

    const format: BannerFormatField[] = [];

    for (const field of item.format) {
      if (field === null || typeof field !== "object") {
        continue;
      }

      const record = field as Record<string, unknown>;

      if (
        (record.field === "content" ||
          record.field === "textblock" ||
          record.field === "url") &&
        typeof record.role === "string"
      ) {
        format.push({
          field: record.field,
          role: record.role,
          required: record.required === true,
        });
      }
    }

    result.push({
      id: item.id,
      ...(typeof item.status === "string"
        ? { status: item.status }
        : {}),
      format,
    });
  }

  return result;
}

function providedFields(
  input: BannerCreateActionInput,
): BannerFormatField[] {
  const fields: BannerFormatField[] = [];

  for (const [section, field] of [
    ["content", "content"],
    ["textblocks", "textblock"],
    ["urls", "url"],
  ] as const) {
    const values = input[section];

    if (values === undefined) {
      continue;
    }

    for (const role of Object.keys(values)) {
      fields.push({ field, role, required: false });
    }
  }

  return fields;
}

function fieldPath(field: BannerFormatField): string {
  const section =
    field.field === "textblock"
      ? "textblocks"
      : field.field === "url"
        ? "urls"
        : "content";
  return `${section}.${field.role}`;
}

function patternAccepts(
  pattern: BannerPattern,
  supplied: BannerFormatField[],
): boolean {
  return supplied.every((provided) =>
    pattern.format.some(
      (field) =>
        field.field === provided.field &&
        field.role === provided.role,
    ),
  );
}

function validateWritableSectionValues(
  input: BannerCreateActionInput,
): RequirementIssue[] {
  const issues: RequirementIssue[] = [];
  const allowedKeys = {
    content: new Set(["id"]),
    urls: new Set(["id"]),
    textblocks: new Set(["text"]),
  } as const;

  for (const section of [
    "content",
    "textblocks",
    "urls",
  ] as const) {
    const values = input[section];

    if (values === undefined) {
      continue;
    }

    for (const [role, value] of Object.entries(values)) {
      if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value)
      ) {
        continue;
      }

      for (const key of Object.keys(value)) {
        if (!allowedKeys[section].has(key)) {
          issues.push(
            issue(
              "banner_section_read_only_field",
              `${section}.${role}.${key}`,
              "Поле возвращается чтением, но не допускается в запросе записи.",
              "provider_contract",
            ),
          );
        }
      }
    }
  }

  return issues;
}

function issue(
  code: string,
  path: string,
  message: string,
  source: RequirementIssue["source"],
): RequirementIssue {
  return { code, path, message, source };
}

export function createBannerCreateActionContract(
  client: BannerCreatePreflightClient,
): ActionContract<
  BannerCreateActionInput,
  BannerCreateContext
> {
  return {
    action: "banner.create",
    staticSchema: bannerCreateActionInputSchema,
    target: (input) => ({
      resource: "banner",
      id: input.adGroupId,
    }),
    async loadContext(input, reads) {
      const [user, adGroup] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`ad-group:${input.adGroupId}`, () =>
          client.getAdGroup(input.adGroupId),
        ),
      ]);
      const [packages, patterns] = await Promise.all([
        reads.loadOnce(
          `reference:packages:${adGroup.packageId}`,
          () =>
            client.listReferenceData("packages", {
              limit: 1,
              offset: 0,
              ids: [adGroup.packageId],
            }),
        ),
        reads.loadOnce("reference:banner-patterns", () =>
            client.listReferenceData("banner_patterns", {
              limit: 1_000,
              offset: 0,
            }),
        ),
      ]);

      return {
        user,
        adGroup,
        packageItem: packages.items.find(
          (item) => item.id === adGroup.packageId,
        ),
        patterns: parsePatterns(patterns.items),
      };
    },
    async validate(input, context) {
      const missingFields: RequirementIssue[] = [];
      const incompatibleFields: RequirementIssue[] =
        validateWritableSectionValues(input);
      const warnings: RequirementIssue[] = [];

      if (context.adGroup.status === "deleted") {
        incompatibleFields.push(
          issue(
            "ad_group_status_disallows_banner_create",
            "adGroupId",
            "Удалённая группа не допускает создание объявления.",
            "provider_state",
          ),
        );
      }

      if (context.packageItem === undefined) {
        incompatibleFields.push(
          issue(
            "ad_group_package_unavailable",
            "adGroupId",
            "Пакет группы отсутствует в актуальном справочнике кабинета.",
            "provider_reference",
          ),
        );
      }

      const allowedPatternIds =
        context.packageItem === undefined
          ? []
          : collectPatternIds(context.packageItem);
      const allowedPatterns = context.patterns.filter(
        (pattern) =>
          allowedPatternIds.includes(pattern.id) &&
          pattern.status !== "deleted",
      );
      const supplied = providedFields(input);
      const compatiblePatterns = allowedPatterns.filter((pattern) =>
        patternAccepts(pattern, supplied),
      );
      const selectedPattern =
        input.patternId === undefined
          ? compatiblePatterns.length === 1
            ? compatiblePatterns[0]
            : undefined
          : allowedPatterns.find(
              (pattern) => pattern.id === input.patternId,
            );

      if (
        input.patternId !== undefined &&
        selectedPattern === undefined
      ) {
        incompatibleFields.push(
          issue(
            "banner_pattern_not_allowed_for_package",
            "patternId",
            "Выбранный паттерн недоступен для пакета группы.",
            "provider_reference",
          ),
        );
      }

      if (
        input.patternId === undefined &&
        compatiblePatterns.length > 1
      ) {
        missingFields.push(
          issue(
            "banner_pattern_ambiguous",
            "patternId",
            "Переданные секции подходят нескольким паттернам; для строгой проверки укажите patternId.",
            "provider_reference",
          ),
        );
      }

      if (
        input.patternId === undefined &&
        compatiblePatterns.length === 0 &&
        context.packageItem !== undefined
      ) {
        incompatibleFields.push(
          issue(
            "banner_sections_incompatible_with_package",
            "",
            "Переданные секции не соответствуют ни одному доступному паттерну пакета.",
            "provider_reference",
          ),
        );
      }

      if (selectedPattern !== undefined) {
        for (const required of selectedPattern.format.filter(
          (field) => field.required,
        )) {
          if (
            !supplied.some(
              (provided) =>
                provided.field === required.field &&
                provided.role === required.role,
            )
          ) {
            missingFields.push(
              issue(
                "banner_required_role_missing",
                fieldPath(required),
                "Обязательная роль выбранного паттерна не заполнена.",
                "provider_reference",
              ),
            );
          }
        }

        for (const provided of supplied) {
          if (
            !selectedPattern.format.some(
              (field) =>
                field.field === provided.field &&
                field.role === provided.role,
            )
          ) {
            incompatibleFields.push(
              issue(
                "banner_role_not_allowed",
                fieldPath(provided),
                "Роль отсутствует в выбранном паттерне.",
                "provider_reference",
              ),
            );
          }
        }
      }

      if (input.content !== undefined) {
        warnings.push(
          issue(
            "creative_variation_requires_provider_validation",
            "content",
            "API не предоставляет отдельное чтение метаданных загруженного креатива; вариацию дополнительно проверит VK.",
            "provider_contract",
          ),
        );
      }

      const ready =
        missingFields.length === 0 &&
        incompatibleFields.length === 0;
      const readiness: ActionReadiness = {
        ready,
        action: "banner.create",
        stage: "compatibility",
        target: {
          resource: "banner",
          id: input.adGroupId,
        },
        missingFields,
        incompatibleFields,
        warnings,
        allowedValues:
          allowedPatternIds.length === 0
            ? undefined
            : [
                {
                  path: "patternId",
                  values: allowedPatternIds,
                },
              ],
        nextAction: ready
          ? "Вызовите vk_ads_banner_create с теми же полями."
          : "Исправьте перечисленные условия и повторите подготовку.",
        requiresConfirmation:
          input.patternId === undefined &&
          compatiblePatterns.length > 1,
      };

      return readiness;
    },
    buildRequest(input) {
      return {
        ad_group_id: input.adGroupId,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.status === undefined
          ? {}
          : { status: input.status }),
        ...(input.content === undefined
          ? {}
          : { content: input.content }),
        ...(input.textblocks === undefined
          ? {}
          : { textblocks: input.textblocks }),
        ...(input.urls === undefined ? {} : { urls: input.urls }),
      };
    },
  };
}
