import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

// O acervo do Canva usa páginas de 1440x810 pontos. O template é desenhado em
// 1440x810 pixels de CSS, que a 96dpi dariam só 1080x608 pontos — a mesma
// proporção 16:9, mas um arquivo fisicamente menor. A escala de 4/3 corrige
// isso, para que um cronograma novo e um antigo tenham o mesmo tamanho ao
// serem abertos ou impressos lado a lado.
export const LARGURA_PAGINA = "20in";
export const ALTURA_PAGINA = "11.25in";
const ESCALA = 4 / 3;

// Tempo máximo esperando a paginação e as fontes. Estourou, segue mesmo assim:
// um PDF com a fonte de fallback é melhor que erro, e o aviso sai no retorno.
const ESPERA_MS = 20000;

let navegadorCompartilhado = null;

/**
 * Um único Chromium para todo o processo. Subir um navegador por PDF custa
 * cerca de um segundo cada, o que pesa quando o servidor gera vários seguidos.
 */
async function obterNavegador() {
  if (!navegadorCompartilhado || !navegadorCompartilhado.isConnected()) {
    navegadorCompartilhado = await chromium.launch();
  }
  return navegadorCompartilhado;
}

export async function fecharNavegador() {
  if (navegadorCompartilhado) {
    await navegadorCompartilhado.close().catch(() => {});
    navegadorCompartilhado = null;
  }
}

/**
 * Converte o HTML do cronograma em PDF.
 *
 * A saída é PDF nativo: texto selecionável e pesquisável, que num cronograma
 * importa — o aluno procura a data de uma disciplina com Ctrl+F. Rasterizar as
 * páginas (o modo "compact" da esteira de informativos) faria sentido se o
 * fundo fosse fotográfico; aqui é cor chapada e texto, onde virar imagem só
 * aumentaria o arquivo e tiraria a busca.
 *
 * @param {string} html conteúdo do arquivo gerado por build-cronograma
 * @returns {Promise<{pdf: Buffer, paginas: number, avisos: string[]}>}
 */
export async function gerarPdfDeHtml(html) {
  const avisos = [];
  const navegador = await obterNavegador();
  const contexto = await navegador.newContext();
  const aba = await contexto.newPage();

  // O HTML é gravado em disco em vez de injetado com setContent porque o
  // Chromium só aplica @page a um documento com URL própria.
  const pastaTemp = fs.mkdtempSync(path.join(os.tmpdir(), "cronograma-pdf-"));
  const arquivoHtml = path.join(pastaTemp, "cronograma.html");
  fs.writeFileSync(arquivoHtml, html, "utf8");

  try {
    await aba.goto(pathToFileURL(arquivoHtml).href, { waitUntil: "load" });

    // O script do template marca o documento quando termina de distribuir as
    // linhas em páginas. Sem esperar, o PDF sairia com uma página só.
    try {
      await aba.waitForSelector("html[data-pronto]", { timeout: ESPERA_MS });
    } catch {
      avisos.push(
        "A paginação não sinalizou conclusão no tempo esperado; " +
          "confira se todas as disciplinas saíram no PDF.",
      );
    }

    // Sem rede as fontes do Google não chegam e o layout muda de aparência.
    const fontesOk = await aba.evaluate(() =>
      document.fonts
        ? document.fonts.check('600 36px Poppins') &&
          document.fonts.check('400 15px Inter')
        : true,
    );
    if (!fontesOk) {
      avisos.push(
        "As fontes Inter/Poppins não carregaram (provavelmente sem acesso à " +
          "internet); o PDF saiu com a fonte do sistema.",
      );
    }

    const paginas = await aba.locator(".pagina").count();

    const pdf = await aba.pdf({
      width: LARGURA_PAGINA,
      height: ALTURA_PAGINA,
      scale: ESCALA,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    return { pdf, paginas, avisos };
  } finally {
    await contexto.close().catch(() => {});
    fs.rmSync(pastaTemp, { recursive: true, force: true });
  }
}

/** Nome de arquivo sugerido a partir dos dados do cronograma. */
export function nomeDoArquivo(dados) {
  const partes = [dados.curso, dados.turma?.codigo]
    .filter(Boolean)
    .join(" - ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // A turma vem como "10/2026" e a barra não pode ir para um nome de
    // arquivo; vira ponto, que é como o acervo já nomeia ("... - 09.2026").
    .replace(/\//g, ".")
    .replace(/[^\w\s.-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `CRONOGRAMA - ${partes || "sem nome"}.pdf`;
}
