import { describe, expect, it } from "vitest";
import { chunks, fetchAllRows } from "./supabasePaging";

/** A table of `total` rows behind a server that returns at most `cap` per request. */
const table = (total: number, cap: number) => {
  const rows = Array.from({ length: total }, (_, index) => index);
  const requests: [number, number][] = [];
  const page = async (from: number, to: number) => {
    requests.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
  };
  return { rows, requests, page };
};

describe("fetchAllRows", () => {
  it("reads past the row cap that truncates a single request", async () => {
    const { rows, page } = table(2500, 1000);
    expect(await fetchAllRows(page)).toEqual(rows);
  });

  it("does not skip rows when the server caps below the page size", async () => {
    // The trap: ask for 1000, get 400, then ask for 1000-1999 and lose 400-999.
    const { rows, page } = table(1300, 400);
    expect(await fetchAllRows(page, 1000)).toEqual(rows);
  });

  it("stops on an empty page", async () => {
    const { requests, page } = table(10, 1000);
    await fetchAllRows(page);
    expect(requests).toEqual([[0, 999], [10, 1009]]);
  });

  it("handles an empty table", async () => {
    const { page } = table(0, 1000);
    expect(await fetchAllRows(page)).toEqual([]);
  });

  it("fails loudly rather than returning a partial list", async () => {
    let calls = 0;
    const page = async () => {
      calls += 1;
      return calls === 1
        ? { data: [1, 2, 3], error: null }
        : { data: null, error: { message: "Gateway Timeout" } };
    };
    await expect(fetchAllRows(page, 3)).rejects.toThrow("Gateway Timeout");
  });
});

describe("chunks", () => {
  it("splits into pieces of at most the given size", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("has no pieces for an empty list", () => {
    expect(chunks([], 3)).toEqual([]);
  });
});
