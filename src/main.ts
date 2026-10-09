import { Channel, invoke } from "@tauri-apps/api/core";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

type Side = { path: string; startCommand: string | null; setupCommand: string | null };
type Worktree = { id: string; label: string; api: Side | null; front: Side | null };
type Project = { name: string; error: string | null; worktrees: Worktree[] };
type Config = { stopTimeoutMs: number; projects: Project[] };
type Tab = "api" | "front";
type Pane = { term: Terminal; fit: FitAddon; el: HTMLElement; ptyId: number; side: Side };
type Env = { project: string; root: HTMLElement; panes: Partial<Record<Tab, Pane>>; ready: Promise<void> };

const TABS: Tab[] = ["api", "front"];
const TAB_LABEL: Record<Tab, string> = { api: "API", front: "Front" };
const CONFIG_EXAMPLE = `{
  "stopTimeoutMs": 5000,
  "projects": [
    {
      "name": "meu-projeto",
      "api":   { "repo": "~/dev/meu-api", "startCommand": "pnpm dev" },
      "front": { "repo": "~/dev/meu-web", "startCommand": "pnpm dev" },
      "manualPairs": [{ "api": "feat/x", "front": "feature/x" }]
    }
  ]
}`;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const sidebar = $("#sidebar");
const tabsEl = $("#tabs");
const titleEl = $("#title");
const panesEl = $("#panes");
const emptyEl = $("#empty");
const waitEl = $("#wait");
const palette = $("#palette");
const paletteInput = $<HTMLInputElement>("#palette input");
const paletteList = $("#palette ul");

let config: Config = { stopTimeoutMs: 5000, projects: [] };
let configError: string | null = null;
const envs = new Map<string, Env>();
// Projeto em troca: qual worktree está sendo encerrada e se já passou do Ctrl+C para o SIGKILL.
const stopping = new Map<string, { fromId: string; from: string; forcing: boolean }>();
const queues = new Map<string, Promise<void>>();
// Worktrees recém-criadas pelo app: na primeira subida rodam o setupCommand antes do startCommand.
const fresh = new Set<string>();
let current: { project: string; wt: Worktree } | null = null;
let tab: Tab = "api";

const key = (project: string, id: string) => `${project}\u0000${id}`;
const currentKey = () => (current ? key(current.project, current.wt.id) : null);

