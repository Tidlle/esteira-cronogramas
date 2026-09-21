// Interface da esteira: envio → revisão → PDF.
//
// Os dados extraídos ficam num único objeto (`dados`), no mesmo formato que o
// servidor devolve e espera de volta. Tudo na tela é leitura ou escrita nele.

const MODALIDADES = ["Presencial", "Ao Vivo", "EAD", "Online", "Híbrido"];

// Endereços que já apareceram no acervo, oferecidos como sugestão para evitar
// erro de digitação. Não restringem: o campo continua aceitando texto livre.
const ENDERECOS_CONHECIDOS = [
  "COLÉGIO GRATITUDE AVENIDA MARECHAL DEODORO, 53 – SANTOS",
  "RUA LAGOA TAÍ GRANDE, 91 – ITAQUERA / SP",
];

const ROTULOS = {
  tipo: "Tipo de cronograma",
  curso: "Curso",
  disciplinas: "Disciplinas",
  "turma.codigo": "Turma",
  "turma.diaSemana": "Dia da semana",
  encontros: "Encontros presenciais",
  horarioPresencial: "Horário das aulas presenciais",
  horarioAoVivo: "Horário das aulas ao vivo",
  intervalo: "Intervalo",
  endereco: "Endereço",
  capacidadeMaxima: "Capacidade máxima",
  limiteFaltas: "Limite de faltas",
};

let dados = null;
let urlPdf = null;

const $ = (seletor) => document.querySelector(seletor);
const etapas = {
  envio: $("#etapa-envio"),
  revisao: $("#etapa-revisao"),
  resultado: $("#etapa-resultado"),
};

function mostrarEtapa(nome) {
  for (const [chave, secao] of Object.entries(etapas)) {
    secao.hidden = chave !== nome;
  }
  window.scrollTo({ top: 0 });
}

function mostrarErro(elemento, mensagem) {
  elemento.textContent = mensagem;
  elemento.hidden = !mensagem;
}

/** Lê ou grava um valor por caminho com pontos ("turma.codigo"). */
function valorEm(objeto, caminho) {
  return caminho.split(".").reduce((atual, parte) => atual?.[parte], objeto);
}

function definirEm(objeto, caminho, valor) {
  const partes = caminho.split(".");
  let atual = objeto;
  for (const parte of partes.slice(0, -1)) {
    atual[parte] ??= {};
    atual = atual[parte];
  }
  atual[partes[partes.length - 1]] = valor;
}

/* --- envio --------------------------------------------------------------- */

const areaSolta = $("#area-solta");
const campoArquivo = $("#campo-arquivo");
const envioErro = $("#envio-erro");
const envioCarregando = $("#envio-carregando");

campoArquivo.addEventListener("change", () => {
  if (campoArquivo.files[0]) enviar(campoArquivo.files[0]);
});

for (const evento of ["dragenter", "dragover"]) {
  areaSolta.addEventListener(evento, (e) => {
    e.preventDefault();
    areaSolta.classList.add("solta--ativa");
  });
}

for (const evento of ["dragleave", "drop"]) {
  areaSolta.addEventListener(evento, (e) => {
    e.preventDefault();
    areaSolta.classList.remove("solta--ativa");
  });
}

areaSolta.addEventListener("drop", (e) => {
  const arquivo = e.dataTransfer?.files?.[0];
  if (arquivo) enviar(arquivo);
});

async function enviar(arquivo) {
  mostrarErro(envioErro, "");
  envioCarregando.hidden = false;

  const corpo = new FormData();
  corpo.append("arquivo", arquivo);

  try {
    const resposta = await fetch("/api/extrair", { method: "POST", body: corpo });
    const retorno = await resposta.json();

    if (!resposta.ok) {
      mostrarErro(envioErro, retorno.erro ?? "Não foi possível ler o arquivo.");
      return;
    }

    dados = retorno.dados;
    normalizarDados();
    montarRevisao();
    mostrarEtapa("revisao");
    atualizarPrevia();
  } catch (erro) {
    mostrarErro(envioErro, `Falha na comunicação com o servidor: ${erro.message}`);
  } finally {
    envioCarregando.hidden = true;
    campoArquivo.value = "";
  }
}

/** Garante que os campos existam, mesmo que a extração não os tenha achado. */
function normalizarDados() {
  dados.turma ??= {};
  dados.variaveis ??= {};
  dados.disciplinas ??= [];
  dados._meta ??= {};
}

/* --- revisão -------------------------------------------------------------- */

const camposForm = [...document.querySelectorAll("[data-caminho]")];
const corpoDisciplinas = $("#linhas-disciplinas");
const revisaoAvisos = $("#revisao-avisos");
const revisaoErro = $("#revisao-erro");

