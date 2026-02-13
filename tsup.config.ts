import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/register.ts", "src/nest/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
