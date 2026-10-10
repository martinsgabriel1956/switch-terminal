---
name: switch-terminal
description: Painel de partidas para trocar de worktree; cada projeto é uma plataforma, cada worktree uma linha com palheta de estado.
colors:
  board: "#131417"
  rail: "#18191d"
  flap: "#222428"
  flap-hi: "#2b2d32"
  seam: "#0a0b0d"
  rule: "#2e3036"
  ink: "#ecebe6"
  ink-2: "#a5a59f"
  ink-3: "#747572"
  run: "#4cc38a"
  start: "#f2b33d"
  wait: "#f2b33d"
  fail: "#f26d6d"
  scrim: "rgb(10 11 13 / 72%)"
  selection: "rgb(236 235 230 / 22%)"
  board-day: "#f4f5f3"
  rail-day: "#ebece9"
  flap-day: "#dcddd9"
  flap-hi-day: "#e4e5e1"
  seam-day: "#b9bbb6"
  rule-day: "#cfd1cc"
  ink-day: "#15161a"
  ink-2-day: "#4f5156"
  ink-3-day: "#6e7074"
  run-day: "#0d6a3f"
  start-day: "#855000"
  wait-day: "#855000"
  fail-day: "#b3261e"
  scrim-day: "rgb(244 245 243 / 78%)"
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
    width: "calc(7ch + 14px)"
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

# Design System: switch-terminal

## Overview

**Creative North Star: "O Painel de Partidas"**

A janela é um painel de partidas de estação. Cada projeto é uma plataforma, cada worktree uma linha, e o estado de cada linha é uma palheta split-flap: um bloco com a linha de corte no meio e caracteres em caixa-alta condensada. Trocar de worktree é o painel virando. O terminal é o conteúdo e ocupa todo o resto da janela, sobre o mesmo fundo do painel.

Há dois materiais, escolhidos pelo sistema operacional (`prefers-color-scheme`): à noite, painel grafite; de dia, tabela impressa em esmalte branco. Os dois têm a mesma estrutura e os mesmos papéis; muda só a tinta. A densidade é de quadro de horários: linhas compactas, colunas fixas, números tabulares, nenhum cartão no painel. A hierarquia vem da tinta (cheia no que está em serviço, meia-tinta no resto) e não de tamanho nem de cor.

O mundo recusa a árvore de arquivos estilo IDE (Explorer + quick-open em cinza VS Code). O movimento é mecânico, em passos discretos sem easing, e só acontece quando um estado muda.

**Key Characteristics:**
- Palheta split-flap de 7 caracteres como assinatura do estado.
- Uma cor por estado, e nenhuma outra cor na interface.
- Tinta cheia só no que está em serviço; meia-tinta no resto.
- Barlow Semi Condensed em caixa-alta para rótulos, números tabulares em tudo.
- Plano: profundidade só nas superfícies flutuantes.
- Movimento em degraus (`steps`), nunca em curva.

## Colors

Neutros quentes de grafite (noite) ou esmalte (dia), com três cores de sinal reservadas aos estados. Cada token tem par diurno (sufixo `-day` no frontmatter), aplicado por `@media (prefers-color-scheme: light)` sobre as mesmas custom properties.

### Primary
- **Tinta Cheia** (`ink`): texto do que está em serviço (branch da worktree ativa ou rodando, destino, títulos), botão primário (`--primary`), anel de foco, caret e seleção (`--focus`, `--selection` são a mesma tinta). É a voz principal do sistema; não há acento cromático.

### Secondary
- **Verde Rodando** (`run`): só o estado RODANDO, o interruptor da marca na barra lateral e a confirmação positiva de formulário (`.side-error.ok`).
- **Âmbar em Movimento** (`start`, `wait`): estados SUBINDO, AGUARDA e PARANDO, e a prévia ENCERRA; os dois tokens têm o mesmo valor e continuam separados por papel. Parar é a consequência esperada de uma troca, não um alarme.
- **Vermelho Falha** (`fail`): só o que falhou ou foi morto: PARCIAL (um lado caiu), SIGKILL (não parou a tempo, ou foi forçado), erros de projeto e de formulário. Uma troca de rotina nunca fica vermelha.

