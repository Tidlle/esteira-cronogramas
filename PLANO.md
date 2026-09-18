# Plano — Esteira de Cronogramas

Sistema web que recebe um arquivo (`.docx` ou `.pdf`), extrai os dados do cronograma,
mostra uma tela de revisão e devolve um PDF pronto no layout institucional Alpha Channel.

---

## 1. O que foi apurado do arquivo de referência

Analisei o `CRONOGRAMA - GESTÃO HOSPITALAR - 09.2026.pdf` e mais um da família
"Capacitação" (`HARMONIZAÇÃO FACIAL FULL FACE - 01.2027 - SÁBADO`).

**Origem atual:** os PDFs são feitos **manualmente no Canva** (metadado
`Producer: Canva`, `Author: Marketing ITEQ`). Não existe hoje nenhuma automação — é
exatamente esse trabalho manual que a esteira vai substituir.

**Formato:** 2 páginas, 1440×810pt (16:9, formato de slide), fundo com onda vermelha/cinza
e logo Alpha Channel no canto superior direito.

### Página 1 — "APRESENTAÇÃO DO CRONOGRAMA"
7 cards numerados (01–07) alternando vermelho/cinza em zigue-zague, cada um com ícone
circular, título e texto. Abaixo, uma caixa cinza "⚠ INFORMAÇÕES IMPORTANTES" com bullets.

### Página 2 — "CRONOGRAMA"
Cabeçalho com `CRONOGRAMA` / modalidade / nome do curso, e uma tabela de 3 colunas
(**Modalidade | Disciplina | Data**) dividida em **duas metades lado a lado** — a metade
esquerda é preenchida primeiro, depois a direita.

### Descoberta central: a página 1 é quase toda boilerplate

Comparando as duas famílias, o texto dos cards é **fixo por tipo de curso**. Só um punhado
de valores muda de um cronograma para outro:

| Variável | Exemplo (Gestão Hospitalar) |
|---|---|
| Nome do curso | `GESTÃO HOSPITALAR` |
| Código da turma | `10/2026` |
| Dia da semana | `SÁBADO` |
| Nº de encontros presenciais | `12` |
| Horário / intervalo | `08h00 às 15h00`, `1 hora` |
| Endereço | `COLÉGIO GRATITUDE AVENIDA MARECHAL DEODORO, 53 – SANTOS` |
| Capacidade máxima | `20` alunos |

Isso muda a arquitetura para melhor: **a página 1 não é extraída em texto livre, é um
template por família com slots preenchidos.** A tela de revisão fica com ~8 campos em vez
de 7 blocos de texto solto, e o resultado nunca sai fora do padrão institucional. O texto
integral dos cards continua editável para casos excepcionais.

### Famílias identificadas (detecção automática)

O tipo é detectado pelo próprio arquivo, pelo subtítulo da página 2 e pelos rótulos dos
cards da página 1:

- **`pos-graduacao`** — cards `TURMA / ENCONTROS / PRESENÇA / AULAS PRESENCIAIS /
  DISCIPLINAS EAD / PLATAFORMA / ENDEREÇO`; tabela com `Presencial` e `EAD`.
- **`capacitacao`** — cards `TURMA / ENCONTROS / AULAS GRAVADAS / AULAS PRESENCIAIS /
  AULAS AO VIVO / DISCIPLINAS EAD / ENDEREÇO`; tabela com `Ao Vivo`, `Presencial`, `EAD`,
  e **dois horários** (aula ao vivo 19:00–21:00 e prática 09:00–16:00).

Se a detecção falhar, o arquivo cai na tela de revisão com o tipo em branco para o usuário
escolher — nunca gera PDF "no chute".

### Viabilidade da extração — validada

Fiz um dump posicional (x/y) do texto do PDF do Canva. A tabela da página 2 é
**perfeitamente regular**:

```
metade esquerda:  modalidade x≈35   disciplina x≈150   data x≈600
metade direita:   modalidade x≈740  disciplina x≈855   data x≈1309
```

Um agrupamento por faixas de x (colunas) + faixas de y (linhas) reconstrói a tabela sem
ambiguidade, inclusive disciplinas que quebram em 2–3 linhas. **Não é preciso IA para o
caminho do PDF Canva** — parser determinístico resolve.

