import { build } from "esbuild";

await build({
  entryPoints: ["scripts/zen-gateway.mjs"], outfile: ".next/standalone/zen-gateway.cjs",
  bundle: true, platform: "node", target: "node22", format: "cjs",
  // Optional native accelerators; ws/discord.js have JS fallbacks.
  external: ["bufferutil", "utf-8-validate", "zlib-sync"],
});
