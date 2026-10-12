import { Channel, invoke } from "@tauri-apps/api/core";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "@fontsource/barlow-semi-condensed/latin-500.css";
import "@fontsource/barlow-semi-condensed/latin-600.css";
import "@fontsource/barlow-semi-condensed/latin-700.css";
import "./styles.css";
import { asPm, isPm, joinStart, PREFIX, rewrite, splitStart, switchPm, type Pm } from "./pm";

/** `startCommand`: o que sobe (o da branch, senão o do projeto); `projectStart`: o do projeto. */
type Side = { path: string; startCommand: string | null; setupCommand: string | null; projectStart: string | null };
type Worktree = { id: string; label: string; api: Side | null; front: Side | null };
type Project = { name: string; error: string | null; worktrees: Worktree[] };
type Config = { stopTimeoutMs: number; screenReader: boolean; projects: Project[] };
type Tab = "api" | "front";
/** `url`: endereço do dev server lido da saída do terminal ("Local: http://localhost:3000"). */
type Pane = { term: Terminal; fit: FitAddon; el: HTMLElement; ptyId: number; side: Side; url: string | null };
type Env = { project: string; root: HTMLElement; panes: Partial<Record<Tab, Pane>>; ready: Promise<void> };
/** Estado de uma linha do painel: o que a palheta mostra. */
type LineState = "run" | "part" | "start" | "wait" | "stop" | "kill" | "idle" | "none";

const TABS: Tab[] = ["api", "front"];
const TAB_LABEL: Record<Tab, string> = { api: "API", front: "Front" };
const FLAP: Record<LineState, string> = {
  run: "RODANDO",
  part: "PARCIAL",
  start: "SUBINDO",
  wait: "AGUARDA",
  stop: "PARANDO",
  kill: "SIGKILL",
  idle: "INATIVA",
  none: "",
};
const SPOKEN: Record<LineState, string> = {
  run: "rodando",
  part: "parcial",
  start: "subindo",
  wait: "aguardando a anterior parar",
  stop: "parando",
  kill: "encerrando à força",
  idle: "inativa",
  none: "não aberta",
};
const CONFIG_PATH = "~/.config/hotswap/config.json";
const CONFIG_EXAMPLE = `{
  "projects": [
    {
      "name": "meu-projeto",
      "api":   { "repo": "~/dev/meu-api", "startCommand": "npm run dev" },
      "front": { "repo": "~/dev/meu-web", "startCommand": "npm run dev" }
    }
  ]
}`;

// Cores ANSI dos terminais por tema. São conteúdo (saída dos programas), não paleta da interface;
// vermelho, verde e amarelo são os estados e vêm dos tokens (termTheme).
const TERM_THEME: Record<"dark" | "light", ITheme> = {
  dark: {
    foreground: "#e6e5df",
    black: "#1b1c20",
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
    foreground: "#1d1e22",
    black: "#1d1e22",
    blue: "#1f5fbf",
    magenta: "#8e3fa8",
    cyan: "#0b6e7a",
    white: "#6c6e72",
    brightBlack: "#55575c",
    brightRed: "#ce352a",
    brightGreen: "#127f4d",
    brightYellow: "#9a5f00",
    brightBlue: "#2b6cd1",
    brightMagenta: "#9d4cb7",
    brightCyan: "#0e7a87",
    brightWhite: "#3a3c40",
  },
};
const scheme = matchMedia("(prefers-color-scheme: light)");
/** Fundo, cursor, seleção e as cores de estado vêm dos tokens do CSS (o terminal fica sobre o mesmo fundo do painel); as outras cores ANSI são conteúdo. */
function termTheme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  return {
    ...TERM_THEME[scheme.matches ? "light" : "dark"],
    background: token("--term-bg"),
    cursor: token("--ink"),
    cursorAccent: token("--term-bg"),
    selectionBackground: token("--selection"),
    red: token("--fail"),
    green: token("--run"),
    yellow: token("--start")
  };
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const board = $("#board");
const tabsEl = $("#tabs");
const destEl = $("#destination");
const runningEl = $("#running");
const panesEl = $("#panes");
const emptyEl = $("#empty");
const waitEl = $("#wait");
// Fala do aviso de troca numa região viva só de texto: no card, os botões eram relidos a cada mudança.
const waitSay = $("#wait-say");
const palette = $("#palette");
const paletteInput = $<HTMLInputElement>("#palette input");
const paletteList = $("#palette ul");
const paletteNote = $("#palette .note");
const urlEl = $<HTMLAnchorElement>("#dev-url");
const lastStopEl = $("#last-stop");
const haltTabEl = $<HTMLButtonElement>("#halt-tab");
const haltAllEl = $<HTMLButtonElement>("#halt-all");
haltTabEl.addEventListener("click", () => toggleRun(false));
haltAllEl.addEventListener("click", () => toggleRun(true));

urlEl.addEventListener("click", (e) => {
  e.preventDefault();
  invoke("open_url", { url: urlEl.href });
});

let lastStopTimer = 0;
function clearNote() {
  lastStopEl.replaceChildren();
  lastStopEl.style.minWidth = "";
  delete lastStopEl.dataset.stay;
}
/** Recado curto no cabeçalho ("Parou em 1,8 s · feat/x", "Worktrees relidas: nada mudou."), por alguns segundos.
 *  `stay`: falha ("não subiu", "à força", "caiu") fica até a próxima troca, em vez de sumir antes de ser lida. */
function headerNote(stay: boolean, ...nodes: (Node | string)[]) {
  lastStopEl.replaceChildren(...nodes.map((n) => (typeof n === "string" ? el("span", { textContent: n }) : n)));
  // O piso do recado é o verbo e o tempo inteiros: sem espaço, o destino cede antes de virar "Encerr…".
  lastStopEl.style.minWidth = `${(lastStopEl.firstElementChild as HTMLElement).scrollWidth}px`;
  clearTimeout(lastStopTimer);
  if (stay) lastStopEl.dataset.stay = "";
  else {
    delete lastStopEl.dataset.stay;
    lastStopTimer = setTimeout(clearNote, 8000);
  }
}

let config: Config = { stopTimeoutMs: 5000, screenReader: false, projects: [] };
let configError: string | null = null;
const envs = new Map<string, Env>();
// Projeto em troca: qual worktree está sendo encerrada, os terminais dela e se já passou do Ctrl+C para o SIGKILL (e por quê).
type Stopping = { fromId: string; from: string; fromWt: Worktree | undefined; panes: Pane[]; forcing: null | "timeout" | "user"; deadline: number };
const stopping = new Map<string, Stopping>();
const queues = new Map<string, Promise<void>>();
// Worktrees recém-criadas pelo app: na primeira subida rodam o setupCommand antes do startCommand.
const fresh = new Set<string>();
// Estado real, vindo do backend: terminais (id do PTY) com processo rodando e o nome dele, e envs cujo start acabou de ser enviado.
let busy = new Map<number, string>();
const starting = new Map<string, number>();
// Parada à mão (botões ■ do cabeçalho): envs parando agora (e se já passou para o SIGKILL), e os terminais parados
// de propósito, que não contam como queda. O próximo start (Subir ou troca) tira a marca.
const halting = new Map<string, { forcing: boolean }>();
const halted = new Set<number>();
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

// Último texto mostrado por cada palheta: ela só vira quando muda.
const shown = new Map<string, string>();

function flap(state: LineState, id: string, text = FLAP[state]) {
  const changed = shown.has(id) && shown.get(id) !== `${state}:${text}`;
  shown.set(id, `${state}:${text}`);
  const f = el("span", { className: `flap${changed ? " flip" : ""}` }, el("span", { textContent: text }));
  f.dataset.state = state;
  f.setAttribute("aria-hidden", "true");
  return f;
}

const findWt = (project: string, id: string) => config.projects.find((p) => p.name === project)?.worktrees.find((w) => w.id === id);

/** O que trocar para `id` encerraria: a worktree ativa do projeto, se tem algo de pé. */
function wouldStop(project: string, id: string | null): Worktree | undefined {
  const prev = active[project];
  if (!prev || prev === id) return;
  const wt = findWt(project, prev);
  return wt && LIVE.includes(lineState(project, wt)) ? wt : undefined;
}

/** Nomes dos processos em primeiro plano da worktree ("npm run dev"): a troca diz o que mata, não só onde. */
function procs(project: string, wt: Worktree) {
  const panes = Object.values(envs.get(key(project, wt.id))?.panes ?? {});
  return [...new Set(panes.map((p) => busy.get(p.ptyId)).filter((n): n is string => !!n))];
}

const LIVE: LineState[] = ["run", "part", "start", "wait"];

/** Lados com processo rodando e os que deveriam estar (os que têm startCommand). */
function sides(k: string) {
  const panes = Object.entries(envs.get(k)?.panes ?? {}) as [Tab, Pane][];
  const up = panes.filter(([, p]) => busy.has(p.ptyId)).map(([t]) => t);
  const want = panes.filter(([, p]) => p.side.startCommand && !halted.has(p.ptyId));
  return { up, down: (want.length ? want : panes).map(([t]) => t).filter((t) => !up.includes(t)) };
}

function lineState(project: string, wt: Worktree): LineState {
  const k = key(project, wt.id);
  const st = stopping.get(project);
  // Voltou para a que estava parando: ela espera a si mesma parar para reiniciar.
  if (st && active[project] === wt.id) return "wait";
  if (st?.fromId === wt.id) return st.forcing ? "kill" : "stop";
  const h = halting.get(k);
  if (h) return h.forcing ? "kill" : "stop";
  if (starting.has(k)) return "start";
  const { up, down } = sides(k);
  if (up.length) return down.length ? "part" : "run";
  if (envs.has(k)) return "idle";
  return "none";
}

/** O estado falado; no parcial, diz qual lado caiu. */
function say(project: string, wt: Worktree, state: LineState) {
  if (state !== "part") return SPOKEN[state];
  const { up, down } = sides(key(project, wt.id));
  return `só ${up.map((t) => TAB_LABEL[t]).join(" e ")} rodando, ${down.map((t) => TAB_LABEL[t]).join(" e ")} parado`;
}

const PAIR_ICON = "M3 5.5h10M10.5 3 13 5.5 10.5 8M13 10.5H3M5.5 8 3 10.5 5.5 13";
const FROM_ICON = "M13 8H3M6.5 4.5 3 8l3.5 3.5";

/** Par cujos lados só diferem no prefixo ("feature-api/x ↔ feature-app/x"): [prefixo da API, prefixo do front, nome]. */
function samePairName(api: string, front: string) {
  const [ap, ar] = splitBranch(api);
  const [fp, fr] = splitBranch(front);
  return ar === fr && ap && fp ? ([ap, fp, ar] as const) : null;
}

/** Rótulo "api ↔ front" com a seta desenhada em SVG, não em caractere; o leitor de tela ouve "pareada com".
 *  Mesmo nome dos dois lados: o nome uma vez e os prefixos depois, em meia-tinta, como no painel. */
function labelNodes(label: string): (Node | string)[] {
  const [a, f] = label.split(" ↔ ");
  if (f === undefined) return [label];
  const arrow = [icon(PAIR_ICON, "inline"), el("span", { className: "sr", textContent: " pareada com " })];
  const same = samePairName(a, f);
  return same ? [same[2], el("span", { className: "pair-pre" }, ` ${same[0]}`, ...arrow, same[1])] : [a, ...arrow, f];
}
/** O mesmo rótulo para atributos (aria-label), onde não cabe nó. */
const spokenLabel = (label: string) => label.replace(" ↔ ", " pareada com ");

/** "feat/scrap-movement" → ["feat/", "scrap-movement"]. */
function splitBranch(branch: string) {
  const cut = branch.lastIndexOf("/") + 1;
  return [branch.slice(0, cut), branch.slice(cut)] as const;
}

/** "feat/scrap-movement": prefixo em meia-tinta, nome em tinta cheia. Sem espaço, o prefixo encolhe antes do nome. */
function branchText(branch: string) {
  const [prefix, rest] = splitBranch(branch);
  return [el("span", { className: "prefix", textContent: prefix }), el("span", { className: "rest", textContent: rest })];
}

// ---------- terminais ----------