---

## 2. Arquitetura

Node.js, alinhado com a esteira de informativos que já existe
(`teste_informativo_atualizado/`), que usa **Playwright + pdf-lib** e tem o fluxo
`data/<slug>.json` + `template.html` → `build-*.mjs` → HTML → `generate-pdf.mjs` → PDF.
Reaproveitamos esse mesmo desenho e boa parte do `generate-pdf.mjs`.

```
upload (.docx/.pdf)
      │
      ▼
┌─────────────────┐   detecta extensão e família
│   extractor     │   ├─ pdf  → parser posicional (pdfjs-dist)
│                 │   └─ docx → parser de tabelas (XML do OOXML)
└────────┬────────┘
         ▼
   cronograma.json  (schema normalizado)
         │
         ▼
┌─────────────────┐
│ tela de revisão │  formulário + tabela editável de disciplinas
└────────┬────────┘
         ▼
  build-cronograma.mjs  →  HTML (template + dados)
         │
         ▼
  generate-pdf.mjs (Playwright)  →  PDF final  →  download
```

### Stack

| Camada | Escolha | Por quê |
|---|---|---|
| Servidor | Node 24 + Express + Multer | Node já é o stack da esteira de informativos |
| Extração PDF | `pdfjs-dist` | já validado neste diagnóstico; sem dependência nativa |
| Extração DOCX | `unzipper` + parse do `word/document.xml` | tabelas OOXML sem perder a estrutura |
| Template | HTML + CSS (páginas 1440×810) | mesmo modelo do informativo |
| PDF | `playwright` (chromium) + `pdf-lib` | proven; modos `compact`/`native` já resolvidos |
| Front-end | HTML + JS puro | "interface simples", sem build step |

### Estrutura de pastas

```
esteira_cronogramas/
├── server.mjs                  # Express: /api/extract, /api/generate, estáticos
├── src/
│   ├── extract/
│   │   ├── index.mjs           # dispatcher por extensão + detecção de família
│   │   ├── pdf.mjs             # parser posicional do PDF do Canva
│   │   ├── docx.mjs            # parser do modelo padronizado .docx
│   │   └── layouts.mjs         # faixas de coluna e rótulos por família
│   ├── schema.mjs              # validação do cronograma.json
│   ├── build-cronograma.mjs    # dados + template → HTML
│   └── generate-pdf.mjs        # HTML → PDF (adaptado do informativo)
├── templates/
│   ├── pos-graduacao.html
│   ├── capacitacao.html
│   └── boilerplate.json        # textos fixos dos cards e avisos, por família
├── public/                     # interface (upload → revisão → download)
│   ├── index.html
│   ├── app.js
│   └── style.css
├── assets/                     # fundo, logo e ícones extraídos do PDF de referência
├── modelos/
│   └── MODELO-CRONOGRAMA.docx  # modelo padronizado para a equipe preencher
├── saida/                      # HTMLs e PDFs gerados
└── README.md
```

---

## 3. Schema de dados (`cronograma.json`)

Contrato único entre extração, tela de revisão e geração.

```jsonc
{
  "tipo": "pos-graduacao",              // ou "capacitacao"
  "curso": "GESTÃO HOSPITALAR",
  "modalidadeTitulo": "PÓS-GRADUAÇÃO",  // subtítulo da página 2

  "turma": {
    "codigo": "10/2026",
    "diaSemana": "SÁBADO"
  },

  "variaveis": {                         // slots do template da página 1
    "encontros": 12,
    "horarioPresencial": "08h00 às 15h00",
    "intervalo": "1 hora",
    "horarioAoVivo": null,               // só capacitação
    "endereco": "COLÉGIO GRATITUDE AVENIDA MARECHAL DEODORO, 53 – SANTOS",
    "capacidadeMaxima": 20,
    "limiteFaltas": "30%"
  },

  "cards": [                             // gerados do boilerplate; editáveis
    { "numero": "01", "titulo": "TURMA– SÁBADO", "icone": "livros",
      "destaque": "10/2026", "texto": "Cada curso possui uma turma específica..." }
  ],

  "avisos": [
    "Sua presença é fundamental em todas as aulas;",
    "O limite de faltas é de 30% — caso atingido, as aulas deverão ser repostas;"
  ],

  "disciplinas": [
    { "modalidade": "Presencial", "nome": "Processos e Fundamentos Históricos da Educação em Saúde", "data": "26/09/2026" },
    { "modalidade": "EAD", "nome": "Ética, Bioética e Legislação em Gestão Hospitalar", "data": null }
  ],

  "_meta": {
    "origem": "pdf-canva",               // ou "docx-modelo"
    "confianca": "alta",                 // alta | parcial — alimenta os avisos da revisão
    "camposNaoEncontrados": []
  }
}
```

