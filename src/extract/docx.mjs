import fs from "node:fs";

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";

import { detectarFamilia, normalizarModalidade, opcionaisDaFamilia } from "./layouts.mjs";
import {
  CAMPOS,
  COLUNAS_DISCIPLINAS,
  COLUNA_EAD,
  acharPorRotulo,
  definirEmCaminho,
  ehCabecalhoEad,
} from "./modelo-docx.mjs";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // Sem isto, uma tabela com uma linha só viraria objeto em vez de lista, e o
  // código teria que checar o tipo em toda travessia.
  isArray: (nome) => ["w:tbl", "w:tr", "w:tc", "w:p", "w:r"].includes(nome),
});

/** Todos os nós com um dado nome, em qualquer profundidade da árvore. */
function coletar(no, nome, encontrados = []) {
  if (!no || typeof no !== "object") return encontrados;
  for (const [chave, valor] of Object.entries(no)) {
    if (chave === nome) {
      for (const item of Array.isArray(valor) ? valor : [valor]) {
        encontrados.push(item);
      }
    }
    for (const item of Array.isArray(valor) ? valor : [valor]) {
      if (item && typeof item === "object") coletar(item, nome, encontrados);
    }
  }
  return encontrados;
}

/**
 * Texto de um parágrafo. Word fatia o parágrafo em vários `w:r` sempre que
 * alguma formatação muda no meio da frase, então a junção é sem separador —
 * inventar espaços aqui quebraria palavras em duas.
 */
function textoDoParagrafo(paragrafo) {
  const pedacos = [];
  const visitar = (atual) => {
    if (!atual || typeof atual !== "object") return;
    for (const [chave, valor] of Object.entries(atual)) {
      if (chave === "w:t") {
        for (const item of Array.isArray(valor) ? valor : [valor]) {
          pedacos.push(typeof item === "object" ? (item["#text"] ?? "") : item);
        }
      } else if (chave === "w:br" || chave === "w:tab") {
        pedacos.push(" ");
      } else {
        for (const item of Array.isArray(valor) ? valor : [valor]) {
          if (item && typeof item === "object") visitar(item);
        }
      }
    }
  };
  visitar(paragrafo);
  return pedacos.join("").replace(/\s+/g, " ").trim();
}

/**
 * Texto de uma célula, com um parágrafo por linha. A separação importa: a
 * célula de rótulo do modelo traz o nome do campo no primeiro parágrafo e o
 * texto de ajuda nos seguintes ("Turma" / "No formato MM/AAAA"), e juntar tudo
 * numa string só faria o rótulo deixar de casar.
 */
function textoDaCelula(celula) {
  return coletar(celula, "w:p")
    .map(textoDoParagrafo)
    .filter(Boolean)
    .join("\n");
}

/** Só a primeira linha — é onde mora o rótulo, sem o texto de ajuda. */
const primeiraLinha = (texto) => (texto ?? "").split("\n")[0] ?? "";

/** Uma tabela como matriz de strings. */
function tabelaParaMatriz(tabela) {
  return coletar(tabela, "w:tr").map((linha) =>
    coletar(linha, "w:tc").map((celula) => textoDaCelula(celula)),
  );
}

/**
 * Descobre qual tabela é qual pelo conteúdo, não pela ordem: a tabela de
 * disciplinas é a que tem um cabeçalho reconhecível, e a de dados é a que tem
 * rótulos de campo na primeira coluna. Assim o arquivo tolera tabelas extras,
 * ordem trocada e seções acrescentadas pela equipe.
 */