$("#enderecos-conhecidos").innerHTML = ENDERECOS_CONHECIDOS.map(
  (endereco) => `<option value="${endereco}"></option>`,
).join("");

function montarRevisao() {
  const faltando = new Set(dados._meta.camposNaoEncontrados ?? []);

  for (const campo of camposForm) {
    const caminho = campo.dataset.caminho;
    const valor = valorEm(dados, caminho);
    campo.value = valor ?? "";

    // O extrator nomeia os campos de duas formas ("endereco" e
    // "variaveis.endereco"), conforme a origem; a marca considera as duas.
    const curto = caminho.replace(/^variaveis\./, "");
    campo.closest(".campo").classList.toggle(
      "campo--faltando",
      faltando.has(caminho) || faltando.has(curto),
    );
  }

  montarAvisos(faltando);
  montarDisciplinas();
}

function montarAvisos(faltando) {
  const blocos = [];

  const doExtrator = dados._meta.avisos ?? [];
  if (doExtrator.length) {
    blocos.push(
      `<div class="alerta alerta--atencao"><ul>${doExtrator
        .map((aviso) => `<li>${escapar(aviso)}</li>`)
        .join("")}</ul></div>`,
    );
  }

  if (faltando.size) {
    const nomes = [...faltando].map(
      (campo) => ROTULOS[campo] ?? ROTULOS[campo.replace(/^variaveis\./, "")] ?? campo,
    );
    blocos.push(
      `<div class="alerta alerta--atencao">` +
        `Estes campos não foram encontrados no arquivo e estão destacados abaixo: ` +
        `<strong>${nomes.map(escapar).join(", ")}</strong>.</div>`,
    );
  }

  revisaoAvisos.innerHTML = blocos.join("");
}

