// Histórico de cronogramas gerados — curso, turma e data/hora de cada PDF
// que saiu de /api/gerar, para a página principal mostrar o que já foi feito.
//
// Duas fontes possíveis, escolhidas por configuração, nunca misturadas:
//
//   - Redis (Upstash), quando UPSTASH_REDIS_REST_URL/TOKEN existem — a única
//     que é confiável em serverless, porque não depende do disco da função.
//   - Arquivo JSON local, quando não há Redis configurado — é o suficiente
//     para uso local (`npm start`, container) e o padrão de fábrica sem
//     nenhuma configuração extra.
//
// Não há fallback cruzado entre as duas: misturar "Redis normalmente, mas
// cai pro arquivo se falhar" criaria uma segunda fonte de verdade que o lado
// de leitura teria que saber juntar. Mais simples, e fácil de explicar no
// README, é a escolha ser uma coisa ou outra.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { emServerless } from "./ambiente.mjs";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const CAMINHO_ARQUIVO = emServerless()
  ? path.join(os.tmpdir(), "esteira-cronogramas-historico.json")
  : path.join(RAIZ, "dados", "historico.json");

const CHAVE_REDIS = "esteira-cronogramas:historico";

// Evita o histórico crescer sem limite num servidor que fica meses no ar.
const MAXIMO_REGISTROS = 200;

function temRedisConfigurado() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

// Importado sob demanda — só quem configurou o Redis paga o custo de carregar
// o pacote, o resto do projeto nem toca nele.
let clienteRedis = null;
async function obterRedis() {
  if (!clienteRedis) {
    const { Redis } = await import("@upstash/redis");
    // fromEnv() lê exatamente UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN
    // — os nomes que a integração do Upstash no Marketplace da Vercel injeta
    // automaticamente ao conectar o banco ao projeto.
    clienteRedis = Redis.fromEnv();
  }
  return clienteRedis;
}

/**
 * Um item de `lrange` pode chegar como string (JSON bruto) ou já como objeto,
 * dependendo da versão do SDK — não é garantido em qualquer uma das duas
 * direções, então as duas são tratadas em vez de assumir uma só.
 */
function paraObjeto(valor) {
  if (valor == null) return null;
  if (typeof valor === "object") return valor;
  try {
    return JSON.parse(valor);
  } catch {
    return null;
  }
}

/** Verdadeiro quando o histórico deste ambiente é para valer, não um cache
 * que pode sumir a qualquer redeploy ou instância nova. Com Redis
 * configurado isso vale em qualquer ambiente, inclusive serverless — é
 * exatamente o problema que o Redis resolve. */
export function persistente() {
  return temRedisConfigurado() || !emServerless();
}

function lerArquivo() {
  try {
    const bruto = fs.readFileSync(CAMINHO_ARQUIVO, "utf8");
    const dados = JSON.parse(bruto);
    return Array.isArray(dados) ? dados : [];
  } catch {
    // Primeira execução (arquivo ainda não existe) ou arquivo corrompido —
    // nos dois casos o histórico recomeça do zero, em vez de derrubar o
    // servidor ou impedir a geração do PDF.
    return [];
  }
}

function gravarArquivo(registro) {
  try {
    const registros = lerArquivo();
    registros.push(registro);
    const recortado = registros.slice(-MAXIMO_REGISTROS);
    fs.mkdirSync(path.dirname(CAMINHO_ARQUIVO), { recursive: true });
    fs.writeFileSync(CAMINHO_ARQUIVO, JSON.stringify(recortado, null, 2));
  } catch (erro) {
    console.error("Não foi possível gravar o histórico de gerações:", erro.message);
  }
}

/**
 * Registra uma geração de PDF. Nunca lança: o histórico é um extra, e uma
 * falha ao gravar (Redis fora do ar, disco cheio, o que for) não pode
 * impedir o usuário de baixar o PDF que acabou de pedir.
 */
export async function registrarGeracao(entrada) {
  const registro = {
    curso: entrada.curso ?? null,
    turma: entrada.turma ?? null,
    tipo: entrada.tipo ?? null,
    paginas: entrada.paginas ?? null,
    geradoEm: new Date().toISOString(),
  };

  if (temRedisConfigurado()) {
    try {
      const redis = await obterRedis();
      await redis.rpush(CHAVE_REDIS, JSON.stringify(registro));
      // Mantém só os últimos MAXIMO_REGISTROS — os mais antigos saem.
      await redis.ltrim(CHAVE_REDIS, -MAXIMO_REGISTROS, -1);
    } catch (erro) {
      console.error("Não foi possível gravar no Redis:", erro.message);
    }
    return;
  }

  gravarArquivo(registro);
}

/** Os últimos `limite` registros, do mais recente para o mais antigo. */
export async function listarHistorico(limite = 30) {
  if (temRedisConfigurado()) {
    try {
      const redis = await obterRedis();
      const brutos = await redis.lrange(CHAVE_REDIS, -limite, -1);
      return brutos.map(paraObjeto).filter(Boolean).reverse();
    } catch (erro) {
      console.error("Não foi possível ler o histórico do Redis:", erro.message);
      return [];
    }
  }

  return lerArquivo().reverse().slice(0, limite);
}
