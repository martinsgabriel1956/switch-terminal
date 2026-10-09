import { Channel, invoke } from "@tauri-apps/api/core";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "@fontsource/barlow-semi-condensed/latin-500.css";
import "@fontsource/barlow-semi-condensed/latin-600.css";
import "@fontsource/barlow-semi-condensed/latin-700.css";
import "./styles.css";

type Side = { path: string; startCommand: string | null; setupCommand: string | null };
type Worktree = { id: string; label: string; api: Side | null; front: Side | null };
type Project = { name: string; error: string | null; worktrees: Worktree[] };
type Config = { stopTimeoutMs: number; projects: Project[] };
type Tab = "api" | "front";
type Pane = { term: Terminal; fit: FitAddon; el: HTMLElement; ptyId: number; side: Side };
type Env = { project: string; root: HTMLElement; panes: Partial<Record<Tab, Pane>>; ready: Promise<void> };
/** Estado de uma linha do painel: o que a palheta mostra. */
type LineState = "run" | "start" | "wait" | "stop" | "idle" | "none";

const TABS: Tab[] = ["api", "front"];
const TAB_LABEL: Record<Tab, string> = { api: "API", front: "Front" };
const FLAP: Record<LineState, string> = { run: "RODANDO", start: "SUBINDO", wait: "AGUARDA", stop: "PARANDO", idle: "PARADA", none: "" };
const SPOKEN: Record<LineState, string> = {
  run: "rodando",
  start: "subindo",
  wait: "aguardando a anterior parar",
  stop: "parando",
  idle: "parada",
  none: "não aberta",
};
const CONFIG_EXAMPLE = `{
  "projects": [
    {
      "name": "meu-projeto",
      "api":   { "repo": "~/dev/meu-api", "startCommand": "npm run dev" },
      "front": { "repo": "~/dev/meu-web", "startCommand": "npm run dev" }
    }
  ]
}`;

// Cores ANSI dos terminais por tema. São conteúdo (saída dos programas), não paleta da interface.
const TERM_THEME: Record<"dark" | "light", ITheme> = {
  dark: {
    background: "#131417",
    foreground: "#e6e5df",
    cursor: "#ecebe6",
    cursorAccent: "#131417",
    selectionBackground: "rgba(236, 235, 230, 0.22)",
    black: "#1b1c20",
    red: "#f26d6d",
    green: "#4cc38a",
    yellow: "#f2b33d",
    blue: "#6ea8fe",
    magenta: "#c792ea",
    cyan: "#5ccfe6",
    white: "#d6d5cf",
    brightBlack: "#6c6d6a",
    brightRed: "#ff8a8a",
    brightGreen: "#6fd9a5",
    brightYellow: "#ffcb66",
    brightBlue: "#93bdff",
    brightMagenta: "#ddb3f5",
    brightCyan: "#8be2f2",
    brightWhite: "#f4f3ee",
  },
  light: {
    background: "#f4f5f3",
    foreground: "#1d1e22",
    cursor: "#15161a",
    cursorAccent: "#f4f5f3",
    selectionBackground: "rgba(21, 22, 26, 0.16)",
    black: "#1d1e22",
    red: "#b3261e",
    green: "#0d6a3f",
    yellow: "#855000",
    blue: "#1f5fbf",
    magenta: "#8e3fa8",
    cyan: "#0b6e7a",
    white: "#6c6e72",
    brightBlack: "#55575c",
    brightRed: "#d0362b",
    brightGreen: "#13824f",
    brightYellow: "#9a5f00",
    brightBlue: "#2c6fd6",
    brightMagenta: "#a24fbd",
    brightCyan: "#0f7f8c",
    brightWhite: "#3a3c40",
  },
};
const scheme = matchMedia("(prefers-color-scheme: light)");
const termTheme = () => TERM_THEME[scheme.matches ? "light" : "dark"];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const board = $("#board");
const tabsEl = $("#tabs");
const destEl = $("#destination");
const runningEl = $("#running");
const panesEl = $("#panes");
const emptyEl = $("#empty");
const waitEl = $("#wait");
const palette = $("#palette");
const paletteInput = $<HTMLInputElement>("#palette input");
const paletteList = $("#palette ul");
const paletteNote = $("#palette .note");

let config: Config = { stopTimeoutMs: 5000, projects: [] };
let configError: string | null = null;
const envs = new Map<string, Env>();
// Projeto em troca: qual worktree está sendo encerrada, os terminais dela e se já passou do Ctrl+C para o SIGKILL (e por quê).
type Stopping = { fromId: string; from: string; fromWt: Worktree | undefined; panes: Pane[]; forcing: null | "timeout" | "user" };
const stopping = new Map<string, Stopping>();
const queues = new Map<string, Promise<void>>();
// Worktrees recém-criadas pelo app: na primeira subida rodam o setupCommand antes do startCommand.
const fresh = new Set<string>();
// Estado real, vindo do backend: envs com processo rodando, e envs cujo start acabou de ser enviado.
let running = new Set<string>();
const starting = new Map<string, number>();
let current: { project: string; wt: Worktree } | null = null;
let tab: Tab = "api";

const key = (project: string, id: string) => `${project}\u0000${id}`;
const currentKey = () => (current ? key(current.project, current.wt.id) : null);

function load<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(name) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function save(name: string, value: unknown) {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch {}
}

// Última worktree ativa por projeto e as mais recentes (a paleta abre na anterior).
const active: Record<string, string> = load("active", {});
let recent: string[] = load("recent", []);
const saveActive = () => save("active", active);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string | null)[]) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children.filter((c): c is Node | string => c !== null));
  return e;
}

// ---------- palheta ----------