`_meta.camposNaoEncontrados` é o que faz a tela de revisão **destacar em amarelo** o que
não foi extraído, em vez de o usuário ter que conferir tudo às cegas.

---

## 3.5. Direção de design (novo layout)

Decidido em conversa: **os cronogramas novos não precisam reproduzir o design do Canva.**
O que se mantém é a **identidade institucional** — logo Alpha Channel e a paleta
vermelho (`#A62432`) / cinza (`#8C8C8C`) / branco. O layout é redesenhado.

Formato mantido em **1440×810 (16:9)**, que é como esses arquivos são distribuídos hoje
(tela, WhatsApp, e-mail). Mudar para A4 retrato é uma alteração pequena se preferirem
priorizar impressão.

### Tratamento de fundo — aprovado

**Faixa de marca no topo + diagonais diluídas na margem inferior.**

A regra que governa o fundo: **cor nas bordas e nos cartões, nunca atrás de texto corrido.**
Foi exatamente aí que o layout do Canva tropeçou.

| Elemento | Valor |
|---|---|
| Fundo da página | `#F1EFEA` (bege-acinzentado quente) |
| Cartões e tabela | `#FFFFFF` — o branco vira destaque, não padrão |
| Faixa do cabeçalho | `#A62432`, altura fixa, título em branco e logo à direita |
| Diagonal cinza | `#E9E6E0`, faixa inferior |
| Diagonal vermelha | `#F3E4E5`, faixa inferior |
| Texto corrido | `#5F5E5A` sobre branco |
| Títulos de cartão | `#2C2C2A` |

**Restrições das diagonais** (é o que impede o layout de ficar carregado):
- vivem só na faixa inferior da página — 74px na página 1, 60px na página 2;
- ficam **atrás** dos cartões brancos, que são opacos;
- nenhum texto de conteúdo cai sobre elas; só o rodapé, que usa `#7A7974` e mantém
  contraste suficiente sobre os dois tons;
- a faixa encolhe automaticamente se o conteúdo crescer — o conteúdo tem prioridade sobre
  a decoração, nunca o contrário.

A inversão fundo-bege / cartões-brancos é o que resolve o aspecto vazio: cria profundidade,
o conteúdo passa a flutuar sobre uma superfície em vez de se dissolver nela.

### Problemas do layout atual que o redesenho resolve

Não é redesenho por gosto — são coisas que atrapalham a leitura no arquivo de referência:

1. **Fundo com onda atravessa o conteúdo.** Na página 2 a onda vermelha passa por baixo da
   tabela e derruba o contraste de várias linhas — a linha "EAD / Ética, Bioética" fica
   sobre a onda e é a menos legível da página. Fundo novo: branco, com a marca só no
   cabeçalho e um filete de cor.
2. **Cards em zigue-zague com alturas diferentes.** Obriga o olho a subir e descer, e o
   texto fica espremido em colunas estreitas (7 colunas em 1440px dá ~150px por card).
   Novo: grid regular, cards de altura igual, texto com espaço para respirar.
3. **Numeração 01–07 é ruído.** Os cards não têm ordem nem sequência — são categorias
   paralelas. A numeração sugere um passo a passo que não existe. Removida.
4. **Ícones emoji inconsistentes** (📚 💻 🏥 🎥, com 🏥 e 📚 repetidos em cards diferentes).
   Substituídos por um conjunto monoline coerente (Lucide), em vermelho institucional.
5. **Caixa "Informações importantes" cortada.** No PDF de referência ela estoura a margem
   inferior da página. No template ela tem espaço reservado.
6. **Tabela dividida em duas metades independentes.** Quebra a leitura cronológica: a
   sequência vai da linha 7 da esquerda para a linha 1 da direita. Novo: tabela única de
   largura total, leitura de cima para baixo.
