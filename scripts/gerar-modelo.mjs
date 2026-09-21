// Gera o modelo .docx em branco que a equipe preenche.
//
//   node scripts/gerar-modelo.mjs [saida.docx]
//
// A estrutura vem de src/extract/modelo-docx.mjs, a mesma que o extrator lê —
// assim o arquivo entregue e o que o sistema espera não saem de sincronia.

import fs from "node:fs";
import path from "node:path";

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import {
  CAMPOS,
  COLUNAS_DISCIPLINAS,
  COLUNAS_EAD,
  DISCIPLINAS_EAD_EXEMPLO,
  DISCIPLINAS_EXEMPLO,
  LINHAS_EM_BRANCO_DATA,
  LINHAS_EM_BRANCO_EAD,
  MODALIDADE_PADRAO,
  TITULO_TABELA_DADOS,
  TITULO_TABELA_DISCIPLINAS,
  TITULO_TABELA_EAD,
} from "../src/extract/modelo-docx.mjs";

const destino = process.argv[2] ?? "modelos/MODELO-CRONOGRAMA.docx";

const VERMELHO = "A62432";
const CINZA = "5F5E5A";

const texto = (conteudo, opcoes = {}) =>
  new Paragraph({ children: [new TextRun({ text: conteudo, ...opcoes })] });

const celula = (filhos, opcoes = {}) =>
  new TableCell({
    children: Array.isArray(filhos) ? filhos : [filhos],
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    ...opcoes,
  });

const cabecalho = (rotulos) =>
  new TableRow({
    tableHeader: true,
    children: rotulos.map((rotulo) =>
      celula(texto(rotulo, { bold: true, color: "FFFFFF" }), {
        shading: { fill: VERMELHO },
      }),
    ),
  });

const larguraTotal = { size: 100, type: WidthType.PERCENTAGE };

// Tabela 1: um campo por linha, com a ajuda logo abaixo do rótulo.
const tabelaDados = new Table({
  width: larguraTotal,
  rows: [
    cabecalho(["Campo", "Valor"]),
    ...CAMPOS.map(
      (campo) =>
        new TableRow({
          children: [
            celula([
              texto(campo.rotulo, { bold: true }),
              ...(campo.ajuda
                ? [texto(campo.ajuda, { size: 16, color: CINZA, italics: true })]
                : []),
              ...(campo.opcional
                ? [texto("(opcional)", { size: 16, color: CINZA })]
                : []),
            ]),
            celula(texto(campo.exemplo ?? "", { color: CINZA })),
          ],
        }),
    ),
  ],
});

// Tabela 2: disciplinas com data, uma por linha, na ordem em que devem sair no
// cronograma. Vem com um número em cada linha e com a modalidade mais comum já
// preenchida, para a equipe só digitar nome e data.
const numero = (n) =>
  celula(texto(String(n), { color: CINZA, size: 16 }), {
    width: { size: 6, type: WidthType.PERCENTAGE },
  });

const linhaDisciplina = (indice, dados) =>
  new TableRow({
    children: [
      numero(indice + 1),
      ...COLUNAS_DISCIPLINAS.map((coluna) =>
        celula(texto(dados?.[coluna.chave] ?? "", { color: CINZA })),
      ),
    ],
  });

const tabelaDisciplinas = new Table({
  width: larguraTotal,
  rows: [
    cabecalho(["#", ...COLUNAS_DISCIPLINAS.map((c) => c.rotulo)]),
    ...DISCIPLINAS_EXEMPLO.map((d, i) => linhaDisciplina(i, d)),
    ...Array.from({ length: LINHAS_EM_BRANCO_DATA }, (_, i) =>
      linhaDisciplina(DISCIPLINAS_EXEMPLO.length + i, {
        modalidade: MODALIDADE_PADRAO,
      }),
    ),
  ],
});

// Tabela 3: disciplinas EAD. Nome e, opcionalmente, carga horária — elas não
// têm data porque ficam liberadas na plataforma o curso inteiro.
const linhaEad = (indice, dados) =>
  new TableRow({
    children: [
      numero(indice + 1),
      ...COLUNAS_EAD.map((coluna) =>
        celula(texto(dados?.[coluna.chave] ?? "", { color: CINZA })),
      ),
    ],
  });

const tabelaEad = new Table({
  width: larguraTotal,
  rows: [
    cabecalho(["#", ...COLUNAS_EAD.map((c) => c.rotulo)]),
    ...DISCIPLINAS_EAD_EXEMPLO.map((d, i) => linhaEad(i, d)),
    ...Array.from({ length: LINHAS_EM_BRANCO_EAD }, (_, i) =>
      linhaEad(DISCIPLINAS_EAD_EXEMPLO.length + i),
    ),
  ],
});

const documento = new Document({
  sections: [
    {
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: "Modelo de cronograma",
              bold: true,
              color: VERMELHO,
              size: 36,
            }),
          ],
        }),
        texto(
          "Preencha as duas tabelas abaixo e envie este arquivo no sistema. " +
            "Os valores em cinza são exemplos — apague e escreva os dados reais. " +
            "Não renomeie os rótulos da primeira coluna nem os cabeçalhos das tabelas.",
          { size: 18, color: CINZA },
        ),
        new Paragraph({ text: "" }),

        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: TITULO_TABELA_DADOS, bold: true })],
        }),
        tabelaDados,
        new Paragraph({ text: "" }),

        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [
            new TextRun({ text: TITULO_TABELA_DISCIPLINAS, bold: true }),
          ],
        }),
        texto(
          "Uma disciplina por linha, na ordem em que devem aparecer no cronograma. " +
            "A modalidade já vem preenchida como “Presencial” — troque só onde for " +
            "diferente. Valores aceitos: Presencial, Ao Vivo, Online ou Híbrido. " +
            "Se a data ainda não estiver fechada, escreva “A definir”. Carga horária " +
            "é opcional — no formato “40h”; deixe em branco quando não tiver essa " +
            "informação.",
          { size: 18, color: CINZA },
        ),
        texto(
          "Sobraram linhas? Deixe em branco, elas são ignoradas. Faltaram? " +
            "Clique na última célula da tabela e aperte Tab para criar outra.",
          { size: 18, color: CINZA, italics: true },
        ),
        new Paragraph({ text: "" }),
        tabelaDisciplinas,
        new Paragraph({ text: "" }),

        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: TITULO_TABELA_EAD, bold: true })],
        }),
        texto(
          "O nome e, se quiser, a carga horária. Estas disciplinas ficam liberadas " +
            "na plataforma durante todo o curso, por isso não têm data e saem num " +
            "bloco separado no cronograma.",
          { size: 18, color: CINZA },
        ),
        new Paragraph({ text: "" }),
        tabelaEad,
      ],
    },
  ],
});

fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, await Packer.toBuffer(documento));

console.log(
  `Modelo gerado em ${destino} — ${CAMPOS.length} campos, ` +
    `${DISCIPLINAS_EXEMPLO.length + LINHAS_EM_BRANCO_DATA} linhas para disciplinas ` +
    `com data e ${DISCIPLINAS_EAD_EXEMPLO.length + LINHAS_EM_BRANCO_EAD} para EAD`,
);
