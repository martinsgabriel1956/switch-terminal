# Tasks: Worktrees em paralelo

Contrato: [prd.md](prd.md) e [techspec.md](techspec.md). Sem `CLAUDE.md` nem diretório de regras. As convenções vêm do código: comentários e UI em pt-BR, TS puro sem framework, lógica pura em módulo pequeno com `node --test`, config gravado só por `write_config_json`, cores por token do `DESIGN.md`. Commits seguem `tipo: frase - item - item` em pt-BR, com o `Co-Authored-By`.

Verificação comum a toda task: `npm test`, `npx tsc --noEmit` e `cargo test` (em `src-tauri/`).

---

## 1. Config: `parallel` e `parallelEnv` no Rust e nos tipos do front

**Escopo:** o backend lê e grava o modo e o modelo de variáveis; o front recebe os dois.

**Contexto:** techspec › Modelos de dado e Decisões ("Flag no config; portas no `localStorage`"). RF1.1 a RF1.3 dependem de o modo estar no config e de o app poder gravá-lo, como faz com o `screenReader`. Tudo o mais lê `project.parallel` e `side.parallelEnv`.

**Skills:** `tdd`, `testing-anti-patterns`.

**Regras:** escrita atômica que preserva o resto do config (`read_config_json` + `write_config_json`). JSON inválido é recusado, nunca sobrescrito.

**Steps:**

`worktrees.rs`, structs:

```rust
struct ProjectCfg { /* … */ #[serde(default)] parallel: bool }
struct SideCfg { /* … */ #[serde(default)] parallel_env: HashMap<String, String> }
pub struct ProjectView { /* … */ parallel: bool }
pub struct SideView { /* … */ parallel_env: HashMap<String, String> }  // em side(): cfg.parallel_env.clone()
```

`load_config` preenche `ProjectView.parallel` com `p.parallel`.

Comando novo, no molde do `set_screen_reader`, com a lógica num `_in(path, …)` para teste, como `add_project_to`:

```rust
fn set_parallel_in(path: &str, project: &str, on: bool) -> Result<(), String> {
    let mut cfg = read_config_json(path)?;
    let proj = cfg["projects"].as_array_mut().and_then(|ps| ps.iter_mut().find(|p| p["name"] == project))
        .and_then(|p| p.as_object_mut()).ok_or(format!("Projeto {project} não está no config."))?;
    // Desligado é a ausência do campo: o config de quem nunca ligou continua igual.
    if on { proj.insert("parallel".into(), true.into()); } else { proj.remove("parallel"); }
    write_config_json(path, &cfg)
}
#[tauri::command]
pub fn set_parallel(project: String, on: bool) -> Result<(), String> { set_parallel_in(&config_path(), &project, on) }
```

`lib.rs` registra `worktrees::set_parallel`.

`main.ts`, tipos:

```ts
type Side = { /* … */ parallelEnv: Record<string, string> };
type Project = { name: string; error: string | null; parallel: boolean; worktrees: Worktree[] };
```

**Plano de teste:**
- `cargo test`: `set_parallel_in` liga (grava `"parallel": true`), desliga (remove o campo) e mantém os outros campos e projetos iguais; projeto inexistente vira erro; JSON inválido é recusado sem mexer no arquivo.
- `cargo test`: deserializar um `ProjectCfg` sem os campos novos dá `parallel == false` e `parallel_env` vazio.
- `tsc` limpo.

---

## 2. `src/parallel.ts`: portas e prefixo, puros

**Escopo:** as funções puras do techspec (Interfaces principais), com testes.

**Contexto:** techspec › Interfaces principais e Decisões ("`/usr/bin/env` com aspas simples", "Prefixo só quando alguma porta padrão está ocupada"). Elas decidem as portas (RF3.2, RF3.5), montam a injeção (RF4.1) e conferem a porta que subiu. Ficam fora do `main.ts` para serem testáveis, como `start.ts`.

**Skills:** `tdd`.

**Regras:** módulo pequeno, puro, com `*.test.ts` ao lado, rodado por `node --test` (sem framework).

**Steps:**

