import fs from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  DATA_A_DEFINIR,
  DIAS_SEMANA,
  FAMILIAS,
  RE_A_DEFINIR,
  RE_DATA,
  RE_HORARIO,
  RE_SEM_DATA,
  RE_TURMA,
  VARIAVEIS,
  detectarFamilia,
  formatarHorario,
  normalizarModalidade,
  opcionaisDaFamilia,
} from "./layouts.mjs";

// PDFs com menos texto que isto são tratados como design exportado em imagem:
// não dá para extrair nada e o arquivo vai para revisão manual em branco.
const MIN_TEXTO = 80;

// Dois fragmentos estão na mesma linha visual se seus centros verticais ficam
// dentro desta distância. 6pt cobre a variação de baseline entre fontes de
// tamanhos diferentes na mesma linha (disciplina 16pt vs. data 15pt).
const TOLERANCIA_LINHA = 6;

// Colunas da tabela são detectadas agrupando os centros horizontais das células
// âncora. Precisa ser generoso porque a célula é centralizada e "Presencial" é
// bem mais larga que "EAD" — no acervo a diferença chega a 25pt.
const TOLERANCIA_COLUNA = 120;

// Separação horizontal entre os cards da página de apresentação. Medido no
// acervo: dentro de um card os fragmentos ficam a menos de 25pt uns dos outros,
// entre cards vizinhos o salto é de 167 a 198pt. 60 fica folgado nos dois lados.
const SALTO_ENTRE_CARDS = 60;

/**
 * Lê o PDF e devolve, por página, os fragmentos de texto com posição absoluta.
 * O eixo y é invertido para crescer de cima para baixo, que é a ordem de
 * leitura e deixa toda a lógica abaixo mais direta.
 */
async function lerPaginas(caminho) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(caminho)),
    useSystemFonts: true,
  }).promise;

  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const { width, height } = pagina.getViewport({ scale: 1 });
    const conteudo = await pagina.getTextContent();

    const itens = conteudo.items
      .filter((item) => item.str && item.str.trim())
      .map((item) => ({
        texto: item.str.trim(),
        x: item.transform[4],
        y: height - item.transform[5],
        largura: item.width,
        fim: item.transform[4] + item.width,
        centroX: item.transform[4] + item.width / 2,
      }))
      .sort((a, b) => a.y - b.y || a.x - b.x);

    paginas.push({ numero: n, largura: width, altura: height, itens });
  }
  return paginas;
}

/**
 * Agrupa fragmentos em linhas visuais e ordena cada linha da esquerda para a
 * direita.
 *
 * Ordenar só por y não serve: células da mesma linha da tabela costumam ter
 * baselines com décimos de ponto de diferença (numa linha do acervo a data está
 * em y=332,8 e o nome da disciplina em y=333,6), e aí a data seria lida antes do
 * nome, invertendo a frase.
 */
function agruparEmLinhas(fragmentos) {
  const ordenados = [...fragmentos].sort((a, b) => a.y - b.y || a.x - b.x);
  const linhas = [];
  for (const item of ordenados) {
    const ultima = linhas[linhas.length - 1];
    if (ultima && Math.abs(ultima.y - item.y) <= TOLERANCIA_LINHA) {
      ultima.partes.push(item);
    } else {
      linhas.push({ y: item.y, partes: [item] });
    }
  }
  for (const linha of linhas) linha.partes.sort((a, b) => a.x - b.x);
  return linhas;
}

