/**
 * Reading a whole table through Supabase without silently losing rows.
 *
 * Two limits bite once a table grows, and neither says so:
 *
 * - Every response is capped at the project's "max rows" setting (1000 by
 *   default). Asking for more returns the first 1000 and no error.
 * - `.in(column, ids)` puts every id in the request URL, and a long enough list
 *   is rejected for its length.
 *
 * fetchAllRows pages until nothing is left, and chunks splits an id list into
 * URL-sized pieces.
 */

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Every row of a query, fetched a page at a time. `page(from, to)` must return
 * the query with `.range(from, to)` applied and a deterministic `.order()` —
 * without one, rows can repeat or go missing between pages.
 *
 * Advances by the rows actually received and stops on an empty page, so it is
 * correct even when the server's row cap is smaller than `pageSize`: a capped
 * page is just a shorter page, never a skipped one.
 */
export const fetchAllRows = async <T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000
): Promise<T[]> => {
  const rows: T[] = [];
  for (let from = 0; ; ) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) {
      throw new Error(error.message);
    }
    const batch = data ?? [];
    if (batch.length === 0) {
      return rows;
    }
    rows.push(...batch);
    from += batch.length;
  }
};

/** Split a list into pieces of at most `size`, for `.in()` filters. */
export const chunks = <T>(items: T[], size: number): T[][] => {
  const step = Math.max(1, Math.floor(size));
  const pieces: T[][] = [];
  for (let index = 0; index < items.length; index += step) {
    pieces.push(items.slice(index, index + step));
  }
  return pieces;
};

/**
 * 150 UUIDs are ~5.5 KB of URL: comfortably under proxy limits, and few enough
 * that one chunk's rows stay well inside a single page in practice (fetchAllRows
 * still pages if they do not).
 */
export const idChunkSize = 150;