```ts
export type Ports = { api: number | null; front: number | null };
export type EnvTemplate = Record<string, string>;
const PH = /\{(apiPort|frontPort)\}/g;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function nextFree(from: number, taken: ReadonlySet<number>): number | null {
  for (let p = from + 1; p <= Math.min(from + 100, 65535); p++) if (!taken.has(p)) return p;
  return null;
}
/** A padrão se livre, senão a próxima livre; sem padrão conhecida, null (o diálogo pede). */
export function propose(defaults: Ports, taken: ReadonlySet<number>): Ports {
  const one = (d: number | null) => (d === null ? null : taken.has(d) ? nextFree(d, taken) : d);
  return { api: one(defaults.api), front: one(defaults.front) };
}
/** Substitui os placeholders; a variável cujo placeholder não tem porta (solo sem o outro lado) sai. */
export function fill(tpl: EnvTemplate, ports: Ports): Record<string, string>;
export function envPrefix(vars: Record<string, string>): string; // `env 'K=v' … ` ou ""
export function templateError(tpl: EnvTemplate): string | null;  // nome, aspa simples, {placeholder} desconhecido
/** O lado consegue mudar a própria porta? (alguma variável usa o placeholder dele) */
export const movesOwnPort = (tpl: EnvTemplate, side: "api" | "front") => Object.values(tpl).some((v) => v.includes(`{${side}Port}`));
export const portMismatch = (assigned: number | null, seen: number | null) => assigned !== null && seen !== null && assigned !== seen;
```

`templateError` acusa: nome fora de `NAME`, valor com `'`, e `{x}` que não seja `apiPort`/`frontPort` (pega erro de digitação como `{apiport}`).

**Plano de teste** (`src/parallel.test.ts`):
- `nextFree`: pula as tomadas; devolve `null` quando as 100 seguintes estão tomadas; não passa de 65535.
- `propose`: padrão livre fica; tomada anda; `null` continua `null`.
- `fill`: os dois placeholders; texto em volta preservado (`http://localhost:{apiPort}/api`); variável com placeholder sem porta sai.
- `envPrefix`: `{}` → `""`; aspas simples em cada par; termina com espaço.
- `templateError`: `null` no modelo do leilao do techspec; acusa `NEXT-URL`, valor com `'` e `{apiport}`.
- `movesOwnPort` e `portMismatch`: casos sim/não, com `null` sem acusar.

---

## 3. Subir juntas: `activate` em paralelo, interruptor e superfícies sem "encerra"

**Escopo:** com o modo ligado, selecionar não para nada; o interruptor liga e desliga (desligar só com no máximo uma rodando, porque o caso com várias é a task 6); ENCERRA, paleta, painel recolhido e `#running` passam a saber do modo.

**Contexto:** PRD RF1.1 a RF1.5, RF2.1 a RF2.5; techspec › Decisões (`active` = "última vista", a fila continua, Reiniciar em segundo plano). Nesta task as portas ainda colidem (task 4): ela prova o ciclo de vida.

**Skills:** `impeccable` (interruptor e marca do modo na placa, contra o `DESIGN.md`), `no-workarounds`.

**Regras:** `aria-disabled` com motivo, e não `disabled` (padrão do `+` da placa); a chave `data-key` em todo controle do painel, para o foco voltar depois do re-render; nada só por cor (`DESIGN.md`).

**Steps:**

Helper:

```ts
const isParallel = (project: string) => !!config.projects.find((p) => p.name === project)?.parallel;
/** Algo de pé (ou subindo) na worktree: em paralelo, selecioná-la só mostra. */
const isLive = (project: string, wt: Worktree) => LIVE.includes(lineState(project, wt));
```

`wouldStop`: `if (isParallel(project)) return;` na primeira linha. Isso já esconde a nota da paleta e o "Abrir ao criar … encerra" do diálogo de criar, que usam `wouldStop`.

`activate`, em paralelo:
- não calcula `prevEnv` nem `hushed`;
- não sai cedo por `prev === wt.id` (outra worktree pode ter sido a última vista);
- sobe só se nada roda nela:

```ts
const parallel = isParallel(project);
const prevEnv = !parallel && prev && prev !== wt.id ? envs.get(key(project, prev)) : undefined;
// …
if (active[project] === wt.id && env) {
  await env.ready;
  // Em paralelo, voltar para uma que já roda só mostra (RF2.2).
  if (!(parallel && isLive(project, wt))) startEnv(k, env);   // a task 4 põe as portas aqui
}
```

`startEnv(k, env)` extrai as duas linhas atuais (`writeStart` em cada pane + `fresh.delete(k)`), para a task 4 ter um lugar só.