/** Junta fragmentos numa string, linha a linha. */
function juntar(fragmentos) {
  return agruparEmLinhas(fragmentos)
    .map((linha) =>
      linha.partes
        .map((item, i) => {
          // O Canva às vezes destaca a primeira letra de um título num
          // fragmento próprio ("P" + "ROCEDIMENTOS"). Isso é geometricamente
          // indistinguível de um espaço normal — medi os dois casos no acervo e
          // ambos dão 0,01pt de folga —, então o critério é textual: uma
          // maiúscula sozinha abrindo a linha, seguida de mais maiúsculas.
          const anterior = linha.partes[i - 1];
          const letraDestacada =
            i === 1 &&
            /^\p{Lu}$/u.test(anterior.texto) &&
            /^\p{Lu}{2,}/u.test(item.texto);
          return i > 0 && !letraDestacada ? ` ${item.texto}` : item.texto;
        })
        .join(""),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Agrupa os fragmentos de uma página em linhas visuais. */
function linhasDaPagina(pagina) {
  return agruparEmLinhas(pagina.itens).map((linha) => ({
    y: linha.y,
    texto: juntar(linha.partes),
  }));
}

function textoDaPagina(pagina) {
  return linhasDaPagina(pagina)
    .map((l) => l.texto)
    .join("\n");
}

/**
 * Agrupa valores próximos. Abre um grupo novo sempre que o salto para o valor
 * seguinte passa da tolerância — é o que separa as colunas tanto da tabela
 * quanto dos cards.
 */
function agrupar(valores, tolerancia) {
  const ordenados = [...valores].sort((a, b) => a - b);
  const grupos = [];
  for (const valor of ordenados) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && valor - ultimo[ultimo.length - 1] <= tolerancia) {
      ultimo.push(valor);
    } else {
      grupos.push([valor]);
    }
  }
  return grupos.map((g) => ({
    centro: g.reduce((s, v) => s + v, 0) / g.length,
    minimo: g[0],
    maximo: g[g.length - 1],
    membros: g,
  }));
}

