// Histórico de cronogramas gerados — curso, turma e data/hora de cada PDF
// que saiu de /api/gerar, para a página principal mostrar o que já foi feito.
//
// Guardado num arquivo JSON simples, sem banco: é o mesmo espírito do resto
// do projeto (sem dependência nova, sem servidor externo). O preço dessa
// simplicidade é de conhecimento — ver `persistente()` abaixo.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { emServerless } from "./ambiente.mjs";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Em execução normal (`npm start` ou container), o arquivo mora no projeto e
// sobrevive a reinícios — é o caminho que faz sentido guardar histórico de
// verdade. Em serverless o projeto é somente leitura fora de /tmp, e /tmp não
// é compartilhado nem garantido entre invocações: o arquivo ali só dura
// enquanto a mesma instância ficar quente, e pode sumir a qualquer momento.
const CAMINHO_HISTORICO = emServerless()
  ? path.join(os.tmpdir(), "esteira-cronogramas-historico.json")
  : path.join(RAIZ, "dados", "historico.json");

// Evita o arquivo crescer sem limite num servidor que fica meses no ar.
const MAXIMO_REGISTROS = 200;

/** Verdadeiro quando o histórico deste ambiente é para valer, não um cache
 * de instância que pode sumir a qualquer redeploy ou instância nova. A
 * interface usa isto para avisar quando o que está vendo pode ser parcial. */
export function persistente() {
  return !emServerless();
}

function lerTudo() {
  try {
    const bruto = fs.readFileSync(CAMINHO_HISTORICO, "utf8");
    const dados = JSON.parse(bruto);
    return Array.isArray(dados) ? dados : [];
  } catch {
    // Primeira execução (arquivo ainda não existe) ou arquivo corrompido —
    // nos dois casos o histórico recomeça do zero, em vez de derrubar o
    // servidor ou impedir a geração do PDF.
    return [];
  }
}

/**
 * Registra uma geração de PDF. Nunca lança: o histórico é um extra, e uma
 * falha ao gravar (disco cheio, permissão, o que for) não pode impedir o
 * usuário de baixar o PDF que acabou de pedir.
 */
export function registrarGeracao(entrada) {
  try {
    const registros = lerTudo();
    registros.push({
      curso: entrada.curso ?? null,
      turma: entrada.turma ?? null,
      tipo: entrada.tipo ?? null,
      paginas: entrada.paginas ?? null,
      geradoEm: new Date().toISOString(),
    });

    // Mais recente por último no arquivo, mas corta pelo início — descarta
    // os mais antigos, não os que acabaram de entrar.
    const recortado = registros.slice(-MAXIMO_REGISTROS);

    fs.mkdirSync(path.dirname(CAMINHO_HISTORICO), { recursive: true });
    fs.writeFileSync(CAMINHO_HISTORICO, JSON.stringify(recortado, null, 2));
  } catch (erro) {
    console.error("Não foi possível gravar o histórico de gerações:", erro.message);
  }
}

/** Os últimos `limite` registros, do mais recente para o mais antigo. */
export function listarHistorico(limite = 30) {
  return lerTudo().reverse().slice(0, limite);
}
