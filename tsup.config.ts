import { defineConfig } from "tsup";

// Packages that should not be bundled (native modules, CommonJS deps)
// Packages that must NOT be bundled — they contain native modules,
// use require() internally, or need to be resolved from node_modules
// at runtime. Every entry here MUST also be in package.json dependencies.
const external = [
  "@ulixee/hero",
  "@ulixee/hero-core",
  "@ulixee/net",
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
