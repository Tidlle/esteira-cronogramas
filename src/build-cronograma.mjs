import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, "..");

const CSS = fs.readFileSync(path.join(RAIZ, "templates/cronograma.css"), "utf8");
const BOILERPLATE = JSON.parse(
  fs.readFileSync(path.join(RAIZ, "templates/boilerplate.json"), "utf8"),
);
const CAMINHO_LOGO = path.join(RAIZ, "assets/logo-alpha-channel.png");

const RODAPE = "Faculdade de Tecnologia Alpha Channel";

// Ícones desenhados aqui em vez de carregados de um CDN: o gerador de PDF roda
// offline, e um ícone que falha ao carregar deixaria um buraco no cartão.
const ICONES = {
  presenca:
    '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  hospital:
    '<path d="M4 21V6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v15"/><path d="M2 21h20"/><path d="M12 8v6M9 11h6"/>',
  livros:
    '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v15H5.5A1.5 1.5 0 0 0 4 20.5z"/><path d="M4 17.5A1.5 1.5 0 0 1 5.5 16H19"/>',
  plataforma:
    '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  endereco:
    '<path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  gravadas:
    '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 5.5 3.5-5.5 3.5z"/>',
  aovivo:
    '<circle cx="12" cy="12" r="2.5"/><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 16.5a6.4 6.4 0 0 0 0-9"/><path d="M4.5 4.5a10.6 10.6 0 0 0 0 15M19.5 19.5a10.6 10.6 0 0 0 0-15"/>',
  estagio:
    '<rect x="5" y="4" width="14" height="17" rx="1.5"/><path d="M9 4h6v3H9z"/><path d="M9 12h6M9 16h4"/>',
  atencao:
    '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  relogio:
    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
};

const DIAS_ABREVIADOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function escapar(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function icone(nome, classe = "") {
  const traco = ICONES[nome] ?? ICONES.livros;
  return (
    `<svg class="${classe}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${traco}</svg>`
  );
}

/** Substitui os campos entre chaves pelos valores. */
function preencher(texto, valores) {
  return String(texto).replace(/\{(\w+)\}/g, (original, chave) => {
    const valor = valores[chave];
    return valor == null || valor === "" ? original : escapar(valor);
  });
}

/**
 * Degraus de tamanho do nome do curso no cabeçalho. O acervo tem nomes de 17 a
 * 86 caracteres — um tamanho único ou estoura a faixa ou desperdiça espaço.
 */
function degrauDoTitulo(curso) {
  const n = (curso ?? "").length;
  if (n <= 28) return "g";
  if (n <= 45) return "m";
  if (n <= 70) return "p";
  return "pp";
}

function classeDoSelo(modalidade) {
  switch (modalidade) {
    case "Presencial":
      return "selo--presencial";
    case "Ao Vivo":
      return "selo--aovivo";
    case "EAD":
      return "selo--ead";
    default:
      return "selo--outra";
  }
}

/** Dia da semana de uma data dd/mm/aaaa, para conferir se caiu no dia da turma. */
function diaDaSemana(data) {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data ?? "");
  if (!partes) return null;
  const [, dia, mes, ano] = partes;
  const quando = new Date(Number(ano), Number(mes) - 1, Number(dia));
  if (Number.isNaN(quando.getTime())) return null;
  return DIAS_ABREVIADOS[quando.getDay()];
}

/**
 * Campos disponíveis para os textos do boilerplate. Alguns são derivados: o
 * trecho do intervalo, por exemplo, precisa sumir por inteiro quando o curso
 * não tem intervalo, em vez de deixar a frase pela metade.
 */
function camposDoTexto(dados) {
  const v = dados.variaveis ?? {};
  return {
    curso: dados.curso,
    turma: dados.turma?.codigo,
    diaSemana: dados.turma?.diaSemana,
    encontros: v.encontros,
    horarioPresencial: v.horarioPresencial,
    horarioAoVivo: v.horarioAoVivo,
    intervalo: v.intervalo,
    endereco: v.endereco,
    capacidadeMaxima: v.capacidadeMaxima,
    limiteFaltas: v.limiteFaltas,
    intervaloFrase: v.intervalo ? `, com ${v.intervalo} de intervalo` : "",
  };
}