// Última worktree ativa por projeto. localStorage basta: é estado local deste app.
let active: Record<string, string> = {};
try {
  active = JSON.parse(localStorage.getItem("active") ?? "{}");
} catch {}
const saveActive = () => {
  try {
    localStorage.setItem("active", JSON.stringify(active));
  } catch {}
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

// ---------- terminais ----------

async function createPane(side: Side, parent: HTMLElement): Promise<Pane> {
  const paneEl = el("div", { className: "pane off" });
  parent.append(paneEl);
  const term = new Terminal({
    fontFamily: "'JetBrainsMono Nerd Font', 'Hack Nerd Font Mono', monospace",
    fontSize: 14,
    theme: { background: "#1e1e1e" },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(paneEl);
  fit.fit();

  const onData = new Channel<ArrayBuffer>();
  onData.onmessage = (buf) => term.write(new Uint8Array(buf));
  const ptyId = await invoke<number>("pty_spawn", { cwd: side.path, cols: term.cols, rows: term.rows, onData });
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

function writeStart(pane: Pane, isFresh: boolean) {
  const cmd = [isFresh && pane.side.setupCommand, pane.side.startCommand].filter(Boolean).join(" && ");
  if (cmd) invoke("pty_write", { id: pane.ptyId, data: cmd + "\r" });
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
      const from = config.projects.find((p) => p.name === project)?.worktrees.find((w) => w.id === prev)?.label ?? prev;
      const state = { fromId: prev, from, forcing: false };
      stopping.set(project, state);
      // O backend manda SIGKILL ao estourar o prazo; aqui só avisa que chegou nessa fase.
      const forceTimer = setTimeout(() => {
        state.forcing = true;
        render();
      }, config.stopTimeoutMs);
      render();
      await prevEnv.ready;
      await Promise.all(Object.values(prevEnv.panes).map(stopPane));
      clearTimeout(forceTimer);
      stopping.delete(project);
    }
    // Trocou de novo enquanto parava: quem vier depois na fila sobe a certa.
    if (active[project] === wt.id) {
      const env = envs.get(key(project, wt.id));
      if (env) {
        await env.ready;
        const k = key(project, wt.id);
        Object.values(env.panes).forEach((pane) => writeStart(pane, fresh.has(k)));
        fresh.delete(k);
      }
    }
    render();
  };
  // Trocas do mesmo projeto em fila, para nunca subir duas worktrees ao mesmo tempo.
  queues.set(project, (queues.get(project) ?? Promise.resolve()).then(run, run));
}

async function select(project: string, wt: Worktree) {
  current = { project, wt };
  const { env, created } = ensureEnv(project, wt);
  activate(project, wt, created);
  render();
  await env.ready;
  render();
}

// ---------- render ----------

function render() {
  renderSidebar();

  const ck = currentKey();
  for (const [k, env] of envs) env.root.classList.toggle("off", k !== ck);
  emptyEl.hidden = !!current;
  tabsEl.replaceChildren();
  titleEl.textContent = "";

  if (!current) {
    waitEl.hidden = true;
    emptyEl.replaceChildren(
      ...(configError
        ? [
            el("p", { textContent: configError }),
            el("p", {}, el("button", { textContent: "Criar projeto", onclick: () => openProjectDialog() })),
            el("p", { textContent: "Ou edite o config à mão. Exemplo:" }),
            el("pre", { textContent: CONFIG_EXAMPLE }),
          ]
        : [el("p", {}, "Use ", el("kbd", { textContent: "Ctrl+Shift+K" }), " ou a barra lateral para escolher uma worktree.")]),
    );
    return;
  }

  const { project, wt } = current;
  if (!wt[tab]) tab = wt.api ? "api" : "front";
  for (const t of TABS) {
    if (!wt[t]) continue;
    tabsEl.append(el("button", { textContent: TAB_LABEL[t], className: t === tab ? "on" : "", onclick: () => setTab(t) }));
  }
  titleEl.textContent = `${project} · ${wt.label}`;
  renderWait(project, wt);

  const env = envs.get(ck!);
  for (const t of TABS) env?.panes[t]?.el.classList.toggle("off", t !== tab);
  const pane = env?.panes[tab];
  if (pane) {
    pane.fit.fit();
    if (palette.hidden && !document.querySelector("dialog[open]")) pane.term.focus();
  }
}

/** Aviso sobre os terminais enquanto a worktree anterior do projeto é encerrada. */
function renderWait(project: string, wt: Worktree) {
  const st = stopping.get(project);
  waitEl.hidden = !st;
  if (!st) return;
  waitEl.replaceChildren(
    el(
      "div",
      { className: "wait-card" },
      el("span", { className: "spinner big" }),
      el("strong", { textContent: st.forcing ? `Forçando o encerramento de ${st.from}…` : `Encerrando ${st.from}…` }),
      el("p", {
        textContent: st.forcing
          ? `Não parou com Ctrl+C em ${config.stopTimeoutMs / 1000}s; enviando SIGKILL.`
          : `Aguardando os processos saírem e liberarem as portas para iniciar ${wt.label}.`,
      }),
    ),
  );
}

function renderSidebar() {
  sidebar.replaceChildren(
    ...config.projects.flatMap((p) => [
      el(
        "div",
        { className: "project" },
        el("h3", { textContent: p.name }),
        el("button", { textContent: "+", title: `Nova worktree em ${p.name}`, ariaLabel: `Nova worktree em ${p.name}`, onclick: () => openAddDialog(p.name) }),
      ),
      ...(p.error ? [el("div", { className: "error", textContent: p.error })] : []),
      ...p.worktrees.map((wt) => {
        const isActive = active[p.name] === wt.id;
        const dot =
          stopping.get(p.name)?.fromId === wt.id
            ? el("span", { className: "dot" }, el("span", { className: "spinner", title: "Encerrando…" }))
            : el("span", { className: "dot" + (isActive ? " active" : ""), textContent: isActive ? "◉" : envs.has(key(p.name, wt.id)) ? "●" : "○" });
        const solo = wt.api && wt.front ? "" : wt.api ? " · só API" : " · só front";
        return el("button", {
          className: currentKey() === key(p.name, wt.id) ? "current" : "",
          title: wt.label + solo,
          onclick: () => select(p.name, wt),
        }, dot, wt.label + solo);
      }),
    ]),
    el("button", { className: "new-project", textContent: "+ Novo projeto", onclick: () => openProjectDialog() }),
  );
}

function setTab(t: Tab) {
  tab = t;
  render();
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
    const fresh = alive.get(currentKey()!);
    if (fresh) current.wt = fresh;
    else if (loaded.has(current.project)) current = null;
  }
  render();
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
  items = config.projects.flatMap((p) => p.worktrees.map((wt) => ({ project: p.name, wt }))).filter((it) => fuzzy(q, `${it.project}${it.wt.label}`.toLowerCase()));
  sel = Math.min(sel, Math.max(items.length - 1, 0));
  paletteList.replaceChildren(
    ...items.map((it, i) =>
      el("li", { className: i === sel ? "sel" : "", onclick: () => choose(it) }, it.wt.label, el("small", { textContent: it.project })),
    ),
  );
  paletteList.children[sel]?.scrollIntoView({ block: "nearest" });
}

function openPalette() {
  palette.hidden = false;
  paletteInput.value = "";
  sel = 0;
  renderPalette();
  paletteInput.focus();
  refresh().then(renderPalette);
}

function closePalette() {
  palette.hidden = true;
  render();
}

function choose(it: Item | undefined) {
  closePalette();
  if (it) select(it.project, it.wt);
}

paletteInput.addEventListener("input", () => {
  sel = 0;
  renderPalette();
});
paletteInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") sel = Math.min(sel + 1, items.length - 1);
  else if (e.key === "ArrowUp") sel = Math.max(sel - 1, 0);
  else if (e.key === "Enter") return choose(items[sel]);
  else if (e.key === "Escape") return closePalette();
  else return;
  e.preventDefault();
  renderPalette();
});
// mousedown na lista não tira o foco do input, então o blur só vem de clique fora.
paletteList.addEventListener("mousedown", (e) => e.preventDefault());
paletteInput.addEventListener("blur", () => !palette.hidden && closePalette());

