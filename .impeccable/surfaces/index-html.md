---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: ["src/main.ts","src/styles.css"]
---

# Superfície: janela principal do switch-terminal

Modo: Operate. Público: um dev, o dia todo, em monitor grande, em luz alta e baixa (tema segue o sistema: escuro e claro).
Tarefa: ver de relance o que está rodando em cada projeto, trocar de worktree pelo teclado ou mouse, acompanhar a troca e voltar ao terminal.
Estados: rodando, aguardando (alvo de uma troca), parando, aberta (shell vivo, nada rodando), nunca aberta; projeto com erro; sem projetos.
Intocável: o terminal é o conteúdo; atalhos atuais; comportamento de troca (SPEC.md); a logo.

## Direction contract

THESIS: A janela é um painel de partidas. Cada projeto é uma plataforma e cada worktree uma linha com uma palheta de estado; trocar de worktree é o painel virando. Recusa a árvore de arquivos estilo IDE (Explorer + quick-open em cinza VS Code).

OWN-WORLD: Fundo de painel grafite (noite) ou tabela impressa branca-esmalte (dia). Palhetas: blocos com a linha de corte no meio, caracteres em caixa-alta condensada (Barlow Semi Condensed), números tabulares. Tinta cheia só no que está em serviço; o resto em meia-tinta. Uma cor por estado (verde de pé, âmbar em movimento, vermelho falha) e nenhuma outra cor. Sem cartões, sem sombras decorativas; ícones SVG desenhados em traço único.

STORY: O usuário bate o olho e sabe o que roda em cada plataforma; escolhe o destino (clique ou Ctrl+Shift+K, que já abre na anterior); vê a palheta da anterior virar para PARANDO e a nova para AGUARDA e depois RODANDO; pode forçar ou voltar; o terminal recebe o foco.

FIRST VIEWPORT: Coluna do painel à esquerda (~280px): marca (logo + nome), plataformas com o nome em palhetas e um botão +, linhas compactas com o nome da branch (prefixo em meia-tinta, nome em tinta cheia; par divergente em segunda linha; etiqueta SÓ API/SÓ FRONT nas solo) e a palheta de estado de 7 caracteres à direita, na coluna de situação (vazia na linha nunca aberta); as linhas na ordem do git, fixas. À direita, faixa de destino: plataforma / branch em tinta cheia com a palheta depois, as abas API | FRONT e a porta do dev server logo após; ajuda (?) no canto. O terminal ocupa todo o resto, com o mesmo fundo do painel.

FORM: Painel de partidas split-flap, posição 6 na lista ordenada; seed c7c151ae. Raises: passos discretos sem easing (acetato), só o ativo em tinta cheia (Saville), tabulares em colunas fixas (Ikeda), uma cor por estado (monocromático), densidade sem cartões (doujin). Assinatura: a palheta vira em 3 quadros (steps) só quando o estado muda; com reduzir movimento, troca seca.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