async function createPane(t: Tab, side: Side, parent: HTMLElement): Promise<Pane> {
  const paneEl = el("div", { className: "pane off" });
  paneEl.setAttribute("role", "tabpanel");
  paneEl.setAttribute("aria-labelledby", `tab-${t}`);
  parent.append(paneEl);
  const term = new Terminal({
    // a mesma pilha do --mono do CSS: muda num lugar só
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--mono").trim(),
    fontSize: 14,
    lineHeight: 1.15,
    theme: termTheme(),
    screenReaderMode: config.screenReader,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(paneEl);
  fit.fit();

  const pane: Pane = { term, fit, el: paneEl, ptyId: -1, side, url: null };
  const dec = new TextDecoder();
  let tail = "";
  const onData = new Channel<ArrayBuffer>();
  onData.onmessage = (buf) => {
    const bytes = new Uint8Array(buf);
    term.write(bytes);
    // Endereço já lido: não varre mais a saída (um build verboso). Ao sair o processo, pollStatus limpa e volta a ler.
    if (pane.url) return;
    // ponytail: sequência ANSI partida entre dois pedaços escapa do filtro; só atrasa a leitura do endereço
    const text = tail + dec.decode(bytes, { stream: true }).replace(ANSI, "");
    tail = text.slice(-80);
    const port = [...text.matchAll(PORT_RE)].pop()?.[1];
    if (port) {
      pane.url = `localhost:${port}`;
      render();
    }
  };
  pane.ptyId = await invoke<number>("pty_spawn", { cwd: side.path, cols: term.cols, rows: term.rows, onData });
  paneEl.id = `pane-${pane.ptyId}`;
  term.onData((data) => invoke("pty_write", { id: pane.ptyId, data }));
  term.onResize(({ cols, rows }) => invoke("pty_resize", { id: pane.ptyId, cols, rows }));
  return pane;
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
// "http://localhost:3000", "127.0.0.1:3333", "listening on port 3333"
const PORT_RE = /(?:https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):|\bporta?\s*:?\s+)(\d{2,5})\b/gi;

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
      if (side) env.panes[t] = await createPane(t, side, root);
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

async function writeStart(k: string, pane: Pane, isFresh: boolean) {
  halted.delete(pane.ptyId);
  const setup = isFresh ? pane.side.setupCommand : null;
  if (!setup && !pane.side.startCommand) return;
  pane.url = null;
  starting.set(k, Date.now());
  // Sem node_modules o start falharia: instala antes, na mesma linha, à vista no terminal.
  // O setupCommand de uma worktree recém-criada já cuida disso; checar antes (e não a cada erro) não reinstala num crash.
  const install = setup || !pane.side.startCommand ? null : await invoke<string | null>("missing_deps_install", { path: pane.side.path, start: pane.side.startCommand });
  const cmd = [setup, install, pane.side.startCommand].filter(Boolean).join(" && ");
  invoke("pty_write", { id: pane.ptyId, data: cmd + "\r" });
}
/** Ctrl+C → espera → SIGKILL; resolve `true` se precisou forçar. */
const stopPane = (pane: Pane) => invoke<boolean>("pty_stop", { id: pane.ptyId, timeoutMs: config.stopTimeoutMs });

/** Botões ■ e ■■ do cabeçalho (Ctrl+Shift+X, com Alt os dois): para o que roda nas abas, como na troca, mas o shell fica.
 *  Parado, sobe de novo. A worktree continua a ativa do projeto. */
async function toggleRun(all: boolean) {
  if (!current) return;
  const { project, wt } = current;
  const k = key(project, wt.id);
  const env = envs.get(k);
  if (!env || stopping.has(project) || halting.has(k)) return;
  const tabs = TABS.filter((t) => env.panes[t] && (all || t === tab));
  const panes = tabs.map((t) => env.panes[t]!);
  if (!(starting.has(k) || panes.some((p) => busy.has(p.ptyId)))) {
    for (const p of panes) writeStart(k, p, false);
    return render(true);
  }
  const state = { forcing: false };
  halting.set(k, state);
  starting.delete(k);
  for (const p of panes) halted.add(p.ptyId);
  const t0 = Date.now();
  const forceTimer = setTimeout(() => {
    state.forcing = true;
    render();
  }, config.stopTimeoutMs);
  render(true);
  const forced = (await Promise.all(panes.map(stopPane))).some(Boolean);
  clearTimeout(forceTimer);
  halting.delete(k);
  for (const p of panes) busy.delete(p.ptyId);
  const secs = ((Date.now() - t0) / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  headerNote(forced, forced ? `Encerrado à força em ${secs} s` : `Parou em ${secs} s`, el("span", { className: "who" }, "· ", tabs.map((t) => TAB_LABEL[t]).join(" e "), " · ", ...labelNodes(wt.label)));
  render();
}

/** Uma worktree ativa por projeto: para a anterior (Ctrl+C → espera → SIGKILL) e só então roda o startCommand. */
function activate(project: string, wt: Worktree, created: boolean) {
  const prev = active[project];
  if (prev === wt.id && !created) return;
  active[project] = wt.id;
  saveActive();

  const run = async () => {
    const prevEnv = prev && prev !== wt.id ? envs.get(key(project, prev)) : undefined;
    if (prevEnv) {
      const fromWt = findWt(project, prev);
      await prevEnv.ready;
      const state: Stopping = {
        fromId: prev,
        from: fromWt?.label ?? prev,
        fromWt,
        panes: Object.values(prevEnv.panes),
        forcing: null,
        deadline: Date.now() + config.stopTimeoutMs,
      };
      stopping.set(project, state);
      // O backend manda SIGKILL ao estourar o prazo; aqui só avisa que chegou nessa fase.
      const forceTimer = setTimeout(() => {
        state.forcing ??= "timeout";
        render();
      }, config.stopTimeoutMs);
      // Contagem até o SIGKILL no aviso.
      const tick = setInterval(() => current?.project === project && renderWait(project, current.wt), 250);
      const hadProcs = !!fromWt && procs(project, fromWt).length > 0;
      render(true);
      await Promise.all(state.panes.map(stopPane));
      clearTimeout(forceTimer);
      clearInterval(tick);
      stopping.delete(project);
      for (const p of state.panes) busy.delete(p.ptyId);
      wasUp.delete(key(project, prev));
      // O fim da troca também tem fechamento: quanto a anterior levou para sair, e se foi à força.
      if (hadProcs) {
        const secs = ((Date.now() - state.deadline + config.stopTimeoutMs) / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        // O tempo primeiro: sem espaço, quem trunca é o nome, nunca o "parou em".
        headerNote(!!state.forcing, state.forcing ? `Encerrada à força em ${secs} s` : `Parou em ${secs} s`, el("span", { className: "who" }, "· ", ...labelNodes(state.from)));
      }
    }
    const k = key(project, wt.id);
    const env = envs.get(k);
    // Trocou de novo enquanto parava: quem vier depois na fila sobe a certa.
    if (active[project] === wt.id) {
      if (env) {
        await env.ready;
        Object.values(env.panes).forEach((pane) => writeStart(k, pane, fresh.has(k)));
        fresh.delete(k);
      }
      // Abandonada antes de subir: fecha, em vez de ficar PARADA sem nunca ter rodado.
    } else if (env && created && currentKey() !== k) disposeEnv(k, env);
    render(currentKey() === key(project, wt.id));
  };
  // Trocas do mesmo projeto em fila, para nunca subir duas worktrees ao mesmo tempo.
  queues.set(project, (queues.get(project) ?? Promise.resolve()).then(run, run));
}

async function select(project: string, wt: Worktree) {
  closeOverlay();
  // A falha que ficou no cabeçalho já foi vista: a próxima troca a tira.
  if (lastStopEl.dataset.stay !== undefined) clearNote();
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

  // Durante a troca o terminal novo não aceita digitação: ela entraria antes do startCommand.
  for (const e of envs.values()) for (const p of Object.values(e.panes)) p.term.options.disableStdin = stopping.has(e.project);

  if (!current) {
    destEl.replaceChildren();
    destEl.dataset.sig = "";
    tabsEl.replaceChildren();
    tabsEl.dataset.sig = "";
    urlEl.hidden = true;
    haltTabEl.hidden = haltAllEl.hidden = true;
    waitEl.hidden = true;
    renderEmpty();
    fitRunning();
    return;
  }

  const { project, wt } = current;
  if (!wt[tab]) tab = wt.api ? "api" : "front";
  const env = envs.get(ck!);
  const state = lineState(project, wt);
  // Durante a troca quem fala é o aviso; o destino calado evita dois anúncios ao mesmo tempo.
  destEl.setAttribute("aria-live", stopping.has(project) ? "off" : "polite");
  // Região viva: só reescreve quando muda, senão o leitor de tela repete o destino a cada render.
  const sig = `${ck}\u0000${state}\u0000${say(project, wt, state)}`;
  if (destEl.dataset.sig !== sig) {
    destEl.dataset.sig = sig;
    destEl.replaceChildren(
      el("span", { className: "where" }, el("span", { className: project.length <= 3 ? "project short" : "project", textContent: project }), el("span", { className: "sep", textContent: "/", ariaHidden: "true" }), el("span", { className: "branch-name" }, ...labelNodes(wt.label))),
      flap(state, `head:${ck}`),
      el("span", { className: "sr", textContent: `: ${say(project, wt, state)}` }),
    );
  }
  // Endereço do dev server da aba aberta, enquanto ele está de pé. Fica à direita: aparecer não empurra as abas.
  const shownPane = env?.panes[tab];
  const url = shownPane?.url && busy.has(shownPane.ptyId) ? `http://${shownPane.url}` : null;
  urlEl.hidden = !url;
  if (url && urlEl.href !== `${url}/`) {
    urlEl.href = url;
    urlEl.textContent = shownPane!.url!.replace("localhost", "");
    urlEl.title = `Abrir ${url} no navegador`;
    urlEl.setAttribute("aria-label", urlEl.title);
  }
  renderHalt(haltTabEl, TABS.filter((t) => t === tab));
  renderHalt(haltAllEl, wt.api && wt.front ? TABS : []);
  const down = state === "part" ? sides(ck!).down : [];
  // Só recria as abas quando elas mudam: recriar com o foco numa delas (a janela voltando, uma palheta virando)
  // jogava o foco do teclado no body. Se mudar com o foco nelas, ele volta para a mesma aba (ou para a selecionada).
  const tabsSig = [ck, tab, down.join(), ...TABS.map((t) => (wt[t] ? (env?.panes[t]?.el.id ?? "-") : ""))].join("\u0000");
  if (tabsEl.dataset.sig !== tabsSig) {
    tabsEl.dataset.sig = tabsSig;
    const focusedTab = tabsEl.contains(document.activeElement) ? document.activeElement!.id : null;
    tabsEl.replaceChildren();
    for (const t of TABS) {
      if (!wt[t]) continue;
      const b = el(
        "button",
        { type: "button", id: `tab-${t}`, tabIndex: t === tab ? 0 : -1, onclick: () => setTab(t, true) },
        el("span", { textContent: TAB_LABEL[t] }),
        down.includes(t) ? el("span", { className: "sr", textContent: " (parado)" }) : null,
      );
      b.classList.toggle("down", down.includes(t));
      if (down.includes(t)) b.title = `Nada rodando no ${TAB_LABEL[t]}`;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(t === tab));
      const pane = env?.panes[t];
      if (pane) b.setAttribute("aria-controls", pane.el.id);
      tabsEl.append(b);
    }
    if (focusedTab) (document.getElementById(focusedTab) ?? document.getElementById(`tab-${tab}`))?.focus();
  }
  // Mede só com o cabeçalho completo (destino, abas, porta): antes disso a faixa parece ter espaço que não tem.
  fitRunning();
  renderWait(project, wt);

  for (const t of TABS) env?.panes[t]?.el.classList.toggle("off", t !== tab);
  const pane = env?.panes[tab];
  pane?.fit.fit();
  if (!focus || !palette.hidden || document.querySelector("dialog[open]")) return;
  if (stopping.has(project)) {
    if (!waitEl.contains(document.activeElement)) waitEl.querySelector<HTMLElement>(".wait-card")?.focus();
  } else pane?.term.focus();
}

const STOP_ICON = "M4.5 4.5h7v7h-7z";
const STOP_ALL_ICON = "M2.5 5h4.5v6H2.5zM9 5h4.5v6H9z";
const START_ICON = "M5.5 3.8v8.4L12 8z";
const START_ALL_ICON = "M2.5 4.2v7.6L7.5 8zM8.5 4.2v7.6l5-3.8z";

/** ■ / ▶ de `tabs` da worktree atual: Parar se algo roda (ou acabou de subir), Subir se há start; senão some.
 *  Durante uma troca ou uma parada fica aria-disabled com o motivo. */
function renderHalt(b: HTMLButtonElement, tabs: Tab[]) {
  const k = currentKey()!;
  const panes = tabs.flatMap((t) => envs.get(k)?.panes[t] ?? []);
  const running = starting.has(k) || panes.some((p) => busy.has(p.ptyId));
  b.hidden = !running && !panes.some((p) => p.side.startCommand);
  if (b.hidden) return;
  const all = tabs.length > 1;
  const what = tabs.map((t) => TAB_LABEL[t]).join(" e ");
  const wait = stopping.has(current!.project) || halting.has(k);
  const label = wait ? "Aguarde: parando processos" : `${running ? "Parar" : "Subir"} ${what} (Ctrl+Shift+${all ? "Alt+" : ""}X)`;
  if (b.title === label) return;
  b.title = label;
  b.setAttribute("aria-label", label);
  if (wait) b.setAttribute("aria-disabled", "true");
  else b.removeAttribute("aria-disabled");
  b.replaceChildren(icon(running ? (all ? STOP_ALL_ICON : STOP_ICON) : all ? START_ALL_ICON : START_ICON));
}

function renderEmpty() {
  const missing = configError?.includes("Não consegui ler");
  const hadFocus = document.activeElement === document.body || emptyEl.contains(document.activeElement);
  emptyEl.replaceChildren(
    ...(configError
      ? [
          el("h2", { textContent: missing ? "Nenhum projeto configurado" : "O config tem um problema" }),
          el("p", { textContent: missing ? "Aponte os repositórios da API e do front; as worktrees deles viram as linhas do painel." : configError }),
          el("p", {}, el("button", { type: "button", className: "btn primary", textContent: "Criar projeto", onclick: () => openProjectDialog() })),
          el("p", { textContent: `Ou edite ${CONFIG_PATH} à mão; o painel relê quando você volta para a janela:` }),
          el("pre", { textContent: CONFIG_EXAMPLE }),
        ]
      : config.projects.length
        ? [
            el("h2", { textContent: "Nenhuma worktree aberta" }),
            el("p", {}, "Escolha uma no painel ou use ", el("kbd", { textContent: "Ctrl" }), el("kbd", { textContent: "Shift" }), el("kbd", { textContent: "K" }), "."),
          ]
        : [
            el("h2", { textContent: "Nenhum projeto ainda" }),
            el("p", { textContent: "Aponte os repositórios da API e do front; as worktrees deles viram as linhas do painel." }),
            el("p", {}, el("button", { type: "button", className: "btn primary", textContent: "Criar projeto", onclick: () => openProjectDialog() })),
          ]),
  );
  if (hadFocus) emptyEl.querySelector<HTMLButtonElement>(".btn.primary")?.focus();
}

/** Aviso sobre os terminais enquanto a worktree anterior do projeto é encerrada. */
function renderWait(project: string, wt: Worktree) {
  const st = stopping.get(project);
  waitEl.hidden = !st;
  if (!st) {
    waitEl.dataset.sig = "";
    waitSay.textContent = "";
    return;
  }
  const goingBack = active[project] === st.fromId;
  const left = Math.max(0, Math.ceil((st.deadline - Date.now()) / 1000));
  // Contagem em tinta neutra: esperar é o caminho normal. Vermelho só se chegar ao SIGKILL.
  const count = () => {
    const c = flap("idle", `count:${project}`, `${left} s`);
    c.classList.add("count");
    return c;
  };
  // Só reconstrói quando o texto muda (é região viva); a contagem vira no lugar.
  const sig = [project, st.fromId, wt.id, goingBack, st.forcing].join("\u0000");
  if (waitEl.dataset.sig === sig) {
    waitEl.querySelector(".count")?.replaceWith(count());
    return;
  }
  waitEl.dataset.sig = sig;
  const verb = goingBack ? "Voltando para" : st.forcing ? "Forçando o encerramento de" : "Encerrando";
  const names = st.fromWt ? procs(project, st.fromWt) : [];
  const what = names.length ? el("span", { className: "procs", textContent: names.join(", ") }) : "os processos";
  const detail = goingBack
    ? [...labelNodes(st.from), " recebeu Ctrl+C e reinicia assim que os processos saírem."]
    : st.forcing === "user"
      ? ["Encerrando à força (SIGKILL), como pedido. ", ...labelNodes(wt.label), " sobe em seguida."]
      : st.forcing
        ? ["Não parou com Ctrl+C a tempo; os processos estão sendo encerrados à força (SIGKILL)."]
        : ["Ctrl+C enviado a ", what, ". Esperando saírem e liberarem as portas para iniciar ", ...labelNodes(wt.label), "."];
  // Nenhum botão é o padrão: esperar é a ação certa, e forçar mata sem o Ctrl+C.
  // No SIGKILL não há botão: o backend espera no máximo 1 s depois dele e a troca segue sozinha.
  const force = st.forcing
    ? null
    : el("button", {
        type: "button",
        className: "btn",
        textContent: "Forçar agora",
        title: "Envia SIGKILL aos processos sem esperar o prazo",
        onclick: () => {
          st.forcing = "user";
          for (const p of st.panes) invoke("pty_force", { id: p.ptyId });
          render();
        },
      });
  if (force) force.dataset.act = "force";
  // Voltar reinicia a anterior (o Ctrl+C já foi); depois de voltar, ou já no SIGKILL, não há mais para onde voltar.
  // Sem atalho de Esc: no reflexo do vim, ele desfazia a troca recém-pedida.
  const back =
    goingBack || st.forcing || !st.fromWt
      ? null
      : el(
          "button",
          {
            type: "button",
            className: "btn back",
            title: `Cancela a troca e reinicia ${st.from}`,
            onclick: () => st.fromWt && select(project, st.fromWt),
          },
          "Voltar para ",
          el("span", { className: "to" }, ...labelNodes(st.from)),
        );
  if (back) back.dataset.act = "back";
  // Redesenho mantém o foco onde estava (mesmo botão, ou o card se o botão sumiu ou ficou desabilitado).
  const had = waitEl.contains(document.activeElement) ? ((document.activeElement as HTMLElement).dataset.act ?? "card") : null;
  const card = el(
    "div",
    { className: "wait-card", tabIndex: -1, role: "group", ariaLabel: "Troca em andamento" },
    el(
      "div",
      { className: "wait-head" },
      flap(goingBack ? "wait" : st.forcing ? "kill" : "stop", `wait:${project}`),
      el("strong", { title: `${verb} ${st.from}` }, `${verb} `, ...labelNodes(st.from)),
      st.forcing ? null : count(),
    ),
    el("p", {}, ...detail),
    st.forcing
      ? null
      : el("p", { className: "fine", textContent: goingBack ? "Se não saírem até a contagem zerar, recebem SIGKILL e reiniciam em seguida." : "Se não saírem até a contagem zerar, recebem SIGKILL." }),
    // Voltar primeiro (Tab + Enter não pode virar SIGKILL); Forçar à direita, afastado.
    back || force ? el("div", { className: "actions" }, back, force) : null,
  );
  waitEl.replaceChildren(card);
  waitSay.textContent = `${card.querySelector("strong")!.textContent}. ${[...card.querySelectorAll("p")].map((p) => p.textContent).join(" ")}`;
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
  // Solo: a etiqueta vai para a segunda linha, como o par; na primeira ela roubava largura do nome.
  const tag = !api ? el("span", { className: "tag", textContent: "SÓ FRONT" }) : !front ? el("span", { className: "tag", textContent: "SÓ API" }) : null;
  let top = branchText(api || front);
  let pair: HTMLElement | null = null;
  if (api && front && api !== front) {
    // "feature-api/x ↔ feature-app/x": o nome uma vez em cima e embaixo só o que difere. Cortar o prefixo dos dois lados repetiria o mesmo nome.
    const same = samePairName(api, front);
    if (same) {
      const [ap, fp, name] = same;
      top = branchText(name);
      pair = el("span", { className: "pair" }, el("span", { className: "pre", textContent: ap }), icon(PAIR_ICON, "inline"), el("span", { className: "pre", textContent: fp }));
    } else pair = el("span", { className: "pair" }, icon(PAIR_ICON, "inline"), el("span", { className: "branch" }, ...branchText(front)));
  }
  const live = LIVE.includes(state);
  const ends = wouldStop(project, wt.id);
  const endsProcs = ends && procs(project, ends).length ? ` (${procs(project, ends).join(", ")})` : "";
  const endsText = ends ? `Encerra ${ends.label}${endsProcs}` : "";
  const f = flap(state, `line:${k}`);
  // A linha em serviço mostra ENCERRA enquanto o cursor (ou o foco) está em outra do mesmo projeto: o clique é destrutivo.
  if (live) f.append(el("span", { className: "ends", textContent: "ENCERRA" }));
  const b = el(
    "button",
    {
      type: "button",
      className: `line${live ? " live" : ""}`,
      tabIndex: -1,
      title: ends ? `${wt.label}\n${endsText}` : wt.label,
      ariaLabel: `${spokenLabel(wt.label)}${tag ? (api ? ", só API" : ", só front") : ""}: ${say(project, wt, state)}`,
      // Busca a worktree na hora do clique: o botão pode ter sobrevivido a um refresh do config.
      onclick: () => {
        const fresh = findWt(project, wt.id);
        if (fresh) select(project, fresh);
      },
    },
    el("span", { className: "name" }, el("span", { className: "top" }, el("span", { className: "branch" }, ...top)), pair, tag),
    // A palheta fica à direita, como a coluna de situação de um painel de partidas; nunca aberta, ela fica vazia (metades e entalhe) esperando virar.
    f,
  );
  if (ends) b.setAttribute("aria-description", `Encerra ${spokenLabel(ends.label)}${endsProcs}`);
  b.dataset.key = k;
  if (currentKey() === k) b.setAttribute("aria-current", "true");
  return b;
}

// Rodando ou no meio de uma troca: não edita (renomear ou mover a pasta embaixo de um dev server o derruba).
const BUSY: LineState[] = [...LIVE, "stop", "kill"];
const PENCIL = "M11 2.5 13.5 5 6 12.5H3.5V10ZM9.5 4 12 6.5";

/** Lápis da linha: irmão do botão de trocar (botão dentro de botão é inválido). Rodando, fica aria-disabled com o motivo. */
function editButton(project: string, wt: Worktree) {
  const busyNow = BUSY.includes(lineState(project, wt));
  const spoken = spokenLabel(wt.label);
  const b = el(
    "button",
    {
      type: "button",
      className: "icon-btn edit",
      tabIndex: -1,
      title: busyNow ? `${wt.label} está rodando: troque para outra worktree do projeto antes de editar` : `Editar ${wt.label}`,
      ariaLabel: busyNow ? `Editar ${spoken}: indisponível, está rodando; troque para outra worktree do projeto antes` : `Editar ${spoken}`,
      onclick: () => {
        const fresh = findWt(project, wt.id);
        if (fresh && !BUSY.includes(lineState(project, fresh))) openEditDialog(project, fresh);
      },
    },
    icon(PENCIL),
  );
  if (busyNow) b.setAttribute("aria-disabled", "true");
  b.dataset.key = `edit:${key(project, wt.id)}`;
  return b;
}

// Projetos recolhidos no painel; lembrados entre sessões.
const collapsed = new Set<string>(load<string[]>("collapsed", []));
const CHEVRON = "M6 4l4 4-4 4";

// Detalhes de erro abertos: o painel é recriado quando muda e eles não podem fechar sob a leitura.
const openProblems = new Set<string>();
// Último painel montado: igual, não troca os nós (um clique entre mousedown e mouseup cairia num nó descartado).
let boardHtml = "";

function renderBoard() {
  // O painel é recriado quando muda; o foco do teclado volta para o mesmo controle (linha, placa, +, erro), pela data-key.
  const focusedKey = board.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined;
  const sections = config.projects.map((p) => {
    const add = el(
      "button",
      {
        type: "button",
        className: "icon-btn",
        title: p.error ? "Corrija o erro do projeto para criar worktrees" : `Nova worktree em ${p.name} (Ctrl+Shift+N)`,
        ariaLabel: p.error ? `Nova worktree em ${p.name}: indisponível, corrija o erro do projeto` : `Nova worktree em ${p.name}`,
        // aria-disabled e não disabled: o teclado e o leitor de tela também chegam no motivo.
        onclick: () => !p.error && openAddDialog(p.name),
      },
      icon("M8 3v10M3 8h10"),
    );
    if (p.error) add.setAttribute("aria-disabled", "true");
    add.dataset.key = `add:${p.name}`;
    const problem = p.error
      ? el(
          "details",
          {
            className: "problem",
            open: openProblems.has(p.name),
            ontoggle: (e: Event) => ((e.target as HTMLDetailsElement).open ? openProblems.add(p.name) : openProblems.delete(p.name)),
          },
          el("summary", { textContent: projectErrorSummary(p.error) }),
          el("code", { textContent: p.error }),
          el("p", {}, "Ajuste o caminho em ", el("code", { textContent: CONFIG_PATH }), " e volte para a janela: o painel relê sozinho."),
          el("button", { type: "button", className: "btn small", textContent: "Abrir o config.json", onclick: () => invoke("open_config") }),
        )
      : null;
    if (problem) keyFocusables(problem, `problem:${p.name}`);
    // Recolhido, o projeto ainda mostra a worktree ativa: o que está de pé não some da tela.
    const open = !collapsed.has(p.name);
    const shownWts = open ? p.worktrees : p.worktrees.filter((wt) => wt.id === active[p.name] || key(p.name, wt.id) === currentKey());
    const hidden = p.worktrees.length - shownWts.length;
    const fold = el(
      "button",
      {
        type: "button",
        className: "fold",
        title: `${open ? "Recolher" : "Expandir"} ${p.name}${p.error && !open ? `\n${projectErrorSummary(p.error)}` : ""}`,
        onclick: () => {
          open ? collapsed.add(p.name) : collapsed.delete(p.name);
          save("collapsed", [...collapsed]);
          render();
        },
      },
      el("span", { className: "tile", textContent: p.name }),
      icon(CHEVRON, "chev"),
      hidden ? el("span", { className: "count", textContent: `+${hidden}` }) : null,
      hidden ? el("span", { className: "sr", textContent: `, ${hidden} ocultas` }) : null,
    );
    fold.setAttribute("aria-expanded", String(open));
    fold.dataset.key = `fold:${p.name}`;
    // Ordem do git, fixa: como num painel de partidas, só a palheta vira; a linha não sai do lugar sob o cursor.
    return el(
      "section",
      { className: `platform${open ? "" : " folded"}` },
      el("div", { className: "platform-head" }, el("h2", {}, fold), add),
      // Recolhido, o erro some junto com as linhas: quem recolheu já viu e não quer o vermelho o dia todo.
      open ? problem : null,
      el("ul", { className: "lines" }, ...shownWts.map((wt) => el("li", { className: "row" }, lineButton(p.name, wt), editButton(p.name, wt)))),
    );
  });
  // Config quebrado com uma worktree aberta (o centro está no terminal): o painel continua com a última leitura boa e diz por que parou de atualizar.
  if (configError && config.projects.length && current)
    sections.unshift(
      el(
        "section",
        { className: "platform" },
        el(
          "details",
          { className: "problem", open: openProblems.has(CONFIG_PATH), ontoggle: (e: Event) => ((e.target as HTMLDetailsElement).open ? openProblems.add(CONFIG_PATH) : openProblems.delete(CONFIG_PATH)) },
          el("summary", { textContent: "O config tem um problema; o painel mostra a última leitura boa." }),
          el("code", { textContent: configError }),
          el("button", { type: "button", className: "btn small", textContent: "Abrir o config.json", onclick: () => invoke("open_config") }),
        ),
      ),
    );
  if (configError && config.projects.length && current) keyFocusables(sections[0], "problem:config");
  // Sem projeto: uma plataforma em branco, com a palheta esperando virar. A ação fica no centro da janela.
  if (!config.projects.length)
    sections.push(
      el(
        "section",
        { className: "platform ghost" },
        el("div", { className: "platform-head" }, el("h2", {}, el("span", { className: "tile", textContent: "Sem projeto" }))),
        el("p", { className: "ghost-line" }, el("span", { textContent: "Nenhuma worktree ainda" }), flap("none", "ghost")),
      ),
    );
  $("#sidebar-foot").hidden = !config.projects.length;
  const html = sections.map((s) => s.outerHTML).join("");
  if (html === boardHtml) return;
  boardHtml = html;
  board.replaceChildren(...sections);
  const focused = focusedKey ? byKey(focusedKey) : undefined;
  const stop = (focused?.classList.contains("line") ? focused : null) ?? board.querySelector<HTMLElement>('.line[aria-current="true"]') ?? board.querySelector<HTMLElement>(".line");
  if (stop) stop.tabIndex = 0;
  focused?.focus();
  fitBranches();
}

/** Controle do painel pela chave. Comparação direta e não seletor: a chave tem "\u0000", que o CSS.escape troca por U+FFFD,
 *  e o seletor nunca casava (o foco não voltava à linha depois de o painel ser recriado). */
const byKey = (k: string) => [...board.querySelectorAll<HTMLElement>("[data-key]")].find((e) => e.dataset.key === k);

/** Resumo e botão de um erro ganham chave: com o foco neles, o painel recriado devolve o foco ao mesmo lugar. */
function keyFocusables(root: HTMLElement, prefix: string) {
  root.querySelector<HTMLElement>("summary")!.dataset.key = `${prefix}:summary`;
  root.querySelector<HTMLElement>("button")!.dataset.key = `${prefix}:open`;
}

/** Nome que não cabe perde o prefixo inteiro ("feat/"), em vez de virar "f." com cara de abreviação.
 *  Decide por plataforma, todas ou nenhuma: na mesma coluna, um nome sem prefixo não pode parecer não ter prefixo. */
function fitBranches() {
  const platforms = [...board.querySelectorAll(".platform")].map(p => [...p.querySelectorAll<HTMLElement>(".line .branch")]);
  for (const branches of platforms) for (const b of branches) b.classList.remove("tight");
  // Mede todas as plataformas antes de escrever: um reflow só, não um por plataforma.
  const tight = platforms.map(branches =>
    branches.some(b => {
      // O nome em si foi cortado (mesmo elemento, sem somar larguras arredondadas de partes diferentes).
      const rest = b.lastElementChild as HTMLElement;
      return rest.scrollWidth > rest.clientWidth;
    })
  );
  platforms.forEach((branches, i) => {
    for (const b of branches) b.classList.toggle("tight", tight[i]);
  });
}
new ResizeObserver(fitBranches).observe(board);

// Último conteúdo de #running: igual, não troca os nós (o foco ficaria no body, como nas abas).
let runningHtml = "";

/** Com o painel recolhido, o cabeçalho mostra o que roda nos outros projetos. */
function renderRunning() {
  const buttons = config.projects
    .filter((p) => p.name !== current?.project && active[p.name])
    .flatMap((p) => {
      const wt = p.worktrees.find((w) => w.id === active[p.name]);
      if (!wt) return [];
      const state = lineState(p.name, wt);
      const spoken = say(p.name, wt, state);
      const b = el(
        "button",
        {
          type: "button",
          className: "other",
          title: `Ir para ${p.name} / ${wt.label} (${spoken})`,
          // Já está em serviço: selecionar não troca nada, só leva o terminal até ela.
          onclick: () => {
            const fresh = findWt(p.name, wt.id);
            if (fresh) select(p.name, fresh);
          },
        },
        el("span", { className: "project", textContent: p.name }),
        el("span", { className: "sep", textContent: "/", ariaHidden: "true" }),
        el("span", { className: "label" }, ...labelNodes(wt.label)),
        el("span", { className: "sr", textContent: `: ${spoken}` }),
        flap(state, `run:${p.name}`),
      );
      b.dataset.key = p.name;
      return [b];
    });
  const html = buttons.map((b) => b.outerHTML).join("");
  if (html === runningHtml) return;
  runningHtml = html;
  // Mudou com o foco num deles: o foco volta para o mesmo projeto, se ele ainda estiver lá.
  const focused = runningEl.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined;
  runningEl.replaceChildren(...buttons);
  if (focused) buttons.find((b) => b.dataset.key === focused)?.focus();
}

/** Sem espaço no cabeçalho, o outro projeto cuja palheta não caberia sai inteiro: o estado nunca aparece cortado.
 *  Mede com todos à mostra e esconde de uma vez; o painel e a paleta continuam mostrando o que roda. */
function fitRunning() {
  if (!document.body.classList.contains("sidebar-off")) return; // com o painel aberto, #running nem aparece
  const items = [...runningEl.children] as HTMLElement[];
  for (const b of items) b.hidden = false;
  const edge = runningEl.getBoundingClientRect().right + 0.5;
  const cut = items.filter((b) => b.querySelector(".flap")!.getBoundingClientRect().right > edge);
  for (const b of cut) b.hidden = true;
}
// A faixa (não o #running, que some e reaparece ao medir) muda de largura com a janela, o zoom e o painel.
new ResizeObserver(fitRunning).observe($("header"));
// A Barlow chega depois do primeiro render e alarga os nomes sem mudar a largura da faixa.
document.fonts.addEventListener("loadingdone", fitRunning);

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

// Painel pelo teclado: setas andam pelas linhas (ou pelos lápis, na coluna deles), → e ← entre a linha e o lápis, Esc volta ao terminal.
board.addEventListener("keydown", (e) => {
  const at = document.activeElement as HTMLElement;
  const column = at.classList.contains("edit") ? ".edit" : ".line";
  const items = [...board.querySelectorAll<HTMLElement>(column)];
  const i = items.indexOf(at);
  if (i < 0) return;
  if (e.key === "ArrowDown") items[Math.min(i + 1, items.length - 1)].focus();
  else if (e.key === "ArrowUp") items[Math.max(i - 1, 0)].focus();
  else if (e.key === "Home") items[0].focus();
  else if (e.key === "End") items[items.length - 1].focus();
  else if (e.key === "ArrowRight" && column === ".line") at.parentElement!.querySelector<HTMLElement>(".edit")!.focus();
  else if (e.key === "ArrowLeft" && column === ".edit") at.parentElement!.querySelector<HTMLElement>(".line")!.focus();
  else if (e.key === "Escape") {
    closeOverlay();
    render(true);
  }
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

  // "screenReader" no config: liga ou desliga nos terminais já abertos também.
  for (const env of envs.values()) for (const pane of Object.values(env.panes)) pane.term.options.screenReaderMode = config.screenReader;

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

// Lados que estavam de pé em cada worktree na última consulta: um que some sem troca é queda.
const wasUp = new Map<string, Tab[]>();

/** Queda fora da worktree atual (outro projeto, ou uma que ficou rodando) vira recado no cabeçalho, que é região viva:
 *  só a palheta mudar não chega ao leitor de tela, e com o painel fechado nem aos olhos. A atual já é falada pelo destino. */
function announceDrops() {
  for (const [k, env] of envs) {
    const [project, id] = k.split("\u0000");
    // Parando por uma troca, ou subindo: lado que some ou ainda não veio não é queda.
    if (stopping.get(project)?.fromId === id || starting.has(k)) {
      wasUp.delete(k);
      continue;
    }
    const { up } = sides(k);
    // Parado pelo botão não é queda.
    const lost = (wasUp.get(k) ?? []).filter((t) => !up.includes(t) && !halted.has(env.panes[t]!.ptyId));
    wasUp.set(k, up);
    const wt = findWt(project, id);
    if (!lost.length || k === currentKey() || !wt) continue;
    headerNote(true, `${lost.map((t) => TAB_LABEL[t]).join(" e ")} ${lost.length > 1 ? "pararam" : "parou"}`, el("span", { className: "who" }, "· ", el("span", { className: "project", textContent: env.project }), " / ", ...labelNodes(wt.label)));
  }
}

/** Consulta quais terminais têm processo rodando; só redesenha quando algo muda. */
async function pollStatus() {
  const ids = [...envs.values()].flatMap((e) => Object.values(e.panes).map((p) => p.ptyId));
  if (!ids.length) return;
  const res = await invoke<(string | null)[]>("pty_status", { ids });
  const next = new Map(ids.flatMap((id, i) => (res[i] === null ? [] : [[id, res[i]] as const])));
  let changed = next.size !== busy.size || [...next].some(([id, name]) => busy.get(id) !== name);
  busy = next;
  announceDrops();
  // Processo saiu: o endereço dele não vale mais, e o próximo start lê o novo.
  for (const e of envs.values()) for (const p of Object.values(e.panes)) if (!busy.has(p.ptyId)) p.url = null;
  for (const [k, t] of starting) {
    // Start enviado: vira RODANDO quando todos os lados sobem, ou desiste depois de 15 s (e mostra o que subiu).
    const { down } = sides(k);
    if (!down.length || Date.now() - t > 15000) {
      starting.delete(k);
      changed = true;
      const [project, id] = k.split("\u0000");
      const wt = down.length && findWt(project, id);
      if (wt) headerNote(true, `${down.map((t) => TAB_LABEL[t]).join(" e ")} ${down.length > 1 ? "não subiram" : "não subiu"} em 15 s`, el("span", { className: "who" }, "· ", ...labelNodes(wt.label)));
    }
  }
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
  const recency = (it: Item) => {
    const r = recent.indexOf(key(it.project, it.wt.id));
    return r < 0 ? Infinity : r;
  };
  // Trecho inteiro no começo de uma palavra > trecho inteiro > subsequência; empate, a mais recente.
  const quality = (it: Item) => {
    const text = `${it.project} ${it.wt.label}`.toLowerCase();
    const at = q ? text.indexOf(q) : 0;
    return at < 0 ? 2 : at === 0 || /[\s/_.-]/.test(text[at - 1]) ? 0 : 1;
  };
  items = config.projects
    .flatMap((p) => p.worktrees.map((wt) => ({ project: p.name, wt })))
    .filter((it) => fuzzy(q, `${it.project}${it.wt.label}`.toLowerCase()))
    .sort((a, b) => quality(a) - quality(b) || recency(a) - recency(b));
  sel = Math.min(sel, Math.max(items.length - 1, 0));
  paletteList.replaceChildren(
    ...(items.length
      ? items.map((it, i) => {
          const state = lineState(it.project, it.wt);
          const li = el(
            "li",
            { id: `opt-${i}`, onclick: () => choose(it) },
            el("span", { className: "label" }, ...labelNodes(it.wt.label), currentKey() === key(it.project, it.wt.id) ? el("span", { className: "tag", textContent: "ATUAL" }) : null),
            el("span", { className: "project", textContent: it.project }),
            // A palheta é aria-hidden: o leitor de tela ouve o estado por aqui, como no painel.
            el("span", { className: "sr", textContent: `: ${say(it.project, it.wt, state)}` }),
            flap(state, `pal:${key(it.project, it.wt.id)}`),
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
  paletteNote.replaceChildren(...(ends ? endsNote(ends, it.project) : []));
  if (items.length) paletteInput.setAttribute("aria-activedescendant", `opt-${sel}`);
  else paletteInput.removeAttribute("aria-activedescendant");
  paletteList.children[sel]?.scrollIntoView({ block: "nearest" });
}

/** "[ENCERRA] Encerra feat/x (npm run dev) em INTERNO": a mesma prévia do painel, e diz o que mata.
 *  Ainda não está parando, então a palheta não diz PARANDO. */
function endsNote(wt: Worktree, project: string, inPalette = true): (Node | string)[] {
  const names = procs(project, wt);
  // O texto num span só: solto no flex, cada pedaço viraria um item e os espaços sumiriam.
  return [
    flap("stop", "ends", "ENCERRA"),
    el(
      "span",
      { className: "ends-text" },
      "Encerra ",
      el("strong", {}, ...labelNodes(wt.label)),
      ...(names.length ? [" ", el("span", { className: "procs", textContent: `(${names.join(", ")})` })] : []),
      ...(inPalette ? [" em ", el("span", { className: "project", textContent: project })] : [", que está rodando."]),
    ),
  ];
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
/** Linhas que o PageUp/PageDown pulam na paleta. */
const PAGE = 8;
paletteInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") sel = Math.min(sel + 1, items.length - 1);
  else if (e.key === "ArrowUp") sel = Math.max(sel - 1, 0);
  else if (e.key === "PageDown") sel = Math.min(sel + PAGE, items.length - 1);
  else if (e.key === "PageUp") sel = Math.max(sel - PAGE, 0);
  else if (e.key === "Enter" || e.key === "Escape") {
    e.preventDefault();
    return e.key === "Enter" ? choose(items[sel]) : closePalette();
  } else return;
  e.preventDefault();
  renderPalette();
});
// mousedown na lista não tira o foco do input, então o blur só vem de clique fora.
paletteList.addEventListener("mousedown", (e) => e.preventDefault());
// O mouse também seleciona: o rodapé diz o que o clique vai encerrar, não só o Enter.
// mousemove (não mouseover): a lista rolando pelo teclado sob um cursor parado não rouba a seleção.
paletteList.addEventListener("mousemove", (e) => {
  const li = (e.target as Element).closest<HTMLElement>("li[id^='opt-']");
  const i = li ? Number(li.id.slice(4)) : sel;
  if (i === sel) return;
  sel = i;
  renderPalette();
});
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

/** Botão ocupado: aria-disabled (o foco continua nele; disabled jogaria o foco no body, atrás do diálogo) e o texto do que está fazendo. */
function setBusy(button: HTMLButtonElement, label: string) {
  button.setAttribute("aria-disabled", "true");
  button.textContent = label;
}
function clearBusy(button: HTMLButtonElement, label: string) {
  button.removeAttribute("aria-disabled");
  button.textContent = label;
}
const isBusy = (button: HTMLElement | null) => button?.getAttribute("aria-disabled") === "true";

/** Campo culpado: anunciado como inválido e ligado à mensagem que explica. */
function markInvalid(input: HTMLElement, msg: HTMLElement) {
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", msg.id);
  input.focus();
}
function clearInvalid(form: HTMLFormElement) {
  for (const f of form.querySelectorAll("[aria-invalid]")) {
    f.removeAttribute("aria-invalid");
    f.removeAttribute("aria-describedby");
  }
  for (const f of form.querySelectorAll("[aria-errormessage]")) document.getElementById(f.getAttribute("aria-errormessage")!)!.textContent = "";
}

const REQUIRED: Record<string, string> = { branch: "Informe a branch.", name: "Dê um nome ao projeto." };
/** Campo obrigatório vazio: mensagem do app ao lado do campo, no lugar da bolha nativa do WebKit (os forms têm novalidate). */
function missingField(form: HTMLFormElement, fallback: HTMLElement) {
  const bad = form.querySelector<HTMLInputElement>("input:invalid");
  if (!bad) return false;
  const msg = document.getElementById(bad.getAttribute("aria-errormessage") ?? "") ?? bad.closest("fieldset")?.querySelector<HTMLElement>(".side-error") ?? fallback;
  msg.textContent = REQUIRED[bad.name] ?? (bad.name.endsWith("-dir") ? "Informe o diretório das worktrees." : "Informe o repositório.");
  const more = bad.closest("details");
  if (more) more.open = true;
  markInvalid(bad, msg);
  return true;
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
const addSubmit = addForm.querySelector<HTMLButtonElement>("button.primary")!;
let defaultsReq = 0;

/** Depois de um erro parcial, o botão diz o lado que ainda falta criar. */
function addSubmitLabel() {
  const created = TABS.some((t) => sideMsg(t).classList.contains("ok"));
  const left = TABS.filter((t) => sideCheck(t).checked);
  return created && left.length === 1 ? (left[0] === "api" ? "Criar na API" : "Criar no Front") : "Criar worktree";
}

function openAddDialog(project?: string) {
  const usable = config.projects.filter((p) => !p.error);
  if (!usable.length) return;
  projectSel.replaceChildren(...config.projects.map((p) => el("option", { value: p.name, textContent: p.name, disabled: !!p.error })));
  const wanted = [project, current?.project].find((n) => usable.some((p) => p.name === n));
  projectSel.value = wanted ?? usable[0].name;
  branchInput.value = "";
  openNow.checked = true;
  addError.textContent = "";
  clearInvalid(addForm);
  loadDefaults();
  addDialog.showModal();
  branchInput.focus();
}

/** Pasta padrão e branches de cada repo do projeto escolhido. */
async function loadDefaults() {
  const req = ++defaultsReq;
  branchInput.readOnly = false;
  for (const t of TABS) {
    sideCheck(t).checked = true;
    sideCheck(t).disabled = false;
    sideDir(t).value = "";
    sideBase(t).replaceChildren(el("option", { value: "", textContent: "Carregando…" }));
    sideMsg(t).textContent = "";
    sideMsg(t).classList.remove("ok");
    sideBox(t).querySelector<HTMLDetailsElement>("details")!.open = false;
  }
  addSubmit.textContent = addSubmitLabel();
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
  openHint.replaceChildren(...(ends ? endsNote(ends, projectSel.value, false) : []));
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
  if (isBusy(e.submitter as HTMLButtonElement)) return; // já criando: Enter de novo não envia duas vezes
  const project = projectSel.value;
  const branch = branchInput.value.trim();
  const side = (t: Tab) => (sideCheck(t).checked ? { dir: sideDir(t).value, base: sideBase(t).value } : null);
  const api = side("api");
  const front = side("front");
  addError.textContent = "";
  clearInvalid(addForm);
  for (const t of TABS) if (!sideMsg(t).classList.contains("ok")) sideMsg(t).textContent = "";
  if (!api && !front) {
    addError.textContent = "Marque API, Front ou os dois.";
    return;
  }
  if (missingField(addForm, addError)) return;
  const submit = e.submitter as HTMLButtonElement;
  setBusy(submit, "Criando…");
  try {
    await invoke("add_worktree", { project, branch, api, front });
    addDialog.close();
  } catch (err) {
    const fe = asFormError(err);
    // O que já foi criado sai do próximo envio: desmarcado e travado, com aviso.
    // Um lado já existe com esta branch: trocar o nome agora criaria o outro lado com outra, e o primeiro ficaria solo.
    if (fe.created.length) branchInput.readOnly = true;
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
      markInvalid(field === "branch" ? branchInput : field === "base" ? sideBase(fe.side) : sideDir(fe.side), sideMsg(fe.side));
    } else {
      addError.textContent = fe.message;
      markInvalid(branchInput, addError);
    }
  } finally {
    clearBusy(submit, addSubmitLabel());
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

// ---------- editar worktree ----------

type SideInfo = { main: boolean; upstream: string | null; dir: string | null };
type PairChange = { kind: "keep" } | { kind: "unpair" } | { kind: "with"; branch: string } | { kind: "create"; dir: string; base: string };

const editDialog = $<HTMLDialogElement>("#edit-dialog");
const editForm = editDialog.querySelector("form")!;
const editError = editDialog.querySelector<HTMLElement>(".error")!;
const editField = <T extends HTMLElement>(name: string) => editForm.elements.namedItem(name) as unknown as T;
const sharedBranch = editField<HTMLInputElement>("branch");
const sharedBranchMsg = $("#edit-branch-error");
const eBox = (t: Tab) => editForm.querySelector<HTMLFieldSetElement>(`fieldset[data-side="${t}"]`)!;
const ePart = <T extends HTMLElement>(t: Tab, sel: string) => eBox(t).querySelector<T>(sel)!;
const eMsg = (t: Tab) => ePart<HTMLElement>(t, ".side-error");
const otherTab = (t: Tab): Tab => (t === "api" ? "front" : "api");
/** "na API", "no Front". */
const inSide = (t: Tab) => (t === "api" ? "na API" : "no Front");

/** O que o diálogo está editando; `info` chega depois de abrir (o git pode demorar). */
let editing: { project: string; wt: Worktree; branches: Record<Tab, string>; divergent: boolean; info: Partial<Record<Tab, SideInfo>> } | null = null;
let editReq = 0;

const newBranch = (t: Tab) => (editing!.divergent ? editField<HTMLInputElement>(`${t}-branch`).value : sharedBranch.value).trim();

function openEditDialog(project: string, wt: Worktree) {
  const [api, front] = wt.id.split("|");
  const branches: Record<Tab, string> = { api, front };
  const divergent = !!api && !!front && api !== front;
  editing = { project, wt, branches, divergent, info: {} };
  const req = ++editReq;
  editForm.querySelector(".where")!.replaceChildren(el("span", { className: "project", textContent: project }), " / ", ...labelNodes(wt.label));
  editForm.querySelector<HTMLElement>(".shared-branch")!.hidden = divergent;
  sharedBranch.value = divergent ? "" : api || front;
  sharedBranchMsg.textContent = "";
  editError.textContent = "";
  clearInvalid(editForm);
  const proj = config.projects.find((p) => p.name === project)!;
  for (const t of TABS) {
    const side = wt[t];
    ePart<HTMLElement>(t, ".has").hidden = !side;
    ePart<HTMLElement>(t, ".own-branch").hidden = !divergent;
    editField<HTMLInputElement>(`${t}-branch`).value = branches[t];
    eMsg(t).textContent = "";
    ePart<HTMLElement>(t, ".upstream").hidden = true;
    ePart<HTMLElement>(t, ".main-hint").hidden = true;
    ePart<HTMLDetailsElement>(t, ".move-dir").open = false;
    if (side) {
      // Campo vazio herda o start do projeto: o seletor e o prefixo mostram o dele, o placeholder o script.
      const project = splitStart(side.projectStart ?? "");
      const own = splitStart(side.startCommand !== side.projectStart ? (side.startCommand ?? "") : "");
      const cmd = editField<HTMLInputElement>(`${t}-cmd`);
      cmd.placeholder = side.projectStart ? `${project.script} (padrão do projeto)` : "Sem comando: abre só o shell";
      cmd.value = own.script;
      setPm(ePm(t), own.script ? own.pm : project.pm);
      // Até o git responder, a pasta fica onde está.
      editField<HTMLInputElement>(`${t}-move`).checked = false;
      editField<HTMLInputElement>(`${t}-move`).disabled = true;
      editField<HTMLInputElement>(`${t}-dir`).value = side.path.slice(0, side.path.lastIndexOf("/"));
    }
    // Seletor de par: no lado que falta (solo) ou no Front de um par manual. Par de nome igual não desfaz.
    const pairSel = editField<HTMLSelectElement>(`${t}-pair`);
    const opts: HTMLOptionElement[] = [];
    if (!side) {
      const mine = otherTab(t);
      opts.push(el("option", { value: "keep", textContent: `Sem ${TAB_LABEL[t]}` }));
      opts.push(el("option", { value: "create", textContent: `Criar ${branches[mine]} ${inSide(t)}` }));
      for (const solo of proj.worktrees.filter((w) => !w[mine] && w[t])) {
        const running = BUSY.includes(lineState(project, solo));
        opts.push(el("option", { value: `with:${solo.label}`, textContent: `Parear com ${solo.label}${running ? " (rodando)" : ""}`, disabled: running }));
      }
    } else if (t === "front" && divergent) {
      opts.push(el("option", { value: "keep", textContent: "Pareada com a API" }), el("option", { value: "unpair", textContent: "Desfazer o par" }));
    }
    pairSel.replaceChildren(...opts);
    pairSel.value = "keep";
    ePart<HTMLElement>(t, ".pair-row").hidden = !opts.length;
    ePart<HTMLElement>(t, ".create").hidden = true;
  }
  syncEdit();
  editDialog.showModal();
  (divergent ? editField<HTMLInputElement>(`${api ? "api" : "front"}-branch`) : sharedBranch).focus();
  loadEditInfo(req);
}

/** Pasta principal, upstream e convenção de cada lado: decidem a caixa "Mover a pasta junto" e os avisos. */
async function loadEditInfo(req: number) {
  const ed = editing!;
  await Promise.all(
    TABS.filter((t) => ed.wt[t]).map(async (t) => {
      let info: SideInfo;
      try {
        info = await invoke<SideInfo>("worktree_info", { path: ed.wt[t]!.path, branch: ed.branches[t] });
      } catch {
        info = { main: true, upstream: null, dir: null }; // sem resposta do git: não oferece mover
      }
      if (req !== editReq) return;
      ed.info[t] = info;
      const move = editField<HTMLInputElement>(`${t}-move`);
      move.disabled = info.main;
      move.checked = !info.main && !!info.dir;
      ePart<HTMLElement>(t, ".move").hidden = info.main;
      ePart<HTMLElement>(t, ".main-hint").hidden = !info.main;
      if (info.dir) editField<HTMLInputElement>(`${t}-dir`).value = info.dir;
    }),
  );
  if (req === editReq) syncEdit();
}

/** Valores do lado a criar (pasta padrão e branches), só quando "Criar" é escolhido. */
async function loadCreateDefaults(t: Tab) {
  const req = editReq;
  const base = editField<HTMLSelectElement>(`${t}-base`);
  base.replaceChildren(el("option", { value: "", textContent: "Carregando…" }));
  try {
    const d = (await invoke<Defaults>("worktree_defaults", { project: editing!.project }))[t];
    if (req !== editReq) return;
    if ("Err" in d) {
      eMsg(t).textContent = d.Err;
      base.replaceChildren();
      return;
    }
    editField<HTMLInputElement>(`${t}-new-dir`).value = d.Ok.dir;
    const group = (label: string, list: string[]) => el("optgroup", { label }, ...list.map((b) => el("option", { value: b, textContent: b })));
    base.replaceChildren(group("Locais", d.Ok.local), ...(d.Ok.remote.length ? [group("Remotas", d.Ok.remote)] : []));
    base.value = d.Ok.defaultBase;
  } catch (err) {
    if (req === editReq) eMsg(t).textContent = String(err);
  }
  syncEdit();
}

/** Prévias dos caminhos e o aviso do upstream, a cada tecla. */
function syncEdit() {
  if (!editing) return;
  const ed = editing;
  for (const t of TABS) {
    const side = ed.wt[t];
    if (side) {
      const nb = newBranch(t) || "<branch>";
      const move = editField<HTMLInputElement>(`${t}-move`);
      const dir = editField<HTMLInputElement>(`${t}-dir`).value.trim().replace(/\/+$/, "");
      ePart<HTMLElement>(t, ".move-dir").hidden = !move.checked;
      ePart<HTMLElement>(t, ".has > .preview").replaceChildren(move.checked ? `${dir}/${nb}` : side.path);
      const up = ed.info[t]?.upstream;
      const renamed = newBranch(t) !== ed.branches[t];
      ePart<HTMLElement>(t, ".upstream").hidden = !(up && renamed);
      if (up && renamed) ePart<HTMLElement>(t, ".upstream").textContent = `A remota ${up} continua com o nome antigo; o próximo push cria ${nb}.`;
    }
    // "Criar <branch> no Front" acompanha o nome que está sendo digitado.
    const createOpt = editField<HTMLSelectElement>(`${t}-pair`).querySelector<HTMLOptionElement>('option[value="create"]');
    if (createOpt) createOpt.textContent = `Criar ${newBranch(otherTab(t)) || "<branch>"} ${inSide(t)}`;
    const creating = editField<HTMLSelectElement>(`${t}-pair`).value === "create";
    ePart<HTMLElement>(t, ".create").hidden = !creating;
    if (creating) {
      const dir = editField<HTMLInputElement>(`${t}-new-dir`).value.trim().replace(/\/+$/, "");
      const base = editField<HTMLSelectElement>(`${t}-base`).value;
      const nb = newBranch(otherTab(t)) || "<branch>";
      ePart<HTMLElement>(t, ".create > .preview").replaceChildren(...(dir ? [`${dir}/${nb}`, ...(base ? [icon(FROM_ICON, "inline"), base] : [])] : ["Carregando…"]));
    }
  }
}

/** Seletor e prefixo fixo do comando de start (o prefixo fica fora do input: não dá para apagá-lo).
 *  `data-pm` guarda o package manager atual, para a próxima troca saber de onde vem. */
function setPm(select: HTMLSelectElement, pm: Pm | null) {
  select.value = pm ?? "";
  select.dataset.pm = pm ?? "";
  const prefix = select.parentElement!.querySelector<HTMLElement>(".prefix")!;
  prefix.hidden = !pm;
  prefix.textContent = pm ? PREFIX[pm] : "";
}

const ePm = (t: Tab) => editField<HTMLSelectElement>(`${t}-pm`);

for (const t of TABS) {
  const cmd = editField<HTMLInputElement>(`${t}-cmd`);
  // Campo esvaziado herda o start do projeto: ao sair dele, o seletor volta a mostrar o do projeto, que é o que roda.
  cmd.addEventListener("change", () => {
    const side = editing?.wt[t];
    if (side && !cmd.value.trim()) setPm(ePm(t), splitStart(side.projectStart ?? "").pm);
  });
  // Escolher com o campo vazio parte do start do projeto: "npm run dev:api" → pnpm + "dev:api", só desta branch.
  ePm(t).addEventListener("change", () => {
    const side = editing?.wt[t];
    if (!side) return;
    if (!cmd.value.trim()) {
      const project = splitStart(side.projectStart ?? "");
      cmd.value = project.script;
      ePm(t).dataset.pm = project.pm ?? "";
    }
    const to = asPm(ePm(t).value);
    cmd.value = switchPm(asPm(ePm(t).dataset.pm), to, cmd.value);
    setPm(ePm(t), to);
  });
}

editForm.addEventListener("input", syncEdit);
editForm.addEventListener("change", (e) => {
  const sel = e.target as HTMLSelectElement;
  if (sel.name?.endsWith("-pair") && sel.value === "create") loadCreateDefaults(sel.name.split("-")[0] as Tab);
  syncEdit();
});
for (const t of TABS) {
  for (const [name, pick] of [[`${t}-dir`, ".move-dir .pick"], [`${t}-new-dir`, ".create .pick"]]) {
    ePart<HTMLButtonElement>(t, pick).addEventListener("click", async () => {
      const input = editField<HTMLInputElement>(name);
      const dir = await pickFolder({ directory: true, defaultPath: input.value || undefined, title: `Diretório (${TAB_LABEL[t]})` });
      if (typeof dir === "string") {
        input.value = dir;
        syncEdit();
      }
    });
  }
}

editForm.addEventListener("submit", async (e) => {
  if ((e.submitter as HTMLButtonElement | null)?.value !== "ok" || !editing) return;
  e.preventDefault();
  const submit = e.submitter as HTMLButtonElement;
  if (isBusy(submit)) return;
  const ed = editing;
  editError.textContent = "";
  sharedBranchMsg.textContent = "";
  clearInvalid(editForm);
  for (const t of TABS) eMsg(t).textContent = "";
  const branchInput = (t: Tab) => (ed.divergent ? editField<HTMLInputElement>(`${t}-branch`) : sharedBranch);
  const branchMsg = (t: Tab) => (ed.divergent ? eMsg(t) : sharedBranchMsg);
  // Branch vazia: a mensagem ao lado do campo, como nos outros formulários.
  for (const t of TABS) {
    if (ed.wt[t] && !newBranch(t)) {
      branchMsg(t).textContent = "Informe a branch.";
      return markInvalid(branchInput(t), branchMsg(t));
    }
  }
  const sideReq = (t: Tab) => {
    const side = ed.wt[t];
    if (!side) return null;
    const move = editField<HTMLInputElement>(`${t}-move`);
    return {
      path: side.path,
      branch: ed.branches[t],
      newBranch: newBranch(t),
      moveTo: move.checked && !move.disabled ? editField<HTMLInputElement>(`${t}-dir`).value : null,
      command: joinStart(asPm(ePm(t).value), editField<HTMLInputElement>(`${t}-cmd`).value),
    };
  };
  const pairT = TABS.find((t) => !ed.wt[t]) ?? "front";
  const choice = editField<HTMLSelectElement>(`${pairT}-pair`).value || "keep";
  const pair: PairChange = choice.startsWith("with:")
    ? { kind: "with", branch: choice.slice(5) }
    : choice === "create"
      ? { kind: "create", dir: editField<HTMLInputElement>(`${pairT}-new-dir`).value, base: editField<HTMLSelectElement>(`${pairT}-base`).value }
      : { kind: choice as "keep" | "unpair" };
  setBusy(submit, "Salvando…");
  try {
    await invoke("edit_worktree", { req: { project: ed.project, api: sideReq("api"), front: sideReq("front"), pair } });
  } catch (err) {
    const fe = asFormError(err);
    if (fe.side) {
      // O erro nomeia a branch: aponta o campo dela; senão, o da pasta (ou o do lado a criar).
      const aboutBranch = /branch|HEAD/i.test(fe.message);
      const msg = aboutBranch ? branchMsg(fe.side) : eMsg(fe.side);
      msg.textContent = fe.message;
      const target = aboutBranch
        ? branchInput(fe.side)
        : ed.wt[fe.side]
          ? editField<HTMLInputElement>(`${fe.side}-dir`)
          : editField<HTMLInputElement>(`${fe.side}-new-dir`);
      target.closest("details")?.setAttribute("open", "");
      markInvalid(target, msg);
    } else {
      editError.textContent = fe.message;
      markInvalid(sharedBranch.hidden ? editField<HTMLInputElement>("api-branch") : sharedBranch, editError);
    }
    return;
  } finally {
    clearBusy(submit, "Salvar");
  }
  await afterEdit(ed, pair);
});

/** Depois de salvar: fecha os terminais dela (e da solo que entrou no par), leva o "ativa" e as recentes para o id novo,
 *  e reabre só o shell se ela era a atual. Não sobe: editar não é trocar. */
async function afterEdit(ed: NonNullable<typeof editing>, pair: PairChange) {
  const { project, wt } = ed;
  const name = (t: Tab) => (ed.wt[t] ? newBranch(t) : pair.kind === "with" ? pair.branch : pair.kind === "create" ? newBranch(otherTab(t)) : "");
  const newId = pair.kind === "unpair" ? `${newBranch("api")}|` : `${name("api")}|${name("front")}`;
  const oldIds = [wt.id];
  if (pair.kind === "with") {
    const solo = config.projects.find((p) => p.name === project)?.worktrees.find((w) => w.label === pair.branch && !w[ed.wt.api ? "api" : "front"]);
    if (solo) oldIds.push(solo.id);
  }
  const oldKeys = oldIds.map((id) => key(project, id));
  const wasCurrent = oldKeys.includes(currentKey() ?? "");
  for (const k of oldKeys) {
    const env = envs.get(k);
    if (env) disposeEnv(k, env);
  }
  const newKey = key(project, newId);
  if (oldIds.includes(active[project])) active[project] = newId;
  saveActive();
  recent = [...new Set(recent.map((r) => (oldKeys.includes(r) ? newKey : r)))];
  save("recent", recent);
  if (wasCurrent) current = null;
  editing = null;
  editDialog.close();
  await refresh();
  const newWt = findWt(project, newId);
  if (wasCurrent && newWt) {
    current = { project, wt: newWt };
    ensureEnv(project, newWt);
  }
  headerNote(false, newWt && newWt.label !== wt.label ? `Editada: ${wt.label} → ${newWt.label}` : `Editada: ${wt.label}`);
  render();
  byKey(`edit:${newKey}`)?.focus();
}

editDialog.addEventListener("close", () => {
  if (!editing) return; // salvou: afterEdit cuida do foco
  const k = key(editing.project, editing.wt.id);
  editing = null;
  const pencil = byKey(`edit:${k}`);
  pencil ? pencil.focus() : render(true);
});

// ---------- novo projeto ----------

const projectDialog = $<HTMLDialogElement>("#project-dialog");
const projectForm = projectDialog.querySelector("form")!;
const projectError = projectDialog.querySelector<HTMLElement>(".error")!;
const pfield = (name: string) => projectForm.elements.namedItem(name) as HTMLInputElement;
const pSideMsg = (t: Tab) => projectForm.querySelector<HTMLElement>(`fieldset[data-side="${t}"] .side-error`)!;

const pFound = (t: Tab) => projectForm.querySelector<HTMLElement>(`fieldset[data-side="${t}"] .found`)!;
const pPm = (t: Tab) => projectForm.elements.namedItem(`${t}-pm`) as HTMLSelectElement;

/** Package manager do lado: prefixo do start e o exemplo do setup. */
function setProjectPm(t: Tab, pm: Pm | null) {
  setPm(pPm(t), pm);
  pfield(`${t}-setup`).placeholder = `ex.: ${pm ?? "npm"} install`;
}

function openProjectDialog() {
  projectForm.reset();
  projectError.textContent = "";
  clearInvalid(projectForm);
  for (const t of TABS) {
    readReq[t]++; // leitura de uma abertura anterior não pinta este formulário
    pSideMsg(t).textContent = "";
    pFound(t).hidden = true;
    setProjectPm(t, "npm");
  }
  projectDialog.showModal();
  pfield("name").focus();
  loadGithubRepos();
}

// ---------- clonar do GitHub ----------

type GithubRepos = { login: string; repos: string[] };
const ghHint = $("#gh-hint");
const ghList = $("#gh-repos");
// Lista da sessão: o gh leva alguns segundos para paginar. Falha não fica guardada, para o próximo abrir tentar de novo.
let ghRepos: Promise<GithubRepos> | null = null;

/** Repositórios da conta logada no gh viram as sugestões do campo "Ou clone do GitHub"; sem gh, uma linha diz o próximo passo. */
async function loadGithubRepos() {
  ghRepos ??= invoke<GithubRepos>("github_repos");
  try {
    const { login, repos } = await ghRepos;
    ghList.replaceChildren(...repos.map(full => el("option", { value: full })));
    for (const row of projectForm.querySelectorAll<HTMLElement>(".gh-row")) {
      row.hidden = false;
      row.querySelector(".gh-label")!.textContent = `Ou clone do GitHub de ${login}`;
    }
    ghHint.hidden = true;
  } catch (err) {
    ghRepos = null;
    ghHint.textContent = `Clonar do GitHub não está disponível: ${String(err)}`;
    ghHint.hidden = false;
  }
}

/** "gtech-api" → "gtech": sugestão de nome do projeto quando o campo ainda está vazio. */
const projectNameFrom = (repo: string) => repo.replace(/[-_.](api|app|web|front|frontend|back|backend|server)$/i, "");

/** Clona o repositório escolhido (bare + worktree da branch padrão) numa pasta que o usuário escolhe e aponta o lado para ele. */
async function cloneFromGithub(t: Tab, button: HTMLButtonElement) {
  const input = pfield(`${t}-gh`);
  const msg = pSideMsg(t);
  const full = input.value.trim();
  msg.replaceChildren();
  input.removeAttribute("aria-invalid");
  const { repos } = await (ghRepos ?? Promise.resolve({ login: "", repos: [] as string[] }));
  if (!repos.includes(full)) {
    msg.textContent = "Escolha um repositório da lista, no formato dono/repositório.";
    markInvalid(input, msg);
    return;
  }
  const name = full.split("/")[1];
  const parent = await pickFolder({ directory: true, defaultPath: load<string | undefined>("cloneParent", undefined), title: `Clonar ${name} em…` });
  if (typeof parent !== "string") return;
  save("cloneParent", parent);
  const req = ++readReq[t];
  // readOnly e aria-disabled, não disabled: o foco fica onde estava (no campo, se foi o Enter; no botão, se foi o clique).
  setBusy(button, "Clonando…");
  input.readOnly = true;
  try {
    const path = await invoke<string>("clone_github_repo", { fullName: full, parent });
    if (req !== readReq[t]) return; // o diálogo foi fechado ou reaberto enquanto clonava
    const repo = pfield(`${t}-repo`);
    repo.value = path;
    input.value = "";
    if (!pfield("name").value.trim()) pfield("name").value = projectNameFrom(name);
    readWorktrees(t);
    repo.focus();
  } catch (err) {
    if (req !== readReq[t]) return;
    msg.textContent = String(err);
    markInvalid(input, msg);
  } finally {
    clearBusy(button, "Clonar…");
    input.readOnly = false;
  }
}

/** Erro do git sobre a pasta do repositório: resumo legível; o texto cru fica embaixo. */
function repoErrorSummary(message: string) {
  const raw = message.toLowerCase();
  if (raw.includes("no such file") || raw.includes("cannot change to")) return "Essa pasta não existe.";
  if (raw.includes("not a git repository") || raw.includes("não é um repositório git")) return "Essa pasta não é um repositório git.";
  return message;
}

/** Erro no lado: resumo, texto cru quando difere, e o campo marcado como inválido. `focus` só quando o usuário enviou. */
function showRepoError(t: Tab, message: string, focus: boolean) {
  const text = repoErrorSummary(message);
  const msg = pSideMsg(t);
  msg.replaceChildren(text, ...(text !== message ? [el("code", { className: "raw", textContent: message })] : []));
  const input = pfield(`${t}-repo`);
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", msg.id);
  if (focus) input.focus();
}

const readReq: Record<Tab, number> = { api: 0, front: 0 };

/** Ao escolher ou colar a pasta: as worktrees que o painel vai mostrar, antes de salvar o projeto. */
async function readWorktrees(t: Tab) {
  const input = pfield(`${t}-repo`);
  const found = pFound(t);
  const req = ++readReq[t];
  pSideMsg(t).replaceChildren();
  input.removeAttribute("aria-invalid");
  input.removeAttribute("aria-describedby");
  found.hidden = true;
  if (!input.value.trim()) return;
  try {
    const wts = await invoke<{ branch: string; path: string }[]>("list_worktrees", { repo: input.value });
    if (req !== readReq[t]) return; // a pasta mudou enquanto o git lia: vale a leitura mais nova
    found.replaceChildren(
      el("p", {
        className: "count",
        textContent: !wts.length
          ? "Nenhuma worktree ainda. Depois de salvar, crie a primeira pelo + do projeto."
          : wts.length === 1
            ? "1 worktree vai aparecer no painel:"
            : `${wts.length} worktrees vão aparecer no painel:`,
      }),
      ...(wts.length ? [el("ul", {}, ...wts.map((w) => el("li", { title: w.path }, el("span", { className: "branch", textContent: w.branch }), w.path.endsWith(`/${w.branch}`) ? null : el("code", { textContent: w.path }))))] : []),
    );
    found.hidden = false;
    const pm = await invoke<string | null>("lockfile_pm", { paths: wts.map(w => w.path) });
    // Start ainda no padrão ("dev" num package manager) e sem setup: segue o lockfile do repositório. Texto digitado fica.
    const untouched = isPm(pPm(t).value) && pfield(`${t}-start`).value === "dev" && !pfield(`${t}-setup`).value;
    if (req !== readReq[t] || !isPm(pm) || !untouched) return;
    setProjectPm(t, pm);
  } catch (err) {
    if (req === readReq[t]) showRepoError(t, String(err), false);
  }
}

for (const t of TABS) {
  const box = projectForm.querySelector<HTMLFieldSetElement>(`fieldset[data-side="${t}"]`)!;
  box.querySelector<HTMLButtonElement>(".pick")!.addEventListener("click", async () => {
    const dir = await pickFolder({ directory: true, defaultPath: pfield(`${t}-repo`).value || undefined, title: `Repositório (${TAB_LABEL[t]})` });
    if (typeof dir !== "string") return;
    pfield(`${t}-repo`).value = dir;
    readWorktrees(t);
  });
  // change: depois de colar ou digitar e sair do campo.
  pfield(`${t}-repo`).addEventListener("change", () => readWorktrees(t));
  // Um package manager por lado: troca o prefixo do start e reescreve o setup junto.
  pPm(t).addEventListener("change", () => {
    const to = asPm(pPm(t).value);
    const start = pfield(`${t}-start`);
    const setup = pfield(`${t}-setup`);
    start.value = switchPm(asPm(pPm(t).dataset.pm), to, start.value);
    if (to) setup.value = rewrite(setup.value, to);
    setProjectPm(t, to);
  });
  const clone = box.querySelector<HTMLButtonElement>(".clone")!;
  clone.addEventListener("click", () => !isBusy(clone) && cloneFromGithub(t, clone));
  // Enter no campo do GitHub clona; não envia o formulário, que ainda não tem a pasta do repositório.
  pfield(`${t}-gh`).addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!isBusy(clone)) cloneFromGithub(t, clone);
  });
}

projectForm.addEventListener("submit", async (e) => {
  if ((e.submitter as HTMLButtonElement | null)?.value !== "ok") return;
  e.preventDefault();
  if (isBusy(e.submitter as HTMLButtonElement)) return;
  const side = (t: Tab) => ({ repo: pfield(`${t}-repo`).value, startCommand: joinStart(asPm(pPm(t).value), pfield(`${t}-start`).value), setupCommand: pfield(`${t}-setup`).value });
  projectError.textContent = "";
  clearInvalid(projectForm);
  for (const t of TABS) pSideMsg(t).textContent = "";
  if (missingField(projectForm, projectError)) return;
  const submit = e.submitter as HTMLButtonElement;
  setBusy(submit, "Criando…");
  try {
    await invoke("add_project", { project: { name: pfield("name").value, api: side("api"), front: side("front") } });
    projectDialog.close();
    await refresh();
  } catch (err) {
    const fe = asFormError(err);
    if (fe.side) {
      pFound(fe.side).hidden = true;
      showRepoError(fe.side, fe.message, true);
    } else {
      projectError.textContent = fe.message;
      markInvalid(pfield("name"), projectError);
    }
  } finally {
    clearBusy(submit, "Criar projeto");
  }
});

projectDialog.addEventListener("close", () => render(true));
$("#new-project").addEventListener("click", () => openProjectDialog());

// ---------- reler worktrees ----------

const reloadBtn = $<HTMLButtonElement>("#reload");
let reloading = false;

const worktreeNames = () => new Map(config.projects.flatMap((p) => p.worktrees.map((wt) => [key(p.name, wt.id), `${p.name} / ${wt.label}`] as const)));

/** Relê o `git worktree list` na hora (worktree criada pelo terminal, por exemplo) e diz no cabeçalho o que mudou. */
async function reload() {
  if (reloading) return;
  reloading = true;
  // aria-disabled e não disabled: o botão focado continua com o foco do teclado.
  reloadBtn.setAttribute("aria-disabled", "true");
  reloadBtn.setAttribute("aria-busy", "true");
  const before = worktreeNames();
  try {
    await refresh();
  } finally {
    reloading = false;
    reloadBtn.removeAttribute("aria-disabled");
    reloadBtn.removeAttribute("aria-busy");
  }
  if (configError) return headerNote(false, "Não consegui reler: o config tem um problema.");
  const after = worktreeNames();
  const added = [...after].filter(([k]) => !before.has(k)).map(([, name]) => name);
  const removed = [...before].filter(([k]) => !after.has(k)).map(([, name]) => name);
  if (!added.length && !removed.length) return headerNote(false, "Worktrees relidas: nada mudou.");
  const parts = [
    added.length === 1 ? `nova: ${added[0]}` : added.length ? `${added.length} novas` : "",
    removed.length === 1 ? `saiu: ${removed[0]}` : removed.length ? `${removed.length} saíram` : "",
  ].filter(Boolean);
  headerNote(false, `Worktrees relidas: ${parts.join(" · ")}.`);
}

reloadBtn.addEventListener("click", () => reload());

// ---------- barra lateral ----------

const toggleBtn = $("#toggle-sidebar");

function setSidebar(open: boolean) {
  document.body.classList.toggle("sidebar-off", !open);
  const label = open ? "Recolher o painel" : "Abrir o painel";
  toggleBtn.title = `${label} (Ctrl+Shift+B)`;
  toggleBtn.setAttribute("aria-label", label);
  toggleBtn.setAttribute("aria-expanded", String(open));
  // Na janela estreita o painel abre por cima e fecha sozinho: isso não muda a preferência salva.
  if (!document.body.classList.contains("narrow")) save("sidebar", open ? "open" : "off");
  // O ResizeObserver dos painéis reajusta os terminais à nova largura.
}

/** Painel por cima do terminal (aberto) que fecha ao escolher, com Esc ou com um clique fora. */
const isOverlay = () => document.body.classList.contains("narrow") && !document.body.classList.contains("sidebar-off");
const closeOverlay = () => isOverlay() && setSidebar(false);

const toggleSidebar = () => setSidebar(document.body.classList.contains("sidebar-off"));
/** Recolhe ou abre; aberto por cima do terminal, o foco vai para o painel, não para o terminal atrás dele. */
function toggleAndFocus() {
  toggleSidebar();
  if (isOverlay()) focusBoard();
  else render(true);
}
toggleBtn.addEventListener("click", toggleAndFocus);
setSidebar(load<string>("sidebar", "open") !== "off");
$("main").addEventListener("pointerdown", closeOverlay);
// Por cima, o painel é uma gaveta: o Tab que sai dele (para o cabeçalho, debaixo dele) e o Esc em qualquer controle fecham.
// relatedTarget nulo (clique num vazio do painel, janela perdendo o foco) não fecha.
$("#sidebar").addEventListener("focusout", (e) => {
  const to = e.relatedTarget as Node | null;
  if (to && !$("#sidebar").contains(to)) closeOverlay();
});
$("#sidebar").addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !isOverlay()) return;
  e.preventDefault();
  closeOverlay();
  render(true);
});

// Largura arrastável da barra lateral, lembrada entre sessões.
const SIDEBAR_W = { min: 200, max: 480, default: 280 };
const handle = $("#sidebar-handle");
const sidebarEl = $("#sidebar");

/** Área principal mínima: o cabeçalho (abas, destino, ajuda) e um terminal utilizável. */
const MAIN_MIN = 440;
/** Maior largura que a janela comporta agora (px CSS: o zoom também estreita a janela). */
const sidebarMax = () => Math.max(SIDEBAR_W.min, Math.min(SIDEBAR_W.max, innerWidth - MAIN_MIN));
let sidebarWanted: number = SIDEBAR_W.default;

/** Janela estreita (pequena, ou com zoom alto): painel e área principal não cabem lado a lado nos seus pisos.
 *  O painel passa a abrir por cima do terminal e começa fechado; ao alargar, volta a preferência salva. */
function applyNarrow() {
  const narrow = innerWidth < SIDEBAR_W.min + MAIN_MIN;
  if (narrow === document.body.classList.contains("narrow")) return;
  document.body.classList.toggle("narrow", narrow);
  setSidebar(!narrow && load<string>("sidebar", "open") !== "off");
}
window.addEventListener("resize", applyNarrow);
applyNarrow();

/** Aplica a largura pedida, limitada pela janela; só a pedida fica salva, para voltar quando a janela crescer. */
function applySidebarWidth() {
  const max = sidebarMax();
  const px = Math.min(max, sidebarWanted);
  document.body.style.setProperty("--sidebar-w", `${px}px`);
  handle.setAttribute("aria-valuemax", String(max));
  handle.setAttribute("aria-valuenow", String(px));
}

/** `persist`: grava a pedida. O arraste passa false a cada movimento e grava uma vez ao soltar. */
function setSidebarWidth(w: number, persist = true) {
  sidebarWanted = Math.round(Math.min(sidebarMax(), Math.max(SIDEBAR_W.min, w)));
  applySidebarWidth();
  if (persist) save("sidebarWidth", sidebarWanted);
}
window.addEventListener("resize", applySidebarWidth);

handle.setAttribute("aria-valuemin", String(SIDEBAR_W.min));
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
  if (handle.hasPointerCapture(e.pointerId)) setSidebarWidth(e.clientX - sidebarEl.getBoundingClientRect().left, false);
});
handle.addEventListener("lostpointercapture", () => {
  dragPointer = null;
  save("sidebarWidth", sidebarWanted);
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
  else if (e.key === "End") setSidebarWidth(sidebarMax());
  else return;
  e.preventDefault();
});
// Restaura a pedida sem cortá-la pela janela de agora: numa janela pequena, ela volta quando a janela crescer.
sidebarWanted = Math.min(SIDEBAR_W.max, Math.max(SIDEBAR_W.min, Number(load("sidebarWidth", SIDEBAR_W.default)) || SIDEBAR_W.default));
applySidebarWidth();

// ---------- atalhos e janela ----------

// Fase de captura: o atalho é tratado antes do xterm receber a tecla.
window.addEventListener(
  "keydown",
  (e) => {
    // Com um diálogo aberto, nada atrás dele responde: a paleta abriria presa sob o véu.
    if (!e.ctrlKey || !e.shiftKey || document.querySelector("dialog[open]")) return;
    if (e.code === "KeyK") palette.hidden ? openPalette() : closePalette();
    else if (e.code === "KeyB") toggleAndFocus();
    else if (e.code === "KeyE") focusBoard();
    else if (e.code === "KeyH") helpEl.togglePopover();
    else if (e.code === "KeyN" || e.code === "KeyL") {
      if (!config.projects.length) {
        headerNote(false, "Sem projeto ainda: crie um primeiro.");
        emptyEl.querySelector<HTMLButtonElement>(".btn.primary")?.focus();
      } else if (e.code === "KeyN") openAddDialog(current?.project);
      else reload();
    } else if (e.code === "KeyJ") {
      if (current?.wt.api && current.wt.front) setTab(tab === "api" ? "front" : "api", true);
    } else if (e.code === "KeyX") toggleRun(e.altKey);
    else return;
    e.preventDefault();
    e.stopPropagation();
  },
  true,
);

const helpEl = $("#help");
// Aberta, a ajuda recebe o foco: o leitor de tela a anuncia e o Esc chega nela (no xterm, o Esc iria para o shell).
const helpBtn = $("#help-btn");
// Aberta pelo botão ?, o foco volta para ele ao fechar; pelo atalho (Ctrl+Shift+H), volta para o terminal.
let helpFromBtn = false;
helpEl.addEventListener("toggle", (e) => {
  if ((e as ToggleEvent).newState === "open") {
    helpFromBtn = document.activeElement === helpBtn;
    srToggle.checked = config.screenReader;
    helpEl.focus();
    return;
  }
  // Fechada por um clique fora (foco já em outro lugar), segue para o terminal.
  const at = document.activeElement;
  if (helpFromBtn && (at === document.body || at === helpBtn || helpEl.contains(at))) helpBtn.focus();
  else render(true);
});

// Modo leitor de tela do xterm: grava no config e relê, que aplica nos terminais abertos.
const srToggle = $<HTMLInputElement>("#sr-toggle");
const srNote = $("#sr-note");
const SR_NOTE = srNote.textContent;
srToggle.addEventListener("change", async () => {
  try {
    await invoke("set_screen_reader", { on: srToggle.checked });
    srNote.textContent = SR_NOTE;
    srNote.classList.remove("error");
    await refresh();
  } catch (e) {
    srToggle.checked = config.screenReader;
    srNote.textContent = String(e);
    srNote.classList.add("error");
  }
});

window.addEventListener("focus", () => refresh());

scheme.addEventListener("change", () => {
  for (const env of envs.values()) for (const pane of Object.values(env.panes)) pane.term.options.theme = termTheme();
});

// Só o terminal visível, uma vez por quadro: os ocultos se ajustam ao aparecer (render), e arrastando a barra
// o ajuste espera soltar (o lostpointercapture redesenha). Antes, cada quadro do arraste mandava pty_resize a todos.
let fitFrame = 0;
new ResizeObserver(() => {
  if (fitFrame || document.body.classList.contains("resizing")) return;
  fitFrame = requestAnimationFrame(() => {
    fitFrame = 0;
    const ck = currentKey();
    if (ck) envs.get(ck)?.panes[tab]?.fit.fit();
  });
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
