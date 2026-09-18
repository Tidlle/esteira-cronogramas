// Extrai um arquivo e imprime o JSON resultante.
//
//   node scripts/extrair.mjs "caminho/do/CRONOGRAMA.pdf" [saida.json]

import fs from "node:fs";

import { extrair } from "../src/extract/index.mjs";

process.stdout.setDefaultEncoding?.("utf8");

const [entrada, saida] = process.argv.slice(2);

if (!entrada) {
  console.error('Uso: node scripts/extrair.mjs "arquivo.pdf" [saida.json]');
  process.exit(1);
}

let dados;
try {
  dados = await extrair(entrada);
} catch (erro) {
  // Erro de uso (formato não suportado, arquivo ilegível) merece uma linha
  // legível, não um stack trace.
  console.error(erro.message);
  process.exit(1);
}

const json = JSON.stringify(dados, null, 2);

if (saida) {
  fs.writeFileSync(saida, json, "utf8");
  console.log(`Gravado em ${saida}`);
} else {
  console.log(json);
}
