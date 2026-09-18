// Prepara o logo institucional que o template usa. É executado uma vez, na
// montagem do projeto — não faz parte da esteira.
//
//   node scripts/extrair-logo.mjs "CRONOGRAMA.pdf" [saida.png]
//   node scripts/extrair-logo.mjs "logo_alpha.png" [saida.png]
//
// De um PDF, pega a imagem do canto superior direito da página — a busca é por
// posição, e não pelo nome interno do objeto, que muda a cada exportação do
// Canva. De um PNG, usa a imagem como está.
//
// Em ambos os casos apara as margens transparentes no fim: o logo original tem
// uma folga larga em volta, e sem aparar ele aparece pequeno demais dentro do
// chip do cabeçalho, que é dimensionado pela altura do arquivo.

import fs from "node:fs";
import path from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const entrada = process.argv[2];
const destino = process.argv[3] ?? "assets/logo-alpha-channel.png";

if (!entrada) {
  console.error(
    'Uso: node scripts/extrair-logo.mjs "arquivo.pdf|.png" [saida.png]',
  );
  process.exit(1);
}

/** Recorta as bordas totalmente transparentes em volta da imagem. */
function apararTransparencia(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const pixels = ctx.getImageData(0, 0, width, height).data;

  let topo = height;
  let base = -1;
  let esquerda = width;
  let direita = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Alfa 8 em vez de 0: bordas suavizadas deixam um halo quase invisível
      // que faria o recorte não apertar nada.
      if (pixels[(y * width + x) * 4 + 3] > 8) {
        if (y < topo) topo = y;
        if (y > base) base = y;
        if (x < esquerda) esquerda = x;
        if (x > direita) direita = x;
      }
    }
  }

  if (base < 0) return canvas;

  const novaLargura = direita - esquerda + 1;
  const novaAltura = base - topo + 1;
  if (novaLargura === width && novaAltura === height) return canvas;

  const aparado = createCanvas(novaLargura, novaAltura);
  aparado
    .getContext("2d")
    .drawImage(
      canvas,
      esquerda,
      topo,
      novaLargura,
      novaAltura,
      0,
      0,
      novaLargura,
      novaAltura,
    );
  return aparado;
}

function gravar(canvas, origem) {
  const aparado = apararTransparencia(canvas);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, aparado.toBuffer("image/png"));
  console.log(
    `Logo gravado em ${destino} — ${canvas.width}x${canvas.height} de ${origem}, ` +
      `aparado para ${aparado.width}x${aparado.height}`,
  );
}

// Caminho do PNG: nada a localizar, só aparar.
if (/\.png$/i.test(entrada)) {
  const imagem = await loadImage(entrada);
  const canvas = createCanvas(imagem.width, imagem.height);
  canvas.getContext("2d").drawImage(imagem, 0, 0);
  gravar(canvas, "imagem");
  process.exit(0);
}

const doc = await pdfjs.getDocument({
  data: new Uint8Array(fs.readFileSync(entrada)),
  useSystemFonts: true,
}).promise;

const pagina = await doc.getPage(1);
const vp = pagina.getViewport({ scale: 1 });

// Renderiza uma vez para que os objetos de imagem fiquem resolvidos em page.objs.
const canvasDescarte = createCanvas(vp.width, vp.height);
await pagina.render({
  canvasContext: canvasDescarte.getContext("2d"),
  viewport: vp,
}).promise;

const ops = await pagina.getOperatorList();
const colocadas = [];
let transformAtual = [1, 0, 0, 1, 0, 0];
const pilha = [];

const multiplicar = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

for (let i = 0; i < ops.fnArray.length; i++) {
  const fn = ops.fnArray[i];
  const args = ops.argsArray[i];

  if (fn === pdfjs.OPS.save) pilha.push([...transformAtual]);
  else if (fn === pdfjs.OPS.restore) transformAtual = pilha.pop() ?? transformAtual;
  else if (fn === pdfjs.OPS.transform)
    transformAtual = multiplicar(transformAtual, args);
  else if (
    fn === pdfjs.OPS.paintImageXObject ||
    fn === pdfjs.OPS.paintJpegXObject
  ) {
    // O sistema de coordenadas da imagem tem origem no canto inferior esquerdo
    // do seu retângulo unitário; o transform corrente dá onde ele caiu na página.
    const [a, b, c, d, e, f] = transformAtual;
    colocadas.push({
      nome: args[0],
      x: e,
      y: vp.height - (f + d),
      largura: Math.abs(a),
      altura: Math.abs(d),
    });
  }
}

// Canto superior direito, ignorando elementos decorativos que ocupam a página
// inteira (as ondas de fundo).
const candidatas = colocadas.filter(
  (img) =>
    img.x > vp.width * 0.6 &&
    img.y < vp.height * 0.3 &&
    img.largura < vp.width * 0.4 &&
    img.largura > 40,
);

if (!candidatas.length) {
  console.error(
    "Nenhuma imagem encontrada no canto superior direito. Imagens da página:",
  );
  for (const img of colocadas) {
    console.error(
      `  ${img.nome}  x=${img.x.toFixed(0)} y=${img.y.toFixed(0)} ` +
        `${img.largura.toFixed(0)}x${img.altura.toFixed(0)}`,
    );
  }
  process.exit(1);
}

// A maior delas: o logo costuma vir acompanhado de elementos menores.
const escolhida = candidatas.sort((a, b) => b.largura - a.largura)[0];

const imagem = await new Promise((resolve) => {
  pagina.objs.get(escolhida.nome, resolve);
});

if (!imagem?.data) {
  console.error(`Objeto "${escolhida.nome}" não trouxe dados de pixel.`);
  process.exit(1);
}

// pdfjs devolve RGB ou RGBA conforme o objeto; o canvas espera sempre RGBA.
const { width, height, data } = imagem;
const canvas = createCanvas(width, height);
const ctx = canvas.getContext("2d");
const destinoPixels = ctx.createImageData(width, height);
const canais = data.length / (width * height);

for (let i = 0; i < width * height; i++) {
  destinoPixels.data[i * 4] = data[i * canais];
  destinoPixels.data[i * 4 + 1] = data[i * canais + 1];
  destinoPixels.data[i * 4 + 2] = data[i * canais + 2];
  destinoPixels.data[i * 4 + 3] = canais === 4 ? data[i * canais + 3] : 255;
}
ctx.putImageData(destinoPixels, 0, 0);

gravar(canvas, `PDF (${canais === 4 ? "com" : "sem"} canal alfa)`);
