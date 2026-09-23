// Tudo que é específico de cada família de cronograma mora aqui. O extrator em
// pdf.mjs não conhece nenhum rótulo nem medida — só consulta este módulo. Uma
// família nova (ex.: graduação) deve entrar como mais uma entrada em FAMILIAS.

export const MODALIDADES = [
  { canonica: "Presencial", padrao: /^presencial$/i },
  { canonica: "Ao Vivo", padrao: /^ao\s*vivo$/i },
  { canonica: "EAD", padrao: /^ead$/i },
  { canonica: "Online", padrao: /^online$/i },
  { canonica: "Híbrido", padrao: /^h[íi]brido$/i },
];

// Reconhece a célula de modalidade, que é o que ancora cada linha da tabela.
export function normalizarModalidade(texto) {
  const limpo = texto.trim();
  for (const { canonica, padrao } of MODALIDADES) {
    if (padrao.test(limpo)) return canonica;
  }
  return null;
}

// Tipo de aula: teórica ou prática. É opcional e independente da modalidade
// — uma disciplina "Ao Vivo" pode ser a teórica de um par, e a "Presencial"
// seguinte ser a prática correspondente.
export const TIPOS_AULA = [
  { canonica: "Teórica", padrao: /^te[óo]ric[ao]?$/i },
  { canonica: "Prática", padrao: /^pr[áa]tic[ao]?$/i },
];

export function normalizarTipoAula(texto) {
  const limpo = (texto ?? "").trim();
  for (const { canonica, padrao } of TIPOS_AULA) {
    if (padrao.test(limpo)) return canonica;
  }
  return null;
}

// No acervo, boa parte das disciplinas de capacitação já trazem "TEÓRICA:" ou
// "PRÁTICA:" no próprio nome ("TEÓRICA: Harmonização Facial Full Face"). É um
// sinal real, então o extrator de PDF aproveita — ao contrário da carga
// horária, que não tem nenhuma âncora na origem.
export const RE_PREFIXO_TIPO_AULA = /^(te[óo]ric[ao]|pr[áa]tic[ao])\s*:\s*/i;

export const RE_DATA = /^\d{2}\/\d{2}\/\d{4}$/;
// O Canva usa hífen, travessão ou meia-risca para "sem data" (disciplinas EAD).
export const RE_SEM_DATA = /^[-–—]$/;
// Estágios aparecem com a data ainda em aberto, no fim do nome da disciplina.
export const RE_A_DEFINIR = /\s*[-–—]?\s*a\s+definir\s*$/i;
export const DATA_A_DEFINIR = "A definir";

// Variáveis que podem legitimamente não existir num documento. Ausência delas
// não conta como falha de extração — só vira campo em branco na revisão.
const OPCIONAIS_GERAIS = ["horarioAoVivo", "turma.diaSemana"];

export const FAMILIAS = {
  "pos-graduacao": {
    rotulo: "Pós-graduação",
    // Casado contra o subtítulo da página do cronograma.
    deteccao: /p[óo]s[-\s]?gradua[çc][ãa]o/i,
    opcionais: [...OPCIONAIS_GERAIS, "intervalo"],
  },
  capacitacao: {
    rotulo: "Capacitação",
    deteccao: /capacita[çc][ãa]o/i,
    // Os informativos de capacitação não falam em limite de faltas nem em
    // intervalo de almoço — os encontros são curtos demais para isso.
    opcionais: [...OPCIONAIS_GERAIS, "limiteFaltas", "intervalo"],
  },
};

export function opcionaisDaFamilia(tipo) {
  return FAMILIAS[tipo]?.opcionais ?? OPCIONAIS_GERAIS;
}

export function detectarFamilia(textoCompleto) {
  for (const [id, familia] of Object.entries(FAMILIAS)) {
    if (familia.deteccao.test(textoCompleto)) return id;
  }
  return null;
}

// Cada variável é extraída por uma regex sobre o texto corrido da página de
// apresentação. São todas tolerantes a quebra de linha porque o PDF quebra os
// textos dos cards em linhas curtas.
export const VARIAVEIS = {
  // "conta com 12 encontros" (pós) e "2 ENCONTROS, SENDO 1 POR..." (capacitação).
  encontros: {
    padrao: /(\d+)\s+encontros/i,
    converter: (m) => Number(m[1]),
  },
  capacidadeMaxima: {
    padrao: /capacidade\s+m[áa]xima\s+permitida\s+na\s+turma\s+[ée]\s+de\s+(\d+)\s+alunos/i,
    converter: (m) => Number(m[1]),
  },
  limiteFaltas: {
    padrao: /limite\s+de\s+faltas\s+[ée]\s+de\s+(\d+\s*%)/i,
    converter: (m) => m[1].replace(/\s+/g, ""),
  },
  // Duas redações no acervo: "com 1 hora de intervalo" e "Intervalo: 1 hora".
  intervalo: {
    padrao: /com\s+(\d+\s*horas?)\s+de\s+intervalo|intervalo\s*:?\s*(\d+\s*horas?)/i,
    converter: (m) => (m[1] ?? m[2]).replace(/\s+/g, " "),
  },
};

// Horários aparecem em três formatos no acervo: "08h00 às 15h00" (pós),
// "09:00 às 16:00." (capacitação) e "09h às 16h" (enfermagem, sem minutos).
export const RE_HORARIO =
  /(\d{1,2})\s*[h:]\s*(\d{2})?\s*(?:às|as)\s*(\d{1,2})\s*[h:]\s*(\d{2})?/gi;

export function formatarHorario(m) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(m[1])}h${m[2] ?? "00"} às ${pad(m[3])}h${m[4] ?? "00"}`;
}

export const DIAS_SEMANA = [
  "SEGUNDA",
  "TERÇA",
  "QUARTA",
  "QUINTA",
  "SEXTA",
  "SÁBADO",
  "DOMINGO",
];

export const RE_TURMA = /^\d{2}\/\d{4}$/;
