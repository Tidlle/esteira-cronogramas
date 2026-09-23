// Aplicação Express da esteira, sem subir servidor. Quem escuta numa porta é o
// server.mjs (execução local); em serverless, a função de api/index.mjs
// entrega este mesmo app ao runtime.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import multer from "multer";

import { emServerless } from "./ambiente.mjs";
import { construirHtml } from "./build-cronograma.mjs";
import { extrair } from "./extract/index.mjs";
import { gerarPdfDeHtml, nomeDoArquivo } from "./generate-pdf.mjs";
import { listarHistorico, persistente, registrarGeracao } from "./historico.mjs";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const EXTENSOES = new Set([".pdf", ".docx"]);

// Em serverless o corpo da requisição é limitado pela plataforma — na Vercel,
// 4,5 MB — e o upload falharia com um erro genérico antes de chegar aqui. O
// limite fica um pouco abaixo disso para a recusa vir com mensagem explicada.
const TAMANHO_MAXIMO = Number(
  process.env.TAMANHO_MAXIMO_MB ?? (emServerless() ? 4 : 25),
) * 1024 * 1024;

export const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(RAIZ, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAXIMO, files: 1 },
});

/** Envolve um handler async para que erro vire resposta, e não processo morto. */
const rota = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (erro) {
    console.error(erro);
    if (!res.headersSent) {
      res.status(500).json({ erro: erro.message ?? "Erro inesperado." });
    }
  }
};

app.get(
  "/api/modelo",
  rota(async (req, res) => {
    const caminho = path.join(RAIZ, "modelos/MODELO-CRONOGRAMA.docx");
    if (!fs.existsSync(caminho)) {
      res.status(404).json({
        erro: "Modelo ainda não foi gerado. Rode: npm run gerar-modelo",
      });
      return;
    }
    res.download(caminho, "MODELO-CRONOGRAMA.docx");
  }),
);

app.post(
  "/api/extrair",
  upload.single("arquivo"),
  rota(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ erro: "Nenhum arquivo enviado." });
      return;
    }

    // multer entrega o nome como latin-1; sem isto um curso com acento no nome
    // do arquivo chega corrompido e a extensão pode nem casar.
    const nomeOriginal = Buffer.from(req.file.originalname, "latin1").toString(
      "utf8",
    );
    const extensao = path.extname(nomeOriginal).toLowerCase();

    if (!EXTENSOES.has(extensao)) {
      res.status(400).json({
        erro: `Formato não suportado: "${extensao || "sem extensão"}". Envie um .pdf ou .docx.`,
      });
      return;
    }

    // Os extratores trabalham a partir de caminho de arquivo, então o upload
    // passa pelo disco e é apagado logo em seguida. Em serverless só /tmp é
    // gravável, que é justamente o que os.tmpdir() devolve lá.
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "cronograma-upload-"));
    const caminho = path.join(pasta, `entrada${extensao}`);

    try {
      fs.writeFileSync(caminho, req.file.buffer);
      const dados = await extrair(caminho);
      res.json({ dados, arquivo: nomeOriginal });
    } catch (erro) {
      res.status(422).json({ erro: erro.message });
    } finally {
      fs.rmSync(pasta, { recursive: true, force: true });
    }
  }),
);

app.post(
  "/api/previa",
  rota(async (req, res) => {
    try {
      res.type("html").send(construirHtml(req.body));
    } catch (erro) {
      res.status(422).json({ erro: erro.message });
    }
  }),
);

app.post(
  "/api/gerar",
  rota(async (req, res) => {
    const dados = req.body;

    let html;
    try {
      html = construirHtml(dados);
    } catch (erro) {
      res.status(422).json({ erro: erro.message });
      return;
    }

    const { pdf, paginas, avisos } = await gerarPdfDeHtml(html);
    const nome = nomeDoArquivo(dados);

    // Esperado, não disparado em segundo plano: numa função serverless, o
    // que não for aguardado antes da resposta não tem garantia de terminar
    // de executar — a instância pode ser congelada assim que o PDF sai.
    await registrarGeracao({
      curso: dados.curso,
      turma: dados.turma?.codigo,
      tipo: dados.tipo,
      paginas,
    });

    res.setHeader("Content-Type", "application/pdf");
    // encodeURIComponent no filename* preserva acentos em qualquer navegador.
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="cronograma.pdf"; filename*=UTF-8''${encodeURIComponent(nome)}`,
    );
    if (avisos.length) {
      res.setHeader("X-Avisos", encodeURIComponent(avisos.join(" | ")));
    }
    res.send(pdf);
  }),
);

app.get(
  "/api/historico",
  rota(async (req, res) => {
    res.json({ persistente: persistente(), itens: await listarHistorico(30) });
  }),
);

// Erros do multer (arquivo grande demais, por exemplo) chegam aqui.
app.use((erro, req, res, next) => {
  if (erro instanceof multer.MulterError) {
    const mensagem =
      erro.code === "LIMIT_FILE_SIZE"
        ? `Arquivo maior que o limite de ${(TAMANHO_MAXIMO / 1024 / 1024).toFixed(1)} MB.`
        : erro.message;
    res.status(400).json({ erro: mensagem });
    return;
  }
  next(erro);
});

export default app;