7. **Disciplinas EAD com data "–"** numa tabela cronológica. Elas não têm data porque ficam
   liberadas na plataforma o tempo todo. Vão para um bloco próprio ao final, rotulado
   "Disciplinas EAD — disponíveis na plataforma durante todo o curso".

### Como fica

**Página 1 — Apresentação**
- Cabeçalho: faixa vermelha sólida, `APRESENTAÇÃO DO CRONOGRAMA` em rosa claro sobre o
  vermelho, nome do curso em branco e logo à direita.
- Uma linha de destaque com os dados-chave da turma (código, dia, nº de encontros,
  horário) em formato de "ficha" — é o que o aluno mais procura.
- Grid **3×2** de cards de informação (+ endereço em card largo na base), todos com altura
  igual, ícone monoline no topo, título em caixa alta pequena e texto em corpo legível
  (~15px em vez dos ~11px atuais).
- Caixa de avisos ao pé, com barra vermelha à esquerda e ícone de atenção.

**Página 2 — Cronograma**
- Mesma faixa vermelha, com `CRONOGRAMA · PÓS-GRADUAÇÃO` e o nome do curso.
- Tabela única dentro de um cartão branco, largura total, com **zebra striping** claro em
  vez de bordas pretas.
- Coluna de modalidade como **pill colorida**: `Presencial` vermelho sólido, `Ao Vivo`
  vermelho contornado, `EAD` cinza.
- Data à direita, com o dia da semana abreviado abaixo (`26/09/2026` / `sáb`) — ajuda a
  conferir se a data caiu no dia certo da turma.
- Bloco separado no fim para as disciplinas EAD sem data.
- Rodapé com numeração de página, já que agora pode haver mais de duas.

### Ganhos operacionais que vêm junto

- **Paginação automática** — cronogramas com muitas disciplinas deixam de exigir ajuste
  manual.
- **Texto pesquisável** no PDF (modo `native`) — o aluno acha uma disciplina com Ctrl+F.
- **Contraste adequado** — o texto cinza-claro sobre onda do layout atual não passa em
  critério de acessibilidade; o novo usa cinza escuro sobre branco.

---

## 4. Fases de implementação

> **Estado atual:** todas as fases concluídas. Ver o [README.md](README.md) para o que já roda.

### Fase 0 — Esqueleto e assets ✅
- `npm init`, dependências, estrutura de pastas.
- **Extrair apenas o logo Alpha Channel** do PDF de referência, na maior resolução
  disponível. O fundo com a onda e os ícones emoji não são reaproveitados — ver seção 3.5.
- Fonte: **Inter** para texto e **Poppins** para títulos (ambas Google Fonts, com bom
  suporte a acentuação e ótima legibilidade em tamanho pequeno).

### Fase 1 — Extrator de PDF (o caminho principal) ✅
- Parser posicional com `pdfjs-dist` (o protótipo do diagnóstico já funciona).
- Clusterização por faixas de x/y para reconstruir a tabela da página 2, incluindo o corte
  entre metade esquerda e direita e disciplinas de múltiplas linhas.
- Página 1: extrair só as variáveis, por âncora de rótulo (`ENCONTROS`, `ENDEREÇO`, ...).
- Detecção de família + preenchimento de `_meta`.
- **Teste de regressão contra os 21 cronogramas já existentes em `Downloads/`** — é um
  conjunto de validação pronto e gratuito, cobrindo as duas famílias.

### Fase 2 — Modelo padronizado `.docx` + extrator ✅
- O modelo ainda não existe; será **criado por este projeto** (`modelos/MODELO-CRONOGRAMA.docx`)
  e disponibilizado para download na própria interface.
- Estrutura: uma tabela "Dados do curso" (rótulo | valor) + uma tabela "Disciplinas"
  (Modalidade | Disciplina | Data).
- Parser lê `word/document.xml` e mapeia as tabelas direto para o schema.
- Tolerante a variação de caixa, acento e espaço nos rótulos.

### Fase 3 — Template HTML (design novo — ver seção 3.5) ✅
- Um `<section class="pagina">` de 1440×810 por página.
- Página 1: grid regular de cards, textos vindos de `templates/boilerplate.json` com os
  slots substituídos.
