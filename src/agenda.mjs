// Sincronização com Google Agenda: toda geração de PDF bem-sucedida cria (ou
// atualiza) um evento por disciplina com data na agenda institucional.
//
// Autenticação por conta de serviço, sem nenhuma biblioteca do Google: o
// pacote oficial (`googleapis`) pesa dezenas de MB para o que precisamos aqui
// — um POST de token e algumas chamadas REST. `crypto` (assinatura RS256 do
// JWT) e `fetch` já bastam.
//
// Idempotência por exclusão e recriação: cada evento carrega, num campo
// privado, uma chave estável do cronograma (curso + turma). A cada geração,
// todos os eventos com essa chave são apagados e recriados do zero — mais
// simples que comparar disciplina a disciplina, e limpa sozinho um evento
// cuja disciplina foi removida ou teve a data alterada na revisão.

import crypto from "node:crypto";

const ESCOPO = "https://www.googleapis.com/auth/calendar";
const URL_TOKEN = "https://oauth2.googleapis.com/token";
const BASE_CALENDAR = "https://www.googleapis.com/calendar/v3";
const CAMPO_CHAVE = "esteiraCronograma";
const FUSO = "America/Sao_Paulo";

function temAgendaConfigurada() {
  return Boolean(
    process.env.GOOGLE_CALENDAR_ID &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
  );
}