function escapar(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

for (const campo of camposForm) {
  campo.addEventListener("input", () => {
    const caminho = campo.dataset.caminho;
    let valor = campo.value.trim();

    if (campo.type === "number") {
      definirEm(dados, caminho, valor === "" ? null : Number(valor));
    } else {
      definirEm(dados, caminho, valor === "" ? null : valor);
    }

    campo.closest(".campo").classList.remove("campo--faltando");
    agendarPrevia();
  });
}

function montarDisciplinas() {
  corpoDisciplinas.innerHTML = "";
  dados.disciplinas.forEach((disciplina, indice) => {
    corpoDisciplinas.appendChild(linhaDisciplina(disciplina, indice));
  });
  atualizarContagem();
}

function linhaDisciplina(disciplina, indice) {
  const linha = document.createElement("tr");

  const modalidade = document.createElement("select");
  modalidade.innerHTML =
    '<option value="">— sem modalidade —</option>' +
    MODALIDADES.map(
      (nome) =>
        `<option value="${nome}"${disciplina.modalidade === nome ? " selected" : ""}>${nome}</option>`,
    ).join("");
  modalidade.addEventListener("change", () => {
    disciplina.modalidade = modalidade.value || null;
    agendarPrevia();
  });

  const nome = document.createElement("input");
  nome.type = "text";
  nome.value = disciplina.nome ?? "";
  nome.addEventListener("input", () => {
    disciplina.nome = nome.value;
    agendarPrevia();
  });

  const cargaHoraria = document.createElement("input");
  cargaHoraria.type = "text";
  cargaHoraria.placeholder = "40h";
  cargaHoraria.value = disciplina.cargaHoraria ?? "";
  cargaHoraria.addEventListener("input", () => {
    disciplina.cargaHoraria = cargaHoraria.value.trim() || null;
    agendarPrevia();
  });

  const data = document.createElement("input");
  data.type = "text";
  data.placeholder = "dd/mm/aaaa";
  data.value = disciplina.data ?? "";
  data.addEventListener("input", () => {
    disciplina.data = data.value.trim() || null;
    agendarPrevia();
  });

  const acoes = document.createElement("div");
  acoes.className = "acoes-linha";
  acoes.append(
    botaoMini("↑", "Mover para cima", indice === 0, () => mover(indice, -1)),
    botaoMini(
      "↓",
      "Mover para baixo",
      indice === dados.disciplinas.length - 1,
      () => mover(indice, 1),
    ),
    botaoMini("✕", "Remover", false, () => {
      dados.disciplinas.splice(indice, 1);
      montarDisciplinas();
      agendarPrevia();
    }),
  );

  for (const [conteudo, classe] of [
    [modalidade, "col-modalidade"],
    [nome, ""],
    [cargaHoraria, "col-carga"],
    [data, "col-data"],
    [acoes, "col-acoes"],
  ]) {
    const celula = document.createElement("td");
    if (classe) celula.className = classe;
    celula.appendChild(conteudo);
    linha.appendChild(celula);
  }

  return linha;
}

function botaoMini(rotulo, titulo, desabilitado, aoClicar) {
  const botao = document.createElement("button");
  botao.type = "button";
  botao.className = "mini";
  botao.textContent = rotulo;
  botao.title = titulo;
  botao.setAttribute("aria-label", titulo);
  botao.disabled = desabilitado;
  botao.addEventListener("click", aoClicar);
  return botao;
}

function mover(indice, passo) {
  const destino = indice + passo;
  if (destino < 0 || destino >= dados.disciplinas.length) return;
  const [item] = dados.disciplinas.splice(indice, 1);
  dados.disciplinas.splice(destino, 0, item);
  montarDisciplinas();
  agendarPrevia();
}

function atualizarContagem() {
  const total = dados.disciplinas.length;
  $("#contagem-disciplinas").textContent =
    total === 1 ? "(1 disciplina)" : `(${total} disciplinas)`;
}

$("#botao-adicionar").addEventListener("click", () => {
  dados.disciplinas.push({
    modalidade: "Presencial",
    nome: "",
    data: null,
    cargaHoraria: null,
  });
  montarDisciplinas();
  // Leva o cursor direto para o nome da disciplina recém-criada.
  corpoDisciplinas.lastElementChild?.querySelector('input[type="text"]')?.focus();
});

/* --- prévia --------------------------------------------------------------- */

const previa = $("#previa");
const previaEstado = $("#previa-estado");
let temporizador = null;
let geracaoAtual = 0;

function agendarPrevia() {
  previaEstado.textContent = "atualizando…";
  clearTimeout(temporizador);
  // Sem a espera, cada tecla digitada dispararia uma construção no servidor.
  temporizador = setTimeout(atualizarPrevia, 400);
}

async function atualizarPrevia() {
  const geracao = ++geracaoAtual;
  previaEstado.textContent = "atualizando…";

  try {
    const resposta = await fetch("/api/previa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });

    // Uma resposta antiga chegando depois de uma nova sobrescreveria a prévia
    // com conteúdo desatualizado.
    if (geracao !== geracaoAtual) return;

    if (!resposta.ok) {
      const retorno = await resposta.json().catch(() => ({}));
      previaEstado.textContent = retorno.erro ?? "não foi possível montar";
      return;
    }

    previa.srcdoc = await resposta.text();
    previaEstado.textContent = "";
  } catch (erro) {
    if (geracao === geracaoAtual) previaEstado.textContent = "sem conexão";
  }
}

/* --- geração do PDF -------------------------------------------------------- */

const botaoGerar = $("#botao-gerar");

botaoGerar.addEventListener("click", async () => {
  mostrarErro(revisaoErro, "");
  botaoGerar.disabled = true;
  botaoGerar.textContent = "Gerando…";

  try {
    const resposta = await fetch("/api/gerar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });

    if (!resposta.ok) {
      const retorno = await resposta.json().catch(() => ({}));
      mostrarErro(revisaoErro, retorno.erro ?? "Não foi possível gerar o PDF.");
      return;
    }

    const avisos = decodeURIComponent(resposta.headers.get("X-Avisos") ?? "");
    const blob = await resposta.blob();

    if (urlPdf) URL.revokeObjectURL(urlPdf);
    urlPdf = URL.createObjectURL(blob);

    const nome = nomeDoPdf(resposta.headers.get("Content-Disposition"));
    const link = $("#link-download");
    link.href = urlPdf;
    link.download = nome;

    $("#resultado-nome").textContent = `${nome} · ${(blob.size / 1024).toFixed(0)} KB`;
    $("#resultado-avisos").innerHTML = avisos
      ? `<div class="alerta alerta--atencao">${escapar(avisos)}</div>`
      : "";

    mostrarEtapa("resultado");
    link.click();
  } catch (erro) {
    mostrarErro(revisaoErro, `Falha na comunicação com o servidor: ${erro.message}`);
  } finally {
    botaoGerar.disabled = false;
    botaoGerar.textContent = "Gerar PDF";
  }
});

function nomeDoPdf(cabecalho) {
  const comAcento = /filename\*=UTF-8''([^;]+)/.exec(cabecalho ?? "");
  if (comAcento) return decodeURIComponent(comAcento[1]);
  const simples = /filename="([^"]+)"/.exec(cabecalho ?? "");
  return simples ? simples[1] : "cronograma.pdf";
}

/* --- navegação ------------------------------------------------------------- */

$("#botao-voltar").addEventListener("click", () => mostrarEtapa("envio"));
$("#botao-revisar").addEventListener("click", () => mostrarEtapa("revisao"));
$("#botao-novo").addEventListener("click", () => {
  dados = null;
  mostrarErro(envioErro, "");
  mostrarEtapa("envio");
});
