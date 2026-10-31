import { z } from "zod";

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type Pagination = z.infer<typeof paginationSchema>;

export function pageMeta(limit: number, offset: number, total: number) {
  return { limit, offset, total, hasMore: offset + limit < total };
}
