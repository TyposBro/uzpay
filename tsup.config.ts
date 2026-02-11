import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "providers/payme": "src/providers/payme.ts",
    "providers/click": "src/providers/click.ts",
    "providers/paynet": "src/providers/paynet.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: "es2020",
  minify: false,
  treeshake: true,
});