`toggleRun`, condição do reiniciar: `envs.get(k) === env && !stopping.has(project) && (isParallel(project) || active[project] === wt.id)`.

`lineButton`: `if (live && !isParallel(project)) f.append(ENCERRA)`.

`renderBoard`:
- recolhido em paralelo mostra também as linhas vivas: `wt.id === active[p.name] || key(…) === currentKey() || (p.parallel && isLive(p.name, wt))`;
- interruptor na `platform-head`, depois do `+`:

```ts
const par = el("button", {
  type: "button", className: "icon-btn parallel",
  title: `Modo paralelo em ${p.name}: ${p.parallel ? "ligado, as worktrees sobem juntas" : "desligado, abrir uma encerra a outra"}`,
  ariaLabel: `Modo paralelo em ${p.name}`,
  onclick: () => toggleParallel(p.name),
}, icon(PARALLEL_ICON));                       // "M5.5 3v10M10.5 3v10"
par.setAttribute("aria-pressed", String(p.parallel));
par.dataset.key = `parallel:${p.name}`;
```

```ts
async function toggleParallel(project: string) {
  if (stopping.has(project)) return headerNote(false, project, "Troca em andamento · espere ela terminar");
  const on = !isParallel(project);
  // Com várias de pé, desligar para as outras: confirmação (task 6). Aqui só o caso simples.
  if (!on && liveWts(project).length > 1) return confirmParallelOff(project);
  await invoke("set_parallel", { project, on }).catch((e) => headerNote(true, project, "Não gravei o modo", String(e)));
  await refresh();
  headerNote(false, project, on ? "Modo paralelo ligado · as worktrees sobem juntas" : "Modo paralelo desligado");
}
const liveWts = (project: string) => config.projects.find((p) => p.name === project)?.worktrees.filter((w) => isLive(project, w)) ?? [];
```

Até a task 6, `confirmParallelOff` é um `headerNote` "Pare as outras antes de desligar". A task 6 troca pelo diálogo.

Paleta (`renderPalette`): `onActive` vira `onActive || (isParallel(p) && isLive(p, wt))` → "ir para"; em paralelo, não viva → "subir junto".

`renderRunning`: além da ativa de cada outro projeto, as vivas de projetos em paralelo, inclusive as do projeto atual que não são a `current` (`data-key` = `project\0id`, para não colidir).

`styles.css`: `.icon-btn.parallel[aria-pressed="true"]` com fundo e traço do token de "rodando", e não só a cor do traço; a forma muda junto (o ícone ganha preenchimento entre as barras).

**Plano de teste:**
- Manual no app (`npm run tauri dev`), interno com o modo ligado: subir `developer`, clicar em outra worktree; as duas ficam de pé (a segunda pode cair por porta, o que é esperado até a task 4); voltar para a primeira não reinicia; nenhuma prévia ENCERRA nem "encerra" na paleta; painel recolhido mostra as duas.
- Modo desligado: troca comum com a faixa "Parando" de sempre (sem regressão).
- O interruptor pelo teclado (`Ctrl+Shift+E`, setas, Enter) e o `aria-pressed` lido.
- `tsc`, `npm test`.

---

## 4. Portas sem colisão: diálogo, prefixo no start e portas lembradas

**Escopo:** a decisão de portas antes de subir em paralelo, o diálogo, a injeção no `writeStart`, o aprendizado das portas padrão e a memória por worktree.

**Contexto:** PRD RF3.1 a RF3.7, RF4.1 a RF4.4; techspec › fluxo de dados, Modelos de dado (`ports`, `defaultPorts`) e Decisões. É a task da métrica de sucesso (nenhum `EADDRINUSE`).

**Skills:** `impeccable` (o diálogo, seguindo os formulários existentes), `no-workarounds`.

**Regras:** formulários do app: Enter envia, erro no campo culpado com o foco nele, `role="alert"` no erro; `<dialog class="form">` como `#remove-dialog`.

**Steps:**

`Pane` ganha `tab: Tab` e `assigned: number | null` (a porta com que este start subiu; `null` = sem prefixo). `createPane(t, side, parent, project)`: ao ler a porta da saída num start sem prefixo, aprende a padrão:

```ts
// Porta lida num start sem prefixo: é a padrão do projeto (RF3.2, RF3.7).
if (pane.assigned === null) learnDefault(project, t, pane.port);
```

Estado:

