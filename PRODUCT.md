# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Um único desenvolvedor (o autor), na própria máquina Linux (desktop COSMIC, Wayland). Ele trabalha em projetos cuja API e front ficam em repositórios separados, cada um com várias worktrees git, e alterna entre elas várias vezes ao dia para revisar, testar e desenvolver features em paralelo.

## Product Purpose

Trocar de worktree sem fricção: com um clique ou atalho, a worktree anterior do projeto é encerrada (os dev servers param e liberam as portas) e a nova sobe com um terminal para a API e outro para o front. Dá certo quando trocar de contexto deixa de exigir abrir terminais, `cd`, matar processos e reiniciar servidores à mão.

## Positioning

Pareia worktrees de dois repositórios diferentes (API + front) pelo nome da branch e garante **uma worktree rodando por projeto**: a troca encerra a anterior, espera as portas liberarem e só então sobe a nova. No modo paralelo, ligado por projeto, várias worktrees do mesmo projeto rodam juntas, cada uma nas suas portas, com o front ligado à API do par. Um multiplexador de terminal ou o terminal do editor não faz esse pareamento nem esse ciclo de vida.

## Operating Context

- App desktop Tauri v2 (webview WebKitGTK), instalado via `.deb`, com ícone na bandeja; o X esconde a janela e os dev servers continuam rodando.
- Janela aberta o dia todo em monitor grande, ao lado do editor.
- Usado tanto em ambiente escuro quanto claro (dia e noite).
- Projetos reais hoje: `interno` e `leilao`, ambos em layout git bare (`repo/.bare` + uma pasta por branch); API em Express/Fastify, front em Next.js; `npm run dev` nos dois lados.

## Capabilities and Constraints

- Projetos configurados em `~/.config/hotswap/config.json` (também criáveis pela UI); worktrees lidas com `git worktree list`; pares manuais para branches de nomes diferentes.
- Por worktree: abas API e Front, cada uma um PTY real (xterm.js) com o shell do usuário (fish).
- Troca: Ctrl+C, espera o grupo de processos sair, SIGKILL no timeout; "Forçar agora" e "Voltar para a anterior" durante a espera.
- Modo paralelo por projeto: as portas vão por variáveis de ambiente declaradas à mão no config (`parallelEnv`), num prefixo `env` visível no terminal.
- Criar worktree (diretório e branch de origem por lado) e criar projeto pela UI, apontando pastas locais ou clonando do GitHub da conta logada no `gh` (layout bare); remover worktree pelo app (sem forçar); remover projeto não é feito pelo app.
- Teclado: `Ctrl+Shift+K` paleta, `Ctrl+Shift+J` alterna abas, `Ctrl+Shift+B` barra lateral.
- Interface em português do Brasil.
- Detalhes completos de comportamento em `SPEC.md`.

## Brand Commitments

- Nome: Hotswap (binário, pacote e pastas em `hotswap`). Antes se chamava switch-terminal.
- Logo (`app-icon.svg`): um H numa palheta split-flap, com o corte do meio atravessando a letra. As hastes são a API e o front; a travessa verde é o par rodando. É compromisso: a identidade parte dela e ela não muda.

## Evidence on Hand

- Logo em `app-icon.svg` e ícones gerados em `src-tauri/icons/`.
- Nenhum material de divulgação, depoimento ou métrica; não inventar.

## Product Principles

1. O terminal é o conteúdo: a interface em volta existe para escolher e trocar, e depois sai do caminho.
2. O estado "rodando" é a verdade mais importante da tela: o que está de pé, o que está parando e o que está subindo precisa ser visível de relance.
3. Trocar é destrutivo (mata processos); o app explica o que está fazendo e sempre oferece saída.
4. Teclado primeiro, mouse sempre possível.

## Accessibility & Inclusion

Uso prolongado em luz alta e baixa: contraste WCAG AA no mínimo para todo texto, e foco visível em todos os controles.
