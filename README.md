# Esteira de Cronogramas

Sistema web que gera cronogramas de curso em PDF a partir de um arquivo enviado pelo usuário,
substituindo a montagem manual que era feita no Canva.

**Fluxo:** envio de `.pdf` ou `.docx` → extração dos dados → tela de revisão → PDF pronto.

O planejamento e as decisões de design estão em [PLANO.md](PLANO.md).

## Começando

```bash
npm install
npx playwright install chromium
npm start
```

Abra <http://127.0.0.1:3000>, arraste um arquivo, confira os dados na tela de revisão e clique
em **Gerar PDF**.

Requer Node.js 18 ou superior (desenvolvido e testado no Node 24).

## O que o sistema aceita

| Entrada | Quando usar |
|---|---|
| `.pdf` | Um cronograma já diagramado no Canva, para reextrair e regerar sem depender do Canva |
| `.docx` | O [modelo padronizado](modelos/MODELO-CRONOGRAMA.docx), preenchido pela equipe |

O modelo `.docx` pode ser baixado pela própria interface, no rodapé da tela de envio, ou em
`GET /api/modelo`.

O tipo de cronograma (pós-graduação ou capacitação) é detectado pelo conteúdo do arquivo. Se a
detecção falhar, o campo vem em branco na revisão para ser escolhido — o sistema nunca gera um
PDF adivinhando.

## Tela de revisão

Entre a extração e o PDF há sempre uma etapa de conferência, porque nenhuma extração
automática é perfeita. Nela dá para:

- corrigir qualquer campo do curso e da turma;
- editar, adicionar, remover e reordenar disciplinas;
- ver a prévia do cronograma se atualizando a cada alteração.

Campos que a extração não conseguiu preencher chegam **destacados em âmbar**, com um aviso no
topo listando quais são. Isso evita ter que conferir tudo às cegas.

## Configuração

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `HOST` | `127.0.0.1` | Interface de escuta |
| `TAMANHO_MAXIMO_MB` | `25` local, `4` em serverless | Limite do arquivo enviado |
| `UPSTASH_REDIS_REST_URL` | — | Opcional; ativa o histórico de gerações persistente (ver "Histórico de gerações") |
| `UPSTASH_REDIS_REST_TOKEN` | — | Opcional; usada junto com a anterior |

O padrão deixa o sistema acessível **apenas na máquina que o executa**. Para liberar na rede
local, use `HOST=0.0.0.0` — mas note que **não há autenticação**: quem alcançar a porta usa o
sistema. Se for publicar para várias pessoas, ponha atrás de um proxy com login.

## Publicar

O app roda em dois formatos a partir do mesmo código:

- **Servidor de longa duração** — `server.mjs` chama `listen()`. É o `npm start`, e é também o
  que roda num container (Docker, Render, Railway, Fly).
- **Função serverless** — `api/index.mjs` entrega o mesmo app Express ao runtime da plataforma.
  É o que a Vercel usa.

Os dois importam `src/app.mjs`, que não sobe servidor nenhum; assim não existe uma versão
"de produção" com rotas diferentes da versão local.

### Vercel

