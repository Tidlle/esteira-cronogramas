// Teste ponta a ponta do servidor: sobe numa porta livre, percorre todas as
// rotas com arquivos reais e derruba no fim.
//
//   node scripts/testar-servidor.mjs [arquivo.pdf]

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, "..");

const PDF_PADRAO =
  process.argv[2] ??
  "C:/Users/Administrador/Downloads/CRONOGRAMA - GESTÃO HOSPITALAR - 09.2026.pdf";
const DOCX_MODELO = path.join(RAIZ, "modelos/MODELO-CRONOGRAMA.docx");
const PORTA = 3999;
const BASE = `http://127.0.0.1:${PORTA}`;

let falhas = 0;

function checar(condicao, descricao, detalhe = "") {
  if (condicao) {
    console.log(`ok     ${descricao}`);
  } else {
    falhas++;
    console.log(`FALHA  ${descricao}${detalhe ? `\n       ${detalhe}` : ""}`);
  }
}

const servidor = spawn(process.execPath, [path.join(RAIZ, "server.mjs")], {
  cwd: RAIZ,
  env: { ...process.env, PORT: String(PORTA), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});

const saidaServidor = [];
servidor.stdout.on("data", (d) => saidaServidor.push(d.toString()));
servidor.stderr.on("data", (d) => saidaServidor.push(d.toString()));

/** Espera a porta responder em vez de dormir um tempo fixo. */
async function esperarSubir(tentativas = 60) {
  for (let i = 0; i < tentativas; i++) {
    try {
      await fetch(BASE, { signal: AbortSignal.timeout(500) });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
}

async function enviarArquivo(caminho) {
  const corpo = new FormData();
  corpo.append(
    "arquivo",
    new Blob([fs.readFileSync(caminho)]),
    path.basename(caminho),
  );
  const resposta = await fetch(`${BASE}/api/extrair`, {
    method: "POST",
    body: corpo,
  });
  return { resposta, retorno: await resposta.json() };
}

try {
  if (!(await esperarSubir())) {
    console.error("O servidor não subiu.\n" + saidaServidor.join(""));
    process.exit(1);
  }

  // --- página inicial
  const inicial = await fetch(BASE);
  const htmlInicial = await inicial.text();
  checar(
    inicial.ok && htmlInicial.includes("Esteira de cronogramas"),
    "GET / devolve a interface",
  );

  // --- modelo .docx
  const modelo = await fetch(`${BASE}/api/modelo`);
  checar(
    modelo.ok &&
      (modelo.headers.get("content-type") ?? "").includes("word"),
    "GET /api/modelo devolve o .docx",
    `status ${modelo.status}, tipo ${modelo.headers.get("content-type")}`,
  );

  // --- extração de PDF
  const pdfEntrada = await enviarArquivo(PDF_PADRAO);
  checar(
    pdfEntrada.resposta.ok && pdfEntrada.retorno.dados?.disciplinas?.length > 0,
    "POST /api/extrair lê um .pdf",
    JSON.stringify(pdfEntrada.retorno).slice(0, 160),
  );

  const dados = pdfEntrada.retorno.dados;

  // --- extração de .docx
  if (fs.existsSync(DOCX_MODELO)) {
    const docxEntrada = await enviarArquivo(DOCX_MODELO);
    checar(
      docxEntrada.resposta.ok && docxEntrada.retorno.dados?.curso,
      "POST /api/extrair lê um .docx",
      JSON.stringify(docxEntrada.retorno).slice(0, 160),
    );
  }

  // --- formato recusado
  const recusa = new FormData();
  recusa.append("arquivo", new Blob(["nada"]), "anotacoes.txt");
  const respostaRecusa = await fetch(`${BASE}/api/extrair`, {
    method: "POST",
    body: recusa,
  });
  const retornoRecusa = await respostaRecusa.json();
  checar(
    respostaRecusa.status === 400 && /não suportado/i.test(retornoRecusa.erro),
    "POST /api/extrair recusa formato inválido",
    `status ${respostaRecusa.status}: ${retornoRecusa.erro}`,
  );

  // --- prévia
  const previa = await fetch(`${BASE}/api/previa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  });
  const htmlPrevia = await previa.text();
  checar(
    previa.ok && htmlPrevia.includes("<!DOCTYPE html>") && htmlPrevia.includes(dados.curso),
    "POST /api/previa devolve o HTML do cronograma",
  );

  // --- prévia com tipo inválido
  const previaRuim = await fetch(`${BASE}/api/previa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...dados, tipo: "inexistente" }),
  });
  checar(
    previaRuim.status === 422,
    "POST /api/previa recusa família desconhecida",
    `status ${previaRuim.status}`,
  );

  // --- PDF
  const pdf = await fetch(`${BASE}/api/gerar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados),
  });
  const bytes = Buffer.from(await pdf.arrayBuffer());
  checar(
    pdf.ok &&
      pdf.headers.get("content-type") === "application/pdf" &&
      bytes.subarray(0, 5).toString() === "%PDF-",
    "POST /api/gerar devolve um PDF válido",
    `status ${pdf.status}, ${bytes.length} bytes`,
  );
  checar(
    /filename\*=UTF-8''/.test(pdf.headers.get("content-disposition") ?? ""),
    "PDF vem com nome de arquivo preservando acentos",
    pdf.headers.get("content-disposition") ?? "",
  );

  // --- histórico registra a geração que acabou de acontecer
  const historico = await (await fetch(`${BASE}/api/historico`)).json();
  checar(
    typeof historico.persistente === "boolean" &&
      Array.isArray(historico.itens) &&
      historico.itens.some((item) => item.curso === dados.curso),
    "GET /api/historico lista a geração feita em /api/gerar",
    JSON.stringify(historico.itens.slice(0, 2)),
  );

  // --- edição na revisão chega no PDF
  const editado = structuredClone(dados);
  editado.curso = "CURSO EDITADO NA REVISÃO";
  editado.disciplinas = editado.disciplinas.slice(0, 2);
  const previaEditada = await fetch(`${BASE}/api/previa`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(editado),
  });
  const htmlEditado = await previaEditada.text();
  checar(
    htmlEditado.includes("CURSO EDITADO NA REVISÃO") &&
      !htmlEditado.includes(dados.disciplinas.at(-1).nome),
    "edições feitas na revisão aparecem no resultado",
  );
} finally {
  servidor.kill();
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTodas as verificações passaram");
process.exit(falhas ? 1 : 0);