function base64url(entrada) {
  const buffer = Buffer.isBuffer(entrada) ? entrada : Buffer.from(entrada);
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Token de acesso via OAuth2 Bearer JWT (RFC 7523) — o fluxo de conta de
 * serviço sem passar por biblioteca nenhuma do Google, só `crypto.sign`.
 */
async function obterTokenAcesso() {
  // Variáveis de ambiente não guardam quebra de linha real; a chave chega com
  // "\n" literal e precisa virar quebra de linha de verdade antes de assinar.
  const chavePrivada = process.env.GOOGLE_SERVICE_ACCOUNT_KEY.replace(/\\n/g, "\n");
  const agora = Math.floor(Date.now() / 1000);

  const cabecalho = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = base64url(
    JSON.stringify({
      iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      scope: ESCOPO,
      aud: URL_TOKEN,
      iat: agora,
      exp: agora + 3600,
    }),
  );
  const assinatura = crypto.sign(
    "RSA-SHA256",
    Buffer.from(`${cabecalho}.${corpo}`),
    chavePrivada,
  );
  const jwt = `${cabecalho}.${corpo}.${base64url(assinatura)}`;

  const resposta = await fetch(URL_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!resposta.ok) {
    throw new Error(`token OAuth2 recusado (${resposta.status}): ${await resposta.text()}`);
  }
  const { access_token: token } = await resposta.json();
  return token;
}

/** Chave estável de um cronograma — o mesmo curso+turma regenerado cai na mesma chave. */
function chaveCronograma(dados) {
  const curso = (dados.curso ?? "").trim();
  const turma = (dados.turma?.codigo ?? "").trim();
  return curso || turma ? `${curso}::${turma}` : null;
}

/** "dd/mm/aaaa" -> "aaaa-mm-dd". Datas fora desse formato (ex. "A definir") viram null. */
function converterData(data) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((data ?? "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function diaSeguinte(dataIso) {
  const data = new Date(`${dataIso}T00:00:00`);
  data.setDate(data.getDate() + 1);
  return data.toISOString().slice(0, 10);
}

/** "08h00 às 15h00" -> horários de início/fim em HH:MM:SS. Formato fora do esperado vira null. */
function converterHorario(horario) {
  const m = /^(\d{1,2})h(\d{2})\s*(?:às|as)\s*(\d{1,2})h(\d{2})$/i.exec(
    (horario ?? "").trim(),
  );
  if (!m) return null;
  const pad = (n) => n.padStart(2, "0");
  return {
    inicio: `${pad(m[1])}:${pad(m[2])}:00`,
    fim: `${pad(m[3])}:${pad(m[4])}:00`,
  };
}

/** O horário do curso relevante pra essa disciplina, conforme a modalidade. */
function horarioDaModalidade(disciplina, variaveis) {
  if (disciplina.modalidade === "Presencial") return variaveis.horarioPresencial;
  if (disciplina.modalidade === "Ao Vivo") return variaveis.horarioAoVivo;
  return null;
}

/**
 * Um evento por disciplina com data — sem data (EAD, "A definir") não vira
 * evento, porque não tem quando ancorar. Com horário reconhecível pro curso e
 * pra modalidade da disciplina, o evento sai com hora marcada; senão, dia
 * inteiro — melhor um evento impreciso do que nenhum.
 */
function montarEvento(disciplina, dados, chave) {
  const dataIso = converterData(disciplina.data);
  if (!dataIso) return null;

  const variaveis = dados.variaveis ?? {};
  const descricao = [
    dados.turma?.codigo ? `Turma ${dados.turma.codigo}` : null,
    disciplina.modalidade,
    disciplina.tipoAula,
    disciplina.cargaHoraria ? `Carga horária: ${disciplina.cargaHoraria}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const evento = {
    summary: disciplina.nome || dados.curso || "Disciplina",
    description: descricao,
    extendedProperties: { private: { [CAMPO_CHAVE]: chave } },
  };

  if (disciplina.modalidade === "Presencial" && variaveis.endereco) {
    evento.location = variaveis.endereco;
  }

  const horario = converterHorario(horarioDaModalidade(disciplina, variaveis));
  if (horario) {
    evento.start = { dateTime: `${dataIso}T${horario.inicio}`, timeZone: FUSO };
    evento.end = { dateTime: `${dataIso}T${horario.fim}`, timeZone: FUSO };
  } else {
    // "end.date" é exclusivo na API do Google — precisa ser o dia seguinte
    // pro evento de dia inteiro cobrir só o dia da disciplina.
    evento.start = { date: dataIso };
    evento.end = { date: diaSeguinte(dataIso) };
  }

  return evento;
}

async function apagarEventosExistentes(token, chave) {
  const calendarId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID);
  const query = new URLSearchParams({
    privateExtendedProperty: `${CAMPO_CHAVE}=${chave}`,
    maxResults: "2500",
  });
  const resposta = await fetch(
    `${BASE_CALENDAR}/calendars/${calendarId}/events?${query}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resposta.ok) {
    throw new Error(`listagem de eventos falhou (${resposta.status}): ${await resposta.text()}`);
  }
  const { items } = await resposta.json();

  await Promise.all(
    (items ?? []).map((item) =>
      fetch(`${BASE_CALENDAR}/calendars/${calendarId}/events/${item.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }),
    ),
  );
}

async function inserirEvento(token, evento) {
  const calendarId = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID);
  const resposta = await fetch(`${BASE_CALENDAR}/calendars/${calendarId}/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(evento),
  });
  if (!resposta.ok) {
    throw new Error(`criação de evento falhou (${resposta.status}): ${await resposta.text()}`);
  }
}

/**
 * Sincroniza os eventos da Google Agenda com as disciplinas do cronograma.
 * Nunca lança: uma falha aqui (agenda não configurada, token recusado, conta
 * de serviço sem acesso à agenda) não pode impedir o usuário de baixar o PDF
 * que acabou de gerar — só fica registrada pra virar aviso na tela.
 */
export async function sincronizarAgenda(dados) {
  if (!temAgendaConfigurada()) return { sincronizado: false };

  const chave = chaveCronograma(dados);
  if (!chave) return { sincronizado: false };

  try {
    const token = await obterTokenAcesso();
    await apagarEventosExistentes(token, chave);

    const eventos = (dados.disciplinas ?? [])
      .map((disciplina) => montarEvento(disciplina, dados, chave))
      .filter(Boolean);

    await Promise.all(eventos.map((evento) => inserirEvento(token, evento)));

    return { sincronizado: true, eventos: eventos.length };
  } catch (erro) {
    console.error("Não foi possível sincronizar com a Google Agenda:", erro.message);
    return { sincronizado: false, erro: erro.message };
  }
}