// Último estado mostrado por cada palheta: ela só vira quando o estado muda.
const shown = new Map<string, LineState>();

function flap(state: LineState, id: string) {
  const changed = shown.has(id) && shown.get(id) !== state;
  shown.set(id, state);
  const f = el("span", { className: `flap${changed ? " flip" : ""}` }, el("span", { textContent: FLAP[state] }));
  f.dataset.state = state;
  f.setAttribute("aria-hidden", "true");
  return f;
}

/** O que trocar para `id` encerraria: a worktree ativa do projeto, se tem algo de pé. */
function wouldStop(project: string, id: string | null): Worktree | undefined {
  const prev = active[project];
  if (!prev || prev === id) return;
  const wt = config.projects.find((p) => p.name === project)?.worktrees.find((w) => w.id === prev);
  return wt && ["run", "start", "wait"].includes(lineState(project, wt)) ? wt : undefined;
}

function lineState(project: string, wt: Worktree): LineState {
  const k = key(project, wt.id);
  const st = stopping.get(project);
  if (st?.fromId === wt.id) return "stop";
  if (st && active[project] === wt.id) return "wait";
  if (running.has(k)) return "run";
  if (starting.has(k)) return "start";
  if (envs.has(k)) return "idle";
  return "none";
}

const PAIR_ICON = "M3 5.5h10M10.5 3 13 5.5 10.5 8M13 10.5H3M5.5 8 3 10.5 5.5 13";
const FROM_ICON = "M13 8H3M6.5 4.5 3 8l3.5 3.5";

/** Rótulo "api ↔ front" com a seta desenhada em SVG, não em caractere. */
function labelNodes(label: string): (Node | string)[] {
  const [a, f] = label.split(" ↔ ");
  return f === undefined ? [label] : [a, icon(PAIR_ICON, "inline"), f];
}

/** "feat/scrap-movement": prefixo em meia-tinta, nome em tinta cheia. Sem espaço, o prefixo encolhe antes do nome. */
function branchText(branch: string) {
  const cut = branch.lastIndexOf("/") + 1;
  return [el("span", { className: "prefix", textContent: branch.slice(0, cut) }), el("span", { className: "rest", textContent: branch.slice(cut) })];
}

// ---------- terminais ----------

