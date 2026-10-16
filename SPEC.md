# Hotswap — SPEC v1

App desktop para trocar rapidamente entre worktrees de projetos com **API e front em repositórios separados**. Cada worktree pareada tem um terminal da API e um do front.

## Stack

- **Tauri v2**
- **Backend (Rust):** `portable-pty` para os PTYs; saída enviada ao front via `tauri::ipc::Channel`.
- **Front:** TypeScript puro + Vite + xterm.js (`@xterm/xterm`, `@xterm/addon-fit`). Sem framework.
- **Shell:** `$SHELL` (fallback `/bin/sh`), aberto no diretório da worktree.

## Configuração

Arquivo `~/.config/hotswap/config.json` (o app se chamava switch-terminal: na primeira abertura, `~/.config/switch-terminal/` e os dados do webview em `~/.local/share/dev.gabriel.switch-terminal/` mudam para as pastas do nome novo, se elas ainda não existirem). Projetos novos podem ser criados pela tela (veja abaixo); o resto (`manualPairs`, `baseBranch`, `stopTimeoutMs`, editar ou remover projeto) é à mão:

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
- Lado Node sem dependências (tem `package.json`, falta `node_modules`, como numa worktree criada fora do app): o start vira `<install> && <startCommand>`. O instalador segue o package manager do start (`pnpm dev` → `pnpm install`); start que não começa com npm, yarn ou pnpm usa o lockfile (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lock(b)` → bun, senão npm). A checagem é antes de subir, não depois do erro: um crash ou Ctrl+C nunca dispara reinstalação. Não roda quando o `setupCommand` da primeira subida já está na linha.
- `baseBranch` (opcional, padrão `main`) preenche o campo "A partir de" ao criar uma worktree.
- `stopTimeoutMs` é opcional (padrão 5000).
- `screenReader` é opcional (padrão `false`): liga o modo leitor de tela do xterm, que expõe a saída dos terminais como texto acessível. Custa desempenho com saída intensa; o painel relê ao voltar para a janela e aplica nos terminais abertos. A ajuda (`Ctrl+Shift+H`) tem um interruptor que grava esse campo no config sem mexer no resto.

Estado persistido no `localStorage` do webview: `{ "<projeto>": "<id da worktree ativa>" }`.

## Worktrees e pareamento

- A lista vem de `git worktree list --porcelain` em cada repo.
- Pareamento automático pelo **nome exato da branch**, com `manualPairs` como override.
- Worktrees sem par aparecem como **solo** (uma aba só).
- O app **cria**, **edita** e **remove** worktrees (veja abaixo).
- A lista é relida ao abrir a paleta, quando a janela ganha foco e no botão de reler (ícone no rodapé da sidebar, `Ctrl+Shift+L`), que diz no cabeçalho o que mudou ("nada mudou", "nova: projeto / branch"). Sem projeto, o rodapé some.
- Worktree que sumiu: os PTYs dela são mortos e ela sai da sidebar.

## Criar projeto

- Botão "+ Novo projeto" no fim da sidebar (e "Criar projeto" na tela vazia, quando ainda não há config).
- Campos: nome e, para API e Front, repositório (campo + "Escolher…"; escolher a pasta ou sair do campo lista as worktrees que o painel vai mostrar, ou o erro legível), comando de start (padrão `npm run dev`) e comando de setup (opcional).
- **Package manager (npm, yarn, pnpm):** um seletor por lado, ao lado do start. O prefixo (`npm run`, `yarn`, `pnpm`) fica fixo fora do campo, que guarda só o script e os argumentos: não dá para apagá-lo. O config continua com o texto inteiro (`npm run dev`); script vazio é sem comando. Trocar de package manager troca o prefixo e reescreve o setup trecho a trecho (`npm install && cp …` → `pnpm install && cp …`). "Outro" tira o prefixo e deixa o comando inteiro livre (`make dev`, encadeados com `&&`); voltar dele para um package manager aproveita o script do texto, ou usa `dev`. Ao ler as worktrees, o start ainda no padrão (`dev`) e sem setup segue o lockfile do repositório.
- **Clonar do GitHub:** em cada lado, "Ou clone do GitHub de <conta>" sugere os repositórios que a conta logada no `gh` alcança (dela, de colaborador e das organizações; `gh api user/repos`, os mexidos por último primeiro). "Clonar…" (ou Enter no campo) pede a pasta de destino (lembrada entre aberturas), roda `gh repo clone <dono/repo> <pasta>/<repo>/.bare -- --bare`, grava `<pasta>/<repo>/.git` com `gitdir: ./.bare`, configura o fetch das branches remotas e cria a worktree da branch padrão em `<pasta>/<repo>/<branch>`; aí preenche o campo Repositório e lista as worktrees. Pasta de destino que já existe é recusada; clone que falha no meio apaga o que criou. Com o nome do projeto vazio, sugere o do repositório sem o sufixo de lado (`gtech-api` → `gtech`). Sem `gh` instalado ou logado, uma linha no topo do diálogo diz o próximo passo (`gh auth login`) e os campos de GitHub ficam ocultos.
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

## Editar worktree

- Lápis na borda direita de cada linha do painel (aparece com o cursor ou o foco na linha; → a partir da linha). Só edita a worktree parada (INATIVA ou nunca aberta); rodando, subindo, aguardando, parando ou no SIGKILL, o lápis fica desabilitado com o motivo: troque para outra worktree do projeto antes.
- **Branch:** renomeia só local (`git branch -m`). Par de nome igual tem um campo (renomeia os dois lados); par manual tem um por lado, e o `manualPairs` acompanha os nomes novos. Branch com upstream: o diálogo avisa que a remota continua com o nome antigo, e o upstream é desligado (o próximo push cria a nova).
- **Pasta:** "Mover a pasta junto" (`git worktree move` para `<diretório>/<nova branch>`), marcada quando a pasta segue a convenção `<diretório>/<branch>`. A pasta principal de um repo não-bare não move. A pasta-mãe que ficou vazia (`feat/`) é apagada.
- **Comando de start por branch:** grava `branchCommands` no lado do projeto (`"api": { "startCommand": "npm run dev", "branchCommands": { "feat/x": "npm run dev:mock" } }`); vazio ou igual ao do projeto volta ao padrão. Renomear a branch leva o comando junto. O seletor de package manager e o prefixo fixo funcionam como no novo projeto; com o campo vazio (herdando), mostram o start do projeto, e trocar o package manager parte dele (`npm run dev:api` → `pnpm dev:api`, só desta branch).
- **Par:** na solo, o lado que falta pode ficar vazio, ser criado com o nome da branch (diretório e origem, como na criação) ou parear com uma solo do outro lado (grava `manualPairs`). Um par manual pode ser desfeito; par de nome igual não (o pareamento automático juntaria de novo).
- **Tudo ou nada:** valida antes de mexer (nome válido, branch nova livre, pasta de destino livre, worktree não travada, solo ainda solo); se um passo falhar mesmo assim, desfaz os anteriores na ordem inversa (renomeia de volta, move de volta, remove o lado criado e a branch que ele criou) e o config não é gravado.
- Ao salvar, os terminais dela (e os da solo que entrou no par) fecham; o "ativa" e as recentes passam para o id novo; se era a atual, abre só o shell, sem o start. O cabeçalho diz "Editada: feat/x → feat/y".

## Remover worktree

- "Remover…" no rodapé do diálogo de editar (à esquerda, longe do Salvar): vale a mesma regra do lápis, só a worktree parada.
- Abre uma confirmação por cima com as pastas de cada lado existente que serão apagadas (inclusive o que o git ignora, como `node_modules` e `.env`) e, se ela foi aberta nesta sessão, "Os terminais dela fecham." O foco começa no Cancelar; Cancelar volta ao editar.
- Caixa "Apagar também a branch local" (desmarcada): `git branch -d`, nunca `-D`. Branch não mergeada fica, e o cabeçalho diz isso junto do "Removida: feat/x" ("Front: a branch feat/x não está mergeada e ficou (git branch -D feat/x apaga)"); o resto da remoção não falha por isso. HEAD destacado não tem branch para apagar.
- `git worktree remove` em cada lado, sem `--force`. Valida os dois antes de mexer e recusa, no lado culpado: a pasta principal de um repo não-bare, worktree travada (`git worktree lock`) e mudanças não commitadas ou arquivos não rastreados (`git status --porcelain`). Se um lado falhar depois do outro removido, o erro diz qual já foi ("A API já foi removida; o Front falhou: …"), e o que saiu é limpo mesmo assim.
- Limpeza: a pasta-mãe que ficou vazia (`feat/`) é apagada; os PTYs dela morrem; as entradas da branch em `branchCommands` e os `manualPairs` com ela saem do config (escrita atômica, só se algo mudou); o "ativa" e as recentes esquecem o id. O foco vai para o painel.

## Terminais e ciclo de vida

- Os PTYs são criados **sob demanda**, na primeira seleção da worktree.
- O shell **continua vivo** nas trocas.
- **Uma worktree ativa por projeto.** Projetos diferentes podem rodar ao mesmo tempo.
- Na troca de worktree dentro de um projeto:
  1. Para cada PTY da worktree anterior com processo em primeiro plano (`tcgetpgrp` ≠ PID do shell): envia `\x03`.
  2. Verifica a cada 100 ms até **todos os processos daquele grupo** morrerem (`killpg(pg, 0)`), por até `stopTimeoutMs`. Não basta o shell voltar ao primeiro plano: o `next-server` é neto do `npm` e pode continuar segurando a porta.
  3. Se estourar o prazo, envia `SIGKILL` ao grupo de processos em primeiro plano.
  4. Escreve o `startCommand` nos PTYs da nova worktree.
- A UI troca de tela na hora. Enquanto a anterior é encerrada, a palheta dela vira PARANDO no painel e uma segunda faixa, logo abaixo do cabeçalho, mostra "Parando" e "Voltar e reiniciar X". Depois de 2 s ela mostra, à direita do Voltar (que não anda), a contagem até o SIGKILL e "Forçar". Depois do clique no Voltar o lugar dele fica, invisível, e o verbo vira "Reiniciando" na mesma largura: o Forçar não desliza para baixo do cursor, e o segundo clique de um duplo clique não age. Passado o `stopTimeoutMs`, ela vira SIGKILL. Ao terminar, a segunda faixa some e o cabeçalho diz por 8 s quanto a anterior levou ("Parou em 1,8 s · feat/x"); se foi à força ("Parou à força em 7,0 s"), é rotina: o recado também dura 8 s, e a linha da anterior volta a INATIVA assim que o processo sai. Se a faixa não tem espaço para o recado com a branch em serviço inteira, ele aparece no canto do terminal. Um lado que cai vira falha na segunda faixa ("Front caiu · LEILAO / main", com a primeira linha de erro do terminal quando há: "· Error: listen EADDRINUSE…"), até a próxima troca ou o ×, inclusive na worktree atual (aí sem o nome, que o destino logo acima já diz: "Front caiu"; "caiu", não "parou", para não ler como a parada de rotina); nela, o botão de um lado vira "Subir Front" seja qual for a aba aberta (se ele não coube no cabeçalho, a falha traz o seu), e subir tira o recado.
- Ao voltar para uma worktree parada, o `startCommand` roda de novo.
- **Parar e subir à mão:** dois botões no cabeçalho, depois da porta (sem espaço, eles e a porta vão para o menu ⋯ do cabeçalho, com o atalho de cada um; cada botão tem a largura do maior rótulo que pode ter, e depois de um clique de mouse neles o que fica à esquerda guarda a largura até o cursor sair do cabeçalho: a porta que some deixa o lugar, a que aparece espera, a palheta do destino e as abas têm largura fixa, o aperto da faixa e o projeto do destino ficam como estavam, e a prévia ENCERRA não acende (o botão sob o cursor virou Parar); assim o vizinho não desliza para baixo do cursor): "Parar API" (ou Front) para o processo da aba visível (`Ctrl+Shift+X`, também com o outro lado parado à mão) e "Parar tudo" o da API e do Front (`Ctrl+Shift+Alt+X`; a solo só tem o primeiro); para subir, `Ctrl+Shift+S` e `Ctrl+Shift+Alt+S`. Com o cursor ou o foco neles, o que vão encerrar ganha o contorno âmbar (a aba; na parada da worktree inteira, as abas, a palheta do destino e a da linha atual no painel com ENCERRA). Mesmo caminho da troca (Ctrl+C → `stopTimeoutMs` → SIGKILL), mas o shell e o histórico ficam e a worktree continua a ativa. A palheta passa por PARANDO (SIGKILL se estourar) e o cabeçalho diz "Parou em 0,7 s · API" (ou "Parou à força em…") por 8 s. Lado parado assim não é queda: a API parada com o Front de pé fica API PARADA (FRONT PARADO) em palheta neutra (nunca vermelha), com um quadrado vazado na palheta e na aba da API ("parado à mão"; o que caiu tem o quadrado cheio); enquanto só um lado para, a palheta fica e a aba ganha o quadrado âmbar, se o outro lado cai com este parado, é queda: SEM FRONT (SEM API) em vermelho, e o botão sobe o que caiu; os dois parados ficam INATIVA, sem recado de falha (o de rotina, "Parou em 0,7 s · Front", sai como em qualquer parada), e as abas mantêm o quadrado vazado: os dois lados foram parados à mão. Com a aba do lado parado aberta, o botão vira "Subir API" e roda o `startCommand` de novo (lado sem start não tem o botão); com a do outro lado, "Parar Front". "Subir tudo" quando nada roda. Durante uma troca ou outra parada, os botões ficam desabilitados; durante SUBINDO dá para parar.

## UI

Identidade visual: **painel de partidas** (split-flap). Tokens, tipografia e regras em `DESIGN.md`.

- **Painel (barra lateral):** cada projeto é uma plataforma (nome numa placa de palheta + botão `+`); cada worktree é uma linha com uma palheta de estado de 7 caracteres e o nome da branch (prefixo em meia-tinta). As linhas seguem a ordem do git, fixa: entrar em serviço não move a linha. Pares com nomes diferentes mostram a branch do front numa segunda linha; worktrees solo têm a etiqueta SÓ API / SÓ FRONT. A palheta fica à direita do nome, como a coluna de situação; linha nunca aberta não tem palheta e o nome usa a largura dela. Sem espaço, o nome trunca no meio e o prefixo fica (`fix/calculo-de-…agrupados`); o prefixo só sai quando nem o começo do nome cabe.
- **Estados da palheta** (estado real, consultado no backend a cada 1,2 s com `pty_status`): RODANDO (verde, há processo), SUBINDO (âmbar, start enviado), AGUARDA (âmbar, esperando a anterior parar), PARANDO (âmbar invertido, Ctrl+C enviado), SIGKILL (âmbar invertido, passou do prazo ou foi forçada, enquanto acontece); de dia a cor é o corpo da palheta, com tinta escura por cima; quem está parando é o negativo de quem espera (à noite corpo âmbar e tinta do painel, de dia corpo grafite e tinta âmbar), SEM API / SEM FRONT (vermelho com quadrado cheio, um lado caiu, e diz qual), API PARADA / FRONT PARADO (neutro com quadrado vazado, um lado parado à mão: a palavra e a forma separam os dois sem depender da cor), INATIVA (terminais abertos, nada rodando), sem palheta (não aberta). Na faixa de destino a palheta é maior e desenha o sentido (↑ SUBINDO, ↓ PARANDO). Com o cursor ou o foco em outra linha do projeto, a linha em serviço mostra ENCERRA: o que o clique vai matar. `pty_status` devolve o nome do processo em primeiro plano, e a paleta, o diálogo e a faixa da troca dizem o que recebe o Ctrl+C. A palheta vira em 3 passos só quando o estado muda; sem animação com "reduzir movimento".
- **Faixa de destino:** PROJETO / branch + palheta de estado, abas API | FRONT (tablist com setas) e, logo depois, a porta do dev server da aba (abre no navegador via `xdg-open`); ajuda (?) com atalhos, legenda e o modo leitor de tela. Sem espaço, o que não cabe na faixa sai de trás para a frente: o recado (para o canto do terminal), os outros projetos, "Parar tudo", "Parar API" e a porta (as ações e a porta no ⋯); a branch do destino guarda um piso de 160 px e só cede abaixo dele depois de tudo isso, e o recado só fica se ela couber inteira, e cede antes do projeto do destino (antes de ir para o canto, ele perde o nome da anterior: "Parou à força em 5,7 s"). Os outros projetos que saem da faixa vão para o ⋯, antes das ações. Parado à mão sem lugar para "Subir API", o canto do terminal diz "Subir API · Ctrl+Shift+S". Se "Parar API" ou "Parar tudo" não cabe, a faixa aperta (vãos de 8 px) e, com o painel aberto ao lado, o projeto sai do destino, e eles cabem; pela necessidade, não por uma largura fixa, para que o que aparece não volte ao ⋯ com mais largura. Falhas ("Front não subiu em 15 s", "Front caiu · LEILAO / main") ficam na segunda faixa, embaixo do cabeçalho, até a próxima troca ou o ×, e trazem "Ver o terminal", que leva à aba do lado que caiu. Com o painel recolhido, mostra o que roda nos outros projetos, e cada um é um botão que leva até a worktree dele. Um SUBINDO que não sobe em 15 s diz no cabeçalho qual lado ficou para trás.
- **Troca em andamento:** fica na segunda faixa, logo abaixo do cabeçalho, do Ctrl+C ao SIGKILL (o terminal desce 36 px enquanto ela existe); bloqueia a digitação no terminal novo (sem cursor e com "Aguardando X parar · digitação liberada em seguida" logo abaixo dele) e oferece "Voltar e reiniciar …" (na faixa estreita, sem o nome; cancela a troca e reinicia a anterior: o Ctrl+C já foi, então a faixa diz "Reiniciando", o terminal diz "Reiniciando X · digitação liberada quando subir", e a linha dela fica PARANDO, ou SIGKILL, até os processos saírem e ela subir de novo; some no SIGKILL, e a faixa diz "depois sobe X"; a contagem vem como "SIGKILL em 3 s") e, depois de 2 s, "Forçar" (SIGKILL na hora). Sem atalho de Esc, para um reflexo não desfazer a troca. O leitor de tela ouve a faixa uma vez por fase (Parando, Reiniciando, SIGKILL também depois do Voltar), e o destino fica calado do clique até a nova subir (não diz "inativa" no começo nem no fim). O foco vai para a faixa, não para um botão: um Enter que sobrou da paleta ou do painel não força nada.
- **Paleta** (`Ctrl+Shift+K`): busca aproximada (cada termo casa dentro do projeto ou da branch, com o trecho destacado), ordenada pela qualidade do casamento, depois pelo projeto que um termo começa ("lei agr" é o LEILAO) e por uso recente, abrindo já na worktree anterior (Ctrl+Shift+K, Enter volta para ela). O rodapé diz o que o Enter encerra quando há algo rodando no projeto (o leitor de tela ouve "Encerra main" uma vez, quando muda, e a opção também diz "encerra main"); com a atual selecionada, diz "Enter já é a atual" (o Enter só fecha a paleta), e na ativa de outro projeto "Enter ir para". Setas andam uma linha, PageUp/PageDown oito (Home/End ficam com o cursor do texto). ARIA de combobox/listbox. Sem projeto, Enter abre o Novo projeto.
- **Atalhos:** `Ctrl+Shift+K` paleta, `Ctrl+Shift+J` alterna abas, `Ctrl+Shift+X` para a aba aberta e `Ctrl+Shift+S` sobe a aba, ou o lado que caiu ou foi parado à mão (com `Alt`, os dois lados; um atalho por verbo: no estado errado não faz nada e o cabeçalho diz o outro, "Nada rodando em API · Ctrl+Shift+S sobe"; durante uma troca ou parada também não faz nada e diz por quê; parar ou subir tira o recado anterior do projeto), `Ctrl+Shift+N` nova worktree, `Ctrl+Shift+E` foca o painel (setas navegam, Esc volta ao terminal), `Ctrl+Shift+B` recolhe o painel, `Ctrl+Shift+L` relê as worktrees, `Ctrl+Shift+H` abre a ajuda (atalhos, legenda e o modo leitor de tela; recebe o foco, Esc fecha, e o foco volta ao terminal). Sem projeto, `Ctrl+Shift+N` e `Ctrl+Shift+L` dizem no cabeçalho que falta criar um e levam o foco ao "Criar projeto". Com um diálogo ou a paleta aberta, nenhum atalho responde (na paleta, só `Ctrl+Shift+K`, que a fecha). `Ctrl+Shift+J` numa solo diz que não há o que alternar. Interceptados na fase de captura, antes do xterm. `Ctrl+=` / `Ctrl+-` ampliam e reduzem a interface inteira, terminal incluído (zoom do webview, `zoomHotkeysEnabled`); a ajuda lista os dois.
- **Alça da barra lateral:** arrastar redimensiona (200–480 px, padrão 280, e nunca deixando menos de 440 px para o terminal; numa janela pequena a largura pedida volta quando ela crescer), duplo clique restaura, setas pelo teclado. A largura fica salva. Abaixo de 640 px de largura (janela pequena ou zoom alto) a alça some e o painel abre por cima do terminal: começa fechado, abre com o botão, `Ctrl+Shift+B` ou `Ctrl+Shift+E`, e fecha ao escolher uma worktree, com Esc, com um clique no terminal ou quando o foco sai dele, sem mudar a preferência salva.
- **Temas:** escuro e claro, seguindo o sistema; o botão de tema no rodapé da sidebar troca para o outro e a escolha fica gravada (localStorage) até coincidir com o sistema, quando o app volta a segui-lo; o terminal lê fundo, cursor e seleção dos tokens do CSS e troca as cores ANSI junto.
- **Janela:** abre em 1200×800 e não fica menor que 720×480; abaixo disso o cabeçalho não cabe. O terminal que estava no fim continua no fim quando muda de tamanho (a faixa da troca entra e sai). Ao redimensionar, só o terminal visível se ajusta (uma vez por quadro, e só ao soltar a alça da barra lateral); os outros se ajustam quando aparecem. Terminais ocultos ficam fora da tela e o xterm pausa o desenho deles; a saída continua chegando e aparece inteira ao mostrar.
- **Projeto com erro de git:** uma linha legível (ex.: "API: repositório não encontrado"), detalhe expansível com o erro cru, e o `+` desabilitado.
- **Formulários:** Enter envia; erros aparecem no lado (API/Front) que falhou, com o foco no campo; o erro do git vira um resumo legível (o cru fica embaixo); depois de um erro parcial, o lado já criado fica travado com "Já criada em …". "Abrir ao criar" (marcado por padrão) diz qual worktree em execução será encerrada; desmarcado, a nova só aparece no painel. Diretório e origem ficam recolhidos em "Alterar diretório ou origem"; o comando de setup do projeto também.

## Abrir / fechar

- **Recarga do webview** (F5, HMR em dev): todos os PTYs são mortos antes de restaurar, para não sobrar dev server órfão.
- **Ao abrir:** restaura a última worktree ativa de cada projeto e roda os `startCommand`.
- **X da janela:** só esconde na bandeja; os terminais e dev servers continuam rodando.
- **Bandeja:** menu com "Mostrar janela" e "Sair". "Sair" pede confirmação (diálogo nativo) se algum PTY tiver processo em primeiro plano; ao sair, todos os PTYs são mortos.
- **Instância única:** abrir o app de novo só mostra a janela existente.

## Logo

`app-icon.svg` na raiz: um H numa palheta split-flap, com o corte do meio atravessando a letra; as hastes são a API e o front, e a travessa verde é o par rodando. Os ícones em `src-tauri/icons/` são gerados com `npx tauri icon app-icon.svg`.

## Fora da v1

- Editar ou remover projetos pela tela.
- Injeção de porta por variável de ambiente.
- Detecção ou notificação de crash do dev server.
