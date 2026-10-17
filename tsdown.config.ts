import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  fixedExtension: false,
  clean: true,
  sourcemap: true,
  dts: { sourcemap: true },
  deps: {
    neverBundle: ["better-auth", "@arcadedb/driver"],
    onlyBundle: [],
    onlyImport: ["better-auth", "@arcadedb/driver"],
  },
});