### Neutral
- **Fundo do Painel** (`board`): chão da janela, do terminal (`--term-bg`) e dos campos de formulário.
- **Trilho** (`rail`): barra lateral e todas as superfícies flutuantes (aviso de troca, paleta, ajuda, diálogos), e blocos de código no estado vazio.
- **Palheta** (`flap`, `flap-hi`): as duas metades de toda palheta (`flap-hi` em cima, `flap` embaixo); `flap` sozinho é o fundo da linha atual; o hover fica a meio caminho entre `rail` e `flap` (`--hover`, `color-mix`), para não se confundir com ela.
- **Corte** (`seam`): os entalhes de 1px nas bordas, no meio da palheta.
- **Fio** (`rule`): toda borda de 1px, divisórias e o polegar da barra de rolagem.
- **Meia-tinta** (`ink-2`): texto em repouso, prefixo da branch, ícones, dicas, estado INATIVA.
- **Tinta Apagada** (`ink-3`): separador `/`, ícone desabilitado, fios da linha atual e do item selecionado, contorno dos campos. Passa 3:1 sobre `board`, `rail` e `flap` nos dois temas, então serve de indicador não textual; não serve para texto que precise ser lido.
- **Véu** (`scrim`): atrás do aviso de troca e dos diálogos modais.

A marca na barra lateral redesenha a geometria da logo com `--mark-bg` / `--mark-prompt` (palheta e tinta à noite; tinta e esmalte de dia) e o interruptor em `run`. O arquivo `app-icon.svg` é compromisso de marca e mantém as próprias cores.

### Named Rules
**A Regra de Uma Cor por Estado.** Verde é de pé, âmbar é em movimento (subindo, aguardando, parando), vermelho é falha (parcial, SIGKILL, erro). A contagem até o SIGKILL fica em tinta neutra: esperar é o caminho normal. Nenhuma outra cor entra na interface: foco, caret, seleção, botão primário e checkbox (`accent-color`) são tinta neutra.

**A Regra da Tinta em Serviço.** Só o que está em serviço (worktree atual ou rodando/subindo/aguardando) recebe tinta cheia; todo o resto fica em meia-tinta. Ênfase nunca vem de cor.

**A Regra do Terminal sem Moldura.** O terminal fica sobre `board`, o mesmo fundo do painel, sem borda nem cartão. O tema ANSI do xterm (`TERM_THEME`) segue o fundo, o cursor e a seleção do sistema e alinha vermelho/verde/amarelo aos tokens de estado; as outras cores ANSI pertencem ao conteúdo do terminal, não à interface.

## Typography

**Display Font:** Barlow Semi Condensed (com system-ui, sans-serif), auto-hospedada via @fontsource nos pesos 500, 600 e 700
**Body Font:** Barlow Semi Condensed (mesma família)
**Label/Mono Font:** JetBrainsMono Nerd Font (com Hack Nerd Font Mono, monospace)

**Character:** Uma condensada só, de quadro de horários, em três pesos; a mono aparece apenas onde há comando ou caminho de verdade. Números tabulares (`font-variant-numeric: tabular-nums`) em toda a raiz.

### Hierarchy
- **Display** (600, 22px): título do estado vazio.
- **Headline** (600, 19px): título dos diálogos e do aviso de troca; busca da paleta em 17px.
- **Title** (600, 17px): a faixa de destino (plataforma / branch).
- **Body** (500, 15px, 1.35): texto padrão, linhas do painel, campos.
- **Small** (500–600, 13px): par divergente, dicas, rótulos de campo (600, 0.02em), erros.
- **Label** (700, 12–13px, 0.08em, caixa-alta): nome da plataforma, abas API | FRONT, nome do projeto no destino e na paleta, títulos da ajuda, legendas de fieldset (0.06em).
- **Flap** (700, 12px, 0.06em, caixa-alta): texto das palhetas e etiquetas SÓ API / SÓ FRONT.
- **Mono** (12px, 1.5): erros brutos, prévia de caminho, código no estado vazio.
- **Terminal** (14px, 1.15): xterm.

### Named Rules
**A Regra da Caixa-Alta com Conteúdo.** Caixa-alta espaçada é para nomes reais (plataforma, projeto, lado, estado) e títulos de seção da ajuda. Nunca para rótulos inventados acima de títulos.

## Layout

Duas colunas: a barra lateral (`--sidebar-w`, padrão 280px, redimensionável por uma alça de 5px; `Ctrl+Shift+B` recolhe) e a área principal. Ambas abrem com uma faixa de 44px separada por um fio de 1px (marca à esquerda; destino, abas, outros rodando e ajuda à direita). O terminal ocupa todo o restante, com respiro de `8px 4px 4px 12px`.

