import { z } from "zod";

import type {
  VkAdsCurrentUser,
  VkAdsSegment,
  VkAdsSegmentRelation,
  VkAdsVkGroup,
} from "../vk-ads/client.js";
import type {
  ActionContract,
  ActionReadiness,
  RequirementIssue,
} from "./types.js";

const idSchema = z.number().int().positive();
const vkGroupReferenceSchema = z
  .union([
    z.number().int().positive(),
    z.string().trim().min(1).max(2048),
  ])
  .superRefine((reference, context) => {
    try {
      normalizeVkGroupReference(reference);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error
            ? error.message
            : "Некорректное VK-сообщество.",
      });
    }
  });
export const vkGroupImportSchema = z.object({
  communities: z.array(vkGroupReferenceSchema).min(1).max(300),
});

export type NormalizedVkGroupReference =
  | { key: string; objectId: number }
  | { key: string; shortname: string };

export function normalizeVkGroupReference(
  reference: z.infer<typeof vkGroupReferenceSchema>,
): NormalizedVkGroupReference {
  if (typeof reference === "number") {
    return {
      key: `id:${reference}`,
      objectId: reference,
    };
  }

  const value = reference.trim();

  if (/^\d+$/u.test(value)) {
    const objectId = Number(value);

    if (Number.isSafeInteger(objectId) && objectId > 0) {
      return { key: `id:${objectId}`, objectId };
    }
  }

  let shortname = value.replace(/^@/u, "");

  if (/^https?:\/\//iu.test(shortname)) {
    const url = new URL(shortname);
    const allowedHosts = new Set([
      "vk.com",
      "www.vk.com",
      "m.vk.com",
      "vk.ru",
      "www.vk.ru",
      "m.vk.ru",
    ]);

    if (!allowedHosts.has(url.hostname.toLowerCase())) {
      throw new Error("Ссылка должна вести на vk.com или vk.ru.");
    }

    const path = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => decodeURIComponent(part));

    if (path.length !== 1 || path[0] === undefined) {
      throw new Error("Укажите ссылку на само VK-сообщество.");
    }

    shortname = path[0];
  }

  if (!/^[a-zA-Z0-9_.-]+$/u.test(shortname)) {
    throw new Error(
      "Укажите числовой ID, короткое имя или ссылку VK-сообщества.",
    );
  }

  return {
    key: `shortname:${shortname.toLowerCase()}`,
    shortname,
  };
}

const relationObjectTypeSchema = z.enum([
  "age",
  "interest",
  "interest_categories",
  "remarketing_app_category",
  "remarketing_campaign_list",
  "remarketing_counter",
  "remarketing_custom_audience",
  "remarketing_game_payer",
  "remarketing_game_player",
  "remarketing_group",
  "remarketing_inapp_event",
  "remarketing_users_list",
  "remarketing_vk_group",
]);
export const segmentRelationInputSchema = z
  .object({
    objectType: relationObjectTypeSchema,
    objectId: z.number().int().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((relation, context) => {
    if (
      relation.objectType !== "remarketing_vk_group" &&
      relation.objectType !== "remarketing_group"
    ) {
      return;
    }

    const sourceId = relation.params?.source_id;
    const relationType = relation.params?.type;

    if (
      typeof sourceId !== "number" ||
      !Number.isInteger(sourceId) ||
      sourceId <= 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["params", "source_id"],
        message:
          "Укажите в params.source_id публичный objectId зарегистрированного сообщества.",
      });
    }

    if (
      relationType !== "positive" &&
      relationType !== "negative"
    ) {
      context.addIssue({
        code: "custom",
        path: ["params", "type"],
        message:
          'Укажите params.type со значением "positive" или "negative".',
      });
    }

    if (
      relation.objectType === "remarketing_group" &&
      relation.params?.source_type !== "group"
    ) {
      context.addIssue({
        code: "custom",
        path: ["params", "source_type"],
        message:
          'Для группы Одноклассников укажите params.source_type="group".',
      });
    }
  });
const segmentCreateSchema = z.object({
  name: z.string().min(1),
  passCondition: z.number().int().positive(),
  relations: z.array(segmentRelationInputSchema).min(1),
});
const segmentUpdateSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).optional(),
    passCondition: z.number().int().positive().optional(),
  })
  .refine(
    ({ name, passCondition }) =>
      name !== undefined || passCondition !== undefined,
    "Укажите name или passCondition.",
  );
const segmentDeleteSchema = z.object({ id: idSchema });
const relationCreateSchema = z.object({
  segmentId: idSchema,
  items: z.array(segmentRelationInputSchema).min(1),
});
const relationUpdateSchema = z.object({
  segmentId: idSchema,
  relationId: idSchema,
  params: z
    .record(z.string(), z.unknown())
    .refine((value) => Object.keys(value).length > 0),
});
const relationDeleteSchema = z.object({
  segmentId: idSchema,
  relationId: idSchema,
});

type SegmentCreateInput = z.infer<
  typeof segmentCreateSchema
