---
name: Hotswap
description: Painel de partidas para trocar de worktree; cada projeto é uma plataforma, cada worktree uma linha com palheta de estado.
colors:
  board: "#131417"
  rail: "#18191d"
  flap: "#222428"
  flap-hi: "#2b2d32"
  rule: "#2e3036"
  ink: "#ecebe6"
  ink-2: "#a5a59f"
  ink-3: "#777875"
  run: "#4cc38a"
  start: "#f2b33d"
  wait: "#f2b33d"
  fail: "#f26d6d"
  scrim: "rgb(10 11 13 / 72%)"
  selection: "rgb(236 235 230 / 22%)"
  board-day: "#f4f5f3"
  rail-day: "#ebece9"
  flap-day: "#d6d7d3"
  flap-hi-day: "#e7e8e4"
  flap-top-day: "#d2d3ce"
  flap-bot-day: "#c3c5bf"
  flap-ink-day: "#45474c"
  flap-run-day: "#15161a"
  flap-start-day: "#15161a"
  flap-fail-day: "#15161a"
  flap-body-run-day: "#6ccf9c / #55c08a"
  flap-body-move-day: "#f6c45f / #f0b33f"
  flap-body-stop: "#f6c45f / #f0b33f"
  flap-ink-stop: "#131417"
  flap-body-stop-day: "#2b2d32 / #222428"
  flap-ink-stop-day: "#f2b33d"
  ends-bg-day: "#f7e7c0"
  flap-body-fail-day: "#f4a29b / #ee8a82"
  rule-day: "#cfd1cc"
  ink-day: "#15161a"
  ink-2-day: "#4f5156"
  ink-3-day: "#6e7074"
  run-day: "#0d6a3f"
  start-day: "#855000"
  wait-day: "#855000"
  fail-day: "#b3261e"
  scrim-day: "rgb(21 22 26 / 24%)"
  selection-day: "rgb(21 22 26 / 16%)"
typography:
  display:
    fontFamily: "Barlow Semi Condensed, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
  headline:
    fontFamily: "Barlow Semi Condensed, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 600
  title:
    fontFamily: "Barlow Semi Condensed, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
  body:
    fontFamily: "Barlow Semi Condensed, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.35
    fontFeature: "tnum"
  small:
    fontFamily: "Barlow Semi Condensed, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  label:
    fontFamily: "Barlow Semi Condensed, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.08em"
  flap:
    fontFamily: "Barlow Semi Condensed, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.06em"
  mono:
    fontFamily: "JetBrainsMono Nerd Font, Hack Nerd Font Mono, monospace"
    fontSize: "12px"
    lineHeight: 1.5
  terminal:
    fontFamily: "JetBrainsMono Nerd Font, Hack Nerd Font Mono, monospace"
    fontSize: "14px"
    lineHeight: 1.15
rounded:
  flap: "2px"
  control: "4px"
  surface: "6px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  row: "10px"
  gutter: "14px"
  card: "22px"
components:
  flap:
    backgroundColor: "{colors.flap}"
    textColor: "{colors.ink-2}"
    typography: "{typography.flap}"
    rounded: "{rounded.flap}"
    height: "22px"
    width: "calc(7ch + 20px)"
  flap-run:
    textColor: "{colors.run}"
  flap-start:
    textColor: "{colors.start}"
  flap-wait:
    textColor: "{colors.wait}"
  flap-stop:
    textColor: "{colors.wait}"
  flap-fail:
    textColor: "{colors.fail}"
  line:
    textColor: "{colors.ink-2}"
    typography: "{typography.body}"
    padding: "5px 10px 5px 14px"
  line-current:
    backgroundColor: "{colors.flap}"
    textColor: "{colors.ink}"
  tab:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.flap}"
    padding: "0 12px"
    height: "26px"
  tab-selected:
    backgroundColor: "{colors.flap}"
    textColor: "{colors.ink}"
  button:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "32px"
  button-hover:
    backgroundColor: "{colors.flap}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.board}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.ink-2}"
  icon-button:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    size: "28px"
  icon-button-hover:
    backgroundColor: "{colors.flap}"
    textColor: "{colors.ink}"
  input:
    backgroundColor: "{colors.board}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "34px"
  floating-surface:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "22px 24px"
  tag:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.flap}"
    padding: "0 4px"
---

# Design System: Hotswap

## Overview

**Creative North Star: "O Painel de Partidas"**

A janela é um painel de partidas de estação. Cada projeto é uma plataforma, cada worktree uma linha, e o estado de cada linha é uma palheta split-flap: um bloco com a linha de corte no meio e caracteres em caixa-alta condensada. Trocar de worktree é o painel virando. O terminal é o conteúdo e ocupa todo o resto da janela, sobre o mesmo fundo do painel.

Há dois materiais, que seguem o sistema operacional (`prefers-color-scheme`) até o botão de tema escolher outro: à noite, painel grafite; de dia, tabela impressa em esmalte branco. Os dois têm a mesma estrutura e os mesmos papéis; muda só a tinta. A densidade é de quadro de horários: linhas compactas, colunas fixas, números tabulares, nenhum cartão no painel. A hierarquia vem da tinta (cheia no que está em serviço, meia-tinta no resto) e não de tamanho nem de cor.

O mundo recusa a árvore de arquivos estilo IDE (Explorer + quick-open em cinza VS Code). O movimento é mecânico, em passos discretos sem easing, e só acontece quando um estado muda.

**Key Characteristics:**
- Palheta split-flap de 7 caracteres como assinatura do estado.
- Uma cor por estado, e nenhuma outra cor na interface.
- Tinta cheia só no que está em serviço; meia-tinta no resto.
- Barlow Semi Condensed em caixa-alta para rótulos, números tabulares em tudo.
- Plano: profundidade só nas superfícies flutuantes.
- Movimento em degraus (`steps`), nunca em curva.

## Colors

Neutros quentes de grafite (noite) ou esmalte (dia), com três cores de sinal reservadas aos estados. Cada token tem par diurno (sufixo `-day` no frontmatter), aplicado por `:root[data-theme="light"]` sobre as mesmas custom properties.

**Tema: o sistema por padrão, o botão quando o sistema não serve.** O app é usado de dia e de noite, e o COSMIC já alterna claro e escuro sozinho; seguir o sistema mantém o painel na mesma luz do editor ao lado, sem um segundo lugar para trocar. Mas a luz da sala nem sempre bate com a do sistema (sistema claro numa sala escura, ou só o terminal escuro ao lado de um editor claro), e para isso só restava mudar a área de trabalho inteira. Por isso há o botão no rodapé do painel. A escolha fica no `localStorage` (`theme`) e é esquecida assim que coincide com o sistema, no clique ou na virada do sistema: o app volta a acompanhar dia e noite sem um terceiro estado "automático" para escolher. `data-theme` é sempre o tema em vigor (escolha ou sistema), aplicado por um script no `<head>` antes da primeira pintura (pelo módulo, o claro piscava escuro); o CSS não consulta `prefers-color-scheme`, para os dois caminhos não divergirem.

### Primary
- **Tinta Cheia** (`ink`): texto do que está em serviço (branch da worktree ativa ou rodando, destino, títulos), botão primário (`--primary`), anel de foco, caret e seleção (`--focus`, `--selection` são a mesma tinta). É a voz principal do sistema; não há acento cromático.