O ritmo é denso e regular em passos de 2px: 4, 6, 8, 10, 14 e 22px. A margem lateral do painel é 14px (`gutter`) em todas as linhas, cabeçalhos de plataforma e no rodapé ("Novo projeto"); linhas têm 5px de respiro vertical; plataformas se separam por 10px. O nome alinha na margem de 14px e a palheta fica à direita dele, na coluna de situação de um painel de partidas, encostada na margem direita; linha nunca aberta não leva palheta e usa a largura toda para o nome. Superfícies flutuantes: aviso 440px, paleta 560px, diálogos 500px, ajuda 360px, todas limitadas a 90–92% da viewport.

## Elevation & Depth

O sistema é plano. A profundidade do painel vem de tons (`board` < `rail` < `flap`) e de fios de 1px, não de sombras. A linha atual é marcada por fundo `flap` e fios internos em cima e embaixo (`inset 0 ±1px 0 ink-3`, ≥3:1), não por elevação. Só as superfícies que flutuam acima do terminal (paleta, ajuda, diálogos) recebem uma sombra curta, e sempre junto de uma borda de 1px em `rule`. O aviso de troca fica sobre o véu, sem sombra.

### Shadow Vocabulary
- **Flutuante** (`box-shadow: 0 4px 8px rgb(0 0 0 / 28%)`): paleta, popover de ajuda, diálogos de formulário.

### Named Rules
**A Regra do Plano no Painel.** Nada no painel ou na faixa de destino tem sombra. Sombra existe só para o que flutua sobre o terminal, e é curta.

## Shapes

Cantos quase retos em três degraus: 2px para palhetas, abas e etiquetas; 4px para botões, campos, fieldsets e teclas; 6px para superfícies flutuantes. A palheta de estado é a única forma com corte: gradiente `flap-hi 50% / flap 50%` e entalhes `seam` de 2px só nas bordas, como numa palheta real. Um fio inteiro atravessaria a altura-x e leria como tachado (era o que acontecia de dia). Placa da plataforma e aba selecionada são `flap` lisos: a assinatura fica reservada ao estado.

Ícones são SVG desenhados em traço único: viewBox 16, 16px, `stroke-width: 1.5`, pontas e junções arredondadas, `stroke: currentColor`, sem preenchimento; a variante inline tem 12px. O marcador de `<details>` é um chevron desenhado em CSS com o mesmo traço de 1.5px.

## Components

### Palheta (assinatura)
O estado de cada worktree em 7 caracteres.
- **Forma:** bloco de `7ch + 14px` × 22px, raio 2px, metade de cima `flap-hi`, de baixo `flap`, entalhes `seam` de 1px × 2px nas bordas, no meio da altura.
- **Estados:** RODANDO (`run`, API e Front de pé), PARCIAL (`fail`, um lado caiu; o estado é lido por terminal, nunca somado), SUBINDO (`start`), AGUARDA (`wait`, também a própria worktree ao voltar para ela), PARANDO (`wait`), SIGKILL (`fail`, passou do prazo ou foi forçada), INATIVA (meia-tinta, `ink-2`; a palavra não começa com PAR para não se confundir com PARANDO/PARCIAL), sem palheta (nunca aberta: a linha não leva palheta nem reserva a coluna, então o nome ganha a largura toda).
- **Prévia ENCERRA:** com o cursor ou o foco numa linha do mesmo projeto, a linha em serviço mostra ENCERRA em âmbar (só CSS, `:has`): o clique é destrutivo e o painel mostra o que ele mata antes de matar. Não vira (o estado não mudou) e espera 120ms, para o cursor de passagem não fazer a palheta piscar. É o único nome da prévia: o rodapé da paleta e o "Abrir ao criar" usam a mesma palheta ENCERRA, nunca PARANDO (que afirmaria uma parada que ainda não começou).
- **Contagem:** no aviso de troca, uma palheta estreita (`4ch + 14px`) conta os segundos até o SIGKILL em tinta cheia (`ink`) e vira a cada segundo.
- **Movimento:** vira em 3 quadros discretos (`180ms steps(3, jump-none)`, `scaleY 1 → 0.12 → 1` no texto) e só quando o estado daquela palheta muda. Com `prefers-reduced-motion: reduce`, a troca é seca, sem animação.