>;
type VkGroupImportInput = z.infer<typeof vkGroupImportSchema>;
type SegmentUpdateInput = z.infer<
  typeof segmentUpdateSchema
>;
type SegmentDeleteInput = z.infer<
  typeof segmentDeleteSchema
>;
type RelationCreateInput = z.infer<
  typeof relationCreateSchema
>;
type RelationUpdateInput = z.infer<
  typeof relationUpdateSchema
>;
type RelationDeleteInput = z.infer<
  typeof relationDeleteSchema
>;

export interface SegmentPreflightClient {
  getCurrentUser(): Promise<VkAdsCurrentUser>;
  getSegment(id: number): Promise<VkAdsSegment>;
  listSegmentRelations(
    segmentId: number,
  ): Promise<VkAdsSegmentRelation[]>;
  listVkGroups?(): Promise<VkAdsVkGroup[]>;
}

interface SegmentContext {
  user: VkAdsCurrentUser;
  segment?: VkAdsSegment;
  relations?: VkAdsSegmentRelation[];
  vkGroups?: VkAdsVkGroup[];
}

function issue(
  code: string,
  path: string,
  message: string,
  source: RequirementIssue["source"] = "provider_state",
): RequirementIssue {
  return { code, path, message, source };
}

function result(
  action: string,
  resource: string,
  id: number | undefined,
  incompatibleFields: RequirementIssue[],
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
    warnings: [],
    nextAction:
      incompatibleFields.length === 0
        ? "Выполните соответствующий write-инструмент."
        : "Исправьте условия и повторите подготовку.",
    requiresConfirmation: false,
  };
}

function providerRelations(
  relations: Array<z.infer<typeof segmentRelationInputSchema>>,
) {
  return relations.map((relation) => ({
    object_type: relation.objectType,
    ...(relation.objectId === undefined
      ? {}
      : { object_id: relation.objectId }),
    ...(relation.params === undefined
      ? {}
      : { params: relation.params }),
  }));
}

async function loadSegmentContext(
  client: SegmentPreflightClient,
  segmentId: number,
  reads: {
    loadOnce<T>(
      key: string,
      loader: () => Promise<T>,
    ): Promise<T>;
  },
): Promise<SegmentContext> {
  const [user, segment, relations] = await Promise.all([
    reads.loadOnce("current-user", () =>
      client.getCurrentUser(),
    ),
    reads.loadOnce(`segment:${segmentId}`, () =>
      client.getSegment(segmentId),
    ),
    reads.loadOnce(`segment-relations:${segmentId}`, () =>
      client.listSegmentRelations(segmentId),
    ),
  ]);
  return { user, segment, relations };
}