### Secondary
- **Verde Rodando** (`run`): só o estado RODANDO, a travessa do H da marca na barra lateral e a confirmação positiva de formulário (`.side-error.ok`).
- **Âmbar em Movimento** (`start`, `wait`): estados SUBINDO, AGUARDA, PARANDO e SIGKILL, e a prévia ENCERRA; os dois tokens têm o mesmo valor e continuam separados por papel. Parar é a consequência esperada de uma troca, não um alarme. Quem está morrendo (PARANDO, SIGKILL) é o negativo de quem espera: a mesma palheta âmbar, invertida. À noite, corpo âmbar (`#f6c45f` / `#f0b33f`) e tinta do painel (`board`, 9,9:1 ou mais); de dia, corpo grafite (`#2b2d32` / `#222428`, as metades da noite) e tinta âmbar `#f2b33d` (7,4:1 ou mais). Lado a lado na troca, PARANDO e AGUARDA tinham o mesmo âmbar e só se separavam lendo a palavra; a seta ↑/↓ só cabia no destino.
- **Vermelho Falha** (`fail`): só o que ficou de pé errado: SEM API / SEM FRONT (um lado caiu), erros de projeto e de formulário. Uma troca de rotina nunca fica vermelha: parar à força é rotina (o alvo sobe, a anterior sai como pedido), então a palheta SIGKILL é âmbar enquanto acontece e a linha volta a INATIVA logo que o processo sai; no recado, "à força" é tinta cheia (`ink`, 600), não `fail`: era a única palavra vermelha de um fecho de rotina. Em vermelho, o SIGKILL durava 8 s depois do fim e banalizava a cor.

### Neutral
- **Fundo do Painel** (`board`): chão da janela, do terminal (`--term-bg`) e dos campos de formulário.
- **Trilho** (`rail`): barra lateral e todas as superfícies flutuantes (paleta, ajuda, diálogos), e blocos de código no estado vazio.
- **Palheta** (`flap`, `flap-hi`; na peça, `--flap-top` / `--flap-bot`): as duas metades de toda palheta (à noite, `flap-hi` em cima e `flap` embaixo; de dia, o estado mora no corpo e não na tinta: metades verdes `#6ccf9c` / `#55c08a` em RODANDO, âmbar `#f6c45f` / `#f0b33f` em SUBINDO, AGUARDA, PARANDO e SIGKILL, vermelhas `#f4a29b` / `#ee8a82` em SEM API / SEM FRONT, todas com tinta cheia `#15161a` a 7,4:1 ou mais e degrau de 1,16–1,22:1 (`--state-top` / `--state-bot`); INATIVA fica nas metades neutras `#d2d3ce` / `#c3c5bf` com tinta `#45474c` (5,3:1). Tintas escuras de estado sobre o mesmo cinza tinham a mesma luminância (1,00–1,04:1 entre si): ao lado do editor, RODANDO, PARANDO e INATIVA só se separavam lendo a palavra. Na linha atual o corpo de estado não muda; a neutra clareia em cima até `flap-hi`). O terminal e o resto da interface ficam com `run`/`start`/`fail`; `flap` sozinho é o fundo da linha atual; o hover fica a meio caminho entre `rail` e `flap` (`--hover`, `color-mix`), para não se confundir com ela.
- **Corte:** não é cor. É o entalhe em V da dobradiça, recortado na silhueta da palheta (`clip-path`), nas duas bordas, no meio da altura, nos dois temas. Marcas escuras de 2×1px nas pontas não se viam a 1x, e maiores liam como hífens ("‑RODANDO‑").
- **Fio** (`rule`): toda borda de 1px e divisórias.
- **Meia-tinta** (`ink-2`): texto em repouso, prefixo da branch, separador `/` (em `ink-3` dava 4,15:1 no escuro), ícones, dicas, estado INATIVA.
- **Tinta Apagada** (`ink-3`): contorno tracejado do encaixe vazio (na legenda), polegar da barra de rolagem (o único sinal de que há mais conteúdo; em `rule` dava 1,3:1), fios da linha atual e do item selecionado, contorno dos campos. Passa 3:1 sobre `board`, `rail`, `flap` e `flap-hi` nos dois temas, então serve de indicador não textual; não serve para texto que precise ser lido.
- **Véu** (`scrim`): atrás dos diálogos modais. De dia é um véu de tinta (24%), não de esmalte: claro sobre claro, os diálogos não se destacavam do terminal.

A marca na barra lateral redesenha a geometria da logo (a palheta H) com `--mark-bg-hi` / `--mark-bg` nas duas metades, `--mark-seam` no corte e `--mark-ink` no H (palheta e tinta à noite; tinta e esmalte de dia). A travessa usa `--mark-run`, o verde da marca nos dois temas: o `run` de dia é escuro demais sobre a palheta escura. O arquivo `app-icon.svg` é compromisso de marca e mantém as próprias cores.

### Named Rules
**A Regra de Uma Cor por Estado.** Verde é de pé, âmbar é em movimento (subindo, aguardando, parando), vermelho é falha (parcial, erro); o SIGKILL é âmbar, porque parar à força ainda é movimento. Dentro do âmbar, a polaridade separa quem morre de quem espera: PARANDO e SIGKILL são a palheta invertida, nunca outra cor. A contagem até o SIGKILL fica em tinta neutra e só aparece com o Forçar (2 s): esperar é o caminho normal. Nenhuma outra cor entra na interface: foco, caret, seleção, botão primário e checkbox (`accent-color`) são tinta neutra.

**A Regra da Tinta em Serviço.** Só o que está em serviço (worktree atual ou rodando/subindo/aguardando) recebe tinta cheia; todo o resto fica em meia-tinta. Ênfase nunca vem de cor.

**A Regra do Terminal sem Moldura.** O terminal fica sobre `board`, o mesmo fundo do painel, sem borda nem cartão. E fica no fim: quem estava no fim continua no fim quando a faixa da troca entra e sai (`fitPane`; o xterm 6.0 prendia a vista uma linha acima e parava de acompanhar a saída, e toda troca com histórico terminava no "^C" da anterior, com o servidor subindo abaixo da dobra). Fundo, cursor e seleção do xterm são lidos dos tokens (`--term-bg`, `--ink`, `--selection`) ao criar o terminal e ao trocar de tema; vermelho, verde e amarelo do ANSI também (`--fail`, `--run`, `--start`), então seguem os estados sem cópia; as outras cores ANSI pertencem ao conteúdo do terminal, não à interface, mas todas passam AA (≥4,5:1) sobre o fundo do terminal nos dois temas.

## Typography

**Display Font:** Barlow Semi Condensed (com system-ui, sans-serif), auto-hospedada via @fontsource nos pesos 500, 600 e 700
**Body Font:** Barlow Semi Condensed (mesma família)
**Label/Mono Font:** JetBrainsMono Nerd Font (com Hack Nerd Font Mono, monospace)

**Character:** Uma condensada só, de quadro de horários, em três pesos; a mono aparece apenas onde há comando ou caminho de verdade. Números tabulares (`font-variant-numeric: tabular-nums`) em toda a raiz.

