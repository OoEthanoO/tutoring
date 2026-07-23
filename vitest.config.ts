import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Background-task sessions run in git worktrees under .claude/ that
    // contain full repo copies — never pick their test files up.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