// ---------- nova worktree ----------

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
let defaultsReq = 0;

function openAddDialog(project?: string) {
  if (!config.projects.length) return;
  projectSel.replaceChildren(...config.projects.map((p) => el("option", { value: p.name, textContent: p.name })));
  projectSel.value = project ?? current?.project ?? config.projects[0].name;
  branchInput.value = "";
  addError.textContent = "";
  for (const t of TABS) sideCheck(t).checked = true;
  loadDefaults();
  addDialog.showModal();
  branchInput.focus();
}

/** Pasta padrão e branches de cada repo do projeto escolhido. */
async function loadDefaults() {
  const req = ++defaultsReq;
  for (const t of TABS) {
    sideDir(t).value = "";
    sideBase(t).replaceChildren(el("option", { value: "", textContent: "Carregando…" }));
    sideBox(t).querySelector(".side-error")!.textContent = "";
  }
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
      sideBox(t).querySelector(".side-error")!.textContent = d.Err;
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
  for (const t of TABS) {
    sideBox(t).disabled = !sideCheck(t).checked;
    const dir = sideDir(t).value.trim().replace(/\/+$/, "");
    sideBox(t).querySelector(".preview")!.textContent = dir ? `Será criada em ${dir}/${branch}` : "";
  }
}

projectSel.addEventListener("change", loadDefaults);
addForm.addEventListener("input", syncSides);
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
    addError.textContent = "Marque API, front ou os dois.";
    return;
  }
  const submit = e.submitter as HTMLButtonElement;
  submit.disabled = true;
  submit.textContent = "Criando…";
  addError.textContent = "";
  try {
    await invoke("add_worktree", { project, branch, api, front });
    addDialog.close();
  } catch (err) {
    addError.textContent = String(err);
  } finally {
    submit.disabled = false;
    submit.textContent = "Criar";
  }
  // Mesmo com erro parcial (ex.: API criada, front falhou) o que foi criado aparece na lista.
  await refresh();
  const wt = config.projects.find((p) => p.name === project)?.worktrees.find((w) => w.id.split("|").includes(branch));
  if (wt && !addDialog.open) {
    fresh.add(key(project, wt.id));
    select(project, wt);
  }
});

