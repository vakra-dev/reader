import { defineConfig } from "tsup";

// Packages that should not be bundled (native modules, CommonJS deps)
const external = [
  "@ulixee/hero",
  "@ulixee/hero-core",
  "@ulixee/net",
  "@ulixee/commons",
  "re2",
  "pino",
  "pino-pretty",
];

export default defineConfig([
  // Main library
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    outDir: "dist",
    splitting: false,
    sourcemap: true,
    target: "node18",
    external,
  },
  // CLI (shebang preserved from source)
  {
    entry: ["src/cli/index.ts"],
    format: ["esm"],
    dts: false,
    outDir: "dist/cli",
    splitting: false,
    sourcemap: true,
    target: "node18",
    external,
  },
]);
