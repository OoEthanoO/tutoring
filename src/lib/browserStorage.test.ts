import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readStorage, writeStorage } from "./browserStorage";

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [full] : [];
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser storage", () => {
  it("reads back what it wrote", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
      },
    });

    writeStorage("dismissed", "true");
    expect(readStorage("dismissed")).toBe("true");
    expect(readStorage("missing")).toBeNull();
  });

  it("acts as empty when the browser blocks the site's data", () => {
    // What Edge/Chrome do on any access once cookies and site data are blocked.
    vi.stubGlobal("window", {
      get localStorage() {
        throw new DOMException("Access is denied for this document.", "SecurityError");
      },
    });

    expect(() => writeStorage("dismissed", "true")).not.toThrow();
    expect(readStorage("dismissed")).toBeNull();
  });

  it("is the only way the app touches storage", () => {
    const offenders = sourceFiles("src").filter(
      (file) =>
        !/browserStorage\.(test\.)?ts$/.test(file) &&
        /\b(localStorage|sessionStorage)\b/.test(readFileSync(file, "utf8"))
    );
    expect(offenders).toEqual([]);
  });
});
