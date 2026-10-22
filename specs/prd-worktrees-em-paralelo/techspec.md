# Techspec: Worktrees em paralelo

## Resumo executivo

O modo paralelo é uma flag por projeto no `config.json` (`"parallel": true`), gravada pelo app como o `screenReader`. Com ela ligada, o `activate` do front pula a parada da anterior: a worktree nova sobe sem encerrar nada, e todo o resto (estados, quedas, Parar/Subir/Reiniciar) já funciona por worktree, porque `envs`, `starting`, `halting`, `wasUp` e o `pollStatus` são indexados pela chave `projeto/id`, e não pelo projeto.

As portas chegam ao dev server por **variáveis de ambiente num prefixo visível** do comando digitado (`env 'SERVER_PORT=3334' 'WEB_URL=http://localhost:3001' npm run dev`), montado a partir de um modelo por lado declarado à mão no config (`parallelEnv`, com `{apiPort}` e `{frontPort}`). Os nomes das variáveis variam por projeto (interno usa `PORT`/`NEXT_PUBLIC_BASE_API_URL`, leilao usa `SERVER_PORT`/`NEXT_PUBLIC_API_URL`), então o app não adivinha nada. Toda a decisão de portas (padrão, livres, propostas, montagem do prefixo) mora num módulo puro novo, `src/parallel.ts`, testado com `node --test` como `start.ts` e `restart.ts`.

## Arquitetura

### Visão de componentes

| Componente | Novo/modificado | Responsabilidade |
|---|---|---|
| `src-tauri/src/worktrees.rs` | modificado | Lê `parallel` (projeto) e `parallelEnv` (lado) do config e os expõe no `ConfigView`. Novo comando `set_parallel(project, on)`, com escrita atômica pelo `write_config_json` existente. |
| `src-tauri/src/lib.rs` | modificado | Registra `set_parallel`. |
| `src/parallel.ts` | **novo** | Funções puras: portas padrão aprendidas, escolha de portas livres, substituição do modelo e montagem do prefixo `env`, validação do modelo, conferência da porta que subiu. |
| `src/parallel.test.ts` | **novo** | Testes do módulo acima. |
| `src/main.ts` | modificado | `activate` e `wouldStop` respeitam o modo; diálogo de portas; `writeStart` aceita o prefixo; interruptor na placa do projeto; desligar o modo; paleta, ENCERRA e `renderRunning` cientes do modo; conferência da porta depois do RODANDO. |
| `index.html` / `src/styles.css` | modificado | `<dialog id="ports-dialog">`, interruptor na placa, marca de projeto em paralelo, legenda na ajuda. |

**Fluxo de dados ao selecionar uma worktree parada num projeto em paralelo:**

1. `select` → `ensureEnv` → `activate`. Em paralelo, `activate` não cria `Stopping` nem para a anterior; só grava `active[project]` (a "última vista", usada para restaurar ao abrir e para o desligar).
2. Antes do `writeStart`, `planPorts` decide:
   - todas as portas padrão livres (nenhum env do app as usa, `ports_open` diz fechadas) → sobe sem prefixo (RF3.1);
   - senão, as portas lembradas desta worktree, se livres → sobe com elas sem perguntar (RF3.5);
   - senão → abre o diálogo com a proposta (RF3.2).
3. Confirmado: `ports_open` de novo nas portas escolhidas (RF3.4); livres → `writeStart(k, pane, fresh, prefix)` em cada lado; as portas vão para o `localStorage` (`ports`).
4. `pollStatus` segue como hoje. Quando a worktree vira RODANDO, `checkPort` compara a porta lida da saída (`pane.port`) com a atribuída; se diferem, segunda faixa: "API subiu na 3333, não na 3334 · confira parallelEnv".

**Desligar com várias rodando:** confirmação (diálogo) lista as que param; em seguida, para cada env do projeto fora a "vista", o mesmo caminho do `toggleRun` com todos os lados (`halting` + `stopPane`), em paralelo; `set_parallel(project, false)` só depois da confirmação.

## Design de implementação

### Interfaces principais