- Página 2: tabela única de largura total, com **paginação automática** — se as disciplinas
  passarem da capacidade da página, uma página extra é criada sozinha (o Canva não faz isso
  hoje; é ganho direto).
- Disciplinas EAD sem data saem da tabela cronológica e vão para um bloco próprio.
- Ajuste de fonte adaptativo para nomes de curso longos, mesma técnica do
  `HERO_TITLE_TIERS` da esteira de informativos.

### Fase 4 — Geração de PDF ✅
- Adaptar o `generate-pdf.mjs` do informativo (Playwright + pdf-lib), que já resolve
  captura por página, espera de fontes/imagens e compressão.
- Padrão: modo `native` (texto selecionável e pesquisável — importante num cronograma, em
  que o aluno procura a data de uma disciplina). Modo `compact` disponível como opção.

### Fase 5 — Interface web ✅
Três telas numa única página, sem framework:
1. **Upload** — drag & drop, aceita `.pdf`/`.docx`, com link para baixar o modelo padrão.
2. **Revisão** — campos do curso/turma/variáveis + tabela de disciplinas editável
   (adicionar, remover, reordenar linhas). Campos não extraídos vêm destacados.
   Pré-visualização do HTML num iframe ao lado.
3. **Resultado** — botão de download do PDF e "gerar outro".

### Fase 6 — README ✅
Documentação completa: instalação, como rodar, o schema, como ajustar o boilerplate de
cada família e como adicionar uma nova família de curso.

---

## 5. Riscos e como tratá-los

| Risco | Tratamento |
|---|---|
| ~~Fidelidade visual ao Canva~~ | **Eliminado** — o design é livre (seção 3.5). Era o maior risco do plano. |
| **Aprovação do novo design** | Prototipar uma página e mostrar antes de construir o resto. Baixo custo, e evita retrabalho. |
| **PDF sem camada de texto** (exportado como imagem) | Detectar (mesma heurística do `MIN_TEXT_LENGTH` da esteira de links) e mandar para a tela de revisão em branco, com aviso claro — nunca falhar em silêncio. |
| **Layout Canva mudar no futuro** | As faixas de coluna ficam em `layouts.mjs`, isoladas do resto; e o modelo `.docx` continua funcionando como caminho independente. |
| **Cronogramas com muitas disciplinas** | Paginação automática (Fase 3). |
| **Terceira família (graduação)** | A arquitetura já prevê: adicionar uma entrada em `boilerplate.json` + um template. Sem mexer no extrator nem na UI. |

---

## 6. Decisões que valem confirmar antes de começar

1. ~~Fidelidade x melhoria~~ — **resolvido**: design livre, ver seção 3.5. Fica só a
   premissa de manter logo e paleta institucionais.
2. **Endereço e capacidade**: variam bastante por turma ou são um conjunto pequeno e fixo
   de unidades? Se for um conjunto fixo, viram um `select` na revisão em vez de texto livre
   — menos erro de digitação.
3. **Persistência**: os cronogramas gerados precisam ficar salvos/históricos no servidor,
   ou é fluxo descartável (gerou, baixou, acabou)?
4. **Onde roda**: só na máquina local da equipe de marketing, ou precisa ser publicado num
   servidor com acesso de várias pessoas? Isso muda autenticação e armazenamento.

---

## 7. Estimativa

| Fase | Esforço |
|---|---|
| 0 — Esqueleto e assets | pequeno |
| 1 — Extrator PDF | médio (o núcleo já está prototipado e validado) |
| 2 — Modelo DOCX + extrator | médio |
| 3 — Template HTML | médio (caiu de "maior" com o design livre) |
| 4 — Geração de PDF | pequeno (reaproveitado do informativo) |
| 5 — Interface | médio |
| 6 — README | pequeno |

Com o design livre, o caminho crítico passa a ser a **Fase 1 (extrator)**, que é onde está
a incerteza real. Ordem sugerida:

1. **Fases 0–1** e te mostrar o `cronograma.json` extraído dos 21 PDFs existentes — valida
   a extração com dados reais antes de qualquer investimento em visual.
2. **Protótipo visual** de uma página para você aprovar o design novo.
3. Resto das fases.
