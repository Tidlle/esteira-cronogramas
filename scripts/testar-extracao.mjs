// Roda a extração sobre um acervo inteiro de cronogramas e resume o resultado.
// Serve de teste de regressão: o acervo real da instituição é o melhor conjunto
// de validação disponível, e cobre as duas famílias de layout.
//
//   node scripts/testar-extracao.mjs [pasta] [--json saida/extracao]

import fs from "node:fs";
import path from "node:path";

import { extrair } from "../src/extract/index.mjs";

// Os nomes no acervo variam bastante na acentuação ("CAPACITAÇÃO" e
// "CAPACITAÇÂO" convivem), então o casamento ignora acentos por completo.
const PADRAO_CRONOGRAMA = /^(CRONOGRAMA|CAPACITACAO)/i;

const semAcento = (texto) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "");

const argumentos = process.argv.slice(2);
const pasta = argumentos.find((a) => !a.startsWith("--")) ?? ".";
const indiceJson = argumentos.indexOf("--json");
const pastaJson = indiceJson >= 0 ? argumentos[indiceJson + 1] : null;

const arquivos = fs
  .readdirSync(pasta)
  .filter((nome) => nome.toLowerCase().endsWith(".pdf"))
  .filter((nome) => PADRAO_CRONOGRAMA.test(semAcento(nome)))
  .sort();

if (!arquivos.length) {
  console.error(`Nenhum cronograma encontrado em ${path.resolve(pasta)}`);
  process.exit(1);
}

if (pastaJson) fs.mkdirSync(pastaJson, { recursive: true });

const resultados = [];

for (const nome of arquivos) {
  const caminho = path.join(pasta, nome);
  try {
    const dados = await extrair(caminho);
    resultados.push({ nome, dados });

    if (pastaJson) {
      const alvo = path.join(pastaJson, nome.replace(/\.pdf$/i, ".json"));
      fs.writeFileSync(alvo, JSON.stringify(dados, null, 2), "utf8");
    }
  } catch (erro) {
    resultados.push({ nome, erro: erro.message });
  }
}

const sinal = (ok) => (ok ? "ok  " : "FALTA");

console.log("");
for (const { nome, dados, erro } of resultados) {
  const curto = nome.replace(/\.pdf$/i, "").slice(0, 58);

  if (erro) {
    console.log(`ERRO  ${curto}\n      ${erro}`);
    continue;
  }

  const faltando = dados._meta.camposNaoEncontrados;
  const marca = faltando.length === 0 ? "OK  " : "AVISO";

  console.log(
    `${marca}  ${curto}\n` +
      `      tipo=${dados.tipo ?? "?"}  turma=${dados.turma?.codigo ?? "?"}` +
      `  dia=${dados.turma?.diaSemana ?? "?"}` +
      `  encontros=${dados.variaveis?.encontros ?? "?"}` +
      `  disciplinas=${dados.disciplinas.length}`,
  );
  if (faltando.length) {
    console.log(`      não encontrado: ${faltando.join(", ")}`);
  }
}

const total = resultados.length;
const comErro = resultados.filter((r) => r.erro).length;
const completos = resultados.filter(
  (r) => r.dados && r.dados._meta.camposNaoEncontrados.length === 0,
).length;
const totalDisciplinas = resultados.reduce(
  (soma, r) => soma + (r.dados?.disciplinas.length ?? 0),
  0,
);
const semData = resultados.reduce(
  (soma, r) =>
    soma + (r.dados?.disciplinas.filter((d) => !d.data).length ?? 0),
  0,
);

console.log(
  `\n${total} arquivos · ${completos} completos · ` +
    `${total - completos - comErro} com campo faltando · ${comErro} com erro`,
);
console.log(
  `${totalDisciplinas} disciplinas extraídas (${semData} sem data, esperado para EAD)\n`,
);

// Distribuição por família, para conferir se a detecção está funcionando.
const porTipo = {};
for (const { dados } of resultados) {
  if (!dados) continue;
  const chave = dados.tipo ?? "não detectado";
  porTipo[chave] = (porTipo[chave] ?? 0) + 1;
}
console.log("por família:", porTipo, "\n");

process.exit(comErro > 0 ? 1 : 0);