async function createPane(side: Side, parent: HTMLElement): Promise<Pane> {
  const paneEl = el("div", { className: "pane off" });
  paneEl.setAttribute("role", "tabpanel");
  parent.append(paneEl);
  const term = new Terminal({
    fontFamily: "'JetBrainsMono Nerd Font', 'Hack Nerd Font Mono', monospace",
    fontSize: 14,
    lineHeight: 1.15,
    theme: termTheme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(paneEl);
  fit.fit();

  const onData = new Channel<ArrayBuffer>();
  onData.onmessage = (buf) => term.write(new Uint8Array(buf));
  const ptyId = await invoke<number>("pty_spawn", { cwd: side.path, cols: term.cols, rows: term.rows, onData });
  paneEl.id = `pane-${ptyId}`;
  term.onData((data) => invoke("pty_write", { id: ptyId, data }));
  term.onResize(({ cols, rows }) => invoke("pty_resize", { id: ptyId, cols, rows }));
  return { term, fit, el: paneEl, ptyId, side };
}

function ensureEnv(project: string, wt: Worktree): { env: Env; created: boolean } {
  const k = key(project, wt.id);
  const existing = envs.get(k);
  if (existing) return { env: existing, created: false };

  const root = el("div", { className: "env off" });
  panesEl.append(root);
  const env: Env = { project, root, panes: {}, ready: Promise.resolve() };
  env.ready = (async () => {
    for (const t of TABS) {
      const side = wt[t];
      if (side) env.panes[t] = await createPane(side, root);
    }
  })();
  envs.set(k, env);
  return { env, created: true };
}

function disposeEnv(k: string, env: Env) {
  for (const pane of Object.values(env.panes)) {
    invoke("pty_kill", { id: pane.ptyId });
    pane.term.dispose();
  }
  env.root.remove();
  envs.delete(k);
}

function writeStart(k: string, pane: Pane, isFresh: boolean) {
  const cmd = [isFresh && pane.side.setupCommand, pane.side.startCommand].filter(Boolean).join(" && ");
  if (!cmd) return;
  starting.set(k, Date.now());
  invoke("pty_write", { id: pane.ptyId, data: cmd + "\r" });
}
const stopPane = (pane: Pane) => invoke("pty_stop", { id: pane.ptyId, timeoutMs: config.stopTimeoutMs });

/** Uma worktree ativa por projeto: para a anterior (Ctrl+C → espera → SIGKILL) e só então roda o startCommand. */
function activate(project: string, wt: Worktree, created: boolean) {
  const prev = active[project];
  if (prev === wt.id && !created) return;
  active[project] = wt.id;
  saveActive();

  const run = async () => {
    const prevEnv = prev && prev !== wt.id ? envs.get(key(project, prev)) : undefined;
    if (prevEnv) {
      const fromWt = config.projects.find((p) => p.name === project)?.worktrees.find((w) => w.id === prev);
      await prevEnv.ready;
      const state: Stopping = { fromId: prev, from: fromWt?.label ?? prev, fromWt, panes: Object.values(prevEnv.panes), forcing: null };
      stopping.set(project, state);
      // O backend manda SIGKILL ao estourar o prazo; aqui só avisa que chegou nessa fase.
      const forceTimer = setTimeout(() => {
        state.forcing ??= "timeout";
        render();
      }, config.stopTimeoutMs);
      render(true);
      await Promise.all(state.panes.map(stopPane));
      clearTimeout(forceTimer);
      stopping.delete(project);
      running.delete(key(project, prev));
    }
    // Trocou de novo enquanto parava: quem vier depois na fila sobe a certa.
    if (active[project] === wt.id) {
      const k = key(project, wt.id);
      const env = envs.get(k);
      if (env) {
        await env.ready;
        Object.values(env.panes).forEach((pane) => writeStart(k, pane, fresh.has(k)));
        fresh.delete(k);
      }
    }
    render(currentKey() === key(project, wt.id));
  };
  // Trocas do mesmo projeto em fila, para nunca subir duas worktrees ao mesmo tempo.
  queues.set(project, (queues.get(project) ?? Promise.resolve()).then(run, run));
}

async function select(project: string, wt: Worktree) {
  current = { project, wt };
  const k = key(project, wt.id);
  recent = [k, ...recent.filter((r) => r !== k)].slice(0, 30);
  save("recent", recent);
  const { env, created } = ensureEnv(project, wt);
  activate(project, wt, created);
  render(true);
  await env.ready;
  render(true);
}

// ---------- render ----------

/** Redesenha tudo. `focus`: devolve o foco ao terminal (ou ao aviso de troca); só em ações do usuário. */
function render(focus = false) {
  renderBoard();
  renderRunning();

  const ck = currentKey();
  for (const [k, env] of envs) env.root.classList.toggle("off", k !== ck);
  emptyEl.hidden = !!current;
  tabsEl.replaceChildren();

  // Durante a troca o terminal novo não aceita digitação: ela entraria antes do startCommand.
  for (const e of envs.values()) for (const p of Object.values(e.panes)) p.term.options.disableStdin = stopping.has(e.project);

  if (!current) {
    destEl.replaceChildren();
    destEl.dataset.sig = "";
    waitEl.hidden = true;
    renderEmpty();
    return;
  }

  const { project, wt } = current;
  if (!wt[tab]) tab = wt.api ? "api" : "front";
  const env = envs.get(ck!);
  const state = lineState(project, wt);
  // Região viva: só reescreve quando muda, senão o leitor de tela repete o destino a cada render.
  const sig = `${ck}\u0000${state}`;
  if (destEl.dataset.sig !== sig) {
    destEl.dataset.sig = sig;
    destEl.replaceChildren(
      flap(state, `head:${ck}`),
      el("span", { className: "where" }, el("span", { className: "project", textContent: project }), el("span", { className: "sep", textContent: "/" }), ...labelNodes(wt.label)),
      el("span", { className: "sr", textContent: `: ${SPOKEN[state]}` }),
    );
  }
  for (const t of TABS) {
    if (!wt[t]) continue;
    const b = el("button", { type: "button", id: `tab-${t}`, tabIndex: t === tab ? 0 : -1, onclick: () => setTab(t, true) }, el("span", { textContent: TAB_LABEL[t] }));
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(t === tab));
    const pane = env?.panes[t];
    if (pane) b.setAttribute("aria-controls", pane.el.id);
    tabsEl.append(b);
  }
  renderWait(project, wt);

  for (const t of TABS) env?.panes[t]?.el.classList.toggle("off", t !== tab);
  const pane = env?.panes[tab];
  pane?.fit.fit();
  if (!focus || !palette.hidden || document.querySelector("dialog[open]")) return;
  if (stopping.has(project)) {
    if (!waitEl.contains(document.activeElement)) waitEl.querySelector<HTMLElement>(".wait-card")?.focus();
  } else pane?.term.focus();
}

function renderEmpty() {
  const missing = configError?.includes("Não consegui ler");
  emptyEl.replaceChildren(
    ...(configError
      ? [
          el("h2", { textContent: missing ? "Nenhum projeto configurado" : "O config tem um problema" }),
          el("p", { textContent: missing ? "Crie o primeiro projeto apontando os repositórios da API e do front." : configError }),
          el("p", {}, el("button", { type: "button", className: "btn primary", textContent: "Criar projeto", onclick: () => openProjectDialog() })),
          el("p", { textContent: "Ou edite ~/.config/switch-terminal/config.json à mão:" }),
          el("pre", { textContent: CONFIG_EXAMPLE }),
        ]
      : config.projects.length
        ? [
            el("h2", { textContent: "Nenhuma worktree aberta" }),
            el("p", {}, "Escolha uma no painel ou use ", el("kbd", { textContent: "Ctrl" }), el("kbd", { textContent: "Shift" }), el("kbd", { textContent: "K" }), "."),
          ]
        : [
            el("h2", { textContent: "Nenhum projeto ainda" }),
            el("p", {}, el("button", { type: "button", className: "btn primary", textContent: "Criar projeto", onclick: () => openProjectDialog() })),
          ]),
  );
}

/** Aviso sobre os terminais enquanto a worktree anterior do projeto é encerrada. */
function renderWait(project: string, wt: Worktree) {
  const st = stopping.get(project);
  waitEl.hidden = !st;
  if (!st) return;
  const goingBack = active[project] === st.fromId;
  const detail = goingBack
    ? `A troca foi cancelada. ${st.from} reinicia assim que os processos saírem.`
    : st.forcing === "user"
      ? `Encerrando à força (SIGKILL), como pedido. ${wt.label} sobe em seguida.`
      : st.forcing
        ? "Não parou com Ctrl+C a tempo; os processos estão sendo encerrados à força (SIGKILL)."
        : `Aguardando os processos saírem e liberarem as portas para iniciar ${wt.label}.`;
  // Nenhum botão é o padrão: esperar é a ação certa, e forçar mata sem o Ctrl+C.
  const force = el("button", {
    type: "button",
    className: "btn",
    textContent: st.forcing ? "Forçando…" : "Forçar agora",
    title: "Envia SIGKILL aos processos sem esperar o prazo",
    disabled: !!st.forcing,
    onclick: () => {
      st.forcing = "user";
      for (const p of st.panes) invoke("pty_force", { id: p.ptyId });
      render();
    },
  });
  const back = el("button", {
    type: "button",
    className: "btn",
    textContent: `Voltar para ${st.from}`,
    title: `Cancela a troca e reinicia ${st.from}`,
    disabled: goingBack || !st.fromWt,
    onclick: () => st.fromWt && select(project, st.fromWt),
  });
  force.dataset.act = "force";
  back.dataset.act = "back";
  // Redesenho mantém o foco onde estava (mesmo botão, ou o card se o botão ficou desabilitado).
  const had = waitEl.contains(document.activeElement) ? ((document.activeElement as HTMLElement).dataset.act ?? "card") : null;
  const card = el("div", { className: "wait-card", tabIndex: -1 });
  card.append(
    el(
      "div",
      { className: "wait-head" },
      flap("stop", `wait:${project}`),
      el("strong", { textContent: st.forcing ? `Forçando o encerramento de ${st.from}` : `Encerrando ${st.from}` }),
    ),
    el("p", { textContent: detail }),
    el("div", { className: "actions" }, force, back),
  );
  waitEl.replaceChildren(card);
  if (had) (waitEl.querySelector<HTMLButtonElement>(`[data-act="${had}"]:not(:disabled)`) ?? card).focus();
}

/** Erro de git do projeto em uma linha legível; o texto cru fica no detalhe. */
function projectErrorSummary(error: string) {
  const side = error.startsWith("Front:") ? "Front" : "API";
  const raw = error.toLowerCase();
  const reason = raw.includes("not a git repository")
    ? "a pasta não é um repositório git"
    : raw.includes("cannot change to") || raw.includes("no such file")
      ? "repositório não encontrado"
      : "não consegui ler as worktrees";
  return `${side}: ${reason}`;
}

function lineButton(project: string, wt: Worktree) {
  const k = key(project, wt.id);
  const state = lineState(project, wt);
  const [api, front] = wt.id.split("|");
  const branch = api || front;
  const tag = !api ? el("span", { className: "tag", textContent: "SÓ FRONT" }) : !front ? el("span", { className: "tag", textContent: "SÓ API" }) : null;
  const pair = api && front && api !== front ? el("span", { className: "pair" }, icon(PAIR_ICON, "inline"), front) : null;
  const live = state === "run" || state === "start" || state === "wait";
  const b = el(
    "button",
    {
      type: "button",
      className: `line${live ? " live" : ""}`,
      tabIndex: -1,
      title: wt.label,
      ariaLabel: `${wt.label}${tag ? (api ? ", só API" : ", só front") : ""}: ${SPOKEN[state]}`,
      onclick: () => select(project, wt),
    },
    flap(state, `line:${k}`),
    el("span", { className: "name" }, el("span", { className: "top" }, el("span", { className: "branch" }, ...branchText(branch)), tag), pair),
  );
  b.dataset.key = k;
  if (currentKey() === k) b.setAttribute("aria-current", "true");
  return b;
}

function renderBoard() {
  // O painel é recriado a cada render; o foco do teclado volta para a mesma linha.
  const focusedKey = board.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined;
  board.replaceChildren(
    ...config.projects.map((p) => {
      const add = el(
        "button",
        {
          type: "button",
          className: "icon-btn",
          title: p.error ? "Corrija o erro do projeto para criar worktrees" : `Nova worktree em ${p.name} (Ctrl+Shift+N)`,
          ariaLabel: `Nova worktree em ${p.name}`,
          disabled: !!p.error,
          onclick: () => openAddDialog(p.name),
        },
        icon("M8 3v10M3 8h10"),
      );
      const problem = p.error
        ? el(
            "details",
            { className: "problem" },
            el("summary", { textContent: projectErrorSummary(p.error) }),
            el("code", { textContent: p.error }),
            el("p", { textContent: "Ajuste o caminho no config.json e volte para a janela." }),
          )
        : null;
      // Ordem do git, fixa: como num painel de partidas, só a palheta vira; a linha não sai do lugar sob o cursor.
      return el(
        "section",
        { className: "platform", ariaLabel: p.name },
        el("div", { className: "platform-head" }, el("h3", {}, el("span", { className: "tile" }, el("span", { textContent: p.name }))), add),
        problem,
        el("ul", { className: "lines" }, ...p.worktrees.map((wt) => el("li", {}, lineButton(p.name, wt)))),
      );
    }),
  );
  const focused = focusedKey ? board.querySelector<HTMLElement>(`.line[data-key="${CSS.escape(focusedKey)}"]`) : null;
  const stop = focused ?? board.querySelector<HTMLElement>('.line[aria-current="true"]') ?? board.querySelector<HTMLElement>(".line");
  if (stop) stop.tabIndex = 0;
  focused?.focus();
}

/** Com o painel recolhido, o cabeçalho mostra o que roda nos outros projetos. */
function renderRunning() {
  runningEl.replaceChildren(
    ...config.projects
      .filter((p) => p.name !== current?.project && active[p.name])
      .flatMap((p) => {
        const wt = p.worktrees.find((w) => w.id === active[p.name]);
        if (!wt) return [];
        const state = lineState(p.name, wt);
        return [
          el("span", { className: "other", title: `${p.name} / ${wt.label}: ${SPOKEN[state]}` }, flap(state, `run:${p.name}`), `${p.name} / ${wt.label}`, el("span", { className: "sr", textContent: `: ${SPOKEN[state]}` })),
        ];
      }),
  );
}

function icon(d: string, extra = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", `icon ${extra}`.trim());
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

function setTab(t: Tab, focus = false) {
  tab = t;
  render(focus);
}

// Abas: setas trocam de aba, como em qualquer tablist.
tabsEl.addEventListener("keydown", (e) => {
  if (!current?.wt.api || !current.wt.front || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
  e.preventDefault();
  setTab(tab === "api" ? "front" : "api");
  $<HTMLButtonElement>(`#tab-${tab}`).focus();
});

// Painel pelo teclado: setas andam pelas linhas, Esc volta ao terminal.
board.addEventListener("keydown", (e) => {
  const lines = [...board.querySelectorAll<HTMLButtonElement>(".line")];
  const i = lines.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  if (e.key === "ArrowDown") lines[Math.min(i + 1, lines.length - 1)].focus();
  else if (e.key === "ArrowUp") lines[Math.max(i - 1, 0)].focus();
  else if (e.key === "Home") lines[0].focus();
  else if (e.key === "End") lines[lines.length - 1].focus();
  else if (e.key === "Escape") render(true);
  else return;
  e.preventDefault();
});

board.addEventListener("focusin", (e) => {
  if (!(e.target as HTMLElement).classList.contains("line")) return;
  for (const l of board.querySelectorAll<HTMLElement>(".line")) l.tabIndex = l === e.target ? 0 : -1;
});

function focusBoard() {
  if (document.body.classList.contains("sidebar-off")) setSidebar(true);
  const lines = board.querySelectorAll<HTMLButtonElement>(".line");
  (board.querySelector<HTMLButtonElement>('.line[aria-current="true"]') ?? lines[0])?.focus();
}

// ---------- config / worktrees ----------

async function refresh() {
  try {
    config = await invoke<Config>("load_config");
    configError = null;
  } catch (e) {
    // Config quebrado não mata terminais: só mostra o erro.
    configError = String(e);
    render();
    return;
  }

  const alive = new Map<string, Worktree>();
  const loaded = new Set<string>();
  for (const p of config.projects) {
    if (p.error) continue;
    loaded.add(p.name);
    for (const wt of p.worktrees) alive.set(key(p.name, wt.id), wt);
  }
  // Worktree que sumiu (git worktree remove): mata os PTYs dela. Projeto com erro de git fica intacto.
  for (const [k, env] of envs) if (loaded.has(env.project) && !alive.has(k)) disposeEnv(k, env);
  for (const p of loaded) if (active[p] && !alive.has(key(p, active[p]))) delete active[p];
  saveActive();

  if (current) {
    const freshWt = alive.get(currentKey()!);
    if (freshWt) current.wt = freshWt;
    else if (loaded.has(current.project)) current = null;
  }
  render();
}

/** Consulta quais terminais têm processo rodando; só redesenha quando algo muda. */
async function pollStatus() {
  const panes = [...envs].flatMap(([k, e]) => Object.values(e.panes).map((p) => ({ k, id: p.ptyId })));
  if (!panes.length) return;
  const busy = await invoke<boolean[]>("pty_status", { ids: panes.map((p) => p.id) });
  const next = new Set(panes.filter((_, i) => busy[i]).map((p) => p.k));
  let changed = next.size !== running.size || [...next].some((k) => !running.has(k));
  for (const [k, t] of starting) {
    // Start enviado: vira RODANDO quando o processo aparece, ou desiste depois de 15 s.
    if (next.has(k) || Date.now() - t > 15000) {
      starting.delete(k);
      changed = true;
    }
  }
  running = next;
  if (changed) render();
}

// ---------- paleta ----------

type Item = { project: string; wt: Worktree };
let items: Item[] = [];
let sel = 0;

/** Subsequência: "fx" casa com "feature-x". */
const fuzzy = (q: string, text: string) => {
  let i = 0;
  for (const c of text) if (c === q[i]) i++;
  return i === q.length;
};

function renderPalette() {
  const q = paletteInput.value.toLowerCase().replace(/\s+/g, "");
  const rank = (it: Item) => {
    const r = recent.indexOf(key(it.project, it.wt.id));
    return r < 0 ? Infinity : r;
  };
  items = config.projects
    .flatMap((p) => p.worktrees.map((wt) => ({ project: p.name, wt })))
    .filter((it) => fuzzy(q, `${it.project}${it.wt.label}`.toLowerCase()))
    .sort((a, b) => rank(a) - rank(b));
  sel = Math.min(sel, Math.max(items.length - 1, 0));
  paletteList.replaceChildren(
    ...(items.length
      ? items.map((it, i) => {
          const li = el(
            "li",
            { id: `opt-${i}`, onclick: () => choose(it) },
            flap(lineState(it.project, it.wt), `pal:${key(it.project, it.wt.id)}`),
            el("span", { className: "label" }, ...labelNodes(it.wt.label)),
            el("span", { className: "project", textContent: it.project }),
          );
          li.setAttribute("role", "option");
          li.setAttribute("aria-selected", String(i === sel));
          return li;
        })
      : [el("li", { className: "none", textContent: q ? `Nenhuma worktree corresponde a "${paletteInput.value.trim()}".` : "Nenhuma worktree ainda." })]),
  );
  // A troca é destrutiva: diz o que o Enter vai encerrar.
  const it = items[sel];
  const ends = it && wouldStop(it.project, it.wt.id);
  paletteNote.hidden = !ends;
  paletteNote.replaceChildren(...(ends ? ["Encerra ", el("strong", {}, ...labelNodes(ends.label)), ` em ${it.project}`] : []));
  if (items.length) paletteInput.setAttribute("aria-activedescendant", `opt-${sel}`);
  else paletteInput.removeAttribute("aria-activedescendant");
  paletteList.children[sel]?.scrollIntoView({ block: "nearest" });
}

function openPalette() {
  palette.hidden = false;
  paletteInput.value = "";
  sel = 0;
  renderPalette();
  // Como no Alt+Tab: abre selecionando a anterior, então Ctrl+Shift+K e Enter voltam para ela.
  if (items.length > 1 && currentKey() === key(items[0].project, items[0].wt.id)) {
    sel = 1;
    renderPalette();
  }
  paletteInput.focus();
  refresh().then(renderPalette);
}

function closePalette() {
  palette.hidden = true;
  render(true);
}

function choose(it: Item | undefined) {
  palette.hidden = true;
  if (it) select(it.project, it.wt);
  else render(true);
}

paletteInput.addEventListener("input", () => {
  sel = 0;
  renderPalette();
});
paletteInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") sel = Math.min(sel + 1, items.length - 1);
  else if (e.key === "ArrowUp") sel = Math.max(sel - 1, 0);
  else if (e.key === "Enter" || e.key === "Escape") {
    e.preventDefault();
    return e.key === "Enter" ? choose(items[sel]) : closePalette();
  } else return;
  e.preventDefault();
  renderPalette();
});
// mousedown na lista não tira o foco do input, então o blur só vem de clique fora.
paletteList.addEventListener("mousedown", (e) => e.preventDefault());
paletteInput.addEventListener("blur", () => !palette.hidden && closePalette());

// ---------- nova worktree ----------

type FormError = { side: Tab | null; message: string; created: Tab[] };
const asFormError = (err: unknown): FormError =>
  err && typeof err === "object" && "message" in err ? (err as FormError) : { side: null, message: String(err), created: [] };

/** Erro do git ao criar worktree: resumo legível e o campo que o usuário precisa corrigir. */
function worktreeErrorSummary(message: string): { field: "dir" | "base" | "branch"; text: string } {
  const raw = message.toLowerCase();
  if (raw.includes("invalid reference") || raw.includes("not a valid object name"))
    return { field: "base", text: "A branch de origem não existe neste repositório." };
  if (raw.includes("branch de origem")) return { field: "base", text: "Escolha a branch de origem." };
  if (raw.includes("not a valid branch name")) return { field: "branch", text: "Nome de branch inválido." };
  if (raw.includes("already checked out") || raw.includes("already used by worktree"))
    return { field: "branch", text: "Essa branch já está aberta em outra worktree." };
  if (raw.includes("already exists")) return { field: "dir", text: "Já existe uma pasta com esse nome no diretório." };
  return { field: "dir", text: message };
}

type SideDefaults = { dir: string; local: string[]; remote: string[]; defaultBase: string };
type Defaults = Record<Tab, { Ok: SideDefaults } | { Err: string }>;

const addDialog = $<HTMLDialogElement>("#add-dialog");
const addForm = addDialog.querySelector("form")!;
const addError = addDialog.querySelector<HTMLElement>(".error")!;
const field = <T extends HTMLElement>(name: string) => addForm.elements.namedItem(name) as unknown as T;
const projectSel = field<HTMLSelectElement>("project");
const branchInput = field<HTMLInputElement>("branch");
const sideBox = (t: Tab) => addForm.querySelector<HTMLFieldSetElement>(`fieldset[data-side="${t}"]`)!;
const sideCheck = (t: Tab) => field<HTMLInputElement>(t);
const sideDir = (t: Tab) => field<HTMLInputElement>(`${t}-dir`);
const sideBase = (t: Tab) => field<HTMLSelectElement>(`${t}-base`);
const sideMsg = (t: Tab) => sideBox(t).querySelector<HTMLElement>(".side-error")!;
const openNow = field<HTMLInputElement>("open");
const openHint = addForm.querySelector<HTMLElement>(".open-hint")!;
let defaultsReq = 0;

function openAddDialog(project?: string) {
  const usable = config.projects.filter((p) => !p.error);
  if (!usable.length) return;
  projectSel.replaceChildren(...config.projects.map((p) => el("option", { value: p.name, textContent: p.name, disabled: !!p.error })));
  const wanted = [project, current?.project].find((n) => usable.some((p) => p.name === n));
  projectSel.value = wanted ?? usable[0].name;
  branchInput.value = "";
  openNow.checked = true;
  addError.textContent = "";
  loadDefaults();
  addDialog.showModal();
  branchInput.focus();
}

/** Pasta padrão e branches de cada repo do projeto escolhido. */
async function loadDefaults() {
  const req = ++defaultsReq;
  for (const t of TABS) {
    sideCheck(t).checked = true;
    sideCheck(t).disabled = false;
    sideDir(t).value = "";
    sideBase(t).replaceChildren(el("option", { value: "", textContent: "Carregando…" }));
    sideMsg(t).textContent = "";
    sideMsg(t).classList.remove("ok");
    sideBox(t).querySelector<HTMLDetailsElement>("details")!.open = false;
  }
  syncSides();
  let defaults: Defaults;
  try {
    defaults = await invoke<Defaults>("worktree_defaults", { project: projectSel.value });
  } catch (err) {
    if (req === defaultsReq) addError.textContent = String(err);
    return;
  }
  if (req !== defaultsReq) return; // trocou de projeto no meio
  for (const t of TABS) {
    const d = defaults[t];
    if ("Err" in d) {
      sideCheck(t).checked = false;
      sideBase(t).replaceChildren();
      sideMsg(t).textContent = d.Err;
    } else {
      sideDir(t).value = d.Ok.dir;
      const group = (label: string, list: string[]) =>
        el("optgroup", { label }, ...list.map((b) => el("option", { value: b, textContent: b })));
      sideBase(t).replaceChildren(group("Locais", d.Ok.local), ...(d.Ok.remote.length ? [group("Remotas", d.Ok.remote)] : []));
      sideBase(t).value = d.Ok.defaultBase;
    }
  }
  syncSides();
}

/** Lado desmarcado: fieldset desabilitado (o checkbox da legend continua clicável) e sem validação. */
function syncSides() {
  const branch = branchInput.value.trim() || "<branch>";
  const ends = openNow.checked ? wouldStop(projectSel.value, null) : undefined;
  openHint.hidden = !ends;
  openHint.replaceChildren(...(ends ? ["Encerra ", el("strong", {}, ...labelNodes(ends.label)), ", que está rodando."] : []));
  for (const t of TABS) {
    sideBox(t).disabled = !sideCheck(t).checked;
    const dir = sideDir(t).value.trim().replace(/\/+$/, "");
    const base = sideBase(t).value;
    sideBox(t)
      .querySelector(".preview")!
      .replaceChildren(...(dir ? [`${dir}/${branch}`, ...(base ? [icon(FROM_ICON, "inline"), base] : [])] : ["Carregando…"]));
  }
}

projectSel.addEventListener("change", loadDefaults);
addForm.addEventListener("input", syncSides);
addForm.addEventListener("change", syncSides);
for (const t of TABS) {
  sideBox(t).querySelector<HTMLButtonElement>(".pick")!.addEventListener("click", async () => {
    const dir = await pickFolder({ directory: true, defaultPath: sideDir(t).value || undefined, title: `Diretório das worktrees (${TAB_LABEL[t]})` });
    if (typeof dir === "string") {
      sideDir(t).value = dir;
      syncSides();
    }
  });
}

addForm.addEventListener("submit", async (e) => {
  if ((e.submitter as HTMLButtonElement | null)?.value !== "ok") return;
  e.preventDefault();
  const project = projectSel.value;
  const branch = branchInput.value.trim();
  const side = (t: Tab) => (sideCheck(t).checked ? { dir: sideDir(t).value, base: sideBase(t).value } : null);
  const api = side("api");
  const front = side("front");
  if (!api && !front) {
    addError.textContent = "Marque API, Front ou os dois.";
    return;
  }
  const submit = e.submitter as HTMLButtonElement;
  submit.disabled = true;
  submit.textContent = "Criando…";
  addError.textContent = "";
  for (const t of TABS) if (!sideMsg(t).classList.contains("ok")) sideMsg(t).textContent = "";
  try {
    await invoke("add_worktree", { project, branch, api, front });
    addDialog.close();
  } catch (err) {
    const fe = asFormError(err);
    // O que já foi criado sai do próximo envio: desmarcado e travado, com aviso.
    for (const t of fe.created) {
      sideCheck(t).checked = false;
      sideCheck(t).disabled = true;
      sideMsg(t).textContent = `Já criada em ${sideDir(t).value.replace(/\/+$/, "")}/${branch}.`;
      sideMsg(t).classList.add("ok");
    }
    syncSides();
    if (fe.side) {
      const { field, text } = worktreeErrorSummary(fe.message);
      sideMsg(fe.side).replaceChildren(text, ...(text !== fe.message ? [el("code", { className: "raw", textContent: fe.message })] : []));
      sideBox(fe.side).querySelector<HTMLDetailsElement>("details")!.open = true;
      (field === "branch" ? branchInput : field === "base" ? sideBase(fe.side) : sideDir(fe.side)).focus();
    } else {
      addError.textContent = fe.message;
      branchInput.focus();
    }
  } finally {
    submit.disabled = false;
    submit.textContent = "Criar worktree";
  }
  // Mesmo com erro parcial (ex.: API criada, front falhou) o que foi criado aparece na lista.
  await refresh();
  const wt = config.projects.find((p) => p.name === project)?.worktrees.find((w) => w.id.split("|").includes(branch));
  if (wt && !addDialog.open) {
    fresh.add(key(project, wt.id));
    if (openNow.checked) select(project, wt);
  }
});

addDialog.addEventListener("close", () => render(true));

// ---------- novo projeto ----------

const projectDialog = $<HTMLDialogElement>("#project-dialog");
const projectForm = projectDialog.querySelector("form")!;
const projectError = projectDialog.querySelector<HTMLElement>(".error")!;
const pfield = (name: string) => projectForm.elements.namedItem(name) as HTMLInputElement;
const pSideMsg = (t: Tab) => projectForm.querySelector<HTMLElement>(`fieldset[data-side="${t}"] .side-error`)!;

function openProjectDialog() {
  projectForm.reset();
  projectError.textContent = "";
  for (const t of TABS) pSideMsg(t).textContent = "";
  projectDialog.showModal();
  pfield("name").focus();
}

for (const t of TABS) {
  projectForm.querySelector<HTMLButtonElement>(`fieldset[data-side="${t}"] .pick`)!.addEventListener("click", async () => {
    const dir = await pickFolder({ directory: true, defaultPath: pfield(`${t}-repo`).value || undefined, title: `Repositório (${TAB_LABEL[t]})` });
    if (typeof dir === "string") pfield(`${t}-repo`).value = dir;
  });
}

projectForm.addEventListener("submit", async (e) => {
  if ((e.submitter as HTMLButtonElement | null)?.value !== "ok") return;
  e.preventDefault();
  const side = (t: Tab) => ({ repo: pfield(`${t}-repo`).value, startCommand: pfield(`${t}-start`).value, setupCommand: pfield(`${t}-setup`).value });
  const submit = e.submitter as HTMLButtonElement;
  submit.disabled = true;
  submit.textContent = "Criando…";
  projectError.textContent = "";
  for (const t of TABS) pSideMsg(t).textContent = "";
  try {
    await invoke("add_project", { project: { name: pfield("name").value, api: side("api"), front: side("front") } });
    projectDialog.close();
    await refresh();
  } catch (err) {
    const fe = asFormError(err);
    if (fe.side) {
      pSideMsg(fe.side).textContent = fe.message;
      pfield(`${fe.side}-repo`).focus();
    } else {
      projectError.textContent = fe.message;
      pfield("name").focus();
    }
  } finally {
    submit.disabled = false;
    submit.textContent = "Criar projeto";
  }
});

projectDialog.addEventListener("close", () => render(true));
$("#new-project").addEventListener("click", () => openProjectDialog());

// ---------- barra lateral ----------

const toggleBtn = $("#toggle-sidebar");

function setSidebar(open: boolean) {
  document.body.classList.toggle("sidebar-off", !open);
  const label = open ? "Recolher o painel" : "Abrir o painel";
  toggleBtn.title = `${label} (Ctrl+Shift+B)`;
  toggleBtn.setAttribute("aria-label", label);
  toggleBtn.setAttribute("aria-expanded", String(open));
  save("sidebar", open ? "open" : "off");
  // O ResizeObserver dos painéis reajusta os terminais à nova largura.
}

const toggleSidebar = () => setSidebar(document.body.classList.contains("sidebar-off"));
toggleBtn.addEventListener("click", () => {
  toggleSidebar();
  render(true);
});
setSidebar(load<string>("sidebar", "open") !== "off");

// Largura arrastável da barra lateral, lembrada entre sessões.
const SIDEBAR_W = { min: 200, max: 480, default: 280 };
const handle = $("#sidebar-handle");
const sidebarEl = $("#sidebar");

function setSidebarWidth(w: number) {
  const px = Math.round(Math.min(SIDEBAR_W.max, Math.max(SIDEBAR_W.min, w)));
  document.body.style.setProperty("--sidebar-w", `${px}px`);
  handle.setAttribute("aria-valuenow", String(px));
  save("sidebarWidth", px);
}

handle.setAttribute("aria-valuemin", String(SIDEBAR_W.min));
handle.setAttribute("aria-valuemax", String(SIDEBAR_W.max));
let dragPointer: number | null = null;
handle.addEventListener("pointerdown", (e) => {
  if (dragPointer !== null || e.button !== 0) return; // um segundo ponteiro não sequestra o arraste
  e.preventDefault();
  dragPointer = e.pointerId;
  handle.setPointerCapture(e.pointerId);
  document.body.classList.add("resizing");
});
window.addEventListener("blur", () => {
  if (dragPointer !== null && handle.hasPointerCapture(dragPointer)) handle.releasePointerCapture(dragPointer);
});
handle.addEventListener("pointermove", (e) => {
  if (handle.hasPointerCapture(e.pointerId)) setSidebarWidth(e.clientX - sidebarEl.getBoundingClientRect().left);
});
handle.addEventListener("lostpointercapture", () => {
  dragPointer = null;
  document.body.classList.remove("resizing");
  render(true);
});
handle.addEventListener("dblclick", () => setSidebarWidth(SIDEBAR_W.default));
handle.addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 40 : 10;
  const w = sidebarEl.getBoundingClientRect().width;
  if (e.key === "ArrowLeft") setSidebarWidth(w - step);
  else if (e.key === "ArrowRight") setSidebarWidth(w + step);
  else if (e.key === "Home") setSidebarWidth(SIDEBAR_W.min);
  else if (e.key === "End") setSidebarWidth(SIDEBAR_W.max);
  else return;
  e.preventDefault();
});
setSidebarWidth(Number(load("sidebarWidth", SIDEBAR_W.default)) || SIDEBAR_W.default);

