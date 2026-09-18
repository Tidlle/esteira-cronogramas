// Gera o HTML do cronograma a partir de um arquivo de entrada ou de um JSON já
// extraído.
//
//   node scripts/construir.mjs "entrada.pdf" saida/cronograma.html
//   node scripts/construir.mjs "saida/extracao/curso.json" saida/cronograma.html

import fs from "node:fs";
import path from "node:path";

import { construirHtml } from "../src/build-cronograma.mjs";
import { extrair } from "../src/extract/index.mjs";

const [entrada, saida] = process.argv.slice(2);

if (!entrada) {
  console.error(
    'Uso: node scripts/construir.mjs "entrada.pdf|.docx|.json" [saida.html]',
  );
  process.exit(1);
}

let dados;
try {
  dados =
    path.extname(entrada).toLowerCase() === ".json"
      ? JSON.parse(fs.readFileSync(entrada, "utf8"))
      : await extrair(entrada);
} catch (erro) {
  console.error(erro.message);
  process.exit(1);
}

let html;
try {
  html = construirHtml(dados);
} catch (erro) {
  console.error(erro.message);
  process.exit(1);
}

const destino =
  saida ??
  path.join(
    "saida",
    `${path.basename(entrada, path.extname(entrada))}.html`,
  );

fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, html, "utf8");

const faltando = dados._meta?.camposNaoEncontrados ?? [];
console.log(
  `HTML gerado em ${destino} — ${dados.disciplinas?.length ?? 0} disciplinas` +
    (faltando.length ? `, campos em branco: ${faltando.join(", ")}` : ""),
);