### Hierarchy
- **Display** (600, 22px): título do estado vazio.
- **Headline** (600, 19px): título dos diálogos; busca da paleta em 17px.
- **Title** (600, 17px): a faixa de destino (plataforma / branch).
- **Body** (500, 15px, 1.35): texto padrão, linhas do painel, campos.
- **Small** (500–600, 13px): par divergente, dicas, rótulos de campo (600, 0.02em), erros.
- **Label** (700, 12–13px, 0.08em, caixa-alta): nome da plataforma, abas API | FRONT, nome do projeto no destino e na paleta, títulos da ajuda, legendas de fieldset (numa placa `flap`, 12px).
- **Flap** (700, 12px, 0.06em, caixa-alta): texto das palhetas e etiquetas SÓ API / SÓ FRONT. Na faixa de destino, 14px: é o estado lido de relance, ao lado do editor.
- **Mono** (12px, 1.5): erros brutos, prévia de caminho, código no estado vazio.
- **Terminal** (14px, 1.15): xterm.

### Named Rules
**A Regra da Caixa-Alta com Conteúdo.** Caixa-alta espaçada é para nomes reais (plataforma, projeto, lado, estado) e títulos de seção da ajuda. Nunca para rótulos inventados acima de títulos.

## Layout

Duas colunas: a barra lateral (`--sidebar-w`, padrão 280px, redimensionável por uma alça de 5px (11px de área de clique, o excedente do lado do terminal) até deixar 440px para a área principal, limite refeito quando a janela ou o zoom mudam; `Ctrl+Shift+B` recolhe) e a área principal. Abaixo de 640px CSS (janela pequena ou zoom alto), os dois pisos (200px de painel e 440px de área) não cabem lado a lado: o painel começa fechado e abre por cima do terminal, com fundo `rail`, fio `rule` e a sombra Lateral, e fecha ao escolher uma worktree, com Esc em qualquer controle dele, com um clique no terminal ou quando o Tab sai dele (o botão de recolher fica debaixo do painel); a preferência salva não muda e volta quando a janela alarga. Ambas abrem com uma faixa de 44px separada por um fio de 1px (marca à esquerda; destino, abas, outros rodando e ajuda à direita). Embaixo da faixa da área principal, uma segunda faixa de 36px (`#strip`, fundo `board`, fio `rule` embaixo) existe só enquanto tem o que dizer: a troca em andamento e as falhas. Vazia, fica com altura zero, e não `display: none`, para a região viva da falha já existir quando ela chegar; o terminal desce 36px enquanto ela está lá. O terminal ocupa todo o restante, com respiro de `8px 4px 4px 12px`. Sem worktree aberta, o estado vazio ocupa esse lugar ancorado no topo à esquerda (`32px 40px`, até 560px), como o texto do terminal: centrado, flutuava num vão grande. No primeiro uso (sem projeto), ele mostra a troca em três linhas de painel, com as palhetas de verdade: PARANDO "a worktree anterior recebe Ctrl+C", AGUARDA "a nova espera as portas liberarem", RODANDO "API e front sobem, cada um no seu terminal".

O ritmo é denso e regular em passos de 2px: 4, 6, 8, 10, 14 e 22px. A margem lateral do painel é 14px (`gutter`) em todas as linhas, cabeçalhos de plataforma e no rodapé ("Novo projeto"); linhas têm 5px de respiro vertical; plataformas se separam por 10px. O nome alinha na margem de 14px e a palheta fica à direita dele, na coluna de situação de um painel de partidas, encostada na margem direita; linha nunca aberta não tem palheta nem reserva a coluna: o nome usa os ~80px justo onde ainda não há estado, e a palheta entra (virando) quando a linha abre. Os nomes alinham pela esquerda, então nada pula. Superfícies flutuantes: paleta 560px, diálogos 500px (ancorados a 8vh do topo, até 84vh: um erro ou a lista crescem para baixo e o diálogo não pula; em janela de até 860px de altura, a 16px do topo e até a altura menos 32px, para o Par do editar ficar à vista), ajuda 640px em duas colunas, atalhos | estados, com o leitor de tela embaixo atravessando as duas (uma coluna abaixo de 560px; até a altura da janela, com rolagem, e até a largura da janela menos 24px), paleta até a altura da janela (a lista cede e o rodapé fica à vista), todas limitadas a 90–92% da largura.

## Elevation & Depth

O sistema é plano. A profundidade do painel vem de tons (`board` < `rail` < `flap`) e de fios de 1px, não de sombras. A linha atual é marcada por fundo `flap` e fios internos em cima e embaixo (`inset 0 ±1px 0 ink-3`, ≥3:1), não por elevação. Só as superfícies que flutuam acima do terminal (paleta, ajuda, diálogos) recebem uma sombra curta, e sempre junto de uma borda de 1px em `rule`.

### Shadow Vocabulary
- **Flutuante** (`--float-shadow`: `0 4px 8px rgb(0 0 0 / 28%)` à noite, `0 4px 8px rgb(21 22 26 / 14%), 0 12px 28px rgb(21 22 26 / 14%)` de dia, na tinta; de dia o trilho fica a 1,08:1 do esmalte e só a sombra separa a superfície): paleta, popover de ajuda, diálogos de formulário.
- **Lateral** (`--side-shadow`: `8px 0 24px rgb(0 0 0 / 70%)` à noite (preto sobre grafite quase não se via), `6px 0 16px rgb(21 22 26 / 16%)` de dia): o painel aberto por cima do terminal na janela estreita. A borda que importa é a direita; a Flutuante caía para baixo e sumia ali.

### Named Rules
**A Regra do Plano no Painel.** Nada no painel ou na faixa de destino tem sombra. Sombra existe só para o que flutua sobre o terminal, e é curta.

## Shapes

Cantos quase retos em três degraus: 2px para palhetas, abas e etiquetas; 4px para botões, campos, fieldsets e teclas; 6px para superfícies flutuantes. A palheta de estado é a única forma com corte: gradiente `flap-hi 50% / flap 50%` e o entalhe em V da dobradiça recortado nas duas bordas, no meio da altura, como numa palheta real. Um fio inteiro atravessaria a altura-x e leria como tachado. Placa da plataforma e aba selecionada são `flap` lisos: a assinatura fica reservada ao estado.

Ícones são SVG desenhados em traço único: viewBox 16, 16px, `stroke-width: 1.5`, pontas e junções arredondadas, `stroke: currentColor`, sem preenchimento; a variante inline tem 12px. O marcador de `<details>` é um chevron desenhado em CSS com o mesmo traço de 1.5px.

## Components