```ts
// src/parallel.ts
export type Ports = { api: number | null; front: number | null };
/** Modelo por lado: { "SERVER_PORT": "{apiPort}", "WEB_URL": "http://localhost:{frontPort}" }. */
export type EnvTemplate = Record<string, string>;

/** Porta livre a partir de `from` (exclusive), pulando as tomadas; null se não achar em 100 tentativas. */
export function nextFree(from: number, taken: ReadonlySet<number>): number | null;
/** Proposta para os lados com servidor: a padrão se livre, senão a próxima livre. Lado sem padrão conhecida → null (RF3.7). */
export function propose(defaults: Ports, taken: ReadonlySet<number>): Ports;
/** Substitui {apiPort}/{frontPort}; lado sem porta usa a padrão. */
export function fill(tpl: EnvTemplate, ports: Ports): Record<string, string>;
/** `env 'K=v' 'K2=v2' ` (com espaço final) ou "" sem variáveis. Aspas simples valem em fish, bash e zsh. */
export function envPrefix(vars: Record<string, string>): string;
/** Problema do modelo, ou null: nome fora de [A-Z_][A-Z0-9_]*, valor com aspa simples, placeholder desconhecido. */
export function templateError(tpl: EnvTemplate): string | null;
/** A porta lida da saída bate com a atribuída? Sem leitura ainda, não acusa. */
export function portMismatch(assigned: number | null, seen: number | null): boolean;
```

```rust
// worktrees.rs
#[tauri::command]
pub fn set_parallel(project: String, on: bool) -> Result<(), String>; // grava/remove "parallel" no projeto, atômico
```

`writeStart(k, pane, isFresh, prefix = "")`: o prefixo entra só antes do `startCommand`, depois do setup e do install (`setup && install && env … npm run dev`).

### Modelos de dado

**Config (`~/.config/hotswap/config.json`)**, campos novos opcionais:

```json
{
  "name": "leilao",
  "parallel": true,
  "api":   { "repo": "…", "startCommand": "npm run dev",
             "parallelEnv": { "SERVER_PORT": "{apiPort}", "WEB_URL": "http://localhost:{frontPort}" } },
  "front": { "repo": "…", "startCommand": "npm run dev",
             "parallelEnv": { "PORT": "{frontPort}", "NEXT_PUBLIC_API_URL": "http://localhost:{apiPort}/api" } }
}
```

- `parallel` ausente = `false` (RF1.2). Gravado pelo app; `parallelEnv` só à mão.
- Lado em paralelo **sem** `parallelEnv`, ou sem variável com `{apiPort}`/`{frontPort}` do próprio lado: o diálogo diz que aquele lado não tem como mudar de porta e aponta o config, e não sobe com porta trocada (RF4.4).
- Front sem nenhuma variável com `{apiPort}`, quando a API do par recebeu porta nova: o diálogo avisa que o front falaria com a API padrão e não deixa confirmar (RF4.4).

**`ConfigView` → front:** `ProjectView.parallel: bool`; `SideView.parallelEnv: Record<string,string>` (vazio quando ausente).

**`localStorage`:**
- `ports`: `{ "<projeto>\0<id>": { api, front } }`, as portas confirmadas por worktree (RF3.5). Esquecidas quando a worktree some, junto com `active` e `recent`.
- `defaultPorts`: `{ "<projeto>": { api, front } }`, a última porta lida de cada lado numa subida **sem** prefixo. É a porta "padrão" (RF3.2, RF3.6). Sem leitura → `null` → o diálogo pede (RF3.7).

**Estado em memória (main.ts):** `assigned: Map<string, Ports>`, as portas com que cada env subiu nesta subida (para `taken`, para a conferência e para a faixa de destino).

### Endpoints de API

Não há API HTTP. Comandos Tauri: `set_parallel` (novo); `load_config` (ganha campos); `ports_open` (reusado, sem mudança).

## Pontos de integração

- **Dev servers dos projetos:** a injeção depende de o processo dar precedência à variável de ambiente sobre o `.env`. Isso vale para o Node `--env-file` (interno: `tsx watch --env-file .env`), para o `dotenv-cli` sem `--override` (leilao: `dotenv -e ./.env --`) e para o Next.js (a env do processo vence os `.env*`; `next dev` lê `PORT`). Um projeto que force override, ou que fixe `-p 3000` no script, sobe na porta errada, e a conferência pós-RODANDO (`portMismatch`) acusa.
- **Shell:** o prefixo usa `/usr/bin/env`, e não `VAR=x cmd`, para funcionar igual em fish, bash e zsh.

## Estratégia de teste

**Unitário (`node --test`, `src/parallel.test.ts`):** `nextFree` (pula as tomadas, limite de 100); `propose` (padrão livre fica, padrão tomada anda, lado sem padrão → null); `fill` (os dois placeholders, lado ausente usa a padrão); `envPrefix` (vazio → "", aspas, ordem estável); `templateError` (nome inválido, aspa simples, placeholder desconhecido); `portMismatch`.