### Linhas do painel
- **Estrutura:** grade nome | palheta; branch com prefixo (`feat/`) em meia-tinta e nome em tinta cheia quando em serviço; par divergente numa segunda linha (13px, seta de par desenhada em SVG inline); se os dois lados só diferem no prefixo, o nome aparece uma vez e a segunda linha mostra só os prefixos (`feature-api/ ⇄ feature-app/`); etiqueta SÓ API / SÓ FRONT nas solo, também na segunda linha, para a primeira ficar inteira para o nome. Fora do painel (destino, paleta, aviso, outros rodando), o mesmo par cabe numa linha: o nome uma vez e os prefixos depois, em 13px `ink-2` (`motor-x feature-api/ ⇄ feature-app/`). Sem espaço, o prefixo sai inteiro e só o fim do nome trunca (nunca "f." com cara de abreviação), e a decisão é por plataforma: todas as linhas perdem o prefixo ou nenhuma.
- **Ordem:** a do git, fixa. A linha não muda de lugar ao entrar em serviço; só a palheta vira.
- **Estados:** repouso transparente com texto `ink-2`; hover `--hover`; atual `flap` com fios internos `ink-3` em cima e embaixo; foco com o anel recolhido para dentro (`outline-offset: -2px`).
- **Teclado:** o painel é uma parada de Tab só (roving tabindex); setas, Home/End navegam.
- **Sem projeto:** uma plataforma em branco, placa "SEM PROJETO" em `ink-2` e uma linha "Nenhuma worktree ainda" com a palheta vazia (metades e entalhes, sem texto) esperando virar. Não é clicável: o painel não duplica o "Criar projeto" do centro.
- **Config quebrado com uma worktree aberta:** o painel fica com a última leitura boa e, no topo, um `.problem` ("O config tem um problema; o painel mostra a última leitura boa.") com o erro cru e "Abrir o config.json". Sem worktree aberta, quem diz é o centro, e o painel não repete.
- **Recolher:** a placa do projeto é um botão (`aria-expanded`) com chevron de 12px; recolhido, o projeto mostra só a worktree ativa (o estado de pé nunca some) e `+N` em `ink-2` com as ocultas; o erro de projeto também sai da frente e fica no title da placa. Lembrado entre sessões.

### Abas (API | FRONT)
- **Forma:** 26px de altura, raio 2px, rótulo em caixa-alta 12px/700.
- **Não selecionada:** contorno `rule`, texto `ink-2`. **Selecionada:** fundo `flap` liso, sem contorno, texto `ink`. **Lado caído (PARCIAL):** texto `fail` com um quadrado de 6px (raio 2px) na frente.

### Buttons
- **Shape:** cantos discretos (4px), 32px de altura, `0 14px`, 600.
- **Primary:** fundo `ink` (`--primary`), texto `board` (`--primary-ink`); hover em `ink-2`. Vem primeiro no DOM (Enter envia por ele) e aparece à direita (`row-reverse`).
- **Secondary:** contorno `rule`, fundo transparente, texto `ink`; hover `flap`.
- **Ícone:** 28×28, raio 4px, ícone `ink-2`; hover fundo `flap` e ícone `ink`; desabilitado em `ink-3`.
- **Rodapé do painel:** uma linha só, de 40px, com fio superior: "Novo projeto" (botão quiet com ícone de pasta com +, para não repetir o `+` de nova worktree das placas; texto `ink-2`, hover `ink` sobre `flap`) ocupa a largura, e "Reler worktrees" é um botão de ícone de 28px na ponta (`Ctrl+Shift+L`, listado na ajuda). Enquanto lê, o reler fica `aria-disabled` (o foco não sai dele), em `ink-3`, e o ícone gira em 8 degraus (`steps(8)`, desligado com reduzir movimento); ao terminar, o cabeçalho diz o que mudou na mesma região `status` do "parou em" ("Worktrees relidas: nada mudou.", "nova: interno / feat/x", "2 novas · 1 saiu"). Sem projeto, o rodapé inteiro some: a ação é o "Criar projeto" do centro.
- **Aviso de troca:** nenhum botão é primário nem recebe o foco; o foco vai para o card (esperar é a ação padrão). "Voltar para X" e "Forçar agora" são secundários, nessa ordem (Tab + Enter nunca vira SIGKILL), com Forçar empurrado para a direita (o nome trunca, o verbo fica); depois de voltar, ou já no SIGKILL, o Voltar some e o card diz "Voltando para X". Sem atalho de Esc: no reflexo do vim, ele desfazia a troca recém-pedida. O texto diz o que recebe o Ctrl+C (`npm run dev`, em mono), lido do processo em primeiro plano. O card é um `group` com nome ("Troca em andamento"): o foco nele não relê o que a região viva já anunciou. Ao terminar, o cabeçalho diz por 8 s, logo depois das abas, quanto a anterior levou ("feat/x parou em 1,8 s", ou "encerrada à força"), em 13px `ink-2`, numa região `status`; durante a troca o destino fica com `aria-live="off"` para não falar junto com o aviso.
- **Disabled:** opacidade 0.5.