### Palheta (assinatura)
O estado de cada worktree em 7 caracteres.
- **Forma:** bloco de `7ch + 20px` × 22px, raio 2px, metade de cima `flap-hi`, de baixo `flap`, entalhe em V de 2,5px × 6px recortado em cada borda, no meio da altura (`clip-path`, nos dois temas). Na linha atual e no item selecionado da paleta, cujo fundo já é `flap`, a metade de baixo desce para `board`: igual ao fundo, ela sumia na linha e a palheta lia como uma aba cinza. De dia a de cima sumiria na linha: ali ela clareia até `flap-hi` e a de baixo fica a da palheta, mais escura que a linha. Na faixa de destino: 26px de altura, 14px, largura fixa, a do rótulo mais largo que ela pode ter (FRONT PARADO numa worktree com os dois lados, ↓ PARANDO numa solo: os rótulos empilhados e invisíveis, como nos botões; crescendo de RODANDO a API PARADA, ela empurrava "Parar tudo" para baixo do cursor) e o sentido desenhado antes da palavra, uma seta de 12px no traço do sistema: ↑ em SUBINDO, ↓ em PARANDO. Os três âmbares (SUBINDO, AGUARDA, PARANDO) só se separavam pela palavra.
- **Estados:** RODANDO (`run`, API e Front de pé), SEM API / SEM FRONT (`fail`, um lado caiu, e a palheta diz qual, com um quadrado cheio de 6px (raio 2px) antes do texto; "1 LADO" não dizia. É a única palheta que alarga além de `7ch + 20px` (`0 7px` de respiro), e a falha se destaca na coluna. Antes de 1 LADO era PARCIAL, era PARCIAL, que começava com PAR como PARANDO e, em vermelho ao lado do âmbar, se confundia com ele; o estado é lido por terminal, nunca somado), API PARADA / FRONT PARADO (`held`: um lado parado pelo botão ou pelo atalho, o outro de pé; o particípio do botão que o parou, "Parar API". Antes dizia SEM API, o mesmo texto da falha, e uma palavra nomeava dois estados opostos. Na palheta neutra de INATIVA nos dois temas, nunca `fail`: foi pedido, não caiu. O quadrado é vazado (contorno de 1,5px, o traço do sistema): à noite, `fail` e `ink-2` ficam a ~1,2:1 de luminância, e só a cor separava os dois "SEM X" para quem não distingue vermelho. O quadrado é o mesmo das abas. Antes ficava RODANDO com só um ponto na aba, e o leitor de tela ouvia "rodando"; fala "só Front rodando, API parada à mão"), SUBINDO (`start`), AGUARDA (`wait`, também a própria worktree ao voltar para ela), PARANDO (`wait` invertido: corpo âmbar à noite, grafite de dia), SIGKILL (`wait` invertido, passou do prazo ou foi forçada; só enquanto acontece), INATIVA (meia-tinta, `ink-2`; a palavra não começa com PAR para não se confundir com PARANDO), encaixe vazio (nunca aberta). No painel a linha nunca aberta não tem palheta (ver Linha); na paleta o encaixe ocupa a coluna sem desenhar nada; só a legenda da ajuda o desenha, como um contorno tracejado `ink-3` da largura da palheta (os entalhes que ele tinha liam como hífens, "–  –"). De dia a palheta tem metades e tintas próprias (ver Cores), 5:1 ou mais em todo estado.
- **Prévia ENCERRA:** com o cursor ou o foco numa linha do mesmo projeto, a linha em serviço mostra ENCERRA em âmbar (só CSS, `:has`), só com o contorno (`--ends-line`: 1px à noite; de dia 2px e um creme âmbar por dentro, `--ends-bg` `#f7e7c0`, com `#855000` a 5,45:1: de 1px, ficava abaixo do RODANDO verde que substitui e lia como "o estado sumiu"), sem as metades nem os entalhes: é prévia, não estado, e a forma da palheta fica para o que é verdade agora (a mesma forma no rodapé da paleta, no "Abrir ao criar" e na legenda): o clique é destrutivo e o painel mostra o que ele mata antes de matar. Não vira (o estado não mudou) e espera 120ms, para o cursor de passagem não fazer a palheta piscar. É o único nome da prévia: o rodapé da paleta e o "Abrir ao criar" usam a mesma palheta ENCERRA, nunca PARANDO (que afirmaria uma parada que ainda não começou). Os botões de parar também têm prévia: com o cursor ou o foco em "Parar API", a aba aberta ganha o contorno âmbar; no que para a worktree inteira ("Parar tudo", ou "Parar API" numa solo), as abas, a palheta do destino e a da linha atual no painel, que mostram ENCERRA. Sem atraso: o cursor no botão já é intenção.
- **Contagem:** na faixa da troca, uma palheta estreita (`4ch + 14px`, 12px) conta os segundos até o SIGKILL em tinta cheia (`ink`) e vira a cada segundo. Entra com o Forçar (`FORCE_DELAY`, 2 s): na troca típica (1–2 s), contar até um SIGKILL que não vem era ansiedade à toa.
- **Movimento:** vira em 3 quadros discretos (`180ms steps(3, jump-none)`, `scaleY 1 → 0.12 → 1` no texto) e só quando o estado daquela palheta muda. Com `prefers-reduced-motion: reduce`, a troca é seca, sem animação.

### Linhas do painel
- **Estrutura:** cada linha é um contêiner com dois botões irmãos: o de trocar (grade nome | palheta) e, numa coluna reservada na borda direita de todas as linhas, o lápis de editar: alvo de 24px (WCAG 2.5.8; colado no botão da linha, não tem folga que dispense o mínimo), ícone de 14px no traço do sistema. O lápis tem opacidade 0 até o cursor ou o foco entrar na linha (opacidade, não `visibility`: as setas ainda o alcançam); hover `flap-hi`. Rodando ou numa troca, ele fica `aria-disabled` em `ink-3`, com o motivo no nome e no title ("troque para outra worktree do projeto antes de editar"); desabilitado, aparece com o cursor na linha ou o foco nele, mas não com o foco que ficou na linha depois do clique (ao lado do AGUARDA era ruído). O fundo do hover e da atual fica na linha inteira, lápis incluído. No botão de trocar: branch com prefixo (`feat/`) em meia-tinta e nome em tinta cheia quando em serviço; par divergente numa segunda linha (13px, seta de par desenhada em SVG inline); se os dois lados só diferem no prefixo, o nome aparece uma vez e a segunda linha mostra só os prefixos, sem a barra final (`feature-api ⇄ feature-app`: com ela, parecia cortado); etiqueta SÓ API / SÓ FRONT nas solo, também na segunda linha, para a primeira ficar inteira para o nome, e na altura da linha do par (linha de 14px): as linhas têm duas alturas, uma linha e duas, não três. Fora do painel (destino, paleta, faixa da troca, outros rodando), o mesmo par cabe numa linha: o nome uma vez e os prefixos depois, em 13px `ink-2` (`motor-x feature-api ⇄ feature-app`). Sem espaço, o nome trunca no meio e o tipo fica: `fix/calculo-de-…agrupados` (o fim é a última palavra, até 10 letras, ou os últimos 7 caracteres; nomes de até 18 caracteres truncam no fim). O texto é medido em canvas, então o "…" encosta no fim, sem o vão que o `text-overflow` deixava. Só quando o começo do nome ficaria com menos de 3em o prefixo sai inteiro (nunca "f." com cara de abreviação), e a decisão é por linha (uma branch longa não tira o `hotfix/` das vizinhas).
- **Ordem:** a do git, fixa. A linha não muda de lugar ao entrar em serviço; só a palheta vira.
- **Estados:** repouso transparente com texto `ink-2`; hover `--hover` (de dia mais perto do trilho, 35% de `flap`: a meio caminho ficava a 1,1:1 da atual); atual `flap` com fios internos `ink-3` em cima e embaixo; foco com o anel na linha inteira, coluna do lápis incluída, recolhido para dentro (`outline-offset: -2px`).
- **Teclado:** o painel é uma parada de Tab só (roving tabindex); setas, Home/End navegam; → vai da linha ao lápis e ← volta, e com o foco nos lápis as setas andam pela coluna deles. O painel recriado devolve o foco ao mesmo controle pela `data-key`, comparada direto (a chave tem `\u0000`, que o `CSS.escape` troca).
- **Editar worktree** (diálogo de formulário, 500px): projeto / worktree no topo; branch num campo só (par de nome igual ou solo) ou um por lado (par divergente); por lado, o aviso do upstream quando a branch muda de nome, a caixa "Mover a pasta junto" com a prévia do caminho e "Alterar diretório" (a pasta principal de um repo não-bare não move e o diálogo diz por quê) e o comando de start recolhido num `details` "Comando de start" (renomear é a tarefa comum; aberto quando a worktree tem comando próprio), com o do projeto no placeholder ("padrão do projeto: npm run dev"; vazio, o prefixo do gerenciador sai e o placeholder diz o comando inteiro, senão lia "npm run padrão do projeto…"); o seletor de par no lado que falta (Sem · Criar `<branch>` na API/no Front · Parear com uma solo; a solo rodando aparece desabilitada) ou no Front de um par manual (Pareada · Desfazer o par); "Os terminais dela fecham ao salvar." (só se ela foi aberta nesta sessão) logo abaixo do projeto / worktree, no topo (embaixo, o rodapé fixo a cobria). Erros caem no campo do lado culpado. Salvar não sobe a worktree: o cabeçalho diz "Editada: feat/x → feat/y" e o foco volta ao lápis.
- **Sem projeto:** só a placa "SEM PROJETO" em `ink-2`, vazia como um encaixe (sem fundo, contorno tracejado `ink-3`; cheia, parecia um botão desabilitado); uma linha "Nenhuma worktree ainda" repetia o centro. Não é clicável: o painel não duplica o "Criar projeto" do centro, que recebe o foco ao abrir; sem projeto, `Ctrl+Shift+N` e `Ctrl+Shift+L` dizem no cabeçalho que falta criar um e levam o foco até ele.
- **Config quebrado com uma worktree aberta:** o painel fica com a última leitura boa e, no topo, um `.problem` ("O config tem um problema; o painel mostra a última leitura boa.") com o erro cru e "Abrir o config.json". Sem worktree aberta, quem diz é o centro, e o painel não repete.
- **Recolher:** a placa do projeto é um botão (`aria-expanded`) com chevron de 12px; recolhido, o projeto mostra só a worktree ativa (o estado de pé nunca some) e `+N` em `ink-2` com as ocultas; o erro de projeto também sai da frente e fica no title da placa. Lembrado entre sessões.