```ts
const defaultPorts: Record<string, Ports> = load("defaultPorts", {});
const savedPorts: Record<string, Ports> = load("ports", {});
```

`writeStart(k, pane, isFresh, prefix = "", assigned: number | null = null)`: `pane.assigned = assigned`, e o comando vira `[setup, install, prefix + pane.side.startCommand]`.

Decisão, chamada por `startEnv` só em paralelo:

```ts
/** null: sobe sem prefixo; Ports: sobe com essas; "cancel": não sobe (RF3.3). */
async function planPorts(project: string, wt: Worktree): Promise<Ports | null | "cancel"> {
  const def = defaultPorts[project] ?? { api: null, front: null };
  const taken = takenPorts(key(project, wt.id));            // portas de outros envs do app (pane.port de quem está de pé + assigned)
  const sidesUp = TABS.filter((t) => wt[t]?.startCommand);
  const others = liveWts(project).some((w) => w.id !== wt.id);
  // Sem padrão conhecida e ninguém de pé: primeira subida, ensina a padrão (RF3.1).
  if (sidesUp.every((t) => def[t] === null) && !others) return null;
  const open = await portsOpen(sidesUp.flatMap((t) => def[t] ?? []));
  const busyPort = (p: number | null) => p === null ? others : taken.has(p) || open.has(p);
  if (!sidesUp.some((t) => busyPort(def[t]))) return null;  // padrões livres: como hoje
  const saved = savedPorts[key(project, wt.id)];
  if (saved && (await allFree(saved, taken))) return saved; // RF3.5
  return askPorts(project, wt, propose(def, union(taken, open)), def);
}
```

`startEnv` em paralelo: `const plan = await planPorts(…)`; `"cancel"` → `headerNote(false, project, "Não subiu: portas canceladas")` e para; senão monta por lado:

```ts
const ports = { api: plan?.api ?? def.api, front: plan?.front ?? def.front };
const prefix = plan ? envPrefix(fill(pane.side.parallelEnv, ports)) : "";
writeStart(k, pane, fresh.has(k), prefix, plan ? ports[pane.tab] : null);
```

Diálogo `#ports-dialog` (`index.html`), com `askPorts` devolvendo uma `Promise` resolvida no `close`:
- título "Portas de PROJETO / branch"; uma linha por lado com servidor: `<input type="number" min="1024" max="65535">`, e "padrão 3333" ao lado (ou "padrão desconhecida", pedindo o número, RF3.7);
- prévia, por lado, das variáveis preenchidas (`fill`), atualizada a cada tecla; mostra "Front → API na 3334" (RF4.2);
- bloqueios, como erro no lado culpado, que impedem o Enter:
  - `templateError(side.parallelEnv)`;
  - porta diferente da padrão e `!movesOwnPort(tpl, t)`: "API: sem variável com {apiPort} no parallelEnv · Abrir o config.json";
  - API com porta nova e o front sem `{apiPort}`: "O Front falaria com a API padrão: ponha {apiPort} no parallelEnv do Front" (RF4.4); a solo (sem front) não tem esse bloqueio (RF4.3);
- no submit: `ports_open` nas escolhidas e `taken`; ocupada → erro no campo ("3334 está ocupada por LEILAO / feat/a", ou "por outro programa"), sem subir (RF3.4);
- confirmado: `savedPorts[k] = ports; save("ports", savedPorts)`.

`refresh`: esquece `savedPorts` das worktrees que sumiram, junto com `active`.

**Plano de teste:**
- Manual, leilao com `parallelEnv` do techspec no config: `feat/a` de pé (aprende 3333/3000); subir `feat/b` → diálogo propõe 3334/3001 com a prévia; Enter → as duas RODANDO, nenhum `EADDRINUSE`; o terminal mostra o `env '…' npm run dev`; na aba Network do front de `feat/b`, as chamadas vão para a 3334.
- Parar e subir `feat/b` de novo com `feat/a` de pé: sobe nas lembradas sem diálogo.
- Ocupar a 3334 por fora (`nc -l 3334`) e subir: o diálogo volta e a 3334 dá erro.
- Tirar o `{apiPort}` do `parallelEnv` do front: o diálogo bloqueia com a frase do RF4.4.
- Sozinha no projeto em paralelo: sobe sem prefixo (RF3.1).
- Esc cancela: nada sobe, nada para.

---

## 5. Conferir a porta que subiu