O ajuste que essa plataforma exige é o navegador. O `playwright install` baixa o Chromium para
um cache da máquina, e esse cache **não vai no deploy** — daí o erro
`browserType.launch: Executable doesn't exist at /home/sbx_user…/ms-playwright/…`. Em serverless
o [`@sparticuz/chromium`](https://github.com/Sparticuz/chromium) resolve, trazendo um binário
compilado para o ambiente da AWS Lambda, que é onde a Vercel roda. A escolha é automática:
`src/generate-pdf.mjs` detecta `VERCEL`/`AWS_LAMBDA_FUNCTION_NAME` e só então carrega o pacote.

O [vercel.json](vercel.json) já traz o necessário: 2 GB de memória, 60s de duração e a inclusão
explícita do binário e das pastas de template no bundle. As dependências de produção somam cerca
de 128 MB, dentro do limite de 250 MB.

Pontos a saber antes de publicar:

- **Não há autenticação.** Numa URL pública, qualquer pessoa com o link envia arquivos e gera
  PDFs — consumindo a cota da conta. Proteja com o Vercel Authentication (Deployment
  Protection) ou ponha um login na frente.
- **Arquivo enviado fica limitado a 4 MB**, porque o corpo de uma requisição na Vercel não passa
  de 4,5 MB. Os cronogramas do acervo têm cerca de 1,1 MB, então na prática cabe; arquivos
  maiores são recusados com mensagem explicada.
- **A primeira geração depois de um tempo parado demora**, porque o Chromium precisa subir. As
  seguintes aproveitam a instância quente.
- **As fontes vêm do Google Fonts** a cada geração. Funciona, mas é uma chamada de rede a mais
  no caminho; se falhar, o PDF sai com a fonte do sistema e o aviso aparece junto do download.

### Container

Num host de container o código roda **sem nenhuma alteração** — inclusive sem o
`@sparticuz/chromium`, já que a imagem pode ter o Chromium de verdade. É o formato que evita
todas as ressalvas acima, à custa de manter um processo no ar:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV HOST=0.0.0.0
CMD ["node", "server.mjs"]
```

## Rotas

| Rota | O que faz |
|---|---|
| `GET /` | Interface |
| `GET /api/modelo` | Baixa o `MODELO-CRONOGRAMA.docx` |
| `POST /api/extrair` | Recebe o arquivo (campo `arquivo`, multipart) e devolve o JSON extraído |
| `POST /api/previa` | Recebe o JSON e devolve o HTML do cronograma |
| `POST /api/gerar` | Recebe o JSON e devolve o PDF, e registra a geração no histórico |
| `GET /api/historico` | Devolve os últimos cronogramas gerados |

Limite de 25 MB por arquivo. Os uploads passam por um arquivo temporário e são apagados logo
depois; nada do conteúdo do arquivo é guardado no servidor — só o registro de que um PDF foi
gerado entra no histórico (ver seção abaixo).

## Histórico de gerações

A página principal mostra os cronogramas gerados recentemente — curso, turma e data/hora —,
alimentada por `POST /api/gerar`: toda geração bem-sucedida grava uma linha, e a lista atualiza
sozinha na tela assim que o download termina.

Guardado em [src/historico.mjs](src/historico.mjs), sempre curso, turma, tipo, páginas e
data/hora de cada geração, no máximo 200 registros — os mais antigos saem conforme novos
entram. Nunca impede a geração do PDF: uma falha ao gravar (Redis fora do ar, disco cheio, o
que for) fica só no console do servidor.

Duas fontes possíveis, escolhidas por configuração, **nunca misturadas** — ou uma ou outra, para
o lado de leitura não ter que reconciliar duas origens diferentes:

| Fonte | Quando é usada | Sobrevive a… |
|---|---|---|
| Redis (Upstash) | `UPSTASH_REDIS_REST_URL`/`TOKEN` configuradas | tudo — redeploy, instância nova, cold start |
| Arquivo `dados/historico.json` | sem Redis, fora da Vercel | reinícios do processo, deploys (container) |
| Arquivo em `/tmp` | sem Redis, na Vercel | só a instância atual — some a qualquer momento |

**Sem Redis configurado**, o padrão de fábrica é o arquivo — funciona bem em execução local ou
em container, mas na Vercel esbarra no mesmo problema de sempre: o projeto é somente leitura
fora de `/tmp`, e `/tmp` não é compartilhado nem garantido entre invocações.

**Para o histórico não correr esse risco na Vercel**, ligue o Redis:

```bash
vercel install upstash
```

Isso cria (ou conecta) um banco Upstash pelo Marketplace da Vercel e injeta
`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` no projeto automaticamente — nenhuma
mudança de código é necessária, `src/historico.mjs` detecta as variáveis sozinho na próxima
geração. Funciona local também, se as mesmas variáveis estiverem no ambiente (`vercel env pull`
traz elas para `.env.local`).

A interface sabe qual fonte está em uso: quando `GET /api/historico` responde
`persistente: false` (sem Redis e em serverless), aparece um aviso discreto ao lado do título da
lista. Com Redis configurado, `persistente` é sempre `true`, em qualquer ambiente.

## Linha de comando

Todo o fluxo também roda sem a interface:

```bash
npm run gerar-pdf -- "entrada.pdf"                 # entrada → PDF, em saida/
npm run construir -- "entrada.docx" saida/x.html   # entrada → HTML
npm run extrair -- "entrada.pdf" saida/x.json      # entrada → JSON
npm run gerar-modelo                               # regera o modelo .docx
npm run pre-visualizar -- "saida/x.html"           # HTML → um PNG por página
npm run extrair-logo -- "arquivo.pdf|logo.png"     # prepara o logo institucional
```

`gerar-pdf` e `construir` aceitam `.pdf`, `.docx` ou um `.json` já extraído; `gerar-pdf` aceita
também um `.html` pronto.

## Testes

```bash
npm run testar-extracao -- "C:/Users/Administrador/Downloads" --json saida/extracao
npm run testar-docx
npm run testar-template
npm run testar-servidor
```

- **`testar-extracao`** percorre todos os PDFs de uma pasta cujo nome começa com `CRONOGRAMA`
  ou `CAPACITAÇÃO` (ignorando acentos) e resume o resultado. O acervo real da instituição é o
  conjunto de validação: cobre as duas famílias de layout. Com `--json`, grava o JSON de cada
  arquivo — é o que alimenta `testar-template`.
- **`testar-docx`** monta documentos de propósito fora do padrão — colunas reordenadas, rótulos
  reescritos, tabelas a mais, modalidade desconhecida, documento sem tabela — e confere se o
  extrator aguenta.
- **`testar-template`** constrói o HTML de todos os JSON de `saida/extracao` e confere no
  navegador o que a inspeção visual não pega: caixa de altura fixa recortando conteúdo em
  silêncio, disciplina sumida na paginação, página sem numeração, nome de curso invadindo o
  logo.
- **`testar-servidor`** sobe o servidor numa porta própria e percorre todas as rotas com
  arquivos reais, incluindo os casos de recusa.

Todos saem com código 1 em caso de falha.

## Estrutura

```
server.mjs               execução local: importa src/app.mjs e escuta numa porta
api/index.mjs            execução serverless: entrega src/app.mjs ao runtime da Vercel
public/                  interface (envio → revisão → resultado)
src/
  app.mjs                rotas Express — o mesmo app nos dois formatos de execução
  ambiente.mjs            detecção de serverless, usada por generate-pdf.mjs e historico.mjs
  build-cronograma.mjs   dados + boilerplate + template → HTML
  generate-pdf.mjs       HTML → PDF
  historico.mjs          registro de gerações (curso, turma, data/hora)
  extract/
    index.mjs            despacha pela extensão do arquivo
    pdf.mjs              extrator de PDF (posicional)
    docx.mjs             extrator do modelo padronizado
    layouts.mjs          o que é específico de cada família de cronograma
    modelo-docx.mjs      campos do modelo .docx (gerador e extrator leem daqui)
templates/
  cronograma.css         layout e cores das páginas
  boilerplate.json       textos fixos dos cards e avisos, por família
scripts/                 CLIs de extração, construção, geração, testes
assets/                  logo institucional
modelos/                 modelo .docx entregue à equipe
dados/                   historico.json (não versionado — ver "Histórico de gerações")
saida/                   resultados gerados (não versionado)
```

## Como funciona a extração de PDF

O extrator lê a posição absoluta de cada fragmento de texto e reconstrói a estrutura pela
geometria. Não depende de número de página nem da ordem dos elementos, porque ambos variam
entre arquivos do acervo.

**Identificação das páginas** — por conteúdo. A página de apresentação é a que contém
"Informações importantes"; páginas de cronograma são as demais com pelo menos duas células de
modalidade. O cronograma pode ocupar mais de uma página.

**Tabela de disciplinas** — ancorada nas células de modalidade (`Presencial`, `Ao Vivo`,
`EAD`, `Online`, `Híbrido`), o único vocabulário fechado do documento. Cada âncora define uma
linha, e os limites verticais saem dos pontos médios entre âncoras vizinhas, o que se adapta a
linhas de alturas diferentes. O número de metades lado a lado sai do agrupamento horizontal das
âncoras — a pós-graduação usa duas, a capacitação uma só.

Linhas sem célula de modalidade (os estágios da pós de enfermagem) são recuperadas numa segunda
passada, ancoradas na data.

**Variáveis da página de apresentação** — extraídas por expressão regular sobre o texto de cada
card isolado, mais a caixa de avisos. O isolamento por coluna é indispensável: lido linha a
linha, o texto da página intercala os sete cards, e frases que quebram em várias linhas dentro
de um card ficam impossíveis de casar.

## O modelo `.docx`

O modelo tem três tabelas:

| Tabela | Conteúdo |
|---|---|
| **Dados do curso** | Um campo por linha (curso, turma, horários, endereço…), com o texto de ajuda junto do rótulo |
| **Disciplinas com data** | `# · Modalidade · Tipo de Aula · Disciplina · Data · Carga Horária`, 23 linhas já criadas |
| **Disciplinas EAD (sem data)** | `# · Disciplina EAD · Carga Horária`, 11 linhas já criadas |

Carga horária é opcional nas duas tabelas ("40h", por exemplo) — deixe em branco quando não
tiver essa informação. Tipo de aula é opcional só na tabela com data ("Teórica" ou "Prática" —
qualquer outro valor vira aviso na revisão, não erro), e não existe na tabela EAD: conteúdo
assíncrono não se encaixa nessa distinção do mesmo jeito.

Nenhum dos dois vem preenchido a partir de um `.pdf` do Canva por padrão — o layout não reserva
coluna para eles —, mas o tipo de aula tem uma exceção: boa parte das disciplinas de
capacitação já traz "TEÓRICA:" ou "PRÁTICA:" no próprio nome ("TEÓRICA: Harmonização Facial
Full Face"), e o extrator de PDF aproveita esse sinal — captura no campo e remove o prefixo do
nome, para não ficar redundante. Carga horária não tem esse tipo de sinal em lugar nenhum da
origem, então só chega por digitação, no modelo ou na tela de revisão.

Três coisas foram feitas para reduzir digitação, medidas no acervo:

- **As EAD têm tabela própria, de uma coluna só.** Elas são 37% das disciplinas e não têm data
  porque ficam liberadas o curso inteiro; na tabela única obrigavam a repetir "EAD" e deixar a
  coluna de data em branco em cada uma.
- **A modalidade já vem preenchida como "Presencial"** nas linhas em branco — é 71% das
  disciplinas com data, então só as exceções precisam ser trocadas.
- **As linhas já vêm criadas** (dimensionadas pelo maior cronograma do acervo, que tem 18 com
  data e 7 EAD), em vez de a equipe ter que inserir uma a uma. Linhas não usadas ficam em
  branco e são ignoradas.

Regerar o arquivo depois de mexer nos campos: `npm run gerar-modelo`.

## Como funciona a extração de `.docx`

Lê as tabelas de `word/document.xml` e as classifica **pelo conteúdo, não pela ordem**: a de EAD
é a que tem "EAD" no cabeçalho, a de disciplinas é a que tem cabeçalho reconhecível (bastam duas
das três colunas), e a de dados é a que tem rótulos de campo na primeira coluna. Assim o arquivo
tolera tabelas decorativas a mais, seções acrescentadas e colunas reordenadas.

O formato antigo, de tabela única com as EAD no meio das demais, **continua sendo aceito** — um
modelo preenchido antes desta mudança não precisa ser refeito.

Os rótulos são casados ignorando acentos, maiúsculas e pontuação, e cada campo aceita sinônimos
— "Turma", "Código da turma" e "Vagas" chegam onde devem. A lista está em
[src/extract/modelo-docx.mjs](src/extract/modelo-docx.mjs), que é também a fonte usada para
gerar o modelo, de modo que o arquivo entregue e o que o sistema espera não saiam de sincronia.

## Famílias de cronograma

Uma família reúne o que muda entre tipos de curso: como detectá-la, quais variáveis podem faltar
sem que isso seja erro, e os textos dos cards da apresentação. Estão declaradas em
[src/extract/layouts.mjs](src/extract/layouts.mjs) e
[templates/boilerplate.json](templates/boilerplate.json) — para acrescentar uma nova, basta uma
entrada em cada.

Hoje existem duas: `pos-graduacao` e `capacitacao`.

Um card ou aviso pode ter `condicao` apontando para um campo: só aparece quando o campo é
verdadeiro. `condicaoAusente` é o inverso — só aparece quando o campo é falso. As duas juntas
declaram um **par mutuamente exclusivo**: em `capacitacao`, o card "Aulas ao vivo" (`condicao:
"temAoVivo"`) e o card "Presença" (`condicaoAusente: "temAoVivo"`) nunca aparecem ao mesmo
tempo — um curso sem nenhuma disciplina "Ao Vivo" na grade nunca fica com um card falando de
aulas ao vivo, mas também nunca fica com um buraco no lugar dele. O mesmo mecanismo se aplica
aos avisos da caixa "Informações importantes", que aceitam string simples (sempre aparece) ou
`{ texto, condicao?, condicaoAusente? }`.

`temAoVivo` é derivado de `dados.disciplinas` — verdadeiro quando existe ao menos uma disciplina
com modalidade "Ao Vivo" na grade —, não da variável `horarioAoVivo` do formulário. São coisas
diferentes de propósito: alguém pode preencher o horário no `.docx` sem que o curso tenha de
fato uma aula ao vivo na grade (ou vice-versa), e é a grade que decide o que aparece na página,
não o formulário.

O card de "Estágios" (`pos-graduacao`) usa o mesmo `condicao`, mas sem par — simplesmente some
quando não há estágio, porque não existe um tema substituto natural para esse card.

O card "Aulas práticas" (nas duas famílias) segue o mesmo padrão de `temAoVivo`: `temAulaPratica`
é derivado de `dados.disciplinas`, verdadeiro quando existe ao menos uma disciplina com
`tipoAula: "Prática"` na grade. A grade de cartões tem 3 colunas; com 5 ou 7 cartões a última
linha ficaria incompleta, então o último cartão ocupa as colunas que sobrarem (classes
`cartoes--cinco` e `cartoes--sete` em `templates/cronograma.css`) — com 6 a grade já fecha
sozinha. Um cartão com texto bem mais longo que o usual (caso do "Aulas práticas") recebe a
classe `cartao--compacto`, com fonte menor, para não estourar a altura da linha da grade.

## Template e geração do PDF

O HTML sai **autocontido** — CSS, ícones e logo embutidos —, para ser aberto direto no navegador
na prévia e convertido em PDF sem depender de nenhum arquivo ao lado. As fontes (Inter e
Poppins) vêm do Google Fonts, com uma pilha de fallback local.

Páginas de 1440×810 px (16:9), no design descrito no [PLANO.md](PLANO.md): fundo bege, cartões
brancos, faixa de marca vermelha no topo e diagonais diluídas na margem inferior.

**Paginação automática.** A distribuição das linhas em páginas é feita no navegador, medindo a
altura real de cada uma — calcular no Node exigiria adivinhar em quantas linhas cada nome de
disciplina quebra, e os nomes do acervo vão de 14 a 118 caracteres. A medição só roda depois de
`document.fonts.ready`: medindo com a fonte de fallback as linhas saem mais baixas, cabe uma a
mais por página, e quando a fonte definitiva entra a última linha é cortada.

Cada página recebe o máximo de linhas que couber, com espaçamento fixo entre elas; o que sobra vai
para a próxima sem tocar nas páginas já fechadas — nenhuma linha é puxada de volta para
"equilibrar" a última página. Uma última página que não fica cheia mantém as linhas no tamanho
normal e o espaço sobrando em branco, em vez de esticar o espaçamento para preencher a página.

As disciplinas EAD sem data saem da tabela cronológica e vão para um bloco próprio ao fim,
dentro do mesmo cartão. Elas não têm data porque ficam liberadas o curso inteiro; no meio das
datadas só geravam uma coluna de traços.

Quando a disciplina tem carga horária, ela aparece numa pílula discreta ao lado do nome — na
tabela e no bloco EAD. Sem carga horária, a pílula simplesmente não é desenhada.

Quando a disciplina tem tipo de aula, o selo aparece na mesma célula do selo de modalidade, ao
lado dele — "Presencial" + "Teórica", por exemplo. Cinza, e não vermelho como os selos de
modalidade: os dois num vermelho igual se misturariam visualmente numa linha só, como se fossem
a mesma categoria de dado. A coluna de modalidade (190px) foi medida para caber o par mais
largo do acervo — Presencial + Teórica, ~167px — sem quebrar linha; o `flex-wrap` continua
ativo como rede de segurança para uma combinação mais larga que apareça no futuro.

**O PDF é nativo**, com texto selecionável e pesquisável — num cronograma isso importa, porque o
aluno procura a data de uma disciplina com Ctrl+F. A folha sai em 1440×810 pontos, igual à dos
arquivos do Canva, para que um cronograma novo e um antigo tenham o mesmo tamanho lado a lado.
Rasterizar as páginas (o modo `compact` da esteira de informativos) faria sentido com fundo
fotográfico; aqui é cor chapada e texto, onde virar imagem só aumentaria o arquivo e tiraria a
busca.

## Formato de dados

É o mesmo objeto em todo o caminho: sai da extração, é editado na revisão e volta para gerar o
PDF.

```jsonc
{
  "tipo": "pos-graduacao",              // ou "capacitacao", ou null
  "curso": "GESTÃO HOSPITALAR",
  "modalidadeTitulo": "PÓS-GRADUAÇÃO",
  "turma": { "codigo": "10/2026", "diaSemana": "SÁBADO" },
  "variaveis": {
    "encontros": 12,
    "capacidadeMaxima": 20,
    "limiteFaltas": "30%",
    "intervalo": "1 hora",
    "horarioPresencial": "08h00 às 15h00",
    "horarioAoVivo": null,
    "endereco": "COLÉGIO GRATITUDE AVENIDA MARECHAL DEODORO, 53 – SANTOS"
  },
  "avisos": ["Sua presença é fundamental em todas as aulas;"],
  "disciplinas": [
    { "modalidade": "Ao Vivo", "tipoAula": "Teórica", "nome": "Harmonização Facial Full Face", "data": "26/01/2027", "cargaHoraria": "8h" },
    { "modalidade": "Presencial", "tipoAula": "Prática", "nome": "Harmonização Facial Full Face", "data": "30/01/2027", "cargaHoraria": "8h" },
    { "modalidade": "EAD", "tipoAula": null, "nome": "Ética, Bioética e Legislação", "data": null, "cargaHoraria": null },
    { "modalidade": null, "tipoAula": null, "nome": "Estágio Centro Obstétrico", "data": "A definir", "cargaHoraria": null }
  ],
  "_meta": {
    "origem": "pdf",                   // ou "docx"
    "confianca": "alta",               // alta | parcial | nenhuma
    "camposNaoEncontrados": [],
    "camposOpcionaisVazios": ["turma.diaSemana"],
    "paginas": 3,
    "paginasCronograma": [2, 3],
    "cardsExtraidos": ["..."],
    "avisos": []
  }
}
```

Nenhum dos extratores lança por conteúdo inesperado: o que não for encontrado volta como `null`
e listado em `_meta.camposNaoEncontrados`, que é o que a tela de revisão destaca.
`camposNaoEncontrados` lista só as ausências inesperadas para a família; as previstas (como o
limite de faltas, que não existe nos documentos de capacitação) vão para `camposOpcionaisVazios`
e não reduzem a confiança.

O campo `avisos` da raiz traz os avisos como estavam no documento de origem, para referência. O
que é impresso na página vem do boilerplate da família com os valores preenchidos, para que uma
correção feita na revisão se propague para o texto.

`disciplinas[].cargaHoraria` e `disciplinas[].tipoAula` são sempre opcionais e nunca entram em
`camposNaoEncontrados` — são dados por linha, não campos do curso. Vêm `null` quando ausentes,
tanto em disciplinas com data quanto EAD. `tipoAula` só aceita exatamente `"Teórica"` ou
`"Prática"` (ver `normalizarTipoAula` em [src/extract/layouts.mjs](src/extract/layouts.mjs));
qualquer outro valor no `.docx` vira aviso na revisão em vez de ser aceito literalmente.

## Resultado sobre o acervo atual

Última execução sobre os 21 cronogramas existentes:

- **extração**: 21 arquivos, 0 erros, 0 com campo obrigatório faltando, 177 disciplinas
- **template**: 21 de 21 montados sem estouro de caixa e sem perder disciplina
- **PDF**: 21 de 21 gerados, 45 páginas, 232 KB em média — os originais do Canva têm cerca de
  1,1 MB
- famílias: 18 capacitações, 3 pós-graduações

## Limitações conhecidas

- **Sem autenticação.** O sistema é de uso interno; publicar para fora exige pôr um login na
  frente. O que fica guardado hoje é só o registro de curso/turma/data de cada geração (ver
  "Histórico de gerações") — o conteúdo dos arquivos enviados não é retido.
- **PDFs sem camada de texto** (design exportado como imagem) são detectados e devolvem
  `confianca: "nenhuma"` com um aviso, para preenchimento manual na revisão. Nenhum dos 21
  arquivos do acervo atual cai nesse caso.
- **Página 1 varia mais do que as duas famílias preveem.** A pós de enfermagem obstétrica usa os
  cards de capacitação mais um de estágios. O card condicional cobre esse caso, mas outros cursos
  podem exigir variantes novas no boilerplate.
- **Resolução do logo.** O logo embutido nos PDFs do Canva tem apenas 264×95px em todos os 21
  arquivos. O asset em uso veio do projeto de informativos, com 567×183px depois de aparado e
  fundo transparente. Para impressão em alta qualidade, vale pedir o original em vetor ao
  marketing.
- **Fontes vindas da internet.** Inter e Poppins são carregadas do Google Fonts. Sem rede, o PDF
  sai com a fonte do sistema e um aviso junto do download. Para garantir o resultado offline, as
  fontes precisam ser embutidas.

## Dependências

- [`express`](https://expressjs.com/) e [`multer`](https://github.com/expressjs/multer) — servidor e upload
- [`playwright`](https://playwright.dev/) — renderiza o HTML e exporta o PDF
- [`@sparticuz/chromium`](https://github.com/Sparticuz/chromium) — Chromium para o PDF em serverless (ver "Publicar")
- [`@upstash/redis`](https://github.com/upstash/redis-js) — histórico de gerações persistente em serverless (opcional, ver "Histórico de gerações")
- [`pdfjs-dist`](https://github.com/mozilla/pdf.js) — leitura posicional do texto dos PDFs
- [`jszip`](https://stuk.github.io/jszip/) — abertura do `.docx`, que é um zip
- [`fast-xml-parser`](https://github.com/NaturalIntelligence/fast-xml-parser) — leitura do `word/document.xml`

De desenvolvimento:

- [`docx`](https://docx.js.org/) — usada por `gerar-modelo` e pelos testes de `.docx`
- [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas) — usada pelo script do logo