### Abas (API | FRONT)
- **Forma:** 26px de altura, raio 2px, rótulo em caixa-alta 12px/700.
- **Não selecionada:** sem contorno (o contorno é dos botões: com ele, as abas pareciam as ações e as ações, texto solto), texto `ink-2`; hover `--hover` e `ink`. **Selecionada:** fundo `flap` liso, sem contorno, texto `ink` e um fio de 2px em `ink` na base (`inset`, não é sombra): o fundo sozinho dá 1,2:1 sobre `board` e não distingue o estado. **Lado caído (SEM API / SEM FRONT):** texto `fail` com um quadrado de 6px (raio 2px) na frente. **Lado parado à mão** (Parar API com o Front de pé; a palheta diz API PARADA em neutro): o mesmo quadrado, vazado (contorno de 1,5px em `ink-2`), como na palheta, texto da aba sem mudar, " (parado à mão)" para o leitor de tela e no title o atalho de subir. **Lado parando** (só ele, pelo botão ou atalho): o quadrado em `wait` e " (parando)"; a palheta da worktree fica com o estado dela, PARANDO só quando todos os lados param (antes, parar a API punha PARANDO na worktree inteira com o Front de pé). O lado caído fala " (caiu)". A legenda da ajuda tem os três quadrados, na ordem caiu, parando, parado à mão: cheio é o que aconteceu (caiu, parando), vazado é o que foi pedido.

