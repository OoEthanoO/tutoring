import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // One-off dev/debug utilities, not part of the app:
    "scratch/**",
    "db-dump.js",
    "dump_discord.js",
    "fix_discord.js",
    "get_schema.js",
    "list_tables.js",
    "query.js",
    "query.mjs",
    "query_courses.js",
    "test-admin-client.js",
    "test-api.js",
    "test_discord_roles.js",
    "delete_all_logs.mjs",
    "delete_logs.mjs",
  ]),
  // Build tooling runs under plain Node as CommonJS.
  {
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