**Unitário Rust (`cargo test`):** `load_config` lê `parallel` e `parallelEnv` e os ausentes viram padrão; `set_parallel` grava e remove o campo sem tocar no resto do config (mesmo molde dos testes de `add_project_to`).

**Integração/E2E (manual, no app):** com o `interno`, ligar o modo, subir `developer` e outra worktree; conferir que as duas ficam RODANDO, que o front da segunda chama a API da segunda (aba Network) e que não aparece `EADDRINUSE`; desligar e conferir que só a vista fica. Com o modo desligado, repetir uma troca comum e ver a faixa da troca de sempre. Não há E2E automatizado no projeto, e esta feature não justifica criar um.

## Sequenciamento

1. **Config no Rust** (`parallel`, `parallelEnv`, `set_parallel`) e tipos no front. Tudo depende de o front saber o modo.
2. **`src/parallel.ts` + testes.** Puro, independente da UI.
3. **`activate`/`wouldStop` em paralelo**, com o interruptor mínimo na placa. Sobem juntas nas portas padrão (colidem, mas o caminho de vida fica provado).
4. **Diálogo de portas + prefixo no `writeStart` + `ports`/`defaultPorts`.** Resolve a colisão, que é a métrica.
5. **Conferência pós-RODANDO** (`portMismatch`) e a porta atribuída na faixa de destino.
6. **Desligar** com a confirmação e a parada das outras.
7. **Ajustes de superfície:** paleta sem "encerra", ENCERRA, `renderRunning`, legenda e ajuda, leitor de tela.

Os passos 3 a 6 dependem de 1 e 2; o 7 pode andar depois do 3.

## Observabilidade

Igual ao app hoje: sem log nem métrica. Tudo é dito na tela.
- O comando com o prefixo fica visível no terminal (o que subiu, com que portas).
- Portas atribuídas na faixa de destino (`localhost:3334`, que já abre no navegador).
- A segunda faixa avisa a porta que não bateu e a porta ocupada antes de subir.
- As notificações de queda de hoje já valem para worktrees em segundo plano (`announceDrops` percorre todos os `envs`).

## Considerações técnicas

### Decisões principais

- **Variáveis de ambiente num prefixo visível, e não no ambiente do shell.** É o que o usuário escolheu e o que o app já faz com o install (`npm install && npm run dev`): fica claro no terminal o que subiu. Mudar as portas não exige recriar o PTY, que perderia o histórico. A alternativa (`pty_spawn` com `env`) foi rejeitada por isso.
- **Modelo por lado escrito à mão no config (`parallelEnv`).** Os dois projetos reais usam nomes diferentes (`PORT` × `SERVER_PORT`, `NEXT_PUBLIC_BASE_API_URL` × `NEXT_PUBLIC_API_URL`, `FRONTEND_URL` × `WEB_URL`), então qualquer padrão embutido erraria em um deles. O caminho segue o do `branchCommands`: config à mão, sem tela de edição (editar projeto pela tela está fora da v1). Um padrão `PORT` implícito foi rejeitado porque subiria a API do leilao na 3333 assim mesmo.
- **`/usr/bin/env` com valores em aspas simples.** Funciona igual em fish, bash e zsh. Valor com aspa simples é recusado na validação, em vez de escapado por shell.
- **Portas padrão aprendidas da saída, e não declaradas.** O app já lê a porta de cada terminal (`PORT_RE`). A primeira subida sem prefixo ensina a padrão, que fica em `localStorage`. Não há campo novo para o usuário manter, e o RF3.7 cobre o caso de ainda não haver leitura.
- **Prefixo só quando alguma porta padrão está ocupada.** Assim a primeira worktree, e qualquer uma que suba sozinha, roda exatamente como hoje, sem prefixo nenhum (RF3.1 e a restrição de "modo desligado = hoje"). Com uma porta trocada, o prefixo leva o modelo inteiro dos dois lados, porque a API também precisa saber a porta nova do front (CORS: `FRONTEND_URL`/`WEB_URL`).
- **Flag no config; portas no `localStorage`.** O interruptor é preferência (RF1.3, sobrevive, editável à mão, como `screenReader`). As portas lembradas são estado da sessão de uso, como `active` e `recent`.
- **`active[project]` continua um valor só.** Em paralelo, ele passa a significar "a última vista": restaura uma por projeto ao abrir (o conjunto está fora do escopo) e define quem fica ao desligar. Trocar por um conjunto mexeria em toda leitura de `active` sem um requisito que peça isso.
- **A fila `queues` por projeto continua.** Ela serializa as ativações. Em paralelo nada espera parada, então a fila só atrasa o tempo do diálogo, que é modal de qualquer jeito.
- **Reiniciar em segundo plano:** a condição `active[project] === wt.id` do `toggleRun` vira "o env ainda existe e não há troca em andamento". Em paralelo, a worktree vista pode não ser a `active` de quando a parada começou.