### Buttons
- **Shape:** cantos discretos (4px), 32px de altura, `0 14px`, 600.
- **Primary:** fundo `ink` (`--primary`), texto `board` (`--primary-ink`); hover em `ink-2`. Vem primeiro no DOM (Enter envia por ele) e aparece à direita (`row-reverse`). Nos diálogos, a fileira de botões fica presa ao pé (`sticky`, fundo `rail`, fio `rule` em cima): com os dois lados do Novo projeto abertos, o principal ficava abaixo da dobra.
- **Secondary:** contorno `rule`, fundo transparente, texto `ink`; hover `flap`.
- **Ícone:** 28×28, raio 4px, ícone `ink-2`; hover fundo `flap` e ícone `ink`; desabilitado a 0.5 de opacidade, como os botões de texto (em `ink-3` ficava perto demais do habilitado). O `+` de um projeto com erro fica `aria-disabled` (focável, com o motivo no nome), não `disabled`.
- **Rodapé do painel:** uma linha só, de 40px, com fio superior: "Novo projeto" (botão quiet com ícone de pasta com +, para não repetir o `+` de nova worktree das placas; texto `ink-2`, hover `ink` sobre `flap`) ocupa a largura, e "Reler worktrees" e o tema são botões de ícone de 28px na ponta (reler com `Ctrl+Shift+L`, listado na ajuda). O de tema mostra o tema que o clique traz (sol à noite, lua de dia, no traço do sistema), com "Mudar para o tema claro" no nome e, no title, o tema em vigor e se veio do sistema ("Tema escuro (do sistema) · clique para o claro"). O tema não tem atalho: troca-se pouco, e nenhum outro trabalho espera por ele. Enquanto lê, o reler fica `aria-disabled` (o foco não sai dele), em `ink-3`, e o ícone gira em 8 degraus (`steps(8)`, desligado com reduzir movimento); ao terminar, o cabeçalho diz o que mudou na mesma região `status` do "Parou em" ("Worktrees relidas: nada mudou.", "nova: interno / feat/x", "2 novas · 1 saiu"). Sem projeto, o rodapé inteiro some: a ação é o "Criar projeto" do centro (e o tema segue o que estava).
- **Parar / Subir** (cabeçalho, depois da porta, abertos por um fio `rule` de 1px na primeira ação à mostra: abas e porta dizem o que está aberto, as ações dizem o que fazer; o fio quebra junto com ela): botões de texto com verbo e objeto, "Parar API" (ou Front, a aba aberta) e "Parar tudo" (os dois lados; só em par), "Subir…" quando nada roda; 26px, `0 10px`, 13px/600 `ink`, com o contorno `rule` dos botões secundários, hover `flap`; os dois com 4px de vão entre si. Um quadrado desenhado lia como maximizar ou checkbox. Parar age na aba aberta, como o atalho promete; subir age no lado caído ou parado à mão seja qual for a aba: com a API parada à mão, a aba da API diz "Subir API" e a do Front "Parar Front" (antes, olhando o Front, "Parar a aba" dizia "Nada rodando em API" e a única saída era Alt+X). Com um lado caído, o botão é "Subir Front" seja qual for a aba: a saída da falha. Cada botão tem a largura do maior rótulo que pode ter (todos empilhados na mesma célula, invisíveis e `aria-hidden`, o atual centrado): clicar em "Parar API" virava "Subir API", e a porta da API saía da faixa; "Parar tudo" deslizava para baixo do cursor, com a prévia ENCERRA acesa, e o segundo clique parava a worktree inteira. Depois de um clique de mouse nas ações, a porta fica como estava até o cursor sair do cabeçalho (a que sumiu guarda o lugar, a que apareceu espera); o segundo clique de um duplo clique não age (o verbo vira na hora, e ele parava o que acabara de subir). Enquanto isso o aperto da faixa e o projeto do destino também ficam (a 960 recolhido o "INTERNO /" voltava e "Parar API" andava 73px), e a prévia ENCERRA não acende (`header.acted`): o botão sob o cursor virou Parar, e o hover pintava de ENCERRA o que acabara de subir. O title tem o atalho do verbo à mostra (`Ctrl+Shift+X` para, `Ctrl+Shift+S` sobe; com Alt, os dois lados), também em `aria-keyshortcuts`. Um atalho por verbo: o que alternava fazia o contrário do pensado no reflexo (durante SUBINDO, com um lado caído); no estado errado ele não faz nada e o recado diz o outro ("Nada rodando em API · Ctrl+Shift+S sobe"). Parar ou subir tira os recados do projeto (como a troca): "Nada rodando" ao lado de RODANDO, ou "Parou à força" ao lado de ↓ PARANDO, contradiziam o estado. Quando "Parar API" ou "Parar tudo" não cabe (`header.tight`, decidido em `fitHeader`: um corte em 800px fazia as ações caberem a 830 e irem para o ⋯ a 860), os vãos da faixa vão de 12 para 8px e os botões perdem 2px de respiro de cada lado (`0 8px`); numa troca do projeto somem (a nova sobe sozinha, e "Subir" ali dizia o contrário); numa parada à mão ficam `aria-disabled` a 0.5 com o motivo.
- **Troca, na segunda faixa:** do Ctrl+C ao SIGKILL a troca fica na segunda faixa, embaixo do cabeçalho, com a largura inteira: "Parando" (13px `ink-2`, o verbo da palheta PARANDO; ENCERRA fica só para a prévia), "Voltar e reiniciar X" (logo depois do verbo, para a contagem que entra aos 2 s não o empurrar ~110px; botão de 26px; "Voltar para" prometia desfazer, e o Ctrl+C já foi; depois do clique a faixa diz "Reiniciando" (empilhado com "Parando", na mesma largura) e a linha da anterior fica PARANDO, ou SIGKILL, até ela subir de novo; o Voltar guarda o lugar, invisível, e o Forçar ignora o segundo clique: num duplo clique ele deslizava para baixo do cursor e mandava SIGKILL, o nome trunca até 420px) e, depois de 2 s (`FORCE_DELAY`), "SIGKILL em" e a contagem numa palheta estreita em tinta neutra (sem o rótulo, "Parando [3 s]" lia como "a nova para em 3 s") e "Forçar", afastado do Voltar por um fio. No SIGKILL, "Parando", a palheta SIGKILL e "depois sobe Y" ("reinicia em seguida" ao voltar), sem botões ("Forçando [SIGKILL]" dizia o verbo duas vezes; o que vem depois ficava só no title, no momento de mais risco): o backend espera no máximo 1 s depois do sinal e a troca segue sozinha. Uma casa só, sem véu nem card: o card entrava aos 3 s, 2 s antes do SIGKILL padrão, mudava o Voltar de lugar e puxava o foco no meio da espera. Na faixa de cima, ao lado do destino, ela apertava em 4 degraus medidos (`data-tight`) e a meia tela perdia o verbo e a contagem; aqui nada disputa a largura. Abaixo de 480px (janela pequena ou zoom alto) o nome sai e fica "Voltar e reiniciar" ("Voltar main" prometia desfazer); sem espaço, o nome do Voltar perde o prefixo ("Voltar login") e só então trunca no meio (`cutBack`, o inteiro no title). Para onde se vai é o que se procura; Voltar e Forçar ficam. Nenhum botão é primário nem recebe o foco: o foco vai para a faixa, um `group` com nome ("Troca em andamento"), com o anel no verbo (em volta do grupo, envolvia Voltar e Forçar e parecia uma seleção de botões), e Voltar vem antes de Forçar (Tab + Enter nunca vira SIGKILL). Sem atalho de Esc: no reflexo do vim, ele desfazia a troca recém-pedida. Com a paleta aberta, nenhum atalho age atrás dela (só `Ctrl+Shift+K`, que a fecha; antes `Ctrl+Shift+X` parava a API e o rodapé dela ficava desatualizado); a paleta é `aria-modal`. `Ctrl+Shift+J` numa solo diz "Só API: nada para alternar". `Ctrl+Shift+X`/`S` durante a troca não fazem nada e o recado diz "Troca em andamento · Voltar ou Forçar na faixa" (numa parada à mão, "Parando · espere os processos saírem"); mudos, pareciam tecla que não pegou. O que recebe o Ctrl+C (o processo em primeiro plano, `npm run dev`) e o que sobe em seguida (só o nome; prefixos de par no meio da prosa liam como ruído) ficam no title da faixa e numa região viva só de texto ("Parando X: Ctrl+C enviado a npm run dev. Quando as portas liberarem, sobe Y."). O terminal novo fica à vista e não aceita digitação até subir, e diz isso: sem o cursor e com "Aguardando X parar · digitação liberada em seguida" (`#term-note`, 13px `ink-2` sobre `term-bg`, sem moldura) na linha logo abaixo do cursor, alinhado à coluna do texto, onde a primeira tecla iria; acompanha o cursor a cada contagem (o prompt chega depois) e, com o cursor na última linha, vai para o canto de cima à direita. No canto, a 1440, ficava a ~1100px do olho; engolir as teclas em silêncio parecia travamento.
- **Recado do fim:** Ao terminar, o cabeçalho diz, depois das ações, quanto a anterior levou, com o tempo primeiro ("Parou em 1,8 s · feat/x" e "Parou à força em 7,0 s · feat/x" por 8 s, este com "à força" em tinta cheia 600), em 13px `ink-2`, numa região `status` (`#last-stop`). É o último do `#flow` e o primeiro a quebrar para fora da faixa, e só fica nela se a branch em serviço couber inteira ao lado dele (`fitHeader` mede com o piso na branch inteira; senão `#last-stop.out` quebra a linha): a 1440 o "Parou à força em 5,7 s · …" encolhia a branch recém-trocada por 8 s. Antes de sair, ele encurta: o nome da anterior (que já está INATIVA no painel) sai da vista e fica no title e no leitor de tela ("Parou à força em 5,7 s"). Fora da faixa, a cópia dele vai para o canto de cima à direita do terminal (`#term-note`, `aria-hidden`: o `#last-stop` já falou) pelos mesmos 8 s: a meia tela a troca terminava sem fecho. Vazio, ele devolve o vão. O recado nomeia o projeto (`PROJETO / branch`) quando não é o atual, e não repete a worktree em serviço, que o destino logo acima já diz ("Parou em 0,4 s · API"); o "Parou em" de um projeto sai quando uma nova troca começa nele (ao lado de PARANDO/AGUARDA, dizia que esta já tinha acabado). A anterior encerrada à força não é falha, e a linha dela volta a INATIVA assim que o processo sai. **Falhas** ficam na segunda faixa (`#alert`, região `status`), independentes do recado de rotina (uma queda no LEILAO não apaga o "Parou em" que acabou de sair no INTERNO), até a próxima troca ou o × de 24px: o verbo em `fail` (a mesma voz da palheta SEM FRONT que explicam), quem caiu trunca, e depois a causa lida do terminal: a primeira linha com error, ERR!, EADDRINUSE, exception, fatal ou failed nas últimas 15 do lado que caiu, em mono 12px `ink-2`, truncando ("Front caiu · Error: listen EADDRINUSE: address already in use :::3000"); sem casar, sem causa. Na faixa de cima elas apertavam, cediam e iam para o canto do terminal. São falhas: um SUBINDO que desiste depois de 15 s ("Front não subiu em 15 s · feat/x") e a queda de um lado, também na worktree atual ("Front caiu", sem o nome que o destino já diz; olhando a aba da API, o Front caído era só um ponto de 6px), que só a palheta não levaria ao leitor de tela. Com um lado caído na atual, o botão de um lado vira "Subir Front" seja qual for a aba aberta, e subir tira o recado; se ele quebrou para fora da faixa, a falha traz o seu "Subir Front" (só então: os dois à vista repetiriam a ação). Essas duas trazem "Ver o terminal" (24px, o alvo mínimo, contorno `rule`, 12px/600), que leva à worktree e à aba do lado que caiu (só se ela ainda for a ativa do projeto: senão seria uma troca); durante a troca o destino fica com `aria-live="off"` para não falar junto com a faixa da troca.
- **Disabled:** opacidade 0.5. **Ocupado** (clonando, criando): mesma opacidade com `aria-disabled` e cursor `progress`, nunca `disabled`, que jogaria o foco do teclado no `body`, atrás do diálogo; o clique repetido é ignorado e o texto diz o que está fazendo ("Clonando…", "Criando…").

