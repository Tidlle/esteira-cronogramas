// Teste de regressão do template: constrói o HTML de todos os cronogramas
// extraídos e confere no navegador se nada estourou ou se perdeu.
//
//   node scripts/testar-template.mjs [pasta-de-json]
//
// As checagens são as que a inspeção visual não pega de forma confiável:
// conteúdo cortado por estouro de caixa e disciplina sumida na paginação.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

import { construirHtml } from "../src/build-cronograma.mjs";

const pastaJson = process.argv[2] ?? "saida/extracao";

const arquivos = fs
  .readdirSync(pastaJson)
  .filter((nome) => nome.endsWith(".json"))
  .sort();

if (!arquivos.length) {
  console.error(`Nenhum .json em ${path.resolve(pastaJson)}`);
  process.exit(1);
}

const pastaTemp = fs.mkdtempSync(path.join(os.tmpdir(), "cronograma-html-"));
const navegador = await chromium.launch();
const aba = await navegador.newPage({ viewport: { width: 1440, height: 810 } });

let falhas = 0;

for (const arquivo of arquivos) {
  const dados = JSON.parse(
    fs.readFileSync(path.join(pastaJson, arquivo), "utf8"),
  );
  const curto = arquivo.replace(/\.json$/, "").slice(0, 52);
  const problemas = [];

  let caminho;
  try {
    caminho = path.join(pastaTemp, `${arquivo}.html`);
    fs.writeFileSync(caminho, construirHtml(dados), "utf8");
  } catch (erro) {
    console.log(`FALHA  ${curto}\n       ao construir: ${erro.message}`);
    falhas++;
    continue;
  }

  await aba.goto(pathToFileURL(caminho).href);
  try {
    await aba.waitForSelector("html[data-pronto]", { timeout: 10000 });
  } catch {
    console.log(`FALHA  ${curto}\n       a paginação não concluiu`);
    falhas++;
    continue;
  }

  const relato = await aba.evaluate(() => {
    const paginas = [...document.querySelectorAll(".pagina")];
    const estouros = [];

    for (const [i, pagina] of paginas.entries()) {
      // Cada caixa de altura fixa que receba mais conteúdo do que cabe recorta
      // em silêncio, sem barra de rolagem — por isso a checagem é elemento a
      // elemento, e não só na página.
      for (const seletor of [".quadro", ".corpo", ".cartoes", ".avisos"]) {
        const alvo = pagina.querySelector(seletor);
        if (alvo && alvo.scrollHeight > alvo.clientHeight + 1) {
          estouros.push(
            `${seletor} da página ${i + 1} estourou em ` +
              `${alvo.scrollHeight - alvo.clientHeight}px`,
          );
        }
      }

      // O que importa no cabeçalho é o nome do curso não vazar da faixa nem
      // invadir o logo. Medir a caixa do próprio texto não serve: com
      // line-height menor que a caixa natural da fonte, scrollHeight passa de
      // clientHeight em todo título, sem nada estar cortado.
      const faixa = pagina.querySelector(".cabecalho");
      if (faixa && faixa.scrollHeight > faixa.clientHeight + 1) {
        estouros.push(`cabeçalho da página ${i + 1} estourou`);
      }

      const titulo = pagina.querySelector(".cabecalho__curso");
      const marca = pagina.querySelector(".cabecalho__marca");
      if (titulo && marca) {
        const a = titulo.getBoundingClientRect();
        const b = marca.getBoundingClientRect();
        if (a.right > b.left) {
          estouros.push(
            `nome do curso invade o logo na página ${i + 1} ` +
              `(${Math.round(a.right - b.left)}px)`,
          );
        }
      }
    }

    return {
      paginas: paginas.length,
      linhas: document.querySelectorAll("tbody tr").length,
      itensEad: document.querySelectorAll(".bloco-ead__lista span").length,
      semNumero: [...document.querySelectorAll("[data-numero-pagina]")].filter(
        (e) => !e.textContent.trim(),
      ).length,
      estouros,
    };
  });

  problemas.push(...relato.estouros);

  // Nenhuma disciplina pode sumir entre os dados e a página.
  const esperadas = dados.disciplinas?.length ?? 0;
  const renderizadas = relato.linhas + relato.itensEad;
  if (renderizadas !== esperadas) {
    problemas.push(
      `${esperadas} disciplinas nos dados, ${renderizadas} na página ` +
        `(${relato.linhas} na tabela + ${relato.itensEad} no bloco EAD)`,
    );
  }

  if (relato.semNumero) {
    problemas.push(`${relato.semNumero} página(s) sem numeração`);
  }

  if (problemas.length) {
    falhas++;
    console.log(`FALHA  ${curto}`);
    for (const problema of problemas) console.log(`       ${problema}`);
  } else {
    console.log(
      `ok     ${curto}  (${relato.paginas} páginas, ${renderizadas} disciplinas)`,
    );
  }
}

await navegador.close();
fs.rmSync(pastaTemp, { recursive: true, force: true });

console.log(
  `\n${arquivos.length - falhas} de ${arquivos.length} cronogramas montados sem problema` +
    (falhas ? ` — ${falhas} com falha` : ""),
);
process.exit(falhas ? 1 : 0);
