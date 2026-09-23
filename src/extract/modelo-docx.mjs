// Definição do modelo padronizado .docx. É a fonte única: o script que gera o
// arquivo em branco (scripts/gerar-modelo.mjs) e o extrator (docx.mjs) leem
// daqui, para que o modelo entregue à equipe e o que o sistema espera nunca
// saiam de sincronia.

/** Tira acentos, pontuação e espaços extras — usado para casar rótulos. */
export function normalizarRotulo(texto) {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Cada campo tem o rótulo que aparece no modelo e os sinônimos aceitos na
// leitura. A tolerância existe porque o arquivo passa pela mão de várias
// pessoas e o rótulo acaba reescrito ("Turma" vira "Código da turma").
export const CAMPOS = [
  {
    chave: "tipo",
    rotulo: "Tipo de cronograma",
    sinonimos: ["tipo", "modalidade do curso", "familia"],
    exemplo: "Pós-graduação",
    ajuda: "Pós-graduação ou Capacitação",
  },
  {
    chave: "curso",
    rotulo: "Curso",
    sinonimos: ["nome do curso"],
    exemplo: "Gestão Hospitalar",
  },
  {
    chave: "turma.codigo",
    rotulo: "Turma",
    sinonimos: ["codigo da turma", "turma codigo"],
    exemplo: "10/2026",
    ajuda: "No formato MM/AAAA",
  },
  {
    chave: "turma.diaSemana",
    rotulo: "Dia da semana",
    sinonimos: ["dia", "dia das aulas"],
    exemplo: "Sábado",
    opcional: true,
  },
  {
    chave: "variaveis.encontros",
    rotulo: "Encontros presenciais",
    sinonimos: ["encontros", "numero de encontros", "quantidade de encontros"],
    exemplo: "12",
    numero: true,
  },
  {
    chave: "variaveis.horarioPresencial",
    rotulo: "Horário das aulas presenciais",
    sinonimos: ["horario", "horario presencial", "horario das aulas"],
    exemplo: "08h00 às 15h00",
  },
  {
    chave: "variaveis.horarioAoVivo",
    rotulo: "Horário das aulas ao vivo",
    sinonimos: ["horario ao vivo", "horario das aulas online"],
    exemplo: "19h00 às 21h00",
    opcional: true,
    ajuda: "Deixe em branco se o curso não tiver aulas ao vivo",
  },
  {
    chave: "variaveis.intervalo",
    rotulo: "Intervalo",
    sinonimos: ["intervalo para almoco", "almoco"],
    exemplo: "1 hora",
    opcional: true,
  },
  {
    chave: "variaveis.endereco",
    rotulo: "Endereço",
    sinonimos: ["local", "endereco das aulas"],
    exemplo: "Colégio Gratitude — Avenida Marechal Deodoro, 53 — Santos",
  },
  {
    chave: "variaveis.capacidadeMaxima",
    rotulo: "Capacidade máxima da turma",
    sinonimos: ["capacidade", "capacidade maxima", "vagas", "maximo de alunos"],
    exemplo: "20",
    numero: true,
  },
  {
    chave: "variaveis.limiteFaltas",
    rotulo: "Limite de faltas",
    sinonimos: ["faltas", "limite de faltas permitido"],
    exemplo: "30%",
    opcional: true,
  },
];

// Carga horária é opcional em ambas as tabelas de disciplina — a com data e a
// EAD. Não existe hoje no acervo (os PDFs do Canva não trazem essa informação),
// então nenhum cronograma antigo tem esse dado; é um campo novo que só chega
// por preenchimento manual, no modelo ou na tela de revisão.
export const COLUNA_CARGA_HORARIA = {
  chave: "cargaHoraria",
  rotulo: "Carga Horária",
  sinonimos: ["carga horaria", "horas", "ch", "carga"],
};

// Tipo de aula é opcional e independente da modalidade — uma disciplina "Ao
// Vivo" pode ser a teórica de um par, e a "Presencial" seguinte, a prática
// correspondente. Só os dois valores abaixo são aceitos (ver normalizarTipoAula
// em layouts.mjs); qualquer outra coisa gera aviso na revisão, sem travar a
// extração.
export const COLUNA_TIPO_AULA = {
  chave: "tipoAula",
  rotulo: "Tipo de Aula",
  sinonimos: ["tipo de aula", "teorica ou pratica", "teoria ou pratica"],
};

// Cabeçalhos aceitos para a tabela de disciplinas com data. A ordem das colunas
// é lida do cabeçalho, não fixada, para o arquivo tolerar quem as reordene — a
// ordem aqui só decide a ordem em que o modelo em branco é gerado.
export const COLUNAS_DISCIPLINAS = [
  {
    chave: "modalidade",
    rotulo: "Modalidade",
    sinonimos: ["tipo", "formato"],
  },
  COLUNA_TIPO_AULA,
  {
    chave: "nome",
    rotulo: "Disciplina",
    sinonimos: ["disciplinas", "nome", "nome da disciplina", "conteudo"],
  },
  {
    chave: "data",
    rotulo: "Data",
    sinonimos: ["datas", "dia"],
  },
  COLUNA_CARGA_HORARIA,
];

// As disciplinas EAD ganham tabela própria. No acervo elas são 37% do total, e
// numa tabela única com as demais obrigavam a repetir "EAD" e deixar a data em
// branco em cada uma — trabalho manual que não informa nada.
export const COLUNA_EAD = {
  chave: "nome",
  rotulo: "Disciplina EAD",
  sinonimos: ["disciplinas ead", "ead", "nome da disciplina ead"],
};

export const COLUNAS_EAD = [COLUNA_EAD, COLUNA_CARGA_HORARIA];

/** Reconhece o cabeçalho da tabela só de EAD. */
export function ehCabecalhoEad(celulas) {
  const texto = celulas.map(normalizarRotulo).join(" ");
  return /\bead\b/.test(texto);
}

export const TITULO_TABELA_DADOS = "Dados do curso";
export const TITULO_TABELA_DISCIPLINAS = "Disciplinas com data";
export const TITULO_TABELA_EAD = "Disciplinas EAD (sem data)";

// Linhas em branco já criadas no modelo, para a equipe só preencher em vez de
// ter que inserir linha a linha no Word. Dimensionado pelo acervo, cujo maior
// cronograma tem 18 disciplinas com data e 7 EAD.
export const LINHAS_EM_BRANCO_DATA = 20;
export const LINHAS_EM_BRANCO_EAD = 10;

// Modalidade já preenchida nas linhas em branco: 71% das disciplinas com data
// no acervo são presenciais, então o padrão poupa a maior parte da digitação.
export const MODALIDADE_PADRAO = "Presencial";

/** Casa um texto de célula contra um conjunto de definições de rótulo. */
export function acharPorRotulo(texto, definicoes) {
  const alvo = normalizarRotulo(texto);
  if (!alvo) return null;
  return (
    definicoes.find(
      (def) =>
        normalizarRotulo(def.rotulo) === alvo ||
        def.sinonimos?.some((s) => normalizarRotulo(s) === alvo),
    ) ?? null
  );
}

/** Grava um valor num objeto usando uma chave com pontos ("turma.codigo"). */
export function definirEmCaminho(objeto, caminho, valor) {
  const partes = caminho.split(".");
  let atual = objeto;
  for (const parte of partes.slice(0, -1)) {
    atual[parte] ??= {};
    atual = atual[parte];
  }
  atual[partes[partes.length - 1]] = valor;
}

// Linhas de exemplo que acompanham o modelo, para a equipe ver o formato
// esperado antes de apagar e preencher com os dados reais.
export const DISCIPLINAS_EXEMPLO = [
  {
    modalidade: "Ao Vivo",
    tipoAula: "Teórica",
    nome: "Harmonização Facial Full Face",
    data: "26/01/2027",
    cargaHoraria: "8h",
  },
  {
    modalidade: "Presencial",
    tipoAula: "Prática",
    nome: "Harmonização Facial Full Face",
    data: "30/01/2027",
    cargaHoraria: "8h",
  },
  {
    modalidade: "Presencial",
    tipoAula: "",
    nome: "Processos e Fundamentos Históricos da Educação em Saúde",
    data: "26/09/2026",
    cargaHoraria: "40h",
  },
];

export const DISCIPLINAS_EAD_EXEMPLO = [
  {
    nome: "Ética, Bioética e Legislação em Gestão Hospitalar",
    cargaHoraria: "20h",
  },
];
