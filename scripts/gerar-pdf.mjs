// Gera o PDF final a partir de um arquivo de entrada, de um JSON extraído ou
// de um HTML já construído.
//
//   node scripts/gerar-pdf.mjs "entrada.pdf" saida/cronograma.pdf
//   node scripts/gerar-pdf.mjs "saida/extracao/curso.json"
//   node scripts/gerar-pdf.mjs "saida/html/curso.html"

import fs from "node:fs";
import path from "node:path";

import { construirHtml } from "../src/build-cronograma.mjs";
import { extrair } from "../src/extract/index.mjs";
import {
  fecharNavegador,
  gerarPdfDeHtml,
  nomeDoArquivo,
} from "../src/generate-pdf.mjs";

const [entrada, saida] = process.argv.slice(2);

if (!entrada) {
  console.error(
    'Uso: node scripts/gerar-pdf.mjs "entrada.pdf|.docx|.json|.html" [saida.pdf]',
  );
  process.exit(1);
}

const extensao = path.extname(entrada).toLowerCase();

let html;
let dados = null;

try {
  if (extensao === ".html") {
    html = fs.readFileSync(entrada, "utf8");
  } else {
    dados =
      extensao === ".json"
        ? JSON.parse(fs.readFileSync(entrada, "utf8"))
        : await extrair(entrada);
    html = construirHtml(dados);
  }
} catch (erro) {
  console.error(erro.message);
  process.exit(1);
}

const destino =
  saida ??
  path.join("saida", dados ? nomeDoArquivo(dados) : `${path.basename(entrada, extensao)}.pdf`);

try {
  const { pdf, paginas, avisos } = await gerarPdfDeHtml(html);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, pdf);

  const tamanho = (pdf.length / 1024).toFixed(0);
  console.log(`PDF gerado em ${destino} — ${paginas} páginas, ${tamanho} KB`);
  for (const aviso of avisos) console.log(`  aviso: ${aviso}`);
} catch (erro) {
  console.error(erro.message);
  process.exit(1);
} finally {
  await fecharNavegador();
}