### Chips
- **Etiqueta:** contorno `rule` de 1px, raio 2px, `0 4px`, 12px/700 com 0.06em, texto `ink-2`.
- **Tecla (`kbd`):** fundo `flap`, contorno `rule` com base de 2px, raio 2px, 12px/600.

### Cards / Containers
- **Corner Style:** 6px.
- **Background:** `rail`.
- **Shadow Strategy:** sombra Flutuante na paleta, ajuda e diálogos.
- **Border:** 1px `rule`.
- **Internal Padding:** 22px 24px (aviso), 20px 22px (diálogos), 16px 18px (ajuda).

### Inputs / Fields
- **Style:** 34px, fundo `board`, contorno `ink-3` 1px (≥3:1), raio 4px, 15px/500; placeholder `ink-2`; select com seta desenhada em gradiente; checkbox com `accent-color: ink`; o rótulo inteiro é o alvo da caixa de 15px, com 24px de altura no mínimo.
- **Focus:** anel neutro de 2px em `--focus` (tinta), afastado 2px, em todos os controles.
- **Error / Disabled:** erro em texto `fail` 13px abaixo do campo, resumo legível com o erro cru do git em mono `ink-2` embaixo; campos vazios recebem a mesma mensagem do app logo abaixo do campo (`aria-errormessage`; os formulários têm `novalidate`, sem a bolha nativa do WebKit); o campo culpado ganha contorno `fail` e o foco; placeholder começa com "ex.:", para não parecer valor digitado; depois de um erro parcial, o botão nomeia o lado que falta ("Criar no Front") e a branch fica travada (`readonly`, em `ink-2`), porque o outro lado precisa do mesmo nome; fieldset desabilitado a 0.45, menos o aviso do lado ("Já criada em…"). Fieldsets com `min-inline-size: 0`: um caminho longo não alarga o diálogo.
- **Repositório no Novo projeto:** escolher a pasta ou sair do campo depois de colar lê as worktrees dela (sem botão de ler). Logo abaixo da linha do repositório, a dica do `.bare`; depois o erro (resumo "Essa pasta não é um repositório git." / "Essa pasta não existe." e o cru em mono), depois a lista do que o painel vai mostrar: contagem em `ink-2` e branches em `ink-2`/600 (nada ali está em serviço), o caminho em mono só quando foge de `<pasta>/<branch>` (o completo no title), no máximo ~6 linhas com rolagem. Leitura sem worktree diz o próximo passo ("Depois de salvar, crie a primeira pelo + do projeto"). Com `gh`, cada lado abre com a escolha "Pasta local | Clonar do GitHub" (rádios com a forma das abas API | FRONT, sentença e não caixa-alta: não são nomes) e mostra um caminho só. No GitHub, "Repositório no GitHub de <conta>" (rótulo com a conta do `gh`, para dizer de quem são os repositórios) com o mesmo `.dir-row` do repositório: campo com sugestões nativas (`<datalist>`, "ex.: dono/repositório") e "Clonar…" com o estilo de "Escolher…"; clonando, o botão diz "Clonando…" e campo e botão ficam desabilitados; o erro do clone vai para o mesmo `.side-error` do lado, com o campo do GitHub marcado; clonado, o lado volta para a pasta local, com o caminho e as worktrees lidas à vista. Enviar com o repositório vazio também volta para a pasta local, para o erro cair num campo visível. Sem `gh`, a escolha e o campo do GitHub somem e uma dica `ink-2` logo abaixo do nome diz por quê.