**Escopo:** depois do RODANDO, a porta lida da saída é comparada com a atribuída.

**Contexto:** techspec › Riscos ("Projeto que ignora a env") e Decisões. Um script com `-p 3000` fixo ou um `dotenv --override` sobe na padrão sem avisar. O recado fecha esse buraco.

**Skills:** `no-workarounds` (se der alarme falso, corrigir a leitura, não calar o aviso).

**Regras:** falha na segunda faixa com `headerNote(true, …)` e "Ver o terminal", como as de hoje.

**Steps:** no `pollStatus`, no ramo `end === "rodando"`:

```ts
for (const p of Object.values(panes)) if (portMismatch(p.assigned, p.port))
  headerNote(true, project, `${TAB_LABEL[p.tab]} subiu na ${p.port}, não na ${p.assigned}`, noteWho(project, id, wt.label),
    el("span", { className: "why", textContent: "confira o parallelEnv" }), seeTerminal(project, id, p.tab));
```

Só no fim do SUBINDO (uma vez por subida), como o `lateText`.

**Plano de teste:** manual: um `parallelEnv` com nome errado (`PORTT`), subir em paralelo, e o recado aparece com as duas portas. `npm test` cobre o `portMismatch`.

---

## 6. Desligar com várias de pé

**Escopo:** a confirmação que lista quem para e a parada das outras pelo mesmo caminho do Parar tudo.

**Contexto:** PRD RF5.1 a RF5.5; techspec › fluxo "Desligar". Fica separada por ser destrutiva e porque precisa extrair o miolo da parada do `toggleRun`.

**Skills:** `impeccable` (diálogo), `no-workarounds`.

**Regras:** destrutivo: o foco começa no Cancelar (padrão do `#remove-dialog`); princípio 3 do produto (diz o que mata).

**Steps:**

Extrair do `toggleRun` o trecho de `halting.set` até o `headerNote` do "Parou em" para:

```ts
/** Parada à mão (Ctrl+C → prazo → SIGKILL) dos lados dados; o shell fica. Usada pelo Parar e pelo desligar do paralelo. */
async function haltTabs(project: string, wt: Worktree, env: Env, tabs: Tab[]): Promise<void>
```

`toggleRun` passa a chamá-la, sem mudar comportamento.

`#parallel-off-dialog` (`index.html`): "Desligar o modo paralelo em PROJETO", "Estas param:" com a lista (`labelNodes` + `procs`), "Fica rodando: X", e os botões Desligar e Cancelar.

```ts
function confirmParallelOff(project: string) {
  const keep = current?.project === project ? current.wt.id : active[project];   // RF5.2
  const off = liveWts(project).filter((w) => w.id !== keep);
  // … preenche e showModal(); foco no Cancelar
}
// submit "ok":
await invoke("set_parallel", { project, on: false });
await refresh();
await Promise.all(off.map((w) => { const env = envs.get(key(project, w.id)); return env && haltTabs(project, w, env, Object.keys(env.panes) as Tab[]); }));
```

**Plano de teste:**
- Manual: três de pé no leilao, a vista é `feat/b`; desligar → a lista mostra `feat/a` e `main`; Cancelar mantém tudo e o modo ligado (RF5.4); Desligar → as duas passam por PARANDO e ficam INATIVA, e `feat/b` continua RODANDO.
- Depois, subir outra worktree: troca comum com a faixa "Parando" (o modo saiu).
- Parar/Subir/Reiniciar do cabeçalho iguais a antes (sem regressão da extração).

---

## 7. Ajuda e legenda

**Escopo:** a ajuda (`Ctrl+Shift+H`) explica o interruptor e o modo.

**Contexto:** PRD › Experiência do usuário; princípio 4 (teclado primeiro). Quem esbarra no ícone novo precisa achar o que ele é sem ler o SPEC.

**Skills:** `impeccable`.

**Regras:** textos em pt-BR, no tom da legenda atual.

**Steps:** em `#help` (`index.html`), na `dl.legend`: o ícone do paralelo com "Modo paralelo: as worktrees do projeto sobem juntas, cada uma nas suas portas (parallelEnv no config)".

**Plano de teste:** abrir a ajuda nos dois temas; o item novo lido pelo leitor de tela; `Esc` fecha.

---

Fora destas tasks: `SPEC.md`, `PRODUCT.md` e `DESIGN.md` são atualizados no `sdd-review`, como diz o PRD.
