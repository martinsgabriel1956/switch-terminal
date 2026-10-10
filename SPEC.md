# switch-terminal — SPEC v1

App desktop para trocar rapidamente entre worktrees de projetos com **API e front em repositórios separados**. Cada worktree pareada tem um terminal da API e um do front.

## Stack

- **Tauri v2**
- **Backend (Rust):** `portable-pty` para os PTYs; saída enviada ao front via `tauri::ipc::Channel`.
- **Front:** TypeScript puro + Vite + xterm.js (`@xterm/xterm`, `@xterm/addon-fit`). Sem framework.
- **Shell:** `$SHELL` (fallback `/bin/sh`), aberto no diretório da worktree.

## Configuração

Arquivo `~/.config/switch-terminal/config.json`. Projetos novos podem ser criados pela tela (veja abaixo); o resto (`manualPairs`, `baseBranch`, `stopTimeoutMs`, editar ou remover projeto) é à mão:

```json
{
  "stopTimeoutMs": 5000,
  "projects": [
    {
      "name": "eternno",
      "api":   { "repo": "~/dev/eternno-api", "startCommand": "pnpm dev" },
      "front": { "repo": "~/dev/eternno-web", "startCommand": "pnpm dev" },
      "manualPairs": [{ "api": "feat/x", "front": "feature/x" }],
      "baseBranch": "main"
    }
  ]
}
```

- `startCommand` é opcional; sem ele, abre só o shell.
- `setupCommand` (opcional, por lado) roda antes do `startCommand` só na primeira subida de uma worktree criada pelo app. Exemplo: `"npm install && cp ../main/.env ."`.
- `baseBranch` (opcional, padrão `main`) preenche o campo "A partir de" ao criar uma worktree.
- `stopTimeoutMs` é opcional (padrão 5000).

Estado persistido no `localStorage` do webview: `{ "<projeto>": "<id da worktree ativa>" }`.

## Worktrees e pareamento

- A lista vem de `git worktree list --porcelain` em cada repo.
- Pareamento automático pelo **nome exato da branch**, com `manualPairs` como override.
- Worktrees sem par aparecem como **solo** (uma aba só).
- O app **cria** worktrees (veja abaixo), mas não remove.
- A lista é relida ao abrir a paleta, quando a janela ganha foco e no botão de reler (ícone no rodapé da sidebar, `Ctrl+Shift+L`), que diz no cabeçalho o que mudou ("nada mudou", "nova: projeto / branch"). Sem projeto, o rodapé some.
- Worktree que sumiu: os PTYs dela são mortos e ela sai da sidebar.

## Criar projeto

- Botão "+ Novo projeto" no fim da sidebar (e "Criar projeto" na tela vazia, quando ainda não há config).
- Campos: nome e, para API e Front, repositório (campo + "Escolher…"; escolher a pasta ou sair do campo lista as worktrees que o painel vai mostrar, ou o erro legível), comando de start (padrão `npm run dev`) e comando de setup (opcional).
- Valida: nome preenchido e único; cada pasta precisa ser um repositório git.
- Grava no `config.json` mantendo a ordem e os campos existentes; caminhos dentro da home viram `~/…`. Escrita atômica (arquivo temporário + rename). Se o config existir com JSON inválido, recusa em vez de sobrescrever.

## Criar worktree

- Botão `+` ao lado do nome do projeto na sidebar abre um formulário com projeto e branch, e um bloco por lado (**API** e **Front**), cada um com:
  - caixa para criar ou não naquele lado (uma, outra ou as duas);
  - **diretório** (campo + "Escolher…" com o seletor de pastas nativo) e a prévia do caminho final `<diretório>/<branch>`;
  - **a partir de**: lista das branches locais e remotas daquele repo.
- Valores iniciais: diretório padrão de cada repo (bare → `repo/`; normal → `<repo>.worktrees/`) e base = `baseBranch` do config, senão `main`/`master`, se existir.
- Branch que já existe (local ou `origin/<branch>`) é reaproveitada e "a partir de" é ignorado.
- Se um lado falhar depois do outro ter sido criado, o erro diz qual já foi criado, e ele aparece na lista como solo.
- Depois de criada, a worktree é selecionada e sobe com `setupCommand && startCommand`.

## Terminais e ciclo de vida

- Os PTYs são criados **sob demanda**, na primeira seleção da worktree.
- O shell **continua vivo** nas trocas.
- **Uma worktree ativa por projeto.** Projetos diferentes podem rodar ao mesmo tempo.
- Na troca de worktree dentro de um projeto:
  1. Para cada PTY da worktree anterior com processo em primeiro plano (`tcgetpgrp` ≠ PID do shell): envia `\x03`.
  2. Verifica a cada 100 ms até **todos os processos daquele grupo** morrerem (`killpg(pg, 0)`), por até `stopTimeoutMs`. Não basta o shell voltar ao primeiro plano: o `next-server` é neto do `npm` e pode continuar segurando a porta.
  3. Se estourar o prazo, envia `SIGKILL` ao grupo de processos em primeiro plano.
  4. Escreve o `startCommand` nos PTYs da nova worktree.