function montarCabecalho(dados, familia, etiqueta, logoEmbutido) {
  const degrau = degrauDoTitulo(dados.curso);
  const marca = logoEmbutido
    ? `<div class="cabecalho__marca"><img src="${logoEmbutido}" alt="Alpha Channel"></div>`
    : "";
  return `
      <header class="cabecalho">
        <div>
          <p class="cabecalho__etiqueta">${escapar(etiqueta)}</p>
          <h1 class="cabecalho__curso cabecalho__curso--${degrau}">${escapar(
            dados.curso ?? "Curso sem nome",
          )}</h1>
        </div>
        ${marca}
      </header>`;
}

function montarApresentacao(dados, familia, campos, logoEmbutido) {
  const ficha = [
    { rotulo: "Turma", valor: campos.turma, destaque: true },
    { rotulo: "Dia", valor: campos.diaSemana },
    { rotulo: "Encontros", valor: campos.encontros },
    { rotulo: "Horário", valor: campos.horarioPresencial },
  ]
    .filter((item) => item.valor != null && item.valor !== "")
    .map(
      (item) => `
          <div class="ficha__item${item.destaque ? " ficha__item--destaque" : ""}">
            <p class="ficha__rotulo">${escapar(item.rotulo)}</p>
            <p class="ficha__valor">${escapar(item.valor)}</p>
          </div>`,
    )
    .join("");

  // Um cartão condicionado a um campo vazio sai fora, em vez de aparecer com
  // um espaço em branco no lugar do valor.
  const cartoes = (familia.cards ?? []).filter(
    (cartao) => !cartao.condicao || campos[cartao.condicao],
  );

  const htmlCartoes = cartoes
    .map(
      (cartao) => `
          <article class="cartao">
            ${icone(cartao.icone, "cartao__icone")}
            <h2 class="cartao__titulo">${escapar(cartao.titulo)}</h2>
            <p class="cartao__texto">${preencher(cartao.texto, campos)}</p>
          </article>`,
    )
    .join("");

  const avisos = (familia.avisos ?? [])
    .map((aviso) => `<li>${preencher(aviso, campos)}</li>`)
    .join("");

  return `
    <section class="pagina pagina--apresentacao">
      <div class="faixa-inferior"></div>
      <div class="folha">
        ${montarCabecalho(dados, familia, "Apresentação do cronograma", logoEmbutido)}
        <div class="corpo">
          <div class="ficha">${ficha}</div>
          <div class="cartoes${cartoes.length === 5 ? " cartoes--cinco" : ""}">${htmlCartoes}</div>
          <div class="avisos">
            <p class="avisos__titulo">${icone("atencao")} Informações importantes</p>
            <ul class="avisos__lista">${avisos}</ul>
          </div>
        </div>
        <footer class="rodape">
          <span>${RODAPE}</span>
          <span data-numero-pagina></span>
        </footer>
      </div>
    </section>`;
}

/** Selo pequeno com a carga horária, quando informada — "40h" ao lado do nome. */
function seloCargaHoraria(cargaHoraria) {
  if (!cargaHoraria) return "";
  return `<span class="carga-horaria">${icone("relogio")}${escapar(cargaHoraria)}</span>`;
}

function montarLinha(disciplina) {
  const dia = diaDaSemana(disciplina.data);
  const data = disciplina.data
    ? `${escapar(disciplina.data)}${dia ? `<span class="data-dia">${dia}</span>` : ""}`
    : '<span class="data-vazia">—</span>';

  return `<tr>
              <td><span class="selo ${classeDoSelo(disciplina.modalidade)}">${escapar(
                disciplina.modalidade ?? "A definir",
              )}</span></td>
              <td class="celula-nome">${escapar(disciplina.nome)}${seloCargaHoraria(
                disciplina.cargaHoraria,
              )}</td>
              <td class="celula-data">${data}</td>
            </tr>`;
}

/**
 * Esqueleto de uma página de cronograma. O script de paginação clona este
 * bloco quantas vezes forem necessárias.
 */
function moldeCronograma(dados, familia, logoEmbutido) {
  const etiqueta = ["Cronograma", familia.rotulo].filter(Boolean).join(" · ");
  return `
    <section class="pagina pagina--cronograma">
      <div class="faixa-inferior"></div>
      <div class="folha">
        ${montarCabecalho(dados, familia, etiqueta, logoEmbutido)}
        <div class="corpo">
          <div class="quadro">
            <table class="tabela">
              <colgroup>
                <col class="col-modalidade"><col><col class="col-data">
              </colgroup>
              <thead>
                <tr>
                  <th>Modalidade</th>
                  <th class="celula-nome">Disciplina</th>
                  <th class="celula-data">Data</th>
                </tr>
              </thead>
              <tbody data-corpo-tabela></tbody>
            </table>
            <div data-area-ead></div>
          </div>
        </div>
        <footer class="rodape">
          <span>${RODAPE}</span>
          <span data-numero-pagina></span>
        </footer>
      </div>
    </section>`;
}