addDialog.addEventListener("close", () => render());

// ---------- novo projeto ----------

const projectDialog = $<HTMLDialogElement>("#project-dialog");
const projectForm = projectDialog.querySelector("form")!;
const projectError = projectDialog.querySelector<HTMLElement>(".error")!;
const pfield = (name: string) => projectForm.elements.namedItem(name) as HTMLInputElement;

function openProjectDialog() {
  projectForm.reset();
  projectError.textContent = "";
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
  projectError.textContent = "";
  try {
    await invoke("add_project", { project: { name: pfield("name").value, api: side("api"), front: side("front") } });
    projectDialog.close();
    await refresh();
  } catch (err) {
    projectError.textContent = String(err);
  } finally {
    submit.disabled = false;
  }
});

projectDialog.addEventListener("close", () => render());

// ---------- barra lateral ----------

const toggleBtn = $("#toggle-sidebar");

function setSidebar(open: boolean) {
  document.body.classList.toggle("sidebar-off", !open);
  const label = open ? "Recolher barra lateral" : "Abrir barra lateral";
  toggleBtn.title = `${label} (Ctrl+Shift+B)`;
  toggleBtn.setAttribute("aria-label", label);
  toggleBtn.setAttribute("aria-expanded", String(open));
  try {
    localStorage.setItem("sidebar", open ? "open" : "off");
  } catch {}
  // O ResizeObserver dos painéis reajusta os terminais à nova largura.
}

const toggleSidebar = () => setSidebar(document.body.classList.contains("sidebar-off"));
toggleBtn.addEventListener("click", () => {
  toggleSidebar();
  render();
});
let sidebarPref: string | null = null;
try {
  sidebarPref = localStorage.getItem("sidebar");
} catch {}
setSidebar(sidebarPref !== "off");

// Largura arrastável da barra lateral, lembrada entre sessões.
const SIDEBAR_W = { min: 160, max: 480, default: 220 };
const handle = $("#sidebar-handle");

function setSidebarWidth(w: number) {
  const px = Math.round(Math.min(SIDEBAR_W.max, Math.max(SIDEBAR_W.min, w)));
  document.body.style.setProperty("--sidebar-w", `${px}px`);
  handle.setAttribute("aria-valuenow", String(px));
  try {
    localStorage.setItem("sidebarWidth", String(px));
  } catch {}
}

handle.setAttribute("aria-valuemin", String(SIDEBAR_W.min));
handle.setAttribute("aria-valuemax", String(SIDEBAR_W.max));
handle.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  document.body.classList.add("resizing");
});
handle.addEventListener("pointermove", (e) => {
  if (handle.hasPointerCapture(e.pointerId)) setSidebarWidth(e.clientX - sidebar.getBoundingClientRect().left);
});
handle.addEventListener("lostpointercapture", () => {
  document.body.classList.remove("resizing");
  render();
});
handle.addEventListener("dblclick", () => setSidebarWidth(SIDEBAR_W.default));
handle.addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 40 : 10;
  const w = sidebar.getBoundingClientRect().width;
  if (e.key === "ArrowLeft") setSidebarWidth(w - step);
  else if (e.key === "ArrowRight") setSidebarWidth(w + step);
  else if (e.key === "Home") setSidebarWidth(SIDEBAR_W.min);
  else if (e.key === "End") setSidebarWidth(SIDEBAR_W.max);
  else return;
  e.preventDefault();
});
let savedWidth = NaN;
try {
  savedWidth = Number(localStorage.getItem("sidebarWidth"));
} catch {}
setSidebarWidth(savedWidth || SIDEBAR_W.default);

// ---------- atalhos e janela ----------

// Fase de captura: o atalho é tratado antes do xterm receber a tecla.
window.addEventListener(
  "keydown",
  (e) => {
    if (!e.ctrlKey || !e.shiftKey) return;
    if (e.code === "KeyK") palette.hidden ? openPalette() : closePalette();
    else if (e.code === "KeyB") toggleSidebar();
    else if (e.code === "KeyJ") {
      if (current?.wt.api && current.wt.front) setTab(tab === "api" ? "front" : "api");
    } else return;
    e.preventDefault();
    e.stopPropagation();
  },
  true,
);

window.addEventListener("focus", () => refresh());

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
render();