export function createSegmentActionContracts(
  client: SegmentPreflightClient,
): Array<ActionContract<unknown, SegmentContext>> {
  const vkGroupImport: ActionContract<
    VkGroupImportInput,
    SegmentContext
  > = {
    action: "vk_group.import",
    staticSchema: vkGroupImportSchema,
    target: () => ({ resource: "vk_group" }),
    async loadContext(_input, reads) {
      const user = await reads.loadOnce("current-user", () =>
        client.getCurrentUser(),
      );
      return { user };
    },
    async validate() {
      return result(
        "vk_group.import",
        "vk_group",
        undefined,
        [],
      );
    },
    buildRequest: ({ communities }) => ({
      items: communities.map((community) => {
        const normalized = normalizeVkGroupReference(community);
        return "objectId" in normalized
          ? { object_id: normalized.objectId }
          : { shortname: normalized.shortname };
      }),
    }),
  };

  const segmentCreate: ActionContract<
    SegmentCreateInput,
    SegmentContext
  > = {
    action: "segment.create",
    staticSchema: segmentCreateSchema,
    target: () => ({ resource: "segment" }),
    async loadContext(input, reads) {
      const user = await reads.loadOnce("current-user", () =>
        client.getCurrentUser(),
      );
      const needsVkGroups = input.relations.some(
        (relation) =>
          relation.objectType === "remarketing_vk_group",
      );
      const vkGroups =
        needsVkGroups && client.listVkGroups !== undefined
          ? await reads.loadOnce("vk-groups", () =>
              client.listVkGroups!(),
            )
          : undefined;
      return {
        user,
        ...(vkGroups === undefined ? {} : { vkGroups }),
      };
    },
    async validate(input, context) {
      const incompatible: RequirementIssue[] =
        input.passCondition <= input.relations.length
          ? []
          : [
              issue(
                "segment_pass_condition_too_high",
                "passCondition",
                "passCondition не может превышать число связей.",
                "provider_contract",
              ),
            ];

      input.relations.forEach((relation, index) => {
        if (
          relation.objectType !== "remarketing_vk_group" ||
          context.vkGroups === undefined
        ) {
          return;
        }

        const sourceId = relation.params?.source_id;

        if (
          typeof sourceId === "number" &&
          !context.vkGroups.some(
            (group) => group.objectId === sourceId,
          )
        ) {
          incompatible.push(
            issue(
              "vk_group_not_registered",
              `relations.${index}.params.source_id`,
              "Сначала добавьте VK-сообщество через vk_ads_vk_groups_import.",
            ),
          );
        }
      });

      return result(
        "segment.create",
        "segment",
        undefined,
        incompatible,
      );
    },
    buildRequest: (input) => ({
      name: input.name,
      pass_condition: input.passCondition,
      relations: providerRelations(input.relations),
    }),
  };

  const segmentUpdate: ActionContract<
    SegmentUpdateInput,
    SegmentContext
  > = {
    action: "segment.update",
    staticSchema: segmentUpdateSchema,
    target: ({ id }) => ({ resource: "segment", id }),
    loadContext: (input, reads) =>
      loadSegmentContext(client, input.id, reads),
    async validate(input, context) {
      const relationCount =
        context.relations?.length ??
        context.segment?.relationsCount;
      return result(
        "segment.update",
        "segment",
        input.id,
        input.passCondition !== undefined &&
          relationCount !== undefined &&
          input.passCondition > relationCount
          ? [
              issue(
                "segment_pass_condition_too_high",
                "passCondition",
                "passCondition не может превышать текущее число связей.",
                "provider_contract",
              ),
            ]
          : [],
      );
    },
    buildRequest: ({ id: _id, ...input }) => ({
      ...(input.name === undefined
        ? {}
        : { name: input.name }),
      ...(input.passCondition === undefined
        ? {}
        : { pass_condition: input.passCondition }),
    }),
  };

  const segmentDelete: ActionContract<
    SegmentDeleteInput,
    SegmentContext
  > = {
    action: "segment.delete",
    staticSchema: segmentDeleteSchema,
    target: ({ id }) => ({ resource: "segment", id }),
    async loadContext(input, reads) {
      const [user, segment] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`segment:${input.id}`, () =>
          client.getSegment(input.id),
        ),
      ]);
      return { user, segment };
    },
    async validate(input) {
      return result("segment.delete", "segment", input.id, []);
    },
    buildRequest: ({ id }) => ({ id }),
  };

  const relationCreate: ActionContract<
    RelationCreateInput,
    SegmentContext
  > = {
    action: "segment_relation.create",
    staticSchema: relationCreateSchema,
    target: ({ segmentId }) => ({
      resource: "segment_relation",
      id: segmentId,
    }),
    loadContext: (input, reads) =>
      loadSegmentContext(client, input.segmentId, reads),
    async validate(input, context) {
      const incompatible: RequirementIssue[] = [];

      input.items.forEach((item, index) => {
        const sourceId = item.params?.source_id;
        const duplicate = context.relations?.some(
          (existing) =>
            existing.objectType === item.objectType &&
            (item.objectId !== undefined
              ? existing.objectId === item.objectId
              : sourceId === undefined ||
                existing.params?.source_id === sourceId),
        );

        if (duplicate) {
          incompatible.push(
            issue(
              "segment_relation_duplicate",
              `items.${index}`,
              "Такая связь уже есть в сегменте.",
            ),
          );
        }
      });

      return result(
        "segment_relation.create",
        "segment_relation",
        input.segmentId,
        incompatible,
      );
    },
    buildRequest: ({ segmentId: _segmentId, items }) => ({
      items: providerRelations(items),
    }),
  };

  const relationUpdate: ActionContract<
    RelationUpdateInput,
    SegmentContext
  > = {
    action: "segment_relation.update",
    staticSchema: relationUpdateSchema,
    target: ({ relationId }) => ({
      resource: "segment_relation",
      id: relationId,
    }),
    loadContext: (input, reads) =>
      loadSegmentContext(client, input.segmentId, reads),
    async validate(input, context) {
      return result(
        "segment_relation.update",
        "segment_relation",
        input.relationId,
        context.relations?.some(
          (relation) => relation.id === input.relationId,
        )
          ? []
          : [
              issue(
                "segment_relation_not_found",
                "relationId",
                "Связь не найдена в выбранном сегменте.",
              ),
            ],
      );
    },
    buildRequest: ({ params }) => ({ params }),
  };

  const relationDelete: ActionContract<
    RelationDeleteInput,
    SegmentContext
  > = {
    action: "segment_relation.delete",
    staticSchema: relationDeleteSchema,
    target: ({ relationId }) => ({
      resource: "segment_relation",
      id: relationId,
    }),
    loadContext: (input, reads) =>
      loadSegmentContext(client, input.segmentId, reads),
    async validate(input, context) {
      return result(
        "segment_relation.delete",
        "segment_relation",
        input.relationId,
        context.relations?.some(
          (relation) => relation.id === input.relationId,
        )
          ? []
          : [
              issue(
                "segment_relation_not_found",
                "relationId",
                "Связь не найдена в выбранном сегменте.",
              ),
            ],
      );
    },
    buildRequest: ({ segmentId, relationId }) => ({
      segment_id: segmentId,
      relation_id: relationId,
    }),
  };

  return [
    vkGroupImport,
    segmentCreate,
    segmentUpdate,
    segmentDelete,
    relationCreate,
    relationUpdate,
    relationDelete,
  ] as Array<ActionContract<unknown, SegmentContext>>;
}
