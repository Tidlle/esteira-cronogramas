// Captura cada página do HTML como PNG, no tamanho real (1440x810).
// Ferramenta de conferência visual do template — a geração do PDF é a Fase 4.
//
//   node scripts/pre-visualizar.mjs "saida/html/curso.html" [pasta]

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

const [entrada, pastaSaida = "saida/preview"] = process.argv.slice(2);

if (!entrada) {
  console.error('Uso: node scripts/pre-visualizar.mjs "arquivo.html" [pasta]');
  process.exit(1);
}

fs.mkdirSync(pastaSaida, { recursive: true });

const navegador = await chromium.launch();
const pagina = await navegador.newPage({
  viewport: { width: 1440, height: 810 },
  deviceScaleFactor: 2,
});

await pagina.goto(pathToFileURL(path.resolve(entrada)).href);
// O script de paginação sinaliza quando terminou de distribuir as linhas.
await pagina.waitForSelector("html[data-pronto]", { timeout: 15000 });
await pagina.waitForLoadState("networkidle").catch(() => {});

const base = path.basename(entrada, ".html");
const folhas = await pagina.locator(".pagina").all();

for (const [i, folha] of folhas.entries()) {
  const destino = path.join(pastaSaida, `${base} - p${i + 1}.png`);
  await folha.screenshot({ path: destino });
  console.log(destino);
}

await navegador.close();