/**
 * Linha do bloco EAD — mesmo padrão visual da tabela cronológica (selo de
 * modalidade + nome + carga horária), só sem coluna de data. É a mesma classe
 * ".tabela" que dá a linha, o zebrado e a tipografia; a tabela recebe menos
 * colunas via colgroup em vez de ganhar uma coluna de data cheia de traços.
 */
function montarLinhaEad(disciplina) {
  return `<tr>
              <td><span class="selo selo--ead">EAD</span></td>
              <td class="celula-nome">${escapar(disciplina.nome)}${seloCargaHoraria(
                disciplina.cargaHoraria,
              )}</td>
            </tr>`;
}

function montarBlocoEad(disciplinas) {
  if (!disciplinas.length) return "";
  const linhas = disciplinas.map(montarLinhaEad).join("");
  return `
          <section class="bloco-ead">
            <p class="bloco-ead__titulo">Disponíveis na plataforma durante todo o curso</p>
            <table class="tabela tabela--ead">
              <colgroup>
                <col class="col-modalidade"><col>
              </colgroup>
              <tbody>${linhas}</tbody>
            </table>
          </section>`;
}

/**
 * Distribui as linhas em páginas medindo a altura real de cada uma no
 * navegador. Calcular no Node exigiria adivinhar quantas linhas um nome de
 * disciplina ocupa depois de quebrado, e os nomes do acervo vão de 14 a 118
 * caracteres — a estimativa erraria e cortaria a tabela.
 */
const SCRIPT_PAGINACAO = `
  function paginarCronograma() {
    var container = document.getElementById("paginas");
    var molde = document.getElementById("molde-cronograma");
    var linhas = Array.prototype.slice.call(
      document.getElementById("linhas").content.querySelectorAll("tr")
    );
    var htmlEad = document.getElementById("bloco-ead").innerHTML.trim();
    var folhas = [];

    function novaPagina() {
      var pagina = molde.content.cloneNode(true).firstElementChild;
      container.appendChild(pagina);
      var folha = {
        pagina: pagina,
        corpo: pagina.querySelector("[data-corpo-tabela]"),
        quadro: pagina.querySelector(".quadro"),
        areaEad: pagina.querySelector("[data-area-ead]")
      };
      folhas.push(folha);
      return folha;
    }

    function estourou(alvo) {
      // 1px de folga evita que arredondamento de subpixel dispare uma página a
      // mais com a última linha sozinha.
      return alvo.quadro.scrollHeight > alvo.quadro.clientHeight + 1;
    }

    var atual = novaPagina();
    for (var i = 0; i < linhas.length; i++) {
      atual.corpo.appendChild(linhas[i]);
      if (estourou(atual)) {
        atual.corpo.removeChild(linhas[i]);
        // Uma linha que não cabe nem numa página vazia fica onde está: tirá-la
        // de novo geraria páginas vazias em série.
        if (atual.corpo.children.length === 0) {
          atual.corpo.appendChild(linhas[i]);
          continue;
        }
        atual = novaPagina();
        atual.corpo.appendChild(linhas[i]);
      }
    }

    if (htmlEad) {
      atual.areaEad.innerHTML = htmlEad;
      // A tabela divide a altura com o bloco EAD, então inserir o bloco encolhe
      // o quadro e pode cortar as últimas linhas. A conferência tem que ser no
      // quadro: o corpo é flex e nunca acusa estouro — quem cede altura é a
      // tabela, silenciosamente.
      if (estourou(atual)) {
        // A tabela da página nova fica: o balanceamento logo abaixo traz
        // linhas para acompanhar o bloco, em vez de gastar uma folha inteira
        // com meia dúzia de nomes de disciplina.
        atual.areaEad.innerHTML = "";
        atual = novaPagina();
        atual.areaEad.innerHTML = htmlEad;
      }
    }

    // Evita última página órfã: com 15 linhas e 14 cabendo na primeira, a
    // segunda ficava com uma linha só. Puxa linhas da anterior enquanto couberem.
    var ultima = folhas[folhas.length - 1];
    var penultima = folhas[folhas.length - 2];
    if (penultima) {
      while (
        ultima.corpo.children.length < 4 &&
        penultima.corpo.children.length > 4
      ) {
        var movida = penultima.corpo.lastElementChild;
        ultima.corpo.insertBefore(movida, ultima.corpo.firstChild);
        if (estourou(ultima)) {
          ultima.corpo.removeChild(movida);
          penultima.corpo.appendChild(movida);
          break;
        }
      }
    }

    // Se nem assim veio linha nenhuma, a tabela vazia — que seria só um
    // cabeçalho solto — sai, e o bloco EAD perde o filete que não separa nada.
    var blocoEad = ultima.pagina.querySelector(".bloco-ead");
    if (ultima.corpo.children.length === 0) {
      var tabelaVazia = ultima.pagina.querySelector(".tabela");
      if (tabelaVazia) tabelaVazia.remove();
      if (blocoEad) blocoEad.classList.add("bloco-ead--sozinho");
    }

    // Na última página o quadro passa a ter a altura do conteúdo. Esticado até
    // o pé com três ou quatro linhas, ele vira um retângulo branco quase vazio.
    // Se a página estiver cheia, porém, soltar a altura faz o quadro transbordar
    // o corpo — aí fica esticado mesmo.
    var corpoDaUltima = ultima.pagina.querySelector(".corpo");
    ultima.quadro.classList.add("quadro--conteudo");
    if (corpoDaUltima.scrollHeight > corpoDaUltima.clientHeight + 1) {
      ultima.quadro.classList.remove("quadro--conteudo");
    }

    var paginas = container.querySelectorAll(".pagina");
    for (var p = 0; p < paginas.length; p++) {
      var numero = paginas[p].querySelector("[data-numero-pagina]");
      if (numero) numero.textContent = (p + 1) + " de " + paginas.length;
    }
    document.documentElement.setAttribute("data-pronto", "1");
  }

  // A paginação mede alturas de linha, então só pode rodar depois que as fontes
  // estiverem aplicadas: medindo com a fonte de fallback as linhas saem mais
  // baixas, cabe uma a mais por página, e quando a fonte definitiva entra a
  // tabela cresce e a última linha é cortada.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(paginarCronograma);
  } else {
    paginarCronograma();
  }
`;