### Riscos conhecidos

- **Projeto que ignora a env** (override do dotenv, `-p` fixo no script): sobe na porta padrão e colide. Mitigação: o `portMismatch` acusa com a porta lida, e o `EADDRINUSE` aparece no recado de queda que já existe.
- **`PORT_RE` lendo a porta errada:** o front que imprime a URL da API (`localhost:3334/api`) antes da própria poderia ser lido como a porta dele. Esse risco já existe hoje (o regex pega a última ocorrência do bloco). Ver no teste manual com os dois projetos; se acontecer, a conferência pode dar alarme falso.
- **Recursos compartilhados** (banco, Redis, filas, `RABBIT_MQ_URL`) continuam os mesmos; está fora de escopo. Duas APIs consumindo a mesma fila podem roubar mensagens uma da outra. É limitação documentada, não bug.
- **Memória:** sem teto (decisão do PRD). Dois `next dev` pesam; nenhum aviso.
- **Desligar com uma worktree subindo:** a parada usa o caminho do `toggleRun`, que já aceita parar durante SUBINDO.

### Conformidade com regras do projeto

Não há `CLAUDE.md` nem diretório de regras. As convenções vêm do código e de `PRODUCT.md`/`DESIGN.md`/`SPEC.md`:
- Comentários e textos de UI em português do Brasil; TypeScript puro, sem framework.
- Lógica pura em módulo pequeno com teste `node --test` ao lado (`start.ts`, `restart.ts`, `pm.ts`): `parallel.ts` segue o molde.
- Config gravado só por escrita atômica que preserva o resto (`write_config_json`), recusando JSON inválido.
- Princípios do produto: o estado "rodando" visível de relance (a marca de paralelo e a porta na faixa); trocar é destrutivo e explica-se (a confirmação ao desligar lista quem para); teclado primeiro (interruptor focável na navegação do painel, diálogo com Enter/Esc).
- `DESIGN.md`: cores por token nos dois temas, contraste AA, foco visível, nada só por cor.
- **Desvio:** nenhum.

### Conformidade com skills disponíveis

- `tdd`: para `src/parallel.ts` (puro, bem delimitado).
- `testing-anti-patterns`: nos testes Rust do config, sem mock de sistema de arquivos além do que os testes atuais já fazem (arquivo temporário).
- `impeccable` (plugin): interruptor na placa, diálogo de portas e marca do modo, contra o `DESIGN.md`.
- `feature-prints`: prints das duas worktrees rodando e do diálogo de portas para a PR.
- `no-workarounds`: se a conferência de porta der alarme falso, corrigir a leitura, e não silenciar o aviso.

### Arquivos relevantes

- `src-tauri/src/worktrees.rs`: `Config`/`ProjectCfg`/`SideCfg`, `ProjectView`/`SideView`, `side()`, `load_config`, `write_config_json`, `set_screen_reader` (molde do `set_parallel`).
- `src-tauri/src/lib.rs`: registro dos comandos.
- `src-tauri/src/pty.rs`: `ports_open` (reusado).
- `src/main.ts`: `activate`, `select`, `wouldStop`, `writeStart`, `toggleRun`, `pollStatus`, `refresh` (esquecer `ports` das worktrees sumidas), `createPane` (`PORT_RE`, `pane.port`), `renderBoard`/`lineButton` (ENCERRA, placa), `endsNote`/`renderPalette`, `renderRunning`, `howItWorks`/ajuda.
- `src/parallel.ts`, `src/parallel.test.ts`: novos.
- `index.html`, `src/styles.css`: diálogo, interruptor, legenda.
- `SPEC.md`, `PRODUCT.md`: atualizados no `sdd-review` (ver "Decisões existentes afetadas" no PRD).

## Histórico

**2026-10-22**. Documento criado.
