import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";

await mkdir("dist/public", { recursive: true });

await Promise.all([
  build({
    entryPoints: ["src/server.ts"],
    outfile: "dist/server.js",
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    target: "node22",
  }),
  build({
    entryPoints: ["src/client.ts"],
    outfile: "dist/public/client.js",
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
  }),
  copyFile("public/index.html", "dist/public/index.html"),
  copyFile("public/style.css", "dist/public/style.css"),
  copyFile("public/favicon.svg", "dist/public/favicon.svg"),
]);
