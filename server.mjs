// Servidor da esteira: upload → extração → revisão → PDF.
//
//   npm start
//
// Por padrão escuta só em 127.0.0.1, ou seja, fica acessível apenas na máquina
// que o executa. Para liberar na rede local, defina HOST=0.0.0.0 — mas repare
// que não há autenticação nenhuma: quem alcançar a porta usa o sistema.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import multer from "multer";

import { construirHtml } from "./src/build-cronograma.mjs";
import { extrair } from "./src/extract/index.mjs";
import { fecharNavegador, gerarPdfDeHtml, nomeDoArquivo } from "./src/generate-pdf.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";

const EXTENSOES = new Set([".pdf", ".docx"]);
const TAMANHO_MAXIMO = 25 * 1024 * 1024;

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(AQUI, "public")));

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
    const caminho = path.join(AQUI, "modelos/MODELO-CRONOGRAMA.docx");
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
    // passa pelo disco e é apagado logo em seguida.
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

    const { pdf, avisos } = await gerarPdfDeHtml(html);
    const nome = nomeDoArquivo(dados);

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

// Erros do multer (arquivo grande demais, por exemplo) chegam aqui.
app.use((erro, req, res, next) => {
  if (erro instanceof multer.MulterError) {
    const mensagem =
      erro.code === "LIMIT_FILE_SIZE"
        ? `Arquivo maior que o limite de ${TAMANHO_MAXIMO / 1024 / 1024} MB.`
        : erro.message;
    res.status(400).json({ erro: mensagem });
    return;
  }
  next(erro);
});

const servidor = app.listen(PORTA, HOST, () => {
  console.log(`Esteira de cronogramas em http://${HOST}:${PORTA}`);
  if (HOST === "0.0.0.0") {
    console.log(
      "Atenção: escutando em todas as interfaces, e o sistema não tem login.",
    );
  }
});

for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, async () => {
    servidor.close();
    await fecharNavegador();
    process.exit(0);
  });
}