### Navigation
- **Paleta de troca** (`Ctrl+Shift+K`): busca de 44px com ícone de lupa (o campo não tem anel: com o foco nele, o fio de baixo da busca vira `--focus`), lista com nome do projeto em rótulo caixa-alta; nomes em `ink-2`, tinta cheia só no que está em serviço, na atual e no item selecionado; item na ordem do painel, nome | projeto | palheta, com a palheta na coluna de situação à direita; item selecionado igual à linha atual (`flap` + fios internos `ink-3`); cada termo da busca (separados por espaço: "int login") casa dentro do projeto ou dentro da branch, nunca atravessando os dois ("log" não casa LEILAO + landing); onde casou fica em tinta cheia e 700, sem cor nova, no nome e no projeto; a subsequência só acende quando o termo não casou como trecho em nenhum dos dois campos ("int" achado em INTERNO acendia i…n…t em "login-timeout"); sem projeto, o campo diz "Sem projeto: Enter cria o primeiro"; ordem por qualidade do casamento (trecho no começo de palavra > trecho > subsequência, o pior termo decide), depois recência; a subsequência só entra quando nenhum item casa como trecho ("log" achava l…o…g espalhados em "calculo-…-agrupados"); sem projeto, a lista diz "Nenhum projeto ainda: Enter cria o primeiro." e o rodapé "Enter criar projeto"; a atual leva a etiqueta ATUAL e as solo, SÓ API / SÓ FRONT, como no painel; ao abrir e a cada letra digitada, a seleção cai no primeiro item que não é a atual (ao abrir, a anterior, como no Alt+Tab; digitando, a atual ganhava o desempate pela recência e o Enter nela não fazia nada); com a atual selecionada (a busca achou só ela), o rodapé diz "Enter já é a atual" (o Enter só fecha; "trocar" prometia uma troca que não vem), e na ativa de outro projeto "Enter ir para" (leva até ela sem trocar nada); rodapé com uma mini palheta ENCERRA e o que o Enter ou o clique encerra, com o processo em mono ("[ENCERRA] feat/x (npm run dev) em PROJETO": a palheta já é o verbo; sem espaço, só o nome da worktree trunca); com esse aviso, a legenda Enter/Esc sai e o rodapé inteiro é dele; o mouse também move a seleção.
- **Faixa de destino:** projeto em rótulo caixa-alta `ink-2`, separador `ink-2`, branch em 17px/600 e a palheta depois dela, maior que a do painel (14px, com o sentido desenhado); depois as abas e, num `#flow` que quebra linha, a porta, as ações, os outros projetos em serviço e o recado. **Quem cede é CSS, não medida.** O destino tem base no piso (o projeto, a branch até 160px e a palheta, medido em `fitHeader` a partir do texto) e um fator de crescimento enorme; o `#flow` tem fator de encolhimento 1000. Acima do piso, a largura vai primeiro para os acessórios e o que sobra para o resto da branch; o que não cabe no `#flow` quebra para uma segunda linha, a 56px, fora dos 44px da faixa (`overflow: hidden`, com 8px de respiro onde cabem os anéis de foco), de trás para a frente na ordem do DOM: o recado, os outros projetos, "Parar tudo", "Parar API" e por último a porta, o link usado o dia todo. Antes, ~15 degraus medidos em JS (`dense`, `ceded`, `tight`, `data-tight` 1 a 4, duas passadas no `#running`) decidiam isso, e cada regressão de largura saía de uma medida errada. O JS mede só o que o CSS não sabe: o piso (depende do texto), a largura que o `#flow` usa de fato (`--flow-w`: o vão do que quebrou volta para a branch; a 600 sobravam 89px vazios ao lado de uma branch truncada), quem quebrou (fica `inert` e entra no ⋯), o sufixo do par e o projeto que saem do destino, e o corte no meio. Num par de prefixos diferentes, o sufixo ("feature-api ⇄ feature-app") é o primeiro a sair quando a branch não cabe (`.bare`), porque o nome em comum é o que diz a worktree; sem espaço, o nome do projeto trunca (até "INT…"; até 8 letras não trunca: com dois projetos que têm `main`, é ele que diz qual é) e só depois a branch; a palheta fica sempre inteira (coluna `auto`), para nada passar por cima das abas; abaixo do piso mínimo (112px; com 48px a 480 ficava "INTERNO /" inteiro ao lado de "fe…leilao"), o projeto e a "/" saem do destino (`.no-project`). **A meia tela é o caso base:** com as ações sem espaço (`.tight`; 960 num monitor de 1920, ao lado do editor) e o painel aberto ao lado, o projeto não aparece no destino (a placa e a linha atual estão à vista no painel) e os ~75px vão para "Parar API" e "Parar tudo", que iam para o ⋯; com o painel por cima ou recolhido, ele fica. A palheta que passa da largura de RODANDO (API PARADA, SEM FRONT, ↓ PARANDO) tira do piso da branch, não das ações: "Parar tudo" fica no mesmo lugar em todos os estados. Numa troca, os botões de parar somem mas guardam o lugar (`.hold`, invisíveis e `inert`): a branch não aparece inteira durante a troca para encolher no fecho. Com o painel aberto ao lado, o destino corta pelo começo, numa palavra (`endCut`, "…de-lotes-por-leilao", nunca "…or-de-lotes"): a linha atual guarda o começo e o fim, e com o mesmo corte nos dois o meio do nome não aparecia em lugar nenhum. O visível do destino é `aria-hidden` e o nome inteiro ("interno / feat/x: rodando") fica no `.sr`: truncado dentro da região viva, o leitor de tela ouvia "feat/agrupador-de-lotes-…leilao"; o title tem o nome inteiro. A branch trunca como no painel: o meio do nome primeiro, o prefixo (`feat/`) e o fim ficam, e o prefixo só sai inteiro quando o começo do nome ficaria com menos de 3em (`middleCut`), decidido pela largura real do texto (`Range`, com subpixel): `scrollWidth` e `clientWidth` são inteiros, e com a caixa em 212,70px e o texto em 212,77px a reticência do CSS cortava o fim ("…agrupad…"); um par de prefixos diferentes fica com a reticência do CSS. O que quebrou das ações não some sem rastro: entra um ⋯ (`#more`, 28px, três pontos desenhados, fora do `#flow`) que existe só enquanto algo quebrou e abre um menu flutuante (`#more-menu`, popover, sombra Flutuante) com um item de 32px por ação (setas andam entre eles), o atalho em `ink-2` 13px à direita ("Parar tudo  Ctrl+Shift+Alt+X", "Abrir :3333 no navegador") e a mesma prévia ENCERRA do botão que substitui. A porta do dev server da aba aberta (`:3333`, o endereço inteiro no title) fica logo depois das abas, junto da aba a que pertence, lida da saída do terminal, em mono 12px `ink-2`, link que abre no navegador padrão (sublinha no hover), curta o bastante para nunca truncar; troca junto com a aba. Com a barra recolhida, os outros projetos em serviço vêm à direita (margem automática no primeiro), depois de um fio `rule`, cada um um botão (28px, hover `--hover`, anel de foco por dentro, título "Ir para…") que leva até a worktree dele; cada um quebra sozinho e inteiro, e o que ficaria com a palheta além da borda sai (nunca uma palheta cortada; sem `max-width`, que espremia o primeiro da linha até "LEILAO /" sem branch nem palheta, numa troca a 600). O que saiu vai para o ⋯, antes das ações e separado delas por um fio ("LEILAO / main" e a palheta, levando até a worktree): sumia sem rastro, e nada dizia que o outro projeto seguia de pé. Uma falha em outro projeto (SEM API/FRONT) que a faixa não mostra (quebrou, ou painel fechado) aparece como um quadrado `fail` de 6px (raio 2px) no canto do botão do painel, com "falha em PROJETO" no nome e no title. O nome de projeto é caixa-alta em todo lugar.

## Do's and Don'ts

### Do:
- **Do** mostrar estado só pela palheta e pelas três cores de estado (`run` de pé, `start`/`wait` em movimento, `fail` falha).
- **Do** usar tinta cheia (`ink`) apenas no que está em serviço; o resto em `ink-2`.
- **Do** desenhar ícones como SVG de traço 1.5 em viewBox 16 (16px, inline 12px), em `currentColor`.
- **Do** animar só em degraus (`steps`), só na mudança de estado (ou enquanto um estado dura, como o reler lendo), e desligar com `prefers-reduced-motion`.
- **Do** dar a toda superfície flutuante borda `rule` de 1px, raio 6px, fundo `rail` e a sombra Flutuante.
- **Do** manter o terminal sobre `board`, sem moldura.
- **Do** definir todo valor novo nas duas paletas (noite e dia) com contraste AA.

### Don't:
- **Don't** introduzir cor de acento na interface: foco, seleção e botão primário são tinta neutra.
- **Don't** pôr cartões ou sombras no painel; linhas são linhas, separadas por respiro e fio.
- **Don't** usar easing em curva nem transições contínuas.
- **Don't** usar caracteres ou glifos como ícone; setas e chevrons são desenhados.
- **Don't** usar `ink-3` para texto que precise ser lido.
- **Don't** recolorir `app-icon.svg`; a logo é compromisso de marca.
- **Don't** voltar à árvore de arquivos estilo IDE (Explorer + quick-open em cinza VS Code).
