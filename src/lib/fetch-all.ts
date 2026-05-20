/**
 * Supabase/PostgREST caps a single response at 1000 rows.
 * fetchAll loops with .range() until all rows are retrieved.
 *
 * Usage:
 *   const rows = await fetchAll<MyRow>((from, to) =>
 *     supabase.from("orders").select("*").gte("order_date", x).range(from, to)
 *   );
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (let i = 0; i < 200; i++) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return out;
}
