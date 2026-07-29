import { z } from "zod";

export interface VkAdsPaginationInput {
  limit?: number;
  offset?: number;
}

export function appendPagination(
  searchParams: URLSearchParams,
  pagination: VkAdsPaginationInput,
): void {
  if (pagination.limit !== undefined) {
    searchParams.set("limit", String(pagination.limit));
  }

  if (pagination.offset !== undefined) {
    searchParams.set("offset", String(pagination.offset));
  }
}

export function createPageSchema<ItemSchema extends z.ZodType>(
  itemSchema: ItemSchema,
) {
  return z.object({
    count: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    items: z.array(itemSchema),
  });
}
