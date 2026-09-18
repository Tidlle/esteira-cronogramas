import path from "node:path";

import { extrairDeDocx } from "./docx.mjs";
import { extrairDePdf } from "./pdf.mjs";

/**
 * Ponto de entrada da extração: escolhe o parser pela extensão do arquivo.
 * O formato de saída é o mesmo para toda origem, para que a tela de revisão e
 * a geração de PDF não precisem saber de onde os dados vieram.
 */
export async function extrair(caminho) {
  const extensao = path.extname(caminho).toLowerCase();

  switch (extensao) {
    case ".pdf":
      return extrairDePdf(caminho);
    case ".docx":
      return extrairDeDocx(caminho);
    default:
      throw new Error(
        `Formato não suportado: "${extensao}". Envie um arquivo .pdf ou .docx.`,
      );
  }
}