### Chips
- **Etiqueta:** contorno `rule` de 1px, raio 2px, `0 4px`, 12px/700 com 0.06em, texto `ink-2`.
- **Tecla (`kbd`):** fundo `flap`, contorno `rule` com base de 2px, raio 2px, 12px/600.

### Cards / Containers
- **Corner Style:** 6px.
- **Background:** `rail`.
- **Shadow Strategy:** sombra Flutuante na paleta, ajuda e diálogos; o aviso de troca usa só o véu.
- **Border:** 1px `rule`.
- **Internal Padding:** 22px 24px (aviso), 20px 22px (diálogos), 16px 18px (ajuda).

### Inputs / Fields
- **Style:** 34px, fundo `board`, contorno `ink-3` 1px (≥3:1), raio 4px, 15px/500; placeholder `ink-2`; select com seta desenhada em gradiente; checkbox com `accent-color: ink`.
- **Focus:** anel neutro de 2px em `--focus` (tinta), afastado 2px, em todos os controles.
- **Error / Disabled:** erro em texto `fail` 13px abaixo do campo, resumo legível com o erro cru do git em mono `ink-2` embaixo; campos vazios recebem a mesma mensagem do app logo abaixo do campo (`aria-errormessage`; os formulários têm `novalidate`, sem a bolha nativa do WebKit); o campo culpado ganha contorno `fail` e o foco; placeholder começa com "ex.:", para não parecer valor digitado; depois de um erro parcial, o botão nomeia o lado que falta ("Criar no Front") e a branch fica travada (`readonly`, em `ink-2`), porque o outro lado precisa do mesmo nome; fieldset desabilitado a 0.45, menos o aviso do lado ("Já criada em…"). Fieldsets com `min-inline-size: 0`: um caminho longo não alarga o diálogo.
- **Repositório no Novo projeto:** escolher a pasta ou sair do campo depois de colar lê as worktrees dela (sem botão de ler). Logo abaixo da linha do repositório, primeiro o erro (resumo "Essa pasta não é um repositório git." / "Essa pasta não existe." e o cru em mono), depois a lista do que o painel vai mostrar: contagem em `ink-2` e branches em `ink-2`/600 (nada ali está em serviço), o caminho em mono só quando foge de `<pasta>/<branch>` (o completo no title), no máximo ~6 linhas com rolagem. Leitura sem worktree diz o próximo passo ("Depois de salvar, crie a primeira pelo + do projeto").

### Navigation
- **Paleta de troca** (`Ctrl+Shift+K`): busca de 44px com ícone de lupa, lista com nome do projeto em rótulo caixa-alta; item selecionado igual à linha atual (`flap` + fios internos `ink-3`); ordem por qualidade do casamento (trecho no começo de palavra > trecho > subsequência), depois recência; a atual leva a etiqueta ATUAL; rodapé com uma mini palheta ENCERRA e o que o Enter ou o clique encerra, com o processo em mono ("Encerra feat/x (npm run dev) em PROJETO"; sem espaço, só o nome da worktree trunca); com esse aviso, a legenda Enter/Esc sai e o rodapé inteiro é dele; o mouse também move a seleção.
- **Faixa de destino:** projeto em rótulo caixa-alta `ink-2`, separador `ink-3`, branch em 17px/600; as abas logo depois; no fim da faixa, à direita, a porta do dev server da aba aberta (`:3333`, o endereço inteiro no title), que aparecer ou trocar de porta não desloca as abas, lida da saída do terminal, em mono 12px `ink-2`, link que abre no navegador padrão (sublinha no hover) e curta o bastante para nunca truncar; com a barra recolhida, os outros projetos em serviço vêm depois de um fio `rule` e não encolhem; troca junto com a aba. O nome de projeto é caixa-alta em todo lugar.

## Do's and Don'ts

### Do:
- **Do** mostrar estado só pela palheta e pelas três cores de estado (`run` de pé, `start`/`wait` em movimento, `fail` falha).
- **Do** usar tinta cheia (`ink`) apenas no que está em serviço; o resto em `ink-2`.
- **Do** desenhar ícones como SVG de traço 1.5 em viewBox 16 (16px, inline 12px), em `currentColor`.
- **Do** animar só em degraus (`steps`), só na mudança de estado (ou enquanto um estado dura, como o reler lendo), e desligar com `prefers-reduced-motion`.
- **Do** dar a toda superfície flutuante borda `rule` de 1px, raio 6px, fundo `rail` e a sombra `0 4px 8px`.
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