function mediana(numeros) {
  if (!numeros.length) return 0;
  const ordenados = [...numeros].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2
    ? ordenados[meio]
    : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

/** Separa o nome da disciplina de uma data em aberto grudada no fim dele. */
function separarDataEmAberto(nome) {
  if (RE_A_DEFINIR.test(nome)) {
    return { nome: nome.replace(RE_A_DEFINIR, "").trim(), data: DATA_A_DEFINIR };
  }
  return { nome, data: null };
}

/**
 * Reconstrói a tabela de disciplinas de uma página.
 *
 * A estratégia é ancorar nas células de modalidade ("Presencial", "EAD",
 * "Ao Vivo"): são as únicas com vocabulário fechado, então localizá-las é
 * confiável. Cada âncora define uma linha, e os limites verticais da linha saem
 * dos pontos médios entre âncoras vizinhas — isso se adapta sozinho a linhas de
 * alturas diferentes, já que um nome que quebra em três linhas ocupa bem mais
 * espaço que os vizinhos.
 *
 * Cobre as duas famílias sem tratamento especial: a pós-graduação usa duas
 * metades lado a lado e a capacitação uma tabela centralizada única. O número de
 * metades sai do agrupamento horizontal das âncoras.
 */
function extrairDisciplinas(pagina) {
  const ancoras = pagina.itens
    .map((item) => ({ item, modalidade: normalizarModalidade(item.texto) }))
    .filter((a) => a.modalidade);

  if (!ancoras.length) {
    return { disciplinas: [], consumidos: new Set(), topoTabela: pagina.altura };
  }

  const colunas = agrupar(
    ancoras.map((a) => a.item.centroX),
    TOLERANCIA_COLUNA,
  );

  const disciplinas = [];
  const consumidos = new Set();
  let topoTabela = pagina.altura;

  // Metades da esquerda para a direita: é a ordem de leitura do documento.
  for (const coluna of colunas) {
    const daColuna = ancoras
      .filter((a) => coluna.membros.includes(a.item.centroX))
      .sort((a, b) => a.item.y - b.item.y);

    // Onde esta metade termina. O limite é a borda esquerda da célula de
    // modalidade da metade seguinte — e não o ponto médio entre as duas, que
    // cortaria a coluna de datas desta metade: na pós-graduação a data fica a
    // 640pt enquanto o meio entre as âncoras cai em 441pt.
    const proxima = colunas.find((c) => c.centro > coluna.centro);
    const inicioDaProxima = proxima
      ? Math.min(
          ...ancoras
            .filter((a) => proxima.membros.includes(a.item.centroX))
            .map((a) => a.item.x),
        )
      : pagina.largura;
    const limiteDireito = inicioDaProxima;

    // Altura típica de linha, usada para limitar a primeira e a última: sem
    // isso o título da página seria absorvido pela primeira linha da tabela.
    const alturas = daColuna
      .slice(1)
      .map((a, i) => a.item.y - daColuna[i].item.y);
    const alturaTipica = mediana(alturas) || pagina.altura;

    for (let i = 0; i < daColuna.length; i++) {
      const ancora = daColuna[i];
      const anteriorY = daColuna[i - 1]?.item.y;
      const proximaY = daColuna[i + 1]?.item.y;

      const topo = anteriorY
        ? (anteriorY + ancora.item.y) / 2
        : ancora.item.y - alturaTipica / 2;
      const base = proximaY
        ? (ancora.item.y + proximaY) / 2
        : ancora.item.y + alturaTipica;

      if (i === 0) topoTabela = Math.min(topoTabela, topo);

      const naLinha = pagina.itens.filter(
        (item) =>
          item !== ancora.item &&
          item.y > topo &&
          item.y <= base &&
          item.centroX < limiteDireito &&
          item.centroX > ancora.item.centroX,
      );

      const partesData = [];
      const partesNome = [];
      for (const item of naLinha) {
        if (RE_DATA.test(item.texto) || RE_SEM_DATA.test(item.texto)) {
          partesData.push(item);
        } else {
          partesNome.push(item);
        }
      }

      // Uma âncora sem nada à direita não é linha de tabela — é outra ocorrência
      // da palavra no layout (um card da página de apresentação, por exemplo).
      if (!partesNome.length) continue;

      const bruto = juntar(partesNome);
      const comData = separarDataEmAberto(bruto);
      const dataExplicita = partesData.find((p) => RE_DATA.test(p.texto));

      disciplinas.push({
        modalidade: ancora.modalidade,
        nome: comData.nome,
        data: dataExplicita ? dataExplicita.texto : comData.data,
      });

      consumidos.add(ancora.item);
      for (const item of naLinha) consumidos.add(item);
    }
  }

  // Linhas sem célula de modalidade — os estágios da pós de enfermagem são
  // assim. Ancoram na data em vez da modalidade.
  for (const linha of linhasDaPagina(pagina)) {
    const partes = pagina.itens.filter(
      (item) =>
        Math.abs(item.y - linha.y) <= TOLERANCIA_LINHA && !consumidos.has(item),
    );
    if (!partes.length) continue;

    const bruto = juntar(partes);
    const comData = separarDataEmAberto(bruto);
    if (!comData.data || !comData.nome) continue;

    disciplinas.push({ modalidade: null, nome: comData.nome, data: comData.data });
    for (const item of partes) consumidos.add(item);
  }

  return { disciplinas, consumidos, topoTabela };
}

/**
 * Isola cada card da página de apresentação numa coluna própria.
 *
 * Sem isso nada funciona: o texto da página, lido linha a linha, intercala os
 * sete cards ("O cronograma | Aula prática das | de estudos será"), e frases que
 * quebram em várias linhas dentro de um card — como "conta com 12 encontros" —
 * ficam impossíveis de casar por regex.
 */
function colunasDeCards(pagina, limiteInferior) {
  const corpo = pagina.itens.filter((item) => item.y < limiteInferior);
  if (!corpo.length) return [];

  return agrupar(
    corpo.map((item) => item.centroX),
    SALTO_ENTRE_CARDS,
  ).map((coluna) => {
    const fragmentos = corpo.filter((item) =>
      coluna.membros.includes(item.centroX),
    );
    return { centro: coluna.centro, texto: juntar(fragmentos) };
  });
}

/** Bullets da caixa "Informações importantes". */
function extrairAvisos(pagina, yAvisos) {
  if (yAvisos == null) return [];

  // O Canva repete o mesmo bullet uma vez por coluna do layout; o Set desfaz
  // essa duplicação sem alterar a ordem.
  const vistos = new Set();
  const avisos = [];
  for (const linha of linhasDaPagina(pagina)) {
    if (linha.y <= yAvisos) continue;
    for (const pedaco of linha.texto.split(/•/)) {
      const limpo = pedaco.replace(/^[·\-\s]+/, "").trim();
      if (!limpo || vistos.has(limpo)) continue;
      vistos.add(limpo);
      avisos.push(limpo);
    }
  }
  return avisos;
}

function extrairVariaveis(textosDeCards, faltando) {
  const variaveis = {};

  for (const [nome, { padrao, converter }] of Object.entries(VARIAVEIS)) {
    let valor = null;
    for (const texto of textosDeCards) {
      const achado = texto.match(padrao);
      if (achado) {
        valor = converter(achado);
        break;
      }
    }
    variaveis[nome] = valor;
    if (valor == null) faltando.push(nome);
  }

  const horarios = [];
  for (const texto of textosDeCards) {
    for (const achado of texto.matchAll(RE_HORARIO)) {
      const formatado = formatarHorario(achado);
      if (!horarios.includes(formatado)) horarios.push(formatado);
    }
  }
  // A capacitação declara dois horários (aula ao vivo e aula prática); a
  // pós-graduação, um só. O primeiro é sempre o do encontro principal.
  variaveis.horarioPresencial = horarios[0] ?? null;
  variaveis.horarioAoVivo = horarios[1] ?? null;
  if (!horarios.length) faltando.push("horarioPresencial");

  return variaveis;
}

/**
 * Lê o cabeçalho da página do cronograma. A ordem dos elementos varia entre
 * arquivos — há quem escreva "CRONOGRAMA / PÓS-GRADUAÇÃO / Nome do curso" e
 * quem escreva "PÓS-GRADUAÇÃO / CRONOGRAMA Nome do curso- 10/2026" —, então
 * nada é lido por posição: descontam-se os elementos conhecidos e o que sobra
 * é o nome do curso.
 */
function extrairCabecalho(pagina, topoTabela) {
  if (!pagina) return { curso: null, modalidadeTitulo: null };

  // O corte é geométrico, na borda superior da primeira linha da tabela. Cortar
  // por padrão de texto não serve: a primeira linha da tabela costuma começar
  // com a quebra do nome de uma disciplina, sem modalidade nem data nela, e
  // esse pedaço acabaria grudado no nome do curso.
  const cabecalho = linhasDaPagina(pagina).filter((l) => l.y < topoTabela);

  let modalidadeTitulo = null;
  const restos = [];

  for (const linha of cabecalho) {
    let texto = linha.texto;

    // "CRONOGRAMA" pode estar sozinho numa linha ou colado no nome do curso.
    texto = texto.replace(/^\s*cronograma\b\s*/i, "").trim();

    const familia = detectarFamilia(texto);
    if (familia && texto.replace(FAMILIAS[familia].deteccao, "").trim() === "") {
      modalidadeTitulo = texto;
      continue;
    }

    if (texto) restos.push(texto);
  }

  const curso =
    restos
      .join(" ")
      // Vários arquivos trazem o código da turma colado no nome
      // ("ENFERMAGEM OBSTÉTRICA- 10/2026").
      .replace(/\s*[-–—]?\s*\d{2}\/\d{4}\s*$/, "")
      .replace(/\s+/g, " ")
      .trim() || null;

  return { curso, modalidadeTitulo };
}

/**
 * Extrai um cronograma de um PDF já diagramado (hoje, os arquivos feitos no
 * Canva). Nunca lança por conteúdo inesperado: o que não for encontrado volta
 * como null e listado em _meta.camposNaoEncontrados, para a tela de revisão
 * destacar.
 */
export async function extrairDePdf(caminho) {
  const paginas = await lerPaginas(caminho);
  const textos = paginas.map(textoDaPagina);
  const textoCompleto = textos.join("\n");

  if (textoCompleto.trim().length < MIN_TEXTO) {
    return {
      tipo: null,
      curso: null,
      disciplinas: [],
      _meta: {
        origem: "pdf",
        confianca: "nenhuma",
        camposNaoEncontrados: [],
        avisos: [
          "PDF sem camada de texto extraível — provavelmente um design exportado " +
            "como imagem. Preencha os dados manualmente na revisão.",
        ],
      },
    };
  }

  // Identificação por conteúdo, não por número nem por cabeçalho: o cronograma
  // pode ocupar mais de uma página (a pós de enfermagem usa duas) e o cabeçalho
  // varia entre arquivos — em alguns "CRONOGRAMA" vem colado no nome do curso e
  // a modalidade aparece antes, não depois.
  const indiceApresentacao = paginas
    .map((_, i) => i)
    .find((i) => /informa[çc][õo]es\s+importantes/i.test(textos[i]));

  // A palavra "Presencial" aparece solta em cards da apresentação, então uma
  // âncora sozinha não basta para caracterizar uma tabela.
  const indicesCronograma = paginas
    .map((_, i) => i)
    .filter(
      (i) =>
        i !== indiceApresentacao &&
        paginas[i].itens.filter((item) => normalizarModalidade(item.texto))
          .length >= 2,
    );

  const paginasCronograma = indicesCronograma.map((i) => paginas[i]);
  const paginaApresentacao =
    indiceApresentacao != null ? paginas[indiceApresentacao] : null;

  const faltando = [];
  const avisos = [];

  const tipo = detectarFamilia(textoCompleto);
  if (!tipo) faltando.push("tipo");

  // O cronograma pode continuar em páginas seguintes.
  const disciplinas = [];
  let topoTabela = null;
  for (const pagina of paginasCronograma) {
    const tabela = extrairDisciplinas(pagina);
    disciplinas.push(...tabela.disciplinas);
    if (topoTabela == null) topoTabela = tabela.topoTabela;
  }
  if (!disciplinas.length) faltando.push("disciplinas");

  // O cabeçalho tem três elementos em ordem variável: a palavra "CRONOGRAMA",
  // o nome da modalidade e o nome do curso — que pode quebrar em várias linhas.
  // Em vez de assumir posições, lê-se tudo acima da tabela e desconta-se o que
  // é conhecido; o que sobra é o nome do curso.
  const { curso, modalidadeTitulo } = extrairCabecalho(
    paginasCronograma[0],
    topoTabela ?? 0,
  );
  if (!curso) faltando.push("curso");

  let variaveis = {};
  let cardsExtraidos = [];
  let listaAvisos = [];
  let codigoTurma = null;

  if (paginaApresentacao) {
    const cabecalhoAvisos = paginaApresentacao.itens.find((item) =>
      /informa[çc][õo]es\s+importantes/i.test(item.texto),
    );
    const yAvisos = cabecalhoAvisos ? cabecalhoAvisos.y : null;

    cardsExtraidos = colunasDeCards(
      paginaApresentacao,
      yAvisos ?? paginaApresentacao.altura,
    );

    listaAvisos = extrairAvisos(paginaApresentacao, yAvisos);

    // A caixa de avisos entra junto na busca das variáveis: é lá que moram o
    // limite de faltas e a capacidade da turma, não nos cards.
    variaveis = extrairVariaveis(
      [...cardsExtraidos.map((c) => c.texto), ...listaAvisos],
      faltando,
    );

    // Endereço vem do card inteiro, não de regex: é texto livre sem marcador
    // estável. É sempre o card mais à direita do layout. O texto da coluna
    // começa com o número do card e o rótulo ("07 ENDEREÇO ..."), que saem fora.
    const ultimo = cardsExtraidos[cardsExtraidos.length - 1];
    variaveis.endereco = ultimo
      ? ultimo.texto
          .replace(/^\s*\d{1,2}\s+/, "")
          .replace(/^ENDERE[ÇC]O\s*/i, "")
          .trim() || null
      : null;
    if (!variaveis.endereco) faltando.push("endereco");

    codigoTurma =
      paginaApresentacao.itens.find((item) => RE_TURMA.test(item.texto))
        ?.texto ?? null;
  } else {
    avisos.push(
      "Página de apresentação não encontrada — só o cronograma foi extraído.",
    );
    variaveis = extrairVariaveis([], faltando);
    variaveis.endereco = null;
    faltando.push("endereco");
  }

  if (!codigoTurma) faltando.push("turma.codigo");

  const textoApresentacao =
    indiceApresentacao != null ? textos[indiceApresentacao] : textoCompleto;
  const diaSemana =
    DIAS_SEMANA.find((dia) =>
      new RegExp(`\\b${dia}\\b`, "i").test(textoApresentacao),
    ) ?? null;
  if (!diaSemana) faltando.push("turma.diaSemana");

  // Ausências esperadas para a família não contam como falha de extração.
  const opcionais = opcionaisDaFamilia(tipo);
  const naoEncontrados = faltando.filter((campo) => !opcionais.includes(campo));

  return {
    tipo,
    curso,
    modalidadeTitulo,
    turma: { codigo: codigoTurma, diaSemana },
    variaveis,
    avisos: listaAvisos,
    disciplinas,
    _meta: {
      origem: "pdf",
      confianca: naoEncontrados.length === 0 ? "alta" : "parcial",
      camposNaoEncontrados: naoEncontrados,
      camposOpcionaisVazios: faltando.filter((campo) =>
        opcionais.includes(campo),
      ),
      paginas: paginas.length,
      paginasCronograma: indicesCronograma.map((i) => i + 1),
      cardsExtraidos: cardsExtraidos.map((c) => c.texto),
      avisos,
    },
  };
}