// ---------- atalhos e janela ----------

// Fase de captura: o atalho é tratado antes do xterm receber a tecla.
window.addEventListener(
  "keydown",
  (e) => {
    if (!e.ctrlKey || !e.shiftKey) return;
    if (e.code === "KeyK") palette.hidden ? openPalette() : closePalette();
    else if (e.code === "KeyB") {
      toggleSidebar();
      render(true);
    } else if (e.code === "KeyE") focusBoard();
    else if (e.code === "KeyH") helpEl.togglePopover();
    else if (e.code === "KeyN") {
      if (!document.querySelector("dialog[open]")) openAddDialog(current?.project);
    } else if (e.code === "KeyJ") {
      if (current?.wt.api && current.wt.front) setTab(tab === "api" ? "front" : "api", true);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  },
  true,
);

const helpEl = $("#help");
helpEl.addEventListener("toggle", (e) => (e as ToggleEvent).newState === "closed" && render(true));

window.addEventListener("focus", () => refresh());

scheme.addEventListener("change", () => {
  for (const env of envs.values()) for (const pane of Object.values(env.panes)) pane.term.options.theme = termTheme();
});

new ResizeObserver(() => {
  for (const env of envs.values()) for (const pane of Object.values(env.panes)) pane.fit.fit();
}).observe(panesEl);

// ---------- início: restaura a última worktree ativa de cada projeto ----------

// Se o webview recarregou (F5, HMR em dev), os terminais da página anterior ficaram sem dono
// e ainda rodando: mata todos antes de restaurar, senão cada recarga sobe outro dev server.
await invoke("pty_kill_all");
await refresh();
for (const p of config.projects) {
  const wt = p.worktrees.find((w) => w.id === active[p.name]);
  if (!wt) continue;
  const { created } = ensureEnv(p.name, wt);
  activate(p.name, wt, created);
  current ??= { project: p.name, wt };
}
if (current) {
  const k = key(current.project, current.wt.id);
  recent = [k, ...recent.filter((r) => r !== k)];
}
render(true);
setInterval(pollStatus, 1200);
