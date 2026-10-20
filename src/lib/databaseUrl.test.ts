import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Next.js bakes NEXT_PUBLIC_* values into each build. The database URL is read
// at runtime from SUPABASE_URL instead, so a release can be pointed at another
// database (or rolled back across such a switch) with a restart, not a rebuild.
const bakedName = ["NEXT", "PUBLIC", "SUPABASE", "URL"].join("_");

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [full] : [];
  });

describe("database URL", () => {
  it("is never baked into a build", () => {
    const offenders = [...sourceFiles("src"), "middleware.ts"].filter((file) =>
      readFileSync(file, "utf8").includes(bakedName)
    );
    expect(offenders).toEqual([]);
  });
});