function classificarTabelas(matrizes) {
  let dados = null;
  let disciplinas = null;
  let ead = null;

  for (const matriz of matrizes) {
    if (!matriz.length) continue;

    const cabecalho = matriz[0].map((c) =>
      acharPorRotulo(primeiraLinha(c), COLUNAS_DISCIPLINAS),
    );
    const reconhecidas = cabecalho.filter(Boolean).length;

    // A tabela de EAD tem uma coluna só, então também casaria como tabela de
    // disciplinas se fosse testada depois; a checagem vem primeiro.
    if (!ead && ehCabecalhoEad(matriz[0])) {
      ead = matriz;
      continue;
    }

    // Duas das três colunas já bastam: alguém pode ter removido a de data.
    if (reconhecidas >= 2 && !disciplinas) {
      disciplinas = { matriz, cabecalho };
      continue;
    }

    const rotulos = matriz.filter((linha) =>
      acharPorRotulo(primeiraLinha(linha[0]), CAMPOS),
    );
    if (rotulos.length >= 3 && !dados) {
      dados = matriz;
    }
  }

  return { dados, disciplinas, ead };
}

/**
 * Lê a tabela só de EAD. A coluna do nome é localizada pelo cabeçalho, para a
 * tabela tolerar uma coluna de numeração à esquerda (que o modelo traz) ou
 * qualquer outra coluna auxiliar que a equipe acrescente.
 */
function lerTabelaEad(matriz) {
  const indiceNome = matriz[0].findIndex((celula) =>
    acharPorRotulo(primeiraLinha(celula), [COLUNA_EAD]),
  );

  const nomes = [];
  for (const linha of matriz.slice(1)) {
    // Sem cabeçalho reconhecido, vale a célula mais longa da linha — é sempre o
    // nome, nunca o número de ordem.
    const bruto =
      indiceNome >= 0
        ? linha[indiceNome]
        : [...linha].sort((a, b) => (b ?? "").length - (a ?? "").length)[0];

    const nome = (bruto ?? "").trim();
    // Descarta a numeração de uma linha em que só ela foi preenchida.
    if (!nome || /^\d+$/.test(nome)) continue;
    nomes.push(nome);
  }
  return nomes;
}

function converterValor(campo, bruto) {
  const valor = (bruto ?? "").trim();
  if (!valor) return null;
  if (campo.numero) {
    const numero = Number(valor.replace(/[^\d]/g, ""));
    return Number.isFinite(numero) && numero > 0 ? numero : null;
  }
  return valor;
}

/**
 * Extrai um cronograma do modelo padronizado .docx.
 *
 * Como o .pdf, nunca lança por conteúdo inesperado: o que faltar volta como
 * null e listado em _meta.camposNaoEncontrados.
 */
