// Teste de regressão do extrator de .docx.
//
//   node scripts/testar-docx.mjs
//
// Monta documentos de propósito fora do padrão — colunas reordenadas, rótulos
// reescritos, tabelas a mais, modalidade desconhecida — e confere se o extrator
// aguenta. O modelo limpo é coberto pelo primeiro caso.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import { extrair } from "../src/extract/index.mjs";

const pastaTemp = fs.mkdtempSync(path.join(os.tmpdir(), "cronograma-docx-"));

const celula = (texto) =>
  new TableCell({
    children: String(texto)
      .split("\n")
      .map((linha) => new Paragraph({ children: [new TextRun(linha)] })),
  });

const tabela = (linhas) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: linhas.map(
      (linha) => new TableRow({ children: linha.map((c) => celula(c)) }),
    ),
  });

async function gravar(nome, tabelas) {
  const doc = new Document({ sections: [{ children: tabelas.map(tabela) }] });
  const caminho = path.join(pastaTemp, `${nome}.docx`);
  fs.writeFileSync(caminho, await Packer.toBuffer(doc));
  return caminho;
}

const DADOS_PADRAO = [
  ["Campo", "Valor"],
  ["Tipo de cronograma", "Capacitação"],
  ["Curso", "Toxina Botulínica Full Face"],
  ["Turma", "10/2026"],
  ["Dia da semana", "Sábado"],
  ["Encontros presenciais", "2"],
  ["Horário das aulas presenciais", "09h00 às 16h00"],
  ["Endereço", "Rua Lagoa Taí Grande, 91 — Itaquera / SP"],
  ["Capacidade máxima da turma", "2"],
];

const casos = [
  {
    nome: "modelo-limpo",
    descricao: "modelo padrão preenchido",
    tabelas: [
      DADOS_PADRAO,
      [
        ["Modalidade", "Disciplina", "Data"],
        ["Ao Vivo", "TEÓRICA: Toxina Botulínica", "26/01/2027"],
        ["Presencial", "PRÁTICA: Toxina Botulínica", "30/01/2027"],
        ["EAD", "Anatomofisiologia Avançada da Face", ""],
      ],
    ],
    espera: (j) =>
      j.tipo === "capacitacao" &&
      j.disciplinas.length === 3 &&
      j.disciplinas[2].data === null &&
      j._meta.confianca === "alta",
  },
  {
    nome: "colunas-reordenadas",
    descricao: "colunas da tabela de disciplinas fora de ordem",
    tabelas: [
      DADOS_PADRAO,
      [
        ["Data", "Modalidade", "Disciplina"],
        ["26/01/2027", "Ao Vivo", "TEÓRICA: Toxina Botulínica"],
        ["", "EAD", "Biossegurança em Estética"],
      ],
    ],
    espera: (j) =>
      j.disciplinas[0].nome === "TEÓRICA: Toxina Botulínica" &&
      j.disciplinas[0].data === "26/01/2027" &&
      j.disciplinas[1].modalidade === "EAD",
  },
  {
    nome: "rotulos-sinonimos",
    descricao: "rótulos reescritos pela equipe",
    tabelas: [
      [
        ["Campo", "Valor"],
        ["Tipo", "Pós-graduação"],
        ["Nome do curso", "Gestão Hospitalar"],
        ["Código da turma", "09/2026"],
        ["Número de encontros", "12"],
        ["Horário", "08h00 às 15h00"],
        ["Local", "Colégio Gratitude, Santos"],
        ["Vagas", "20"],
      ],
      [
        ["Modalidade", "Disciplina", "Data"],
        ["Presencial", "Segurança do Paciente", "25/09/2027"],
      ],
    ],
    espera: (j) =>
      j.curso === "Gestão Hospitalar" &&
      j.turma.codigo === "09/2026" &&
      j.variaveis.capacidadeMaxima === 20 &&
      j.variaveis.encontros === 12,
  },
  {
    nome: "tabela-extra-antes",
    descricao: "tabela decorativa antes das tabelas de dados",
    tabelas: [
      [
        ["Instituição", "Alpha Channel"],
        ["Responsável", "Marketing"],
      ],
      DADOS_PADRAO,
      [
        ["Modalidade", "Disciplina", "Data"],
        ["Presencial", "PRÁTICA: Toxina Botulínica", "30/01/2027"],
      ],
    ],
    espera: (j) => j.curso === "Toxina Botulínica Full Face" && j.disciplinas.length === 1,
  },
  {
    nome: "modalidade-desconhecida",
    descricao: "modalidade fora do vocabulário e data em aberto",
    tabelas: [
      DADOS_PADRAO,
      [
        ["Modalidade", "Disciplina", "Data"],
        ["Semipresencial", "Estágio Supervisionado", "A definir"],
        ["Presencial", "PRÁTICA: Toxina Botulínica", "30/01/2027"],
      ],
    ],
    espera: (j) =>
      j.disciplinas.length === 2 &&
      j.disciplinas[0].modalidade === null &&
      j.disciplinas[0].data === "A definir" &&
      j._meta.avisos.some((a) => a.includes("Semipresencial")),
  },
  {
    nome: "linhas-vazias",
    descricao: "linhas em branco deixadas no meio da tabela",
    tabelas: [
      DADOS_PADRAO,
      [
        ["Modalidade", "Disciplina", "Data"],
        ["Presencial", "PRÁTICA: Toxina Botulínica", "30/01/2027"],
        ["", "", ""],
        ["EAD", "Normatização Sanitária", ""],
        ["", "", ""],
      ],
    ],
    espera: (j) => j.disciplinas.length === 2,
  },
  {
    nome: "tabela-ead-separada",
    descricao: "tabela de EAD separada, como no modelo atual",
    tabelas: [
      DADOS_PADRAO,
      [
        ["#", "Modalidade", "Disciplina", "Data"],
        ["1", "Ao Vivo", "TEÓRICA: Toxina Botulínica", "26/01/2027"],
        ["2", "Presencial", "PRÁTICA: Toxina Botulínica", "30/01/2027"],
      ],
      [
        ["#", "Disciplina EAD"],
        ["1", "Anatomofisiologia Avançada da Face"],
        ["2", "Biossegurança em Estética"],
      ],
    ],
    espera: (j) =>
      j.disciplinas.length === 4 &&
      // As EAD vêm depois das datadas, na ordem em que saem no cronograma.
      j.disciplinas[2].modalidade === "EAD" &&
      j.disciplinas[2].data === null &&
      j.disciplinas[3].nome === "Biossegurança em Estética",
  },
  {
    nome: "linhas-em-branco-do-modelo",
    descricao: "linhas em branco do modelo, com modalidade já preenchida",
    tabelas: [
      DADOS_PADRAO,
      [
        ["#", "Modalidade", "Disciplina", "Data"],
        ["1", "Presencial", "PRÁTICA: Toxina Botulínica", "30/01/2027"],
        ["2", "Presencial", "", ""],
        ["3", "Presencial", "", ""],
      ],
      [
        ["#", "Disciplina EAD"],
        ["1", "Normatização Sanitária"],
        ["2", ""],
        ["3", ""],
      ],
    ],
    // As linhas não preenchidas não podem virar disciplina sem nome.
    espera: (j) => j.disciplinas.length === 2,
  },
  {
    nome: "ead-sem-numeracao",
    descricao: "tabela de EAD sem a coluna de numeração",
    tabelas: [
      DADOS_PADRAO,
      [
        ["Modalidade", "Disciplina", "Data"],
        ["Presencial", "PRÁTICA: Toxina Botulínica", "30/01/2027"],
      ],
      [["Disciplinas EAD"], ["Normatização Sanitária"]],
    ],
    espera: (j) =>
      j.disciplinas.length === 2 &&
      j.disciplinas[1].nome === "Normatização Sanitária" &&
      j.disciplinas[1].modalidade === "EAD",
  },
  {
    nome: "sem-tabelas",
    descricao: "documento sem nenhuma tabela",
    tabelas: [],
    espera: (j) =>
      j._meta.confianca === "nenhuma" && j._meta.avisos.length > 0,
  },
  {
    nome: "so-disciplinas",
    descricao: "tabela de dados ausente",
    tabelas: [
      [
        ["Modalidade", "Disciplina", "Data"],
        ["Presencial", "Segurança do Paciente", "25/09/2027"],
      ],
    ],
    espera: (j) =>
      j.disciplinas.length === 1 &&
      j.curso === null &&
      j._meta.confianca === "parcial" &&
      j._meta.avisos.some((a) => a.includes("Dados do curso")),
  },
];

let falhas = 0;

for (const caso of casos) {
  const caminho = await gravar(caso.nome, caso.tabelas);
  let resultado;
  try {
    resultado = await extrair(caminho);
  } catch (erro) {
    console.log(`FALHA  ${caso.descricao}\n       lançou: ${erro.message}`);
    falhas++;
    continue;
  }

  if (caso.espera(resultado)) {
    console.log(`ok     ${caso.descricao}`);
  } else {
    falhas++;
    console.log(
      `FALHA  ${caso.descricao}\n` +
        `       ${JSON.stringify({
          tipo: resultado.tipo,
          curso: resultado.curso,
          turma: resultado.turma,
          disciplinas: resultado.disciplinas,
          confianca: resultado._meta.confianca,
          avisos: resultado._meta.avisos,
        })}`,
    );
  }
}

fs.rmSync(pastaTemp, { recursive: true, force: true });

console.log(
  `\n${casos.length - falhas} de ${casos.length} casos passaram` +
    (falhas ? ` — ${falhas} falha(s)` : ""),
);
process.exit(falhas ? 1 : 0);
