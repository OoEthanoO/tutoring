import { build } from "esbuild";

// Self-contained, like zen-gateway.cjs: the backup task runs it with plain node.
await build({
  entryPoints: ["scripts/db-backup.mjs"], outfile: ".next/standalone/db-backup.cjs",
  bundle: true, platform: "node", target: "node22", format: "cjs",
});
