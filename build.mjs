// Сборка клиентских модулей в единые бандлы, совместимые с Chrome 73.
// esbuild транслирует современный синтаксис (?. , ?? и т.п.) в требуемый target
// и встраивает three.js локально — import map больше не нужен (Chrome <89).
import { build } from "esbuild";

const TARGET = ["chrome73"];

async function main() {
  await build({
    entryPoints: { main: "main.js", debug: "debug.js" },
    outdir: "dist",
    bundle: true,
    format: "esm",
    target: TARGET,
    legalComments: "none",
    logLevel: "info",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});