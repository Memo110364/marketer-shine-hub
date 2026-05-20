import type { PostgrestFilterBuilder } from "@supabase/postgrest-js";

/**
 * Supabase/PostgREST caps a single response at 1000 rows.
 * fetchAll loops with .range() until all rows are retrieved.
 */
export async function fetchAll<T>(
  build: () => PostgrestFilterBuilder<any, any, T[], any, any>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  // hard cap to avoid runaway loops
  for (let i = 0; i < 200; i++) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return out;
}