- A UI troca de tela na hora. Enquanto a anterior é encerrada, um aviso cobre os terminais ("Encerrando X… aguardando liberar as portas para iniciar Y") e a worktree anterior mostra um spinner na sidebar. Passado o `stopTimeoutMs`, o aviso muda para "Forçando o encerramento…".
- Ao voltar para uma worktree parada, o `startCommand` roda de novo.

## UI

Identidade visual: **painel de partidas** (split-flap). Tokens, tipografia e regras em `DESIGN.md`.

- **Painel (barra lateral):** cada projeto é uma plataforma (nome numa placa de palheta + botão `+`); cada worktree é uma linha com uma palheta de estado de 7 caracteres e o nome da branch (prefixo em meia-tinta). As linhas seguem a ordem do git, fixa: entrar em serviço não move a linha. Pares com nomes diferentes mostram a branch do front numa segunda linha; worktrees solo têm a etiqueta SÓ API / SÓ FRONT.
- **Estados da palheta** (estado real, consultado no backend a cada 1,2 s com `pty_status`): RODANDO (verde, há processo), SUBINDO (âmbar, start enviado), AGUARDA (âmbar, esperando a anterior parar), PARANDO (âmbar, Ctrl+C enviado), SIGKILL (vermelho, passou do prazo ou foi forçada), PARCIAL (vermelho, um lado caiu), INATIVA (terminais abertos, nada rodando), sem palheta (não aberta). Com o cursor ou o foco em outra linha do projeto, a linha em serviço mostra ENCERRA: o que o clique vai matar. `pty_status` devolve o nome do processo em primeiro plano, e a paleta, o diálogo e o aviso de troca dizem o que recebe o Ctrl+C. A palheta vira em 3 passos só quando o estado muda; sem animação com "reduzir movimento".
- **Faixa de destino:** palheta de estado + PROJETO / branch + endereço do dev server (abre no navegador via `xdg-open`), abas API | FRONT (tablist com setas), ajuda (?) com atalhos e legenda. Com o painel recolhido, mostra o que roda nos outros projetos.
- **Aviso de troca:** cobre os terminais, bloqueia a digitação no terminal novo e oferece "Forçar agora" (SIGKILL na hora) e "Voltar para …" (cancela a troca e reinicia a anterior; some no SIGKILL). Sem atalho de Esc, para um reflexo não desfazer a troca. O foco vai para o aviso, não para um botão: um Enter que sobrou da paleta ou do painel não força nada.
- **Paleta** (`Ctrl+Shift+K`): busca aproximada, ordenada por uso recente e abrindo já na worktree anterior (Ctrl+Shift+K, Enter volta para ela). O rodapé diz o que o Enter encerra quando há algo rodando no projeto. ARIA de combobox/listbox.
- **Atalhos:** `Ctrl+Shift+K` paleta, `Ctrl+Shift+J` alterna abas, `Ctrl+Shift+N` nova worktree, `Ctrl+Shift+E` foca o painel (setas navegam, Esc volta ao terminal), `Ctrl+Shift+B` recolhe o painel, `Ctrl+Shift+L` relê as worktrees, `Ctrl+Shift+H` abre a ajuda (recebe o foco, Esc fecha, e o foco volta ao terminal). Com um diálogo aberto, nenhum atalho responde. Interceptados na fase de captura, antes do xterm.
- **Alça da barra lateral:** arrastar redimensiona (200–480 px, padrão 280), duplo clique restaura, setas pelo teclado. A largura fica salva.
- **Temas:** escuro e claro, seguindo o sistema; o terminal usa o mesmo fundo do painel e troca as cores ANSI junto.
- **Projeto com erro de git:** uma linha legível (ex.: "API: repositório não encontrado"), detalhe expansível com o erro cru, e o `+` desabilitado.
- **Formulários:** Enter envia; erros aparecem no lado (API/Front) que falhou, com o foco no campo; o erro do git vira um resumo legível (o cru fica embaixo); depois de um erro parcial, o lado já criado fica travado com "Já criada em …". "Abrir ao criar" (marcado por padrão) diz qual worktree em execução será encerrada; desmarcado, a nova só aparece no painel. Diretório e origem ficam recolhidos em "Alterar diretório ou origem"; o comando de setup do projeto também.

## Abrir / fechar

- **Recarga do webview** (F5, HMR em dev): todos os PTYs são mortos antes de restaurar, para não sobrar dev server órfão.
- **Ao abrir:** restaura a última worktree ativa de cada projeto e roda os `startCommand`.
- **X da janela:** só esconde na bandeja; os terminais e dev servers continuam rodando.
- **Bandeja:** menu com "Mostrar janela" e "Sair". "Sair" pede confirmação (diálogo nativo) se algum PTY tiver processo em primeiro plano; ao sair, todos os PTYs são mortos.
- **Instância única:** abrir o app de novo só mostra a janela existente.

## Logo

`app-icon.svg` na raiz: `>_` em que o cursor é um interruptor ligado. Os ícones em `src-tauri/icons/` são gerados com `npx tauri icon app-icon.svg`.

## Fora da v1

- Remover worktrees pelo app.
- Editar ou remover projetos pela tela.
- Injeção de porta por variável de ambiente.
- Detecção ou notificação de crash do dev server.