export async function extrairDeDocx(caminho) {
  const zip = await JSZip.loadAsync(fs.readFileSync(caminho));
  const documento = zip.file("word/document.xml");

  if (!documento) {
    throw new Error(
      "Arquivo .docx inválido: não contém word/document.xml. " +
        "Se for um .doc antigo, salve como .docx no Word antes de enviar.",
    );
  }

  const arvore = parser.parse(await documento.async("string"));
  const matrizes = coletar(arvore, "w:tbl").map(tabelaParaMatriz);

  if (!matrizes.length) {
    return {
      tipo: null,
      curso: null,
      disciplinas: [],
      _meta: {
        origem: "docx",
        confianca: "nenhuma",
        camposNaoEncontrados: [],
        avisos: [
          "Nenhuma tabela encontrada no documento. Use o modelo padronizado " +
            "(MODELO-CRONOGRAMA.docx) ou preencha os dados manualmente na revisão.",
        ],
      },
    };
  }

  const {
    dados,
    disciplinas: tabelaDisciplinas,
    ead: tabelaEad,
  } = classificarTabelas(matrizes);

  const resultado = { turma: {}, variaveis: {} };
  const faltando = [];
  const avisos = [];

  if (dados) {
    const vistos = new Set();
    for (const linha of dados) {
      const campo = acharPorRotulo(primeiraLinha(linha[0]), CAMPOS);
      if (!campo) continue;
      vistos.add(campo.chave);
      definirEmCaminho(resultado, campo.chave, converterValor(campo, linha[1]));
    }
    for (const campo of CAMPOS) {
      if (!vistos.has(campo.chave)) {
        definirEmCaminho(resultado, campo.chave, null);
      }
    }
  } else {
    avisos.push(
      'Tabela "Dados do curso" não encontrada — só as disciplinas foram lidas.',
    );
    for (const campo of CAMPOS) definirEmCaminho(resultado, campo.chave, null);
  }

  // O campo "tipo" chega como texto livre ("Pós-graduação"); converte para o
  // identificador da família, e cai para a detecção pelo documento inteiro se
  // quem preencheu tiver escrito de outro jeito.
  const tipo =
    detectarFamilia(resultado.tipo ?? "") ??
    detectarFamilia(matrizes.flat(2).join("\n"));
  resultado.tipo = tipo;
  if (!tipo) faltando.push("tipo");

  const listaDisciplinas = [];
  if (tabelaDisciplinas) {
    const { matriz, cabecalho } = tabelaDisciplinas;
    const indiceDe = (chave) =>
      cabecalho.findIndex((coluna) => coluna?.chave === chave);
    const iModalidade = indiceDe("modalidade");
    const iNome = indiceDe("nome");
    const iData = indiceDe("data");

    for (const linha of matriz.slice(1)) {
      const nome = (iNome >= 0 ? linha[iNome] : "")?.trim();
      if (!nome) continue;

      const modalidadeBruta = iModalidade >= 0 ? linha[iModalidade] : "";
      const modalidade = normalizarModalidade(modalidadeBruta ?? "");
      if (modalidadeBruta?.trim() && !modalidade) {
        avisos.push(
          `Modalidade "${modalidadeBruta.trim()}" não reconhecida ` +
            `na disciplina "${nome}".`,
        );
      }

      const dataBruta = (iData >= 0 ? linha[iData] : "")?.trim() ?? "";
      const data = /a\s*definir/i.test(dataBruta)
        ? "A definir"
        : dataBruta || null;

      listaDisciplinas.push({ modalidade, nome, data });
    }
  } else if (!tabelaEad) {
    avisos.push(
      'Tabela "Disciplinas com data" não encontrada — verifique se o cabeçalho ' +
        "tem as colunas Modalidade, Disciplina e Data.",
    );
  }

  // As EAD entram depois das datadas, que é a ordem em que saem no cronograma.
  if (tabelaEad) {
    for (const nome of lerTabelaEad(tabelaEad)) {
      listaDisciplinas.push({ modalidade: "EAD", nome, data: null });
    }
  }

  if (!listaDisciplinas.length) faltando.push("disciplinas");
  if (!resultado.curso) faltando.push("curso");
  if (!resultado.turma.codigo) faltando.push("turma.codigo");
  if (!resultado.turma.diaSemana) faltando.push("turma.diaSemana");
  for (const [chave, valor] of Object.entries(resultado.variaveis)) {
    if (valor == null) faltando.push(`variaveis.${chave}`);
  }

  // Os nomes usados na lista de opcionais seguem o formato do extrator de PDF.
  const opcionais = opcionaisDaFamilia(tipo).map((c) =>
    c.includes(".") ? c : `variaveis.${c}`,
  );
  const naoEncontrados = faltando.filter((campo) => !opcionais.includes(campo));

  return {
    tipo,
    curso: resultado.curso,
    modalidadeTitulo: null,
    turma: resultado.turma,
    variaveis: resultado.variaveis,
    avisos: [],
    disciplinas: listaDisciplinas,
    _meta: {
      origem: "docx",
      confianca: naoEncontrados.length === 0 ? "alta" : "parcial",
      camposNaoEncontrados: naoEncontrados,
      camposOpcionaisVazios: faltando.filter((campo) =>
        opcionais.includes(campo),
      ),
      tabelasEncontradas: matrizes.length,
      avisos,
    },
  };
}