/**
 * Monta o HTML do cronograma a partir dos dados extraídos.
 *
 * O arquivo sai autocontido — CSS, ícones e logo embutidos —, para poder ser
 * aberto direto no navegador na tela de revisão e convertido em PDF sem
 * depender de nenhum arquivo ao lado.
 */
export function construirHtml(dados, opcoes = {}) {
  const familia = BOILERPLATE[dados.tipo];
  if (!familia) {
    throw new Error(
      `Família de cronograma desconhecida: ${JSON.stringify(dados.tipo)}. ` +
        `Conhecidas: ${Object.keys(BOILERPLATE)
          .filter((c) => !c.startsWith("_"))
          .join(", ")}.`,
    );
  }

  const logoEmbutido =
    opcoes.logo === false || !fs.existsSync(CAMINHO_LOGO)
      ? null
      : `data:image/png;base64,${fs.readFileSync(CAMINHO_LOGO).toString("base64")}`;

  const campos = camposDoTexto(dados);
  const disciplinas = dados.disciplinas ?? [];

  // As disciplinas EAD saem da tabela cronológica: elas não têm data porque
  // ficam liberadas o curso inteiro, e no meio das datadas só geram uma coluna
  // de traços. Uma EAD com data marcada é exceção e fica na tabela.
  const emEad = (d) => d.modalidade === "EAD" && !d.data;
  const naTabela = disciplinas.filter((d) => !emEad(d));
  const soEad = disciplinas.filter(emEad);

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${escapar(
    [dados.curso, dados.turma?.codigo].filter(Boolean).join(" — ") ||
      "Cronograma",
  )}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@600&display=swap" rel="stylesheet">
<style>
${CSS}
</style>
</head>
<body>
<div id="paginas">
${montarApresentacao(dados, familia, campos, logoEmbutido)}
</div>

<template id="molde-cronograma">${moldeCronograma(
    dados,
    familia,
    logoEmbutido,
  )}</template>
<template id="linhas">${naTabela.map(montarLinha).join("")}</template>
<template id="bloco-ead">${montarBlocoEad(soEad)}</template>

<script>${SCRIPT_PAGINACAO}</script>
</body>
</html>
`;

  return html;
}

export function familiasDisponiveis() {
  return Object.keys(BOILERPLATE).filter((chave) => !chave.startsWith("_"));
}
