import { Channel, invoke } from "@tauri-apps/api/core";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import "@fontsource/barlow-semi-condensed/latin-500.css";
import "@fontsource/barlow-semi-condensed/latin-600.css";
import "@fontsource/barlow-semi-condensed/latin-700.css";
import "./styles.css";
import { asPm, isPm, joinStart, PREFIX, rewrite, splitStart, switchPm, type Pm } from "./pm";
import { endCut, middleCut, nameTail } from "./branch";
import { matchAt, matchItem, projectTerms } from "./match";
import { mergePrs, prLabel, type GhPr, type PrEntry } from "./prs";
import { gitSummary, type GitState } from "./git";
import { searchKey } from "./search";
import { restartRefusal } from "./restart";
import { deafSides, lateText, startEnd } from "./start";
import { pullErrorLine, pullErrorSummary } from "./pull";
import { envPrefix, fill, movesOwnPort, portMismatch, propose, templateError, type Ports } from "./parallel";

/** `startCommand`: o que sobe (o da branch, senão o do projeto); `projectStart`: o do projeto.
 *  `parallelEnv`: as variáveis que levam as portas no modo paralelo ("SERVER_PORT": "{apiPort}"). */
type Side = { path: string; startCommand: string | null; setupCommand: string | null; projectStart: string | null; parallelEnv: Record<string, string> };
type Worktree = { id: string; label: string; api: Side | null; front: Side | null };
type Project = { name: string; error: string | null; parallel: boolean; worktrees: Worktree[] };
type Config = { stopTimeoutMs: number; screenReader: boolean; projects: Project[] };
type Tab = "api" | "front";
/** `url`: endereço do dev server lido da saída do terminal ("Local: http://localhost:3000"), só enquanto o processo vive.
 *  `port`: a última porta lida, que fica entre as subidas: o SUBINDO espera por ela (pollStatus).
 *  `follow`: desliga o acompanhamento até o fim que fitPane liga depois de um resize. */
/** `assigned`/`prefix`: a porta e o "env '…' " com que o start subiu no modo paralelo (null/"" sem prefixo); o Subir e o
 *  Reiniciar repetem os dois, para não voltar à porta padrão que outra worktree usa. */
type Pane = { term: Terminal; fit: FitAddon; search: SearchAddon; el: HTMLElement; ptyId: number; tab: Tab; side: Side; url: string | null; port: number | null; assigned: number | null; prefix: string; follow?: () => void };
type Env = { project: string; root: HTMLElement; panes: Partial<Record<Tab, Pane>>; ready: Promise<void> };
/** Estado de uma linha do painel: o que a palheta mostra. */
type LineState = "run" | "part" | "held" | "start" | "wait" | "stop" | "kill" | "idle" | "none";

const TABS: Tab[] = ["api", "front"];
const TAB_LABEL: Record<Tab, string> = { api: "API", front: "Front" };
const FLAP: Record<LineState, string> = {
  run: "RODANDO",
  part: "SEM LADO", // caiu; flapText diz qual: "SEM FRONT"
  held: "PARADO", // parado à mão; flapText diz qual: "API PARADA"
  start: "SUBINDO",
  wait: "AGUARDA",
  stop: "PARANDO",
  kill: "SIGKILL",
  idle: "INATIVA",
  none: "",
};
// SEM FRONT e API PARADA falam qual lado e por quê (say): "só Front rodando, API parada à mão".
const SPOKEN: Record<Exclude<LineState, "part" | "held">, string> = {
  run: "rodando",
  start: "subindo",
  wait: "aguardando a anterior parar",
  stop: "parando",
  kill: "parando à força",
  idle: "inativa",
  none: "não aberta",
};
const CONFIG_PATH = "~/.config/hotswap/config.json";
// Linhas de até ~40 caracteres: com repo e startCommand na mesma linha (74), a 1440 o exemplo saía cortado em "npm r",
// com uma rolagem horizontal que não se via e que o teclado não alcançava no WebKitGTK.
const CONFIG_EXAMPLE = `{
  "projects": [
    {
      "name": "meu-projeto",
      "api": {
        "repo": "~/dev/meu-api",
        "startCommand": "npm run dev"
      },
      "front": {
        "repo": "~/dev/meu-web",
        "startCommand": "npm run dev"
      }
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
    // 4,76:1 sobre o fundo: é a cor das sugestões do fish, lida o dia todo (#6c6d6a dava 3,54:1)
    brightBlack: "#81827e",
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
type Theme = "dark" | "light";
const systemTheme = (): Theme => (scheme.matches ? "light" : "dark");
// Escolha do botão de tema; null segue o sistema. Quando a escolha coincide com o sistema ela é esquecida (applyTheme):
// o COSMIC alterna dia e noite sozinho, e o app volta a acompanhá-lo na próxima virada.
let themeChoice: Theme | null = load<Theme | null>("theme", null);
const theme = (): Theme => themeChoice ?? systemTheme();
/** Fundo, cursor, seleção e as cores de estado vêm dos tokens do CSS (o terminal fica sobre o mesmo fundo do painel); as outras cores ANSI são conteúdo. */
function termTheme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  return {
    ...TERM_THEME[theme()],
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
// Fala da troca numa região viva só de texto: na faixa, os botões seriam relidos a cada mudança.
const waitSay = $("#wait-say");
const switchingEl = $("#switching");
const palette = $("#palette");
const paletteInput = $<HTMLInputElement>("#palette input");
const paletteList = $("#palette ul");
const paletteNote = $("#palette .note");
const paletteEnter = $("#palette-enter");
const urlEl = $<HTMLAnchorElement>("#dev-url");
const lastStopEl = $("#last-stop");
const termNoteEl = $("#term-note");
const searchEl = $("#term-search");
const searchInput = $<HTMLInputElement>("#term-search input");
const searchSay = $("#term-search-say");
const headerEl = $("header");
const haltTabEl = $<HTMLButtonElement>("#halt-tab");
const haltAllEl = $<HTMLButtonElement>("#halt-all");
// Depois de um clique nas ações, a porta fica como estava até o cursor sair do cabeçalho: a que some (Parar) deixa o
// lugar, a que aparece (Subir) espera. A palheta do destino e as abas já têm largura fixa (os rótulos empilhados, o
// quadrado no respiro). Sem isso o vizinho deslizava para baixo do cursor, com a prévia ENCERRA acesa, e o segundo
// clique parava outra coisa. Pelo teclado não guarda: o foco anda com o botão.
// O segundo clique de um duplo clique não age: o verbo vira na hora ("Subir tudo" → "Parar tudo") e ele parava o
// que acabara de subir.
// O aperto (.tight) e o projeto do destino também ficam como estavam: a 960 recolhido, o "INTERNO /" voltava depois de
// "Subir tudo" e "Parar API" andava 73px para baixo do cursor. E a prévia ENCERRA não acende (.acted): o botão sob o
// cursor vira Parar, e o hover pintava de ENCERRA o que acabara de subir.
let frozen: { tight: boolean; noProject: boolean } | null = null;
for (const b of [haltTabEl, haltAllEl])
  b.addEventListener("click", (e) => {
    if (e.detail !== 1 || frozen) return;
    urlEl.dataset.hold = urlEl.hidden ? "off" : "";
    frozen = { tight: headerEl.classList.contains("tight"), noProject: destEl.classList.contains("no-project") };
    headerEl.classList.add("acted");
  });
haltTabEl.addEventListener("click", (e) => e.detail < 2 && toggleRun(false));
haltAllEl.addEventListener("click", (e) => e.detail < 2 && toggleRun(true));
function releaseHold() {
  if (!frozen) return;
  delete urlEl.dataset.hold;
  frozen = null;
  headerEl.classList.remove("acted");
  fitHeader();
}
headerEl.addEventListener("pointerleave", releaseHold);
addEventListener("resize", releaseHold);

/** ⋯ do cabeçalho: o que não coube na faixa (Parar API, Parar tudo, a porta) vai para cá em vez de sumir sem rastro.
 *  Cada item repete o atalho e a prévia ENCERRA do botão que substitui. Com uma worktree em serviço ele sempre existe:
 *  "Abrir no editor" mora só nele (fitHeader). */
const moreBtn = $<HTMLButtonElement>("#more");
const moreMenu = $("#more-menu");
const flowEl = $("#flow");
/** Não coube na faixa: quebrou para a segunda linha do #flow, que fica fora dela (CSS), ou é o primeiro da linha (esse
 *  não quebra) e passa da borda. */
function ceded(e: HTMLElement) {
  if (e.offsetTop > flowEl.clientHeight / 2) return true;
  const edge = flowEl.getBoundingClientRect().right - parseFloat(getComputedStyle(flowEl).paddingRight) + 0.5;
  return e.getBoundingClientRect().right > edge;
}
const cededActions = () => [haltTabEl, haltAllEl, urlEl].filter((a) => !a.hidden && !a.classList.contains("hold") && ceded(a));
/** Outros projetos em serviço que quebraram para fora da faixa: vão para o ⋯ também. Sumiam sem rastro (painel recolhido
 *  a 960, e sempre a 600), e nada dizia que o LEILAO seguia de pé. */
const cededOthers = () => [...runningEl.querySelectorAll<HTMLElement>(".other")].filter(ceded);
/** O ⋯ aberto pelo "Abrir com…" (ou pelo Ctrl+Shift+O sem editor): mostra a lista de editores, não as ações. */
let editorsMode = false;
moreMenu.addEventListener("toggle", (e) => {
  if ((e as ToggleEvent).newState !== "open") return void (editorsMode = false);
  // Sem ancoragem CSS no WebKitGTK: o menu desce do botão, alinhado pela direita.
  const r = moreBtn.getBoundingClientRect();
  moreMenu.style.top = `${r.bottom + 4}px`;
  moreMenu.style.right = `${innerWidth - r.right}px`;
  if (editorsMode) return void renderEditors();
  moreMenu.setAttribute("aria-label", "Mais ações");
  const ck = currentKey();
  const restartPane = ck && current?.wt[tab]?.startCommand ? envs.get(ck)?.panes[tab] : undefined;
  moreMenu.replaceChildren(
    ...cededOthers().map((o) => {
      // A chave é projeto\0id: em paralelo, um projeto tem várias de pé.
      const [project, id] = o.dataset.key!.split("\u0000");
      const wt = findWt(project, id);
      const b = el(
        "button",
        {
          type: "button",
          className: "more-item other",
          title: o.title,
          onclick: () => {
            moreMenu.hidePopover();
            if (wt) select(project, wt);
          },
        },
        el("span", { className: "where" }, el("span", { className: "project", textContent: project }), ` / ${wt ? proseName(wt.label) : ""}`),
        o.querySelector(".flap")!.cloneNode(true),
      );
      b.setAttribute("aria-label", o.title);
      return b;
    }),
    ...cededActions().map((src) => {
      const keys = src.getAttribute("aria-keyshortcuts")?.replace("Control", "Ctrl");
      // A ação direto, não src.click(): o original quebrou para fora da faixa e está inert.
      const act = () => (src === urlEl ? invoke("open_url", { url: urlEl.href }) : toggleRun(src === haltAllEl));
      const b = el(
        "button",
        { type: "button", className: "more-item", title: src.title, onclick: () => (moreMenu.hidePopover(), act()) },
        el("span", { textContent: src === urlEl ? `Abrir ${urlEl.textContent} no navegador` : src.dataset.label! }),
        ...(keys ? [el("span", { className: "keys", textContent: keys })] : []),
      );
      if (src.dataset.ends) b.dataset.ends = src.dataset.ends;
      if (src.getAttribute("aria-disabled")) b.setAttribute("aria-disabled", "true");
      return b;
    }),
    // Reiniciar a aba aberta: só no ⋯ (o encaixe do cabeçalho é delicado) e só no lado com start. Fora de hora (nada
    // rodando, troca ou parada em andamento) fica aria-disabled; o clique diz por quê no cabeçalho, como o atalho.
    ...(restartPane
      ? [
          el(
            "button",
            {
              type: "button",
              className: "more-item",
              title: `Parar ${TAB_LABEL[tab]} e subir de novo (Ctrl+Shift+R; com Alt, os dois lados)`,
              ariaKeyShortcuts: "Control+Shift+R",
              ariaDisabled: stopping.has(current!.project) || halting.has(ck!) || !(starting.has(ck!) || busy.has(restartPane.ptyId)) ? "true" : null,
              onclick: () => (moreMenu.hidePopover(), toggleRun(false, "restart"))
            },
            el("span", { textContent: `Reiniciar ${TAB_LABEL[tab]}` }),
            el("span", { className: "keys", textContent: "Ctrl+Shift+R" })
          )
        ]
      : []),
    ...(current
      ? [
          pullItem(current.project, current.wt),
          el("button", { type: "button", className: "more-item", title: `gh pr view ${tabBranch(current.wt)} --web`, onclick: () => (moreMenu.hidePopover(), viewPr()) }, el("span", { textContent: "Ver PR" })),
          el(
            "button",
            { type: "button", className: "more-item", title: current.wt[editorSide(current.wt)]!.path, ariaKeyShortcuts: "Control+Shift+O", onclick: () => (moreMenu.hidePopover(), openInEditor()) },
            el("span", { textContent: "Abrir no editor" }),
            el("span", { className: "keys", textContent: "Ctrl+Shift+O" }),
          ),
          el("button", { type: "button", className: "more-item", title: "Escolher o editor (fica para o Ctrl+Shift+O)", onclick: openWith }, el("span", { textContent: "Abrir com…" })),
        ]
      : []),
  );
  // Os outros projetos vêm antes das ações: com eles no menu, o foco abre num que só leva até lá, não num que para.
  moreMenu.querySelector<HTMLElement>("button")?.focus();
});

// Setas andam pelos itens, como no painel e nas abas (só o Tab andava).
moreMenu.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const items = [...moreMenu.querySelectorAll<HTMLElement>("button")];
  const at = items.indexOf(document.activeElement as HTMLElement);
  items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
});

urlEl.addEventListener("click", (e) => {
  e.preventDefault();
  invoke("open_url", { url: urlEl.href });
});

/** A pasta da aba visível (na solo, a do único lado). */
function editorSide(wt: Worktree): Tab {
  return wt[tab] ? tab : wt.api ? "api" : "front";
}
/** Ctrl+Shift+O e o ⋯: abre a pasta da aba visível no editor escolhido em "Abrir com…", senão no `editorCommand` (o
 *  backend lê o config na hora). Sem nenhum, abre a lista; se o editor não abre, a segunda faixa oferece outro. */
function openInEditor() {
  if (!current) return headerNote(false, null, "Escolha uma worktree primeiro.");
  const { project, wt } = current;
  const side = editorSide(wt);
  invoke<boolean>("open_in_editor", { path: wt[side]!.path }).then(
    (ok) => {
      if (alertEl.querySelector(".editor")) clearNote(alertEl);
      if (ok) headerNote(false, project, `Abrindo ${TAB_LABEL[side]} no editor`);
      else openWith();
    },
    (err) =>
      headerNote(
        true,
        project,
        el("span", { className: "editor", textContent: "Editor não abriu" }),
        el("span", { className: "why", textContent: `· ${err}`, title: String(err) }),
        el("button", { type: "button", className: "note-act", textContent: "Abrir com…", onclick: openWith }),
      ),
  );
}

/** Por que a worktree não pode ser atualizada agora, ou null: só parada, a regra do lápis (puxar commits embaixo de um
 *  dev server o recompila no meio, e numa troca a pasta está sendo largada ou assumida). */
function pullBlocked(project: string, wt: Worktree) {
  const state = lineState(project, wt);
  return BUSY.includes(state) ? `${wt.label}, ${say(project, wt, state)}: pare a worktree antes de atualizar` : null;
}

/** "Atualizar (pull)" no ⋯, para a worktree em serviço. Indisponível, fica aria-disabled com o motivo, e o clique o diz. */
function pullItem(project: string, wt: Worktree) {
  const blocked = pullBlocked(project, wt);
  const paths = TABS.flatMap(t => (wt[t] ? [wt[t]!.path] : []));
  const b = el(
    "button",
    {
      type: "button",
      className: "more-item",
      title: blocked ?? `git pull --ff-only em ${paths.join(" e ")}`,
      ariaLabel: blocked ? `Atualizar (pull): indisponível; ${blocked}` : "Atualizar (pull)",
      onclick: () => (moreMenu.hidePopover(), pullWorktree(project, wt))
    },
    el("span", { textContent: "Atualizar (pull)" })
  );
  if (blocked) b.setAttribute("aria-disabled", "true");
  return b;
}

/** `git pull --ff-only` em cada lado, em paralelo (backend). "Atualizada: feat/x" ou "Já estava em dia" como recado de
 *  rotina; um lado que falha vira falha na segunda faixa, com uma frase por lado e o erro cru no detalhe. Depois relê o
 *  estado do git do painel (↑/↓). */
async function pullWorktree(project: string, wt: Worktree) {
  const blocked = pullBlocked(project, wt);
  if (blocked) return headerNote(false, project, blocked);
  const tabs = TABS.filter(t => wt[t]);
  headerNote(false, project, `Atualizando ${wt.label}…`);
  type Pulled = { Ok: boolean } | { Err: string };
  const res = await invoke<Pulled[]>("pull_worktree", { paths: tabs.map(t => wt[t]!.path) }).catch((err): Pulled[] => tabs.map(() => ({ Err: String(err) })));
  void readGit();
  const failed = tabs.flatMap((t, i) => {
    const r = res[i];
    return "Err" in r ? [{ t, err: r.Err }] : [];
  });
  if (!failed.length) return headerNote(false, project, res.some(r => "Ok" in r && r.Ok) ? `Atualizada: ${wt.label}` : "Já estava em dia");
  if (lastStopEl.dataset.project === project) clearNote(lastStopEl);
  // "API: a branch divergiu da remota, não é fast-forward; Front: atualizada". Na solo, sem o nome do lado.
  const said = tabs
    .map((t, i) => {
      const r = res[i];
      const text = "Err" in r ? pullErrorSummary(r.Err) : r.Ok ? "atualizada" : "já estava em dia";
      return tabs.length > 1 ? `${TAB_LABEL[t]}: ${text}` : text;
    })
    .join("; ");
  const raw = failed.map(f => (tabs.length > 1 ? `${TAB_LABEL[f.t]}: ${f.err}` : f.err)).join("\n\n");
  headerNote(
    true,
    project,
    "Pull falhou",
    el("span", { className: "who", textContent: `· ${said}`, title: said }),
    el("span", { className: "why", textContent: `· ${pullErrorLine(failed[0].err)}`, title: raw })
  );
}

/** A branch da aba visível (na solo, a do único lado): o id é "<branch da API>|<branch do Front>". */
function tabBranch(wt: Worktree) {
  return wt.id.split("|")[editorSide(wt) === "api" ? 0 : 1];
}

/** "Ver PR" no ⋯: abre no navegador a PR da branch da aba visível (`gh pr view --web`, solto do app e fora do PTY, com o
 *  --repo do origin, como o "Da PR"). Sem PR, sem gh ou sem login, o cabeçalho diz. */
function viewPr() {
  if (!current) return;
  const { project, wt } = current;
  const side = editorSide(wt);
  const branch = tabBranch(wt);
  invoke<boolean>("open_pr", { path: wt[side]!.path, branch }).then(
    found => headerNote(false, project, found ? `Abrindo a PR de ${branch} no navegador` : `Sem PR aberta para ${branch}`),
    err => {
      const raw = String(err);
      // Sem gh instalado ou logado: o próximo passo, inteiro (o do backend fala em clonar).
      const step = raw.startsWith("Instale") ? "Instale o GitHub CLI (gh) e entre com gh auth login" : raw.startsWith("Entre no GitHub") ? raw : null;
      headerNote(true, project, "PR não abriu", step ? el("span", { textContent: `· ${step}` }) : el("span", { className: "why", textContent: `· ${raw.split("\n")[0]}`, title: raw }));
    }
  );
}

/** "Abrir com…": o ⋯ passa a listar os editores. */
function openWith() {
  if (!current) return;
  editorsMode = true;
  if (moreMenu.matches(":popover-open")) renderEditors();
  else moreMenu.showPopover();
}

type Editors = { editors: { id: string; name: string }[]; chosen: string | null; command: string | null };
/** Os editores instalados (relidos a cada vez) e o `editorCommand`, se houver; o que o Ctrl+Shift+O abre leva o atalho.
 *  Escolher grava a escolha e abre. */
async function renderEditors() {
  moreMenu.setAttribute("aria-label", "Abrir com");
  let list: Editors;
  try {
    list = await invoke<Editors>("list_editors");
  } catch (err) {
    list = { editors: [], chosen: null, command: null };
    headerNote(true, current?.project ?? null, el("span", { className: "editor", textContent: "Não consegui listar os editores" }), el("span", { className: "why", textContent: `· ${err}`, title: String(err) }));
  }
  if (!editorsMode) return;
  const pick = (id: string | null) => () => {
    moreMenu.hidePopover();
    invoke("set_editor", { id }).then(openInEditor, (err) => headerNote(true, current?.project ?? null, el("span", { className: "editor", textContent: "Não gravei o editor" }), el("span", { className: "why", textContent: `· ${err}`, title: String(err) })));
  };
  const keys = (on: boolean) => (on ? [el("span", { className: "keys", textContent: "Ctrl+Shift+O" })] : []);
  const items = list.editors.map((e) => el("button", { type: "button", className: "more-item", title: e.id, onclick: pick(e.id) }, el("span", { textContent: e.name }), ...keys(e.id === list.chosen)));
  if (list.command) items.push(el("button", { type: "button", className: "more-item", title: "editorCommand do config", onclick: pick(null) }, el("span", { className: "mono", textContent: list.command }), ...keys(!list.chosen)));
  if (!items.length) items.push(el("button", { type: "button", className: "more-item", title: "Defina editorCommand no config", onclick: () => (moreMenu.hidePopover(), invoke("open_config")) }, el("span", { textContent: "Nenhum editor encontrado · Abrir config" })));
  moreMenu.replaceChildren(el("p", { className: "more-head", textContent: "Abrir com" }), ...items);
  (moreMenu.querySelector<HTMLElement>("button:has(.keys)") ?? moreMenu.querySelector<HTMLElement>("button"))?.focus();
}

/** Falhas ("não subiu", "caiu") na segunda faixa, embaixo do cabeçalho, até a próxima troca ou o ×. Na faixa de cima elas
 *  disputavam largura com o destino e as ações: apertavam, cediam, iam para o canto do terminal. */
const alertEl = $("#alert");
let lastStopTimer = 0;
const NOTE_MS = 8000;
/** Tira um recado (o de rotina, `#last-stop`, ou a falha, `#alert`). */
function clearNote(target: HTMLElement) {
  target.replaceChildren();
  delete target.dataset.project;
  fitHeader();
}
/** Tira os recados de um projeto: parar, subir ou trocar nele responde a eles ("Nada rodando em API" ao lado de RODANDO,
 *  "Front parou" depois do Subir Front). */
function clearNotes(project: string) {
  for (const t of [lastStopEl, alertEl]) if (t.dataset.project === project) clearNote(t);
}
/** Recado no cabeçalho. Rotina ("Parou em 1,8 s · feat/x", "Worktrees relidas: nada mudou.") fica 8 s na faixa, depois
 *  das ações; sem espaço, quebra para fora dela e a cópia vai para o canto do terminal (renderTermNote).
 *  `stay`: falha, na segunda faixa, até a próxima troca ou o ×. Encerrar à força não é falha. Os dois lugares são
 *  independentes: uma queda no LEILAO não apaga o "Parou em" da troca que acabou de acontecer no INTERNO.
 *  `about`: o projeto do recado. */
function headerNote(stay: boolean, about: string | null, ...nodes: (Node | string | null)[]) {
  const target = stay ? alertEl : lastStopEl;
  // A falha fica até a próxima troca; o × a tira antes, para quem já leu (um servidor que sempre vai ao SIGKILL).
  const dismiss = stay
    ? el(
        "button",
        {
          type: "button",
          className: "note-x",
          title: "Dispensar o recado",
          ariaLabel: "Dispensar o recado",
          onclick: () => {
            clearNote(alertEl);
            render(true);
          },
        },
        icon(X_ICON),
      )
    : null;
  target.replaceChildren(...nodes.filter((n) => n !== null).map((n) => (typeof n === "string" ? el("span", { textContent: n }) : n)), ...(dismiss ? [dismiss] : []));
  if (about) target.dataset.project = about;
  else delete target.dataset.project;
  if (!stay) {
    clearTimeout(lastStopTimer);
    lastStopTimer = setTimeout(() => clearNote(lastStopEl), NOTE_MS);
  }
  fitHeader();
}
/** O texto do recado para o title: os espaços entre as partes são o gap do CSS, e o textContent as colava ("6,0 s· feat/x"). */
const noteText = (note: HTMLElement) => [...note.children].map((c) => c.textContent).join(" ");
/** "Ver o terminal" na falha: leva à worktree e à aba do lado que caiu ou não subiu. Só se ela ainda for a ativa
 *  do projeto: selecionar outra seria uma troca (mataria a que está de pé). */
function seeTerminal(project: string, id: string, side: Tab) {
  return el("button", {
    type: "button",
    className: "note-act",
    textContent: "Ver o terminal",
    onclick: () => {
      const wt = findWt(project, id);
      if (!wt || active[project] !== id) return clearNote(alertEl);
      tab = side;
      select(project, wt);
    },
  });
}
/** "Subir Front" na própria falha da worktree em serviço. Só aparece quando o "Subir Front" do cabeçalho quebrou para
 *  fora da faixa (fitHeader liga): a meia tela, a saída da falha ficava escondida no ⋯. */
function upHere(project: string, id: string, down: Tab[]) {
  if (key(project, id) !== currentKey()) return null;
  return el("button", { type: "button", className: "note-act note-up", textContent: `Subir ${down.map((t) => TAB_LABEL[t]).join(" e ")}`, onclick: () => toggleRun(false, "start") });
}
/** "· Error: listen EADDRINUSE: address already in use :::3000": a primeira linha de erro no fim do terminal do lado
 *  que caiu ou não subiu. A falha dizia o quê, não por quê; para saber era preciso abrir o terminal.
 *  ponytail: palavra-chave nas últimas 15 linhas; sem casar, o recado fica sem causa. */
function errorWhy(project: string, id: string, side: Tab) {
  const buf = envs.get(key(project, id))?.panes[side]?.term.buffer.active;
  if (!buf) return null;
  for (let y = Math.max(0, buf.baseY + buf.cursorY - 15); y <= buf.baseY + buf.cursorY; y++) {
    const text = buf.getLine(y)?.translateToString(true).trim();
    if (text && /\b(error|err!|eaddrinuse|exception|fatal|failed)\b/i.test(text)) return el("span", { className: "why", textContent: `· ${text}`, title: text });
  }
  return null;
}
/** "Parou em 1,8 s" ou "Parou à força em 5,0 s": encerrar à força é rotina (o alvo subiu, a anterior parou como pedido),
 *  então o recado é neutro e expira; só "à força" fala na cor do SIGKILL. */
function stoppedIn(secs: string, forced: boolean) {
  return forced ? el("span", {}, "Parou ", el("span", { className: "forced", textContent: "à força" }), ` em ${secs} s`) : `Parou em ${secs} s`;
}
/** "· INTERNO / feat/x": o projeto entra quando não é o atual, onde outra worktree pode ter o mesmo nome ("main").
 *  A worktree em serviço já está no destino, logo acima: o recado dela não repete o nome ("Front parou", "Parou em 0,4 s · API");
 *  sem nada a dizer depois do "·", não há quem. */
function noteWho(project: string, id: string, label: string, ...before: (Node | string)[]) {
  if (key(project, id) === currentKey()) {
    const what = before.filter((b) => b !== " · ");
    return what.length ? el("span", { className: "who" }, "· ", ...what) : null;
  }
  const where = project === current?.project ? [] : [el("span", { className: "project", textContent: project }), " / "];
  return el("span", { className: "who" }, "· ", ...before, ...where, ...labelNodes(label));
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
// Parada à mão (botões Parar do cabeçalho): envs parando agora (e se já passou para o SIGKILL), e os terminais parados
// de propósito, que não contam como queda. O próximo start (Subir ou troca) tira a marca.
const halting = new Map<string, { forcing: boolean; tabs: Tab[] }>();
const halted = new Set<number>();
let current: { project: string; wt: Worktree } | null = null;
let tab: Tab = "api";
// Estado do git por pasta de lado (mudanças, commits à frente/atrás), relido junto com a lista, não no ciclo do pty_status.
let gitStates = new Map<string, GitState>();

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

/** Texto da palheta de uma worktree; no parcial, o lado que caiu ("SEM FRONT"): "1 LADO" não dizia qual. Parado à mão,
 *  o particípio do botão que o parou ("Parar API" → "API PARADA"): com "SEM API" nos dois, a mesma palavra dizia caiu e
 *  foi pedido, e só um quadrado de 6px os separava. */
function flapText(project: string, wt: Worktree, state: LineState) {
  const s = sides(key(project, wt.id));
  if (state === "part") return `SEM ${s.down.map((t) => TAB_LABEL[t].toUpperCase()).join(" E ")}`;
  if (state === "held") return s.held.map((t) => (t === "api" ? "API PARADA" : "FRONT PARADO")).join(" E ");
  return FLAP[state];
}

const findWt = (project: string, id: string) => config.projects.find((p) => p.name === project)?.worktrees.find((w) => w.id === id);

const isParallel = (project: string) => !!config.projects.find((p) => p.name === project)?.parallel;
/** Algo de pé (ou subindo) na worktree: em paralelo, selecioná-la só mostra. */
const isLive = (project: string, wt: Worktree) => LIVE.includes(lineState(project, wt));
const liveWts = (project: string) => config.projects.find((p) => p.name === project)?.worktrees.filter((w) => isLive(project, w)) ?? [];

/** O que trocar para `id` encerraria: a worktree ativa do projeto, se tem algo de pé. Em paralelo, nada. */
function wouldStop(project: string, id: string | null): Worktree | undefined {
  if (isParallel(project)) return;
  const prev = active[project];
  if (!prev || prev === id) return;
  const wt = findWt(project, prev);
  if (!wt) return;
  const state = lineState(project, wt);
  // SEM FRONT com a API parada à mão: nada de pé para encerrar.
  return LIVE.includes(state) && (state !== "part" || sides(key(project, wt.id)).up.length) ? wt : undefined;
}

/** Nomes dos processos em primeiro plano da worktree ("npm run dev"): a troca diz o que mata, não só onde. */
function procs(project: string, wt: Worktree) {
  const panes = Object.values(envs.get(key(project, wt.id))?.panes ?? {});
  return [...new Set(panes.map((p) => busy.get(p.ptyId)).filter((n): n is string => !!n))];
}

const LIVE: LineState[] = ["run", "part", "held", "start", "wait"];

/** Lados com processo rodando, os que deveriam estar (os que têm startCommand) e não estão, e os parados à mão. */
function sides(k: string) {
  const panes = Object.entries(envs.get(k)?.panes ?? {}) as [Tab, Pane][];
  const up = panes.filter(([, p]) => busy.has(p.ptyId)).map(([t]) => t);
  const want = panes.filter(([, p]) => p.side.startCommand && !halted.has(p.ptyId));
  const held = panes.filter(([, p]) => halted.has(p.ptyId) && !busy.has(p.ptyId)).map(([t]) => t);
  return { up, down: (want.length ? want : panes).map(([t]) => t).filter((t) => !up.includes(t) && !held.includes(t)), held };
}

function lineState(project: string, wt: Worktree): LineState {
  const k = key(project, wt.id);
  const st = stopping.get(project);
  // A que está parando diz PARANDO (SIGKILL) enquanto os processos dela existem, também depois do Voltar: ali ela dizia
  // AGUARDA enquanto levava SIGKILL. Reinicia (SUBINDO) quando eles saem.
  if (st?.fromId === wt.id) return st.forcing ? "kill" : "stop";
  if (st && active[project] === wt.id) return "wait";
  // Parada à mão da worktree inteira; parando um lado só, a palheta fica com o estado dela e só a aba fica âmbar.
  const h = halting.get(k);
  if (h && h.tabs.length >= Object.keys(envs.get(k)?.panes ?? {}).length) return h.forcing ? "kill" : "stop";
  if (starting.has(k)) return "start";
  const { up, down, held } = sides(k);
  // Um lado parado à mão com o outro de pé: API PARADA em palheta neutra (nunca vermelha: foi pedido, não caiu).
  if (up.length) return down.length ? "part" : held.length ? "held" : "run";
  // A API parada à mão e o Front caiu depois: é queda (SEM FRONT), não INATIVA. Neutra, a palheta escondia a falha e o
  // botão oferecia "Subir API", o lado que foi pedido.
  if (held.length && down.length) return "part";
  if (envs.has(k)) return "idle";
  return "none";
}

/** O estado falado; no parcial, diz qual lado caiu. */
function say(project: string, wt: Worktree, state: LineState) {
  if (state !== "part" && state !== "held") return SPOKEN[state];
  const { up, down, held } = sides(key(project, wt.id));
  const names = (ts: Tab[]) => ts.map((t) => TAB_LABEL[t]).join(" e ");
  if (!up.length) return `${names(held)} parada à mão, ${names(down)} caiu`;
  return `só ${names(up)} rodando, ${state === "part" ? `${names(down)} caiu` : `${names(held)} parada à mão`}`;
}

/** O title da linha, para os estados sem palavra no painel. */
const STATE_HINT: Partial<Record<LineState, string>> = { idle: "Inativa: terminais abertos, nada rodando", none: "Ainda não aberta nesta sessão" };

const X_ICON = "M4.5 4.5l7 7M11.5 4.5l-7 7";
const PAIR_ICON = "M3 5.5h10M10.5 3 13 5.5 10.5 8M13 10.5H3M5.5 8 3 10.5 5.5 13";
/** "→" da faixa da troca: de quem para para quem sobe. */
const ARROW_ICON = "M3 8h10M9.5 4.5 13 8l-3.5 3.5";
/** Sentido do movimento na palheta do destino: subindo ↑, parando ↓ (desenhados). */
const DIR: Partial<Record<LineState, string>> = { start: "M8 13V3M4 7l4-4 4 4", stop: "M8 3v10M4 9l4 4 4-4" };
const FROM_ICON = "M13 8H3M6.5 4.5 3 8l3.5 3.5";

/** Par cujos lados só diferem no prefixo ("feature-api/x ↔ feature-app/x"): [prefixo da API, prefixo do front, nome].
 *  Os prefixos sem a barra final: depois do nome, "feature-api/ ⇄ feature-app/" parecia cortado. */
function samePairName(api: string, front: string) {
  const [ap, ar] = splitBranch(api);
  const [fp, fr] = splitBranch(front);
  return ar === fr && ap && fp ? ([ap.slice(0, -1), fp.slice(0, -1), ar] as const) : null;
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
/** Só o nome, para frases: "auth-refresh" (par de prefixos diferentes) ou o lado da API. Prefixos do par no meio da prosa liam como ruído. */
function proseName(label: string) {
  const [a, f] = label.split(" ↔ ");
  return f === undefined ? label : (samePairName(a, f)?.[2] ?? a);
}
/** O mesmo rótulo para atributos (aria-label), onde não cabe nó. */
const spokenLabel = (label: string) => label.replace(" ↔ ", " pareada com ");
/** Etiqueta SÓ API / SÓ FRONT da worktree de um lado só, no painel e na paleta. */
function soloTag(wt: Worktree) {
  const [api, front] = wt.id.split("|");
  return !api ? el("span", { className: "tag", textContent: "SÓ FRONT" }) : !front ? el("span", { className: "tag", textContent: "SÓ API" }) : null;
}
/** ", só API" / ", só front" para a worktree de um lado só (o id é "api|front"). */
function soloSay(wt: Worktree) {
  const [api, front] = wt.id.split("|");
  return !api ? ", só front" : !front ? ", só API" : "";
}

/** "feat/scrap-movement" → ["feat/", "scrap-movement"]. */
function splitBranch(branch: string) {
  const cut = branch.lastIndexOf("/") + 1;
  return [branch.slice(0, cut), branch.slice(cut)] as const;
}

/** "fix/calculo-de-comissao-do-leiloeiro-agrupados": prefixo em meia-tinta, nome em tinta cheia.
 *  Sem espaço, o nome trunca no meio ("fix/calculo-de-comis…agrupados"): o tipo e o fim ficam, que é o que distingue. */
function branchText(branch: string) {
  const [prefix, rest] = splitBranch(branch);
  const restEl = el("span", { className: "rest", textContent: rest });
  // O nome inteiro: fitBranches reescreve o texto truncado a partir dele.
  restEl.dataset.full = rest;
  return [el("span", { className: "prefix", textContent: prefix }), restEl];
}

// ---------- terminais ----------

async function createPane(t: Tab, side: Side, parent: HTMLElement, project: string): Promise<Pane> {
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
  // Clique numa URL abre no navegador do sistema, pelo mesmo caminho da porta (xdg-open): o window.open do webview não sai
  // do app. Só http(s); caminhos como src/x.ts:42 ficam de fora.
  term.loadAddon(new WebLinksAddon((_, uri) => invoke("open_url", { url: uri })));
  const search = new SearchAddon();
  term.loadAddon(search);
  term.open(paneEl);
  // O recado no terminal acompanha a saída: o prompt desce o cursor, uma linha longa ocupa o canto.
  // Só o terminal em que o recado está, e uma vez por quadro: na troca a anterior despeja o log de desligar, e cada lote,
  // de qualquer terminal, relia o layout das linhas (um reflow por lote).
  term.onWriteParsed(() => termNoteEl.hidden || pane !== notePane() || queueTermNote());
  // O Tab é do shell e não sai do terminal: a saída do teclado é dita onde o foco está, não só na ajuda.
  // Por aria-describedby (#term-keys): o WebKitGTK não passa aria-description ao leitor de tela.
  term.textarea?.setAttribute("aria-describedby", "term-keys");
  // O xterm chama os dois campos de "Terminal input" (só no open): o leitor de tela não dizia em qual lado se digita.
  term.textarea?.setAttribute("aria-label", `Terminal ${TAB_LABEL[t]}`);
  fit.fit();

  const pane: Pane = { term, fit, search, el: paneEl, ptyId: -1, tab: t, side, url: null, port: null, assigned: null, prefix: "" };
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
      pane.port = Number(port);
      // Lida num start sem prefixo: é a porta padrão do lado, a que o modo paralelo desvia quando está tomada.
      if (pane.assigned === null) learnDefault(project, t, pane.port);
      render();
    }
  };
  pane.ptyId = await invoke<number>("pty_spawn", { cwd: side.path, cols: term.cols, rows: term.rows, onData });
  paneEl.id = `pane-${pane.ptyId}`;
  term.onData((data) => invoke("pty_write", { id: pane.ptyId, data }));
  term.onResize(({ cols, rows }) => invoke("pty_resize", { id: pane.ptyId, cols, rows }));
  return pane;
}

/** Ajusta o terminal ao tamanho do painel sem tirá-lo do fim. A faixa da troca (36px) entra e sai e o terminal perde e
 *  ganha uma linha; no resize o xterm 6.0 sincroniza a rolagem com a altura antiga e prende a vista uma linha acima do
 *  fim, e fora do fim ele para de acompanhar a saída: com histórico, toda troca ficava parada no "^C" da anterior, com o
 *  prompt e o servidor subindo abaixo da dobra. Um scrollToBottom logo depois é limitado pela mesma altura antiga; ele só
 *  vale depois que a saída nova a atualiza. Então desce a cada escrita até chegar ao fim, a menos que a roda role antes.
 *  ponytail: contorno de um bug do xterm 6.0; sai quando o 6.1 estável corrigir o Viewport. */
function fitPane(pane: Pane) {
  const { term } = pane;
  const atEnd = term.buffer.active.viewportY >= term.buffer.active.baseY;
  const rows = term.rows;
  pane.fit.fit();
  if (!atEnd || term.rows === rows) return;
  pane.follow?.();
  const stop = () => {
    written.dispose();
    pane.el.removeEventListener("wheel", stop);
    pane.follow = undefined;
  };
  const written = term.onWriteParsed(() => {
    term.scrollToBottom();
    if (term.buffer.active.viewportY >= term.buffer.active.baseY) stop();
  });
  pane.el.addEventListener("wheel", stop);
  pane.follow = stop;
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
// "http://localhost:3000", "127.0.0.1:3333", "listening on port 3333". Não depois de "=": o eco do prefixo do modo
// paralelo ("WEB_URL=http://localhost:3001") é a porta do outro lado, não a deste servidor.
const PORT_RE = /(?:(?<!=)https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):|\bporta?\s*:?\s+)(\d{2,5})\b/gi;

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
      if (side) env.panes[t] = await createPane(t, side, root, project);
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

async function writeStart(k: string, pane: Pane, isFresh: boolean, prefix = pane.prefix, assigned = pane.assigned) {
  halted.delete(pane.ptyId);
  pane.prefix = prefix;
  pane.assigned = assigned;
  // Com porta atribuída, é ela que o SUBINDO espera; a lida da subida anterior (a padrão) é de outra worktree agora.
  if (assigned !== null) pane.port = assigned;
  const setup = isFresh ? pane.side.setupCommand : null;
  if (!setup && !pane.side.startCommand) return;
  pane.url = null;
  starting.set(k, Date.now());
  // Sem node_modules o start falharia: instala antes, na mesma linha, à vista no terminal.
  // O setupCommand de uma worktree recém-criada já cuida disso; checar antes (e não a cada erro) não reinstala num crash.
  const install = setup || !pane.side.startCommand ? null : await invoke<string | null>("missing_deps_install", { path: pane.side.path, start: pane.side.startCommand });
  const cmd = [setup, install, pane.side.startCommand && prefix + pane.side.startCommand].filter(Boolean).join(" && ");
  invoke("pty_write", { id: pane.ptyId, data: cmd + "\r" });
}
/** O start de cada lado da worktree que vai subir. Em paralelo, com as portas padrão tomadas, com as portas da worktree
 *  num prefixo "env '…' " montado do parallelEnv de cada lado. */
async function startEnv(k: string, env: Env) {
  const [project, id] = k.split("\u0000");
  const wt = findWt(project, id);
  const plan = wt && isParallel(project) ? await planPorts(project, wt) : null;
  // Cancelado: não sobe nada (e o setup da primeira subida fica para a próxima).
  if (plan === "cancel") return headerNote(false, project, "Não subiu: portas canceladas", noteWho(project, id, wt!.label, " · "));
  const def = defaultPorts[project] ?? NO_PORTS;
  const ports = plan && { api: plan.api ?? def.api, front: plan.front ?? def.front };
  for (const pane of Object.values(env.panes))
    writeStart(k, pane, fresh.has(k), ports ? envPrefix(fill(pane.side.parallelEnv, ports)) : "", ports ? ports[pane.tab] : null);
  fresh.delete(k);
}

const NO_PORTS: Ports = { api: null, front: null };
/** Porta padrão de cada lado por projeto: a última lida num start sem prefixo. */
const defaultPorts: Record<string, Ports> = load("defaultPorts", {});
/** Portas confirmadas por worktree no diálogo: na próxima subida em paralelo, valem sem perguntar se estiverem livres. */
const savedPorts: Record<string, Ports> = load("ports", {});

function learnDefault(project: string, t: Tab, port: number) {
  const d = (defaultPorts[project] ??= { ...NO_PORTS });
  if (d[t] === port) return;
  d[t] = port;
  save("defaultPorts", defaultPorts);
}

/** Portas que outra worktree de pé (ou subindo) usa, lidas da saída ou atribuídas. */
function takenPorts(k: string) {
  const taken = new Set<number>();
  for (const [ek, env] of envs)
    if (ek !== k)
      for (const p of Object.values(env.panes)) if (busy.has(p.ptyId) || starting.has(ek)) for (const n of [p.port, p.assigned]) if (n !== null) taken.add(n);
  return taken;
}

/** As que aceitam conexão em localhost: outro programa (ou um dev server fora do app) já escuta nelas. */
async function portsOpen(ports: (number | null)[]) {
  const list = ports.filter((n): n is number => n !== null);
  const ans = list.length ? await invoke<boolean[]>("ports_open", { ports: list }).catch(() => []) : [];
  return new Set(list.filter((_, i) => ans[i]));
}

/** A proposta com as portas também livres fora do app: a que responde entra nas tomadas e a proposta anda. */
async function freePorts(def: Ports, taken: Set<number>): Promise<Ports> {
  const avoid = new Set(taken);
  for (let i = 0; i < 5; i++) {
    const p = propose(def, avoid);
    const open = await portsOpen([p.api, p.front]);
    if (!open.size) return p;
    for (const n of open) avoid.add(n);
  }
  return propose(def, avoid);
}

/** null: sobe sem prefixo, como fora do modo; Ports: sobe com elas; "cancel": não sobe. */
async function planPorts(project: string, wt: Worktree): Promise<Ports | null | "cancel"> {
  const k = key(project, wt.id);
  const def = defaultPorts[project] ?? NO_PORTS;
  const sidesUp = TABS.filter((t) => wt[t]?.startCommand);
  const others = liveWts(project).some((w) => w.id !== wt.id);
  // Sozinha no projeto e sem padrão conhecida: a primeira subida, que ensina a padrão.
  if (!others && sidesUp.every((t) => def[t] === null)) return null;
  const taken = takenPorts(k);
  const proposal = await freePorts(def, taken);
  // As padrão livres (e conhecidas, ou ninguém de pé): sobe como sempre.
  if (sidesUp.every((t) => (def[t] === null ? !others : proposal[t] === def[t]))) return null;
  const saved = savedPorts[k];
  if (saved) {
    const open = await portsOpen([saved.api, saved.front]);
    if (sidesUp.every((t) => saved[t] !== null && !taken.has(saved[t]!) && !open.has(saved[t]!))) return saved;
  }
  return askPorts(project, wt, proposal, def, taken);
}

/** Ctrl+C → espera → SIGKILL; resolve `true` se precisou forçar. */
const stopPane = (pane: Pane) => invoke<boolean>("pty_stop", { id: pane.ptyId, timeoutMs: config.stopTimeoutMs });

// restart: Ctrl+Shift+R, a parada à mão e depois o start de novo, como o Subir.
type Verb = "stop" | "start" | "restart";

/** Lados do botão de um lado só ("Parar API", Ctrl+Shift+X; "Subir API", Ctrl+Shift+S). Parar age na aba aberta, como o
 *  atalho promete: com a API parada à mão e o Front de pé, olhando o Front, Ctrl+Shift+X dizia "Nada rodando em API".
 *  Subir age no lado caído (SEM FRONT) ou parado à mão seja qual for a aba, para "Subir Front" estar à mão olhando a API. */
function sideTabs(verb: Verb): Tab[] {
  if (!current || verb !== "start") return [tab];
  const state = lineState(current.project, current.wt);
  const s = sides(key(current.project, current.wt.id));
  return state === "part" ? s.down : state === "held" ? s.held : [tab];
}

/** O verbo do botão: Parar se algo roda (ou acabou de subir) nos lados dele, senão Subir. O de um lado olha a aba aberta,
 *  menos com um lado caído: aí é "Subir Front", a saída da falha, seja qual for a aba. */
function haltVerb(all: boolean): "stop" | "start" {
  const k = currentKey()!;
  if (!all && lineState(current!.project, current!.wt) === "part") return "start";
  const panes = (all ? TABS : [tab]).flatMap((t) => envs.get(k)?.panes[t] ?? []);
  return starting.has(k) || panes.some((p) => busy.has(p.ptyId)) ? "stop" : "start";
}

/** Botões "Parar API" e "Parar tudo" do cabeçalho: para o que roda nas abas, como na troca, mas o shell fica.
 *  Parado, o botão sobe de novo (o rótulo diz o verbo). A worktree continua a ativa do projeto.
 *  `want`: o atalho tem um verbo só (Ctrl+Shift+X para, Ctrl+Shift+S sobe; com Alt, os dois lados). Um atalho que alternava
 *  fazia o contrário do pensado no reflexo, durante SUBINDO ou com um lado caído; no estado errado ele não faz nada e diz o outro. */
async function toggleRun(all: boolean, want?: Verb) {
  if (!current) return;
  const { project, wt } = current;
  const k = key(project, wt.id);
  const env = envs.get(k);
  if (!env) return;
  // Atalho durante a troca ou outra parada: não faz nada, mas diz por quê (mudo, parecia que a tecla não pegou).
  if (stopping.has(project)) return headerNote(false, project, "Troca em andamento · Voltar ou Forçar na faixa");
  if (halting.has(k)) return headerNote(false, project, "Parando · espere os processos saírem");
  // Sem verbo (o clique), o do botão: ele diz o que vai fazer.
  const asked = (all ? TABS : sideTabs(want ?? haltVerb(all))).filter((t) => env.panes[t]);
  // Reiniciar só mexe nos lados com start: o sem start não reinicia (nem para).
  const tabs = want === "restart" ? asked.filter(t => env.panes[t]!.side.startCommand) : asked;
  const panes = tabs.map((t) => env.panes[t]!);
  const running = starting.has(k) || panes.some((p) => busy.has(p.ptyId));
  const what = asked.map((t) => TAB_LABEL[t]).join(" e ");
  if (want === "restart") {
    const why = restartRefusal({ what, all, hasStart: tabs.length > 0, running });
    if (why) return headerNote(false, project, why);
  }
  if (want === "stop" && !running) return headerNote(false, project, `Nada rodando ${all ? "na worktree" : `em ${what}`} · Ctrl+Shift+${all ? "Alt+" : ""}S sobe`);
  if (want === "start" && running) return headerNote(false, project, `${all ? "A worktree" : what} já está rodando · Ctrl+Shift+${all ? "Alt+" : ""}X para`);
  if (want === "start" && !panes.some((p) => p.side.startCommand)) return headerNote(false, project, `${what}: sem comando de start`);
  // Parar ou subir responde a qualquer recado deste projeto: "Nada rodando em API" ao lado de RODANDO, ou o "Parou à força"
  // da troca anterior ao lado de ↓ PARANDO, contradiziam o estado. A troca já faz isso (activate).
  clearNotes(project);
  if (!running) {
    for (const p of panes) writeStart(k, p, false);
    return render(true);
  }
  const state = { forcing: false, tabs };
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
  headerNote(false, project, stoppedIn(secs, forced),noteWho(project, wt.id, wt.label, tabs.map((t) => TAB_LABEL[t]).join(" e "), " · "));
  // Reiniciar: com os processos fora, o start de novo, como o Subir. Só se ela ainda é a ativa do projeto e nada a
  // trocou ou fechou no meio: subir a anterior de uma troca deixaria duas worktrees de pé.
  // Em paralelo, a vista pode ter mudado no meio e esta continua de pé: basta o env ser o mesmo.
  if (want === "restart" && (isParallel(project) || active[project] === wt.id) && !stopping.has(project) && envs.get(k) === env) for (const p of panes) writeStart(k, p, false);
  render();
}

/** Uma worktree ativa por projeto: para a anterior (Ctrl+C → espera → SIGKILL) e só então roda o startCommand. */
/** Trocas com uma anterior a parar, por projeto, do clique até a nova subir: o destino fica calado (quem fala é a
 *  faixa). Antes ele só calava depois do `await prevEnv.ready` e anunciava "inativa" no começo e no fim da troca. */
const quiet = new Map<string, number>();

function activate(project: string, wt: Worktree, created: boolean) {
  const prev = active[project];
  // Em paralelo, `active` é a última vista do projeto.
  const parallel = isParallel(project);
  if (prev === wt.id && !created) return;
  active[project] = wt.id;
  saveActive();
  const hushed = !parallel && !!prev && prev !== wt.id && envs.has(key(project, prev));
  if (hushed) quiet.set(project, (quiet.get(project) ?? 0) + 1);

  const run = async () => {
    // Em paralelo, a anterior continua de pé.
    const prevEnv = !parallel && prev && prev !== wt.id ? envs.get(key(project, prev)) : undefined;
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
      // O "Parou em" da troca anterior deste projeto sai: ao lado de PARANDO/AGUARDA, dizia que esta já tinha acabado.
      clearNotes(project);
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
        const who = noteWho(project, state.fromId, state.from);
        headerNote(false, project, stoppedIn(secs, !!state.forcing), who);
      }
    }
    const k = key(project, wt.id);
    const env = envs.get(k);
    // Trocou de novo enquanto parava: quem vier depois na fila sobe a certa.
    if (active[project] === wt.id) {
      // Em paralelo, voltar para uma que já roda só mostra.
      if (env) {
        await env.ready;
        if (!(parallel && isLive(project, wt))) await startEnv(k, env);
      }
      // Abandonada antes de subir: fecha, em vez de ficar PARADA sem nunca ter rodado.
    } else if (env && created && currentKey() !== k) disposeEnv(k, env);
    if (hushed) quiet.set(project, quiet.get(project)! - 1);
    render(currentKey() === key(project, wt.id));
  };
  // Trocas do mesmo projeto em fila, para nunca subir duas worktrees ao mesmo tempo.
  queues.set(project, (queues.get(project) ?? Promise.resolve()).then(run, run));
}

async function select(project: string, wt: Worktree) {
  closeOverlay();
  // A falha que ficou no cabeçalho já foi vista: a próxima troca a tira.
  if (alertEl.childElementCount) clearNote(alertEl);
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

/** Redesenha tudo. `focus`: devolve o foco ao terminal (ou à faixa da troca); só em ações do usuário. */
function render(focus = false) {
  renderBoard();
  renderRunning();

  const ck = currentKey();
  for (const [k, env] of envs) env.root.classList.toggle("off", k !== ck);
  emptyEl.hidden = !!current;

  // Durante a troca o terminal novo não aceita digitação: ela entraria antes do startCommand. E diz isso: sem o cursor
  // e com o aviso no canto (CSS), em vez de engolir as teclas em silêncio, o que parecia travado.
  for (const e of envs.values()) {
    const locked = stopping.has(e.project);
    for (const p of Object.values(e.panes)) p.term.options.disableStdin = locked;
    e.root.classList.toggle("locked", locked);
  }

  if (!current) {
    destEl.replaceChildren();
    destEl.dataset.sig = "";
    tabsEl.replaceChildren();
    tabsEl.dataset.sig = "";
    urlEl.hidden = true;
    haltTabEl.hidden = haltAllEl.hidden = true;
    switchingEl.hidden = true;
    searchEl.hidden = true;
    renderEmpty();
    fitHeader();
    return;
  }

  const { project, wt } = current;
  if (!wt[tab]) tab = wt.api ? "api" : "front";
  const env = envs.get(ck!);
  const state = lineState(project, wt);
  // Durante a troca quem fala é o aviso; o destino calado evita dois anúncios ao mesmo tempo.
  destEl.setAttribute("aria-live", stopping.has(project) || quiet.get(project) ? "off" : "polite");
  // Região viva: só reescreve quando muda, senão o leitor de tela repete o destino a cada render.
  const sig = `${ck}\u0000${state}\u0000${say(project, wt, state)}`;
  if (destEl.dataset.sig !== sig) {
    destEl.dataset.sig = sig;
    const f = flap(state, `head:${ck}`, flapText(project, wt, state));
    // Aqui, maior e com o sentido desenhado: SUBINDO, AGUARDA e PARANDO dividem o âmbar e só a palavra os separava.
    const dir = DIR[state];
    if (dir) f.firstElementChild!.prepend(icon(dir, "dir"));
    // Largura fixa: os rótulos mais largos que ela pode ter, empilhados e invisíveis (como .halt). Crescendo de
    // RODANDO a API PARADA, ela empurrava "Parar tudo" para baixo do cursor.
    // Apertado (.tight), os rótulos de um lado só saem dos fantasmas: reservavam ~40px que a branch não tinha (a 720
    // sobrava "…vivo"). Eles são raros e não chegam no meio de uma troca, quando o cursor mira o que vem depois.
    const ghost = (cls: string, ...c: (Node | string)[]) => el("span", { className: cls }, ...c);
    f.append(ghost("ghost", icon(DIR.stop!, "dir"), FLAP.stop), ...(wt.api && wt.front ? ["FRONT PARADO", "API PARADA", "SEM FRONT"].map((t) => ghost("ghost side", t)) : []));
    // "Parar tudo" com o cursor ou o foco mostra a mesma prévia ENCERRA das linhas (CSS).
    if (LIVE.includes(state)) f.append(el("span", { className: "ends", textContent: "ENCERRA" }));
    // O visível trunca (cutDest) e perde o projeto; quem fala é o .sr, inteiro. Truncado dentro da região viva, o leitor
    // de tela ouvia "feat/agrupador-de-lotes-…leilao".
    const where = el("span", { className: "where", title: `${project} / ${wt.label}`, ariaHidden: "true" }, el("span", { className: project.length <= 8 ? "project short" : "project", textContent: project }), el("span", { className: "sep", textContent: "/" }), el("span", { className: "branch-name" }, ...labelNodes(wt.label)));
    destEl.replaceChildren(where, f, el("span", { className: "sr", textContent: `${project} / ${spokenLabel(wt.label)}: ${say(project, wt, state)}` }));
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
  renderHalt(haltTabEl, false);
  renderHalt(haltAllEl, true);
  const down = state === "part" ? sides(ck!).down : [];
  // Parado à mão (Parar API) com o outro lado de pé: a palheta diz API PARADA em neutro, e a aba leva o quadrado vazado.
  // Em ink-2, não em fail: foi pedido, não caiu.
  const parked = ck ? sides(ck).held : [];
  // Parando um lado só: a palheta segue com o estado da worktree e a aba que para fica âmbar.
  const stoppingTabs = (ck && halting.get(ck)?.tabs) || [];
  // Só recria as abas quando elas mudam: recriar com o foco numa delas (a janela voltando, uma palheta virando)
  // jogava o foco do teclado no body. Se mudar com o foco nelas, ele volta para a mesma aba (ou para a selecionada).
  const tabsSig = [ck, tab, down.join(), parked.join(), stoppingTabs.join(), ...TABS.map((t) => (wt[t] ? (env?.panes[t]?.el.id ?? "-") : ""))].join("\u0000");
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
        down.includes(t) ? el("span", { className: "sr", textContent: " (caiu)" }) : null,
        parked.includes(t) ? el("span", { className: "sr", textContent: " (parado à mão)" }) : null,
        stoppingTabs.includes(t) ? el("span", { className: "sr", textContent: " (parando)" }) : null,
      );
      b.classList.toggle("down", down.includes(t));
      b.classList.toggle("parked", parked.includes(t));
      b.classList.toggle("halting", stoppingTabs.includes(t));
      if (down.includes(t)) b.title = `Nada rodando no ${TAB_LABEL[t]}`;
      if (parked.includes(t)) b.title = `${TAB_LABEL[t]} parado à mão (Ctrl+Shift+S sobe)`;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(t === tab));
      const pane = env?.panes[t];
      if (pane) b.setAttribute("aria-controls", pane.el.id);
      tabsEl.append(b);
    }
    if (focusedTab) (document.getElementById(focusedTab) ?? document.getElementById(`tab-${tab}`))?.focus();
  }
  // Mede só com o cabeçalho completo (destino, abas, porta): antes disso a faixa parece ter espaço que não tem.
  fitHeader();
  renderWait(project, wt);

  for (const t of TABS) env?.panes[t]?.el.classList.toggle("off", t !== tab);
  const pane = env?.panes[tab];
  if (pane) fitPane(pane);
  if (!focus || !palette.hidden || document.querySelector("dialog[open]")) return;
  if (stopping.has(project)) {
    // O foco vai para a faixa da troca, nunca para um botão: esperar é a ação padrão.
    if (!switchingEl.contains(document.activeElement)) switchingEl.focus();
  } else pane?.term.focus();
}

/** Todos os rótulos que o botão pode ter, empilhados na mesma célula e invisíveis: ele fica sempre com a largura do maior.
 *  Clicar em "Parar API" virava "Subir API", mais estreito, e "Parar tudo" deslizava para baixo do cursor, com a prévia
 *  ENCERRA acesa; o segundo clique parava a worktree inteira. */
const HALT_LABELS = {
  tab: ["Parar API", "Subir API", "Parar Front", "Subir Front"],
  all: ["Parar tudo", "Subir tudo"],
};

/** "Parar API" (`all`: "Parar tudo") da worktree atual: Parar se algo roda (ou acabou de subir), Subir se há start;
 *  senão some. Verbo e objeto escritos: um quadrado desenhado lia como maximizar ou checkbox, ao lado das abas.
 *  Numa troca do projeto some: a nova sobe sozinha, e "Subir" ali dizia o contrário. Numa parada à mão fica aria-disabled com o motivo. */
function renderHalt(b: HTMLButtonElement, all: boolean) {
  const k = currentKey()!;
  const { wt } = current!;
  const verb = haltVerb(all);
  // Sem lados (o "tudo" de uma worktree solo), some: starting.has(k) sozinho mostrava "Parar undefined" enquanto ela subia.
  const tabs = all ? (wt.api && wt.front ? TABS : []) : sideTabs(verb);
  const panes = tabs.flatMap((t) => envs.get(k)?.panes[t] ?? []);
  const running = verb === "stop";
  // Numa troca os botões não servem (a nova sobe sozinha), mas guardam o lugar, invisíveis (`.hold`): sumindo, a branch
  // do destino aparecia inteira durante a troca e encolhia no fecho, quando eles voltavam.
  const swapping = stopping.has(current!.project);
  b.hidden = !tabs.length || (!swapping && !running && !panes.some((p) => p.side.startCommand));
  b.classList.toggle("hold", swapping);
  b.inert = swapping;
  if (b.hidden) return;
  const word = running ? "Parar" : "Subir";
  const text = `${word} ${all ? "tudo" : TAB_LABEL[tabs[0]]}`;
  const wait = halting.has(k);
  // Prévia do que Parar encerra (CSS): a aba, ou a worktree inteira quando os lados dela são todos estes.
  if (running && !wait) b.dataset.ends = panes.length === Object.keys(envs.get(k)?.panes ?? {}).length ? "all" : "tab";
  else delete b.dataset.ends;
  // Um verbo por atalho: X para, S sobe.
  const chord = `Shift+${all ? "Alt+" : ""}${running ? "X" : "S"}`;
  const title = wait ? "Aguarde: parando processos" : `${word} ${tabs.map((t) => TAB_LABEL[t]).join(" e ")} (Ctrl+${chord})`;
  if (b.title === title && b.dataset.label === text) return;
  b.title = title;
  b.dataset.label = text;
  // Os fantasmas ficam fora do nome acessível (aria-hidden e invisíveis): o leitor de tela ouve só "Parar API".
  b.replaceChildren(el("span", { textContent: text }), ...HALT_LABELS[all ? "all" : "tab"].map((g) => el("span", { className: "ghost", textContent: g, ariaHidden: "true" })));
  b.setAttribute("aria-keyshortcuts", `Control+${chord}`);
  // O motivo ("Aguarde: parando processos") chega ao leitor de tela pelo title, que o WebKitGTK passa como descrição.
  if (wait) b.setAttribute("aria-disabled", "true");
  else b.removeAttribute("aria-disabled");
}

/** Primeiro uso: a troca em três palhetas, com as peças do próprio painel. O que ele vai fazer, antes de ter o que fazer. */
function howItWorks() {
  const step = (state: LineState, text: string) => el("li", {}, flap(state, `how:${state}`), el("span", { textContent: text }));
  return el(
    "ol",
    { className: "how", ariaLabel: "Como a troca funciona" },
    step("stop", "a worktree anterior recebe Ctrl+C"),
    step("wait", "a nova espera as portas liberarem"),
    step("run", "API e front sobem, cada um no seu terminal"),
  );
}

function renderEmpty() {
  const missing = configError?.includes("Não consegui ler");
  const hadFocus = document.activeElement === document.body || emptyEl.contains(document.activeElement);
  emptyEl.replaceChildren(
    ...(configError
      ? [
          el("h2", { textContent: missing ? "Nenhum projeto configurado" : "O config tem um problema" }),
          el("p", { textContent: missing ? "Aponte os repositórios da API e do front; as worktrees deles viram as linhas do painel." : configError }),
          ...(missing ? [howItWorks()] : []),
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
            howItWorks(),
            el("p", {}, el("button", { type: "button", className: "btn primary", textContent: "Criar projeto", onclick: () => openProjectDialog() })),
          ]),
  );
  if (hadFocus) emptyEl.querySelector<HTMLButtonElement>(".btn.primary")?.focus();
}

/** Tempo de parada até a faixa oferecer "Forçar". A maioria das trocas sai em 1–2 s: antes disso o botão
 *  era ruído no gesto mais repetido do dia. */
const FORCE_DELAY = 2000;

/** Contagem até o SIGKILL, em tinta neutra: esperar é o caminho normal. Vermelho só se chegar ao SIGKILL. */
function countFlap(project: string, st: Stopping) {
  const c = flap("idle", `strip:${project}`, `${Math.max(0, Math.ceil((st.deadline - Date.now()) / 1000))} s`);
  c.classList.add("count");
  return c;
}

/** A troca em andamento, do Ctrl+C ao SIGKILL, no cabeçalho, no lugar das ações (que somem numa troca):
 *  "Parando Voltar para X", e depois de FORCE_DELAY "Parando [3 s] Voltar para X · Forçar". Uma casa só: o card sobre o véu entrava aos 3 s, 2 s antes do
 *  SIGKILL padrão, mudava o Voltar de lugar e puxava o foco no meio da espera. O terminal novo fica à vista e não
 *  aceita digitação até subir (render). */
function renderWait(project: string, wt: Worktree) {
  const st = stopping.get(project);
  const was = !switchingEl.hidden;
  switchingEl.hidden = !st;
  // A cada contagem: o prompt do shell novo chega depois e desce o cursor.
  renderTermNote();
  if (!st) {
    switchingEl.dataset.sig = "";
    switchingEl.replaceChildren();
    waitSay.textContent = "";
    // render mede o cabeçalho antes de chegar aqui, ainda com a faixa: sem remedir, a 960 tudo ficava cedido
    // (as ações no ⋯, o recado no terminal) até o próximo pollStatus, ~1,4 s depois, e o fecho tremia.
    if (was) fitHeader();
    return;
  }
  const goingBack = active[project] === st.fromId;
  const late = !!st.forcing || Date.now() - (st.deadline - config.stopTimeoutMs) >= FORCE_DELAY;
  // Só reconstrói quando o texto muda (a fala é região viva); a contagem vira no lugar.
  const sig = [project, st.fromId, wt.id, goingBack, st.forcing, late].join("\u0000");
  if (switchingEl.dataset.sig === sig) {
    if (!st.forcing) switchingEl.querySelector(".count")?.replaceWith(countFlap(project, st));
    return;
  }
  switchingEl.dataset.sig = sig;
  const names = st.fromWt ? procs(project, st.fromWt) : [];
  const next = proseName(wt.label);
  const from = spokenLabel(st.from);
  const detail = goingBack
    ? st.forcing
      ? `Reiniciando ${from}: os processos não saíram com Ctrl+C e estão sendo encerrados à força (SIGKILL); reinicia em seguida.`
      : `Reiniciando ${from}: Ctrl+C já enviado; reinicia assim que os processos saírem.`
    : st.forcing === "user"
      ? `Parando ${from} à força (SIGKILL), como pedido. Depois sobe ${next}.`
      : st.forcing
        ? `${from} não parou com Ctrl+C a tempo; os processos estão sendo encerrados à força (SIGKILL). Depois sobe ${next}.`
        : `Parando ${from}: Ctrl+C enviado ${names.length ? `a ${names.join(", ")}` : "aos processos"}. Quando as portas liberarem, sobe ${next}. Se não saírem até a contagem zerar, recebem SIGKILL.`;
  switchingEl.title = detail;
  // Só quando muda: aos 2 s (a contagem entra) o mesmo texto era dito de novo, e o SIGKILL depois do Voltar, nunca.
  if (waitSay.textContent !== detail) waitSay.textContent = detail;
  // Voltar reinicia a anterior (o Ctrl+C já foi); depois de voltar, no SIGKILL ou sem a anterior no config, não há para onde voltar.
  // Sem atalho de Esc: no reflexo do vim, ele desfazia a troca recém-pedida.
  // Depois do clique ele guarda o lugar, invisível (.hold): sumindo, o Forçar deslizava para baixo do cursor e o
  // segundo clique de um duplo clique mandava SIGKILL na que se queria reiniciar.
  // Curto e secundário: o fato da faixa (quem para, quem sobe) vem antes e em tinta cheia; o que ele reinicia está ali
  // ao lado, no fato, e inteiro no title. "Voltar e reiniciar feat/x" contornado era o mais forte da faixa.
  const back =
    st.forcing || !st.fromWt
      ? null
      : el("button", {
          type: "button",
          className: goingBack ? "btn back hold" : "btn back",
          inert: goingBack,
          textContent: "Voltar",
          // A paleta abre na anterior: no meio da troca, Ctrl+Shift+K e Enter é o Voltar pelo teclado.
          title: `Cancela a troca e reinicia ${st.from} (Ctrl+Shift+K, Enter)`,
          ariaLabel: `Voltar: cancela a troca e reinicia ${from}`,
          onclick: () => st.fromWt && select(project, st.fromWt),
        });
  if (back) back.dataset.act = "back";
  // No SIGKILL não há botão: o backend espera no máximo 1 s depois dele e a troca segue sozinha.
  const force =
    late && !st.forcing
      ? el("button", {
          type: "button",
          className: "btn",
          textContent: "Forçar",
          title: "Envia SIGKILL aos processos sem esperar o prazo",
          onclick: (e: MouseEvent) => {
            if (e.detail > 1) return;
            st.forcing = "user";
            for (const p of st.panes) invoke("pty_force", { id: p.ptyId });
            render();
          },
        })
      : null;
  if (force) force.dataset.act = "force";
  // Redesenho mantém o foco onde estava (o mesmo botão, ou a faixa se o botão sumiu).
  const had = switchingEl.contains(document.activeElement) ? ((document.activeElement as HTMLElement).dataset.act ?? "strip") : null;
  // O fato da troca, em tinta cheia: "Parando feat/x → fix/y". Era só "Parando", e quem parava estava dentro do Voltar.
  // Os nomes truncam no meio (cutBack). Depois do Voltar, "→ fix/y" guarda o lugar invisível: nada à direita anda.
  const fact = el(
    "span",
    { className: "fact" },
    // O verbo da palheta da anterior (PARANDO); ENCERRA fica só para a prévia. No SIGKILL ele continua: a palheta ao lado diz como.
    // Os dois verbos empilhados: "Reiniciando" mais largo empurrava o Forçar para baixo do cursor.
    el("span", { className: "what" }, el("span", { textContent: goingBack ? "Reiniciando" : "Parando" }), el("span", { className: "ghost", ariaHidden: "true", textContent: "Reiniciando" })),
    el("span", { className: "nm", textContent: proseName(st.from) }),
    el("span", { className: goingBack ? "onward hold" : "onward" }, icon(ARROW_ICON, "inline"), el("span", { className: "nm", textContent: next })),
  );
  switchingEl.replaceChildren(
    fact,
    // O Voltar logo depois do verbo: a contagem que entra aos 2 s fica à direita dele, e ele não anda (andava ~110px
    // no instante em que se mirava nele).
    // A contagem entra com o Forçar: na troca típica (1–2 s), contar até um SIGKILL que não vem era ansiedade à toa.
    // "SIGKILL em [3 s]": sem o rótulo, a contagem lia como "a nova para em 3 s".
    ...[back, st.forcing ? flap("kill", `strip:${project}`) : late ? el("span", { className: "count-to", textContent: "SIGKILL em" }) : null, late && !st.forcing ? countFlap(project, st) : null, force].filter((b) => b !== null),
    // No SIGKILL não sobra botão: o que vem depois fica escrito, não só no title (na troca, o "→ fix/y" do fato já diz).
    ...(st.forcing && goingBack ? [el("span", { className: "then", textContent: "reinicia em seguida" })] : []),
  );
  if (had) (switchingEl.querySelector<HTMLElement>(`[data-act="${had}"]`) ?? switchingEl).focus();
  // A faixa cresceu ou mudou (contagem e Forçar aos 2 s): a branch de destino pode ter ficado abaixo do piso.
  fitHeader();
}

/** Largura real do texto, com subpixel. scrollWidth e clientWidth são inteiros: com a caixa em 212,70px e o texto em
 *  212,77px os dois davam 213, o corte no meio não entrava e a reticência do CSS cortava o fim ("…agrupad…"). */
function textWidth(e: HTMLElement) {
  const r = document.createRange();
  r.selectNodeContents(e);
  return r.getBoundingClientRect().width;
}
const overflows = (e: HTMLElement) => textWidth(e) > e.getBoundingClientRect().width + 0.01;

/** Mede um texto na fonte de `e`, com 2px de folga (o canvas ignora tabular-nums): o corte nunca encosta na reticência do CSS. */
function fontWidth(e: HTMLElement) {
  const css = getComputedStyle(e);
  // o shorthand css.font volta vazio com font-variant-numeric definido
  const font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
  return (t: string) => {
    measure.font = font;
    return measure.measureText(t).width + 2;
  };
}

/** Os nomes do fato da troca, sem espaço: primeiro sai o prefixo ("feat/"), o nome é o que distingue; depois trunca no
 *  meio, como as branches do painel ("calculo…agrupados"). Os dois inteiros ficam no title e na fala. */
function cutBack() {
  const names = switchingEl.hidden ? [] : [...switchingEl.querySelectorAll<HTMLElement>(".fact .nm")];
  for (const nm of names) {
    nm.classList.remove("gone");
    nm.textContent = nm.dataset.full ??= nm.textContent!;
  }
  // Quem para cede primeiro (CSS); sem 3em para ele, sai inteiro e a largura vai para quem sobe.
  const from = names[0];
  if (from && overflows(from) && from.getBoundingClientRect().width < 3 * parseFloat(getComputedStyle(from).fontSize)) from.classList.add("gone");
  // Mede todos antes de escrever: cada corte devolveria largura ao outro.
  const cuts = names.map((nm) => (overflows(nm) ? { nm, avail: nm.getBoundingClientRect().width, w: fontWidth(nm) } : null));
  for (const c of cuts) {
    if (!c) continue;
    const name = splitBranch(c.nm.dataset.full!)[1] || c.nm.dataset.full!;
    c.nm.textContent = c.w(name) <= c.avail ? name : middleCut(name, c.avail, c.w);
  }
}

/** A branch do destino, sem espaço. Com o painel aberto ao lado, corta pelo começo ("…de-lotes-por-leilao"): a linha
 *  atual dele guarda o começo e o fim ("feat/agrupador-de-…leilao"), e com o mesmo corte nos dois o meio do nome não
 *  aparecia em lugar nenhum. Sem o painel, trunca como ele (fitBranches): o meio do nome primeiro, o prefixo ("feat/")
 *  e o fim ficam; o prefixo só sai inteiro quando o começo do nome ficaria com menos de 3em ("fe…leilao" a 480).
 *  Só o nome sozinho; o par de prefixos diferentes ("a ⇄ b") fica com a reticência do CSS. */
function cutDest(branch: HTMLElement | null, name: Text | null) {
  if (!branch || !name || !overflows(branch)) return;
  if (branch.childNodes.length > 1 && !destEl.classList.contains("bare")) return;
  const avail = branch.getBoundingClientRect().width;
  const w = fontWidth(branch);
  if (!document.body.classList.contains("sidebar-off") && !document.body.classList.contains("narrow")) {
    name.data = endCut(branch.dataset.full!, avail, w);
    return;
  }
  const [prefix, rest] = splitBranch(branch.dataset.full!);
  const keep = prefix && avail - w(prefix) - w(`…${nameTail(rest)}`) >= 3 * parseFloat(getComputedStyle(branch).fontSize);
  name.data = keep ? prefix + middleCut(rest, avail - w(prefix), w) : middleCut(rest || prefix, avail, w);
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

// id da descrição "Encerra …" de cada linha, fixo por chave: um id novo a cada render mudava o outerHTML que o render do
// painel compara, e toda plataforma era recriada (o atraso da prévia ENCERRA reiniciava sob o cursor)
const endsIds = new Map<string, string>();
const endsId = (k: string) => endsIds.get(k) ?? endsIds.set(k, `ends-${endsIds.size}`).get(k)!;
function lineButton(project: string, wt: Worktree) {
  const k = key(project, wt.id);
  // Encerrada à força pela troca: SIGKILL (em âmbar) só enquanto acontece, depois INATIVA. É rotina: o recado diz "à força".
  const state = lineState(project, wt);
  const [api, front] = wt.id.split("|");
  // Solo: a etiqueta vai para a segunda linha, como o par; na primeira ela roubava largura do nome.
  const tag = soloTag(wt);
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
  const f = flap(state, `line:${k}`, flapText(project, wt, state));
  const git = gitSummary(TABS.flatMap((t) => (wt[t] ? [[TAB_LABEL[t], gitStates.get(wt[t]!.path)] as [string, GitState | undefined]] : [])));
  // A linha em serviço mostra ENCERRA enquanto o cursor (ou o foco) está em outra do mesmo projeto: o clique é destrutivo.
  if (live) f.append(el("span", { className: "ends", textContent: "ENCERRA" }));
  const b = el(
    "button",
    {
      type: "button",
      className: `line${live ? " live" : ""}`,
      tabIndex: -1,
      // O estado por extenso no title: o fio e a falta de palheta não se explicam sozinhos.
      title: [wt.label, STATE_HINT[state] ?? say(project, wt, state), git.text, endsText].filter(Boolean).join("\n"),
      ariaLabel: `${spokenLabel(wt.label)}${soloSay(wt)}: ${say(project, wt, state)}${git.text ? `; ${git.text}` : ""}`,
      // Busca a worktree na hora do clique: o botão pode ter sobrevivido a um refresh do config.
      onclick: () => {
        const fresh = findWt(project, wt.id);
        if (fresh) select(project, fresh);
      },
    },
    el("span", { className: "name" }, el("span", { className: "top" }, el("span", { className: "branch" }, ...top)), pair, tag),
    // A palheta fica à direita, como a coluna de situação de um painel de partidas; nunca aberta, ela não ocupa a coluna (CSS) e o nome usa a largura.
    f,
    // O git embaixo da palheta, na coluna de situação, só na linha atual e nas em serviço: depois do nome, ele tirava ~30px
    // do que distingue as branches, e em toda linha virava textura. Nas outras ele fica no title e no nome acessível.
    live || currentKey() === k ? gitBadge(git) : null,
  );
  // O que o clique encerra, com o par falado ("pareada com", não "↔"). Num filho hidden por aria-describedby: o WebKitGTK
  // não passa aria-description ao leitor de tela. Sem ele, a descrição é o title (nome, git e o mesmo "Encerra").
  if (ends) {
    const id = endsId(k);
    b.append(el("span", { id, hidden: true, textContent: `Encerra ${spokenLabel(ends.label)}${endsProcs}` }));
    b.setAttribute("aria-describedby", id);
  }
  b.dataset.key = k;
  if (currentKey() === k) b.setAttribute("aria-current", "true");
  return b;
}

/** Na coluna de situação, embaixo da palheta: um ponto se há mudança não commitada ou arquivo não rastreado, e ↑2 ↓1 com os
 *  commits à frente/atrás do upstream, só quando não são zero. As setas são desenhadas; o texto vai no nome da linha. */
function gitBadge(g: ReturnType<typeof gitSummary>) {
  if (!g.dirty && !g.ahead && !g.behind) return null;
  const ab = (n: number, d: string) => (n ? el("span", {}, icon(d), String(n)) : null);
  const b = el("span", { className: "git" }, g.dirty ? el("span", { className: "dirty" }) : null, ab(g.ahead, DIR.start!), ab(g.behind, DIR.stop!));
  b.setAttribute("aria-hidden", "true");
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
      title: busyNow ? `${wt.label}, ${say(project, wt, lineState(project, wt))}: troque para outra worktree do projeto antes de editar` : `Editar ${wt.label}`,
      ariaLabel: busyNow ? `Editar ${spoken}: indisponível, ${say(project, wt, lineState(project, wt))}; troque para outra worktree do projeto antes` : `Editar ${spoken}`,
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

const PARALLEL_ICON = "M5.5 3v10M10.5 3v10";

/** Liga ou desliga o modo paralelo do projeto (grava no config). */
async function toggleParallel(project: string) {
  if (stopping.has(project)) return headerNote(false, project, "Troca em andamento · espere ela terminar");
  const on = !isParallel(project);
  // Com várias de pé, desligar para as outras: pede confirmação.
  if (!on && liveWts(project).length > 1) return confirmParallelOff(project);
  try {
    await invoke("set_parallel", { project, on });
  } catch (e) {
    return headerNote(true, project, "Não gravei o modo paralelo", el("span", { className: "why", textContent: `· ${e}`, title: String(e) }));
  }
  await refresh();
  headerNote(false, project, on ? "Modo paralelo ligado · as worktrees sobem juntas" : "Modo paralelo desligado");
}

function confirmParallelOff(project: string) {
  headerNote(false, project, "Pare as outras worktrees antes de desligar o modo paralelo");
}

// Projetos recolhidos no painel; lembrados entre sessões.
const collapsed = new Set<string>(load<string[]>("collapsed", []));
const CHEVRON = "M6 4l4 4-4 4";

// Detalhes de erro abertos: o painel é recriado quando muda e eles não podem fechar sob a leitura.
const openProblems = new Set<string>();
// Último painel montado: igual, não troca os nós (um clique entre mousedown e mouseup cairia num nó descartado).
let boardHtml: string[] = [];

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
    const par = el(
      "button",
      {
        type: "button",
        className: "icon-btn parallel",
        title: `Modo paralelo em ${p.name}: ${p.parallel ? "ligado, as worktrees sobem juntas" : "desligado, abrir uma encerra a outra"}`,
        ariaLabel: `Modo paralelo em ${p.name}`,
        onclick: () => toggleParallel(p.name),
      },
      icon(PARALLEL_ICON),
    );
    par.setAttribute("aria-pressed", String(p.parallel));
    par.dataset.key = `parallel:${p.name}`;
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
    // Em paralelo, recolhido mostra todas as de pé.
    const shownWts = open ? p.worktrees : p.worktrees.filter((wt) => wt.id === active[p.name] || key(p.name, wt.id) === currentKey() || (p.parallel && isLive(p.name, wt)));
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
      // o "+6" é para o olho; o leitor de tela ouve ", 6 ocultas" (os dois juntos falavam a contagem duas vezes)
      hidden ? el("span", { className: "count", textContent: `+${hidden}`, ariaHidden: "true" }) : null,
      hidden ? el("span", { className: "sr", textContent: `, ${hidden} ocultas` }) : null,
    );
    fold.setAttribute("aria-expanded", String(open));
    fold.dataset.key = `fold:${p.name}`;
    // Ordem do git, fixa: como num painel de partidas, só a palheta vira; a linha não sai do lugar sob o cursor.
    return el(
      "section",
      { className: `platform${open ? "" : " folded"}${p.parallel ? " parallel" : ""}` },
      el("div", { className: "platform-head" }, el("h2", {}, fold), par, add),
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
  // Sem projeto: só a placa em branco. A explicação e a ação ficam no centro da janela; uma linha
  // "Nenhuma worktree ainda" aqui repetia o que o centro já diz.
  if (!config.projects.length)
    sections.push(
      el(
        "section",
        { className: "platform ghost" },
        el("div", { className: "platform-head" }, el("h2", {}, el("span", { className: "tile", textContent: "Sem projeto" }))),
      ),
    );
  $("#sidebar-foot").hidden = !config.projects.length;
  const html = sections.map((s) => s.outerHTML);
  if (html.join("") === boardHtml.join("")) return;
  // Só a plataforma que mudou é recriada: recriar todas reiniciava o atraso da prévia ENCERRA sob o cursor
  // quando a palheta de outro projeto virava, e RODANDO piscava de volta.
  if (html.length === boardHtml.length) html.forEach((h, i) => h !== boardHtml[i] && board.children[i].replaceWith(sections[i]));
  else board.replaceChildren(...sections);
  boardHtml = html;
  for (const l of board.querySelectorAll<HTMLElement>(".line")) l.tabIndex = -1;
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

// Mede o texto truncado sem reflow (fitBranches).
const measure = document.createElement("canvas").getContext("2d")!;

/** O nome trunca no meio primeiro e o prefixo ("feat/") fica: o tipo da branch costuma ser o que mais importa nela.
 *  Só quando nem o começo do nome cabe ao lado dele o prefixo sai inteiro, em vez de virar "f." com cara de abreviação.
 *  Decide por linha (uma branch longa não tira o prefixo das vizinhas). Mede todas antes de escrever: um reflow só. */
function fitBranches() {
  const branches = [...board.querySelectorAll<HTMLElement>(".line .branch")];
  const rests = branches.map((b) => b.lastElementChild as HTMLElement);
  branches.forEach((b, i) => {
    b.classList.remove("tight");
    rests[i].textContent = rests[i].dataset.full!;
  });
  const sizes = rests.map((r) => {
    const css = getComputedStyle(r);
    return {
      // com subpixel (textWidth): os inteiros deixavam a reticência do CSS cortar o fim
      avail: r.getBoundingClientRect().width,
      need: textWidth(r),
      prefix: (r.previousElementSibling as HTMLElement).offsetWidth,
      // o shorthand css.font volta vazio com font-variant-numeric definido
      font: `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`,
      em: parseFloat(css.fontSize),
    };
  });
  branches.forEach((b, i) => {
    const { need, prefix, font, em } = sizes[i];
    let { avail } = sizes[i];
    if (need <= avail) return;
    measure.font = font;
    // ponytail: o canvas ignora tabular-nums; 2px de folga, e o text-overflow do CSS segura o resto
    const w = (s: string) => measure.measureText(s).width + 2;
    const full = rests[i].dataset.full!;
    // O começo do nome ficaria com menos de 3em ao lado do prefixo: o prefixo sai.
    if (prefix && avail - w(`…${nameTail(full)}`) < 3 * em) {
      b.classList.add("tight");
      avail += prefix;
    }
    rests[i].textContent = middleCut(full, avail, w);
  });
}
new ResizeObserver(fitBranches).observe(board);

// Último conteúdo de #running: igual, não troca os nós (o foco ficaria no body, como nas abas).
let runningHtml = "";

/** Com o painel recolhido, o cabeçalho mostra o que roda nos outros projetos. */
function runningOthers() {
  return config.projects.flatMap((p) => {
    // Em paralelo, todas as de pé do projeto (também do atual); senão, a ativa de cada outro projeto.
    const wts = p.parallel ? p.worktrees.filter((w) => isLive(p.name, w)) : p.name !== current?.project ? p.worktrees.filter((w) => w.id === active[p.name]) : [];
    return wts.filter((w) => key(p.name, w.id) !== currentKey()).map((wt) => ({ p, wt }));
  });
}

function renderRunning() {
  const buttons = runningOthers()
    .flatMap(({ p, wt }) => {
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
        flap(state, `run:${key(p.name, wt.id)}`, flapText(p.name, wt, state)),
      );
      b.dataset.key = key(p.name, wt.id);
      return [b];
    });
  // Outros projetos com falha (SEM API/FRONT): os que não couberem na faixa marcam o botão do painel (fitHeader).
  toggleBtn.dataset.failing = [...new Set(runningOthers().filter(({ p, wt }) => lineState(p.name, wt) === "part").map(({ p }) => p.name))].join("\u0000");
  const html = buttons.map((b) => b.outerHTML).join("");
  if (html === runningHtml) return;
  runningHtml = html;
  // Mudou com o foco num deles: o foco volta para o mesmo projeto, se ele ainda estiver lá.
  const focused = runningEl.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined;
  runningEl.replaceChildren(...buttons);
  if (focused) buttons.find((b) => b.dataset.key === focused)?.focus();
}

/** Piso da branch em serviço na faixa: o nome inteiro ou, se for longo, uns 17 caracteres. */
const BRANCH_FLOOR = 160;
/** Abaixo disso o projeto sai do destino: a placa do painel ou a paleta dizem qual é; a branch é o que está em serviço.
 *  Com 48px, a 480 ficava "INTERNO /" inteiro ao lado de "fe…leilao". */
const BRANCH_MIN = 112;

/** A faixa é CSS (#flow em styles.css): o destino tem um piso (projeto, a branch até BRANCH_FLOOR e a palheta) e, acima
 *  dele, os acessórios vêm antes do resto da branch. O que não cabe quebra para uma segunda linha do #flow, fora da
 *  faixa, de trás para a frente: o recado (que só fica se a branch couber inteira), os outros projetos, "Parar tudo",
 *  "Parar API" e por último a porta. Antes,
 *  ~15 degraus medidos em JS decidiam isso, e cada regressão de largura saía de uma medida errada.
 *  Aqui só o que o CSS não sabe: o piso (depende do texto), a largura que o #flow usa de fato (o vão do que quebrou volta
 *  para a branch), quem quebrou (fica inert e entra no ⋯), o sufixo do par e o projeto que saem do destino, e o corte no meio. */
/** Mede o cabeçalho folgado e, se Parar API ou Parar tudo (ou o lugar deles numa troca) não couber, apertado (.tight:
 *  vãos de 8px e, com o painel ao lado, sem o projeto no destino). Pela necessidade: um corte fixo em 800px fazia a
 *  branch truncar a 830 e voltar inteira a 860, com as ações indo para o ⋯ com mais largura. */
function fitHeader() {
  if (frozen) {
    headerEl.classList.toggle("tight", frozen.tight);
    return fitHeaderOnce();
  }
  headerEl.classList.remove("tight");
  fitHeaderOnce();
  if (![haltTabEl, haltAllEl].some((a) => !a.hidden && ceded(a))) return;
  headerEl.classList.add("tight");
  fitHeaderOnce();
  // "Subir API" com o lado parado à mão é a única ação útil: ela fica antes do piso da branch (a 720 ia para o ⋯).
  if (!haltTabEl.hidden && haltTabEl.dataset.label?.startsWith("Subir") && ceded(haltTabEl)) {
    branchFloor = BRANCH_MIN;
    fitHeaderOnce();
    branchFloor = BRANCH_FLOOR;
  }
}

let branchFloor = BRANCH_FLOOR;

function fitHeaderOnce() {
  destEl.classList.remove("bare", "no-project");
  const branch = destEl.querySelector<HTMLElement>(".branch-name");
  // O nome inteiro antes de medir: cutDest o trunca no meio no fim.
  const nameNode = branch?.firstChild instanceof Text ? branch.firstChild : null;
  if (nameNode) nameNode.data = branch!.dataset.full ??= nameNode.data;
  // O #flow com toda a largura que pede: o que não cabe quebra. O ⋯ fica com uma worktree em serviço (Abrir no editor);
  // sem ela, entra quando algo quebrou, e ele mesmo ocupa largura.
  flowEl.style.removeProperty("--flow-w");
  moreBtn.hidden = !current;
  lastStopEl.classList.remove("out", "short");
  lastStopEl.removeAttribute("title");
  if (branch) {
    const project = destEl.querySelector<HTMLElement>(".project")!;
    // Meia tela com o painel aberto ao lado, o projeto não está no destino (CSS): a placa do painel já diz qual é.
    let head = 0;
    if (project.offsetParent) {
      const sep = getComputedStyle(destEl.querySelector(".sep")!);
      // Projeto de até 8 letras não trunca; o longo, até "INT…" (2.5em, o min-width do CSS).
      head = (project.classList.contains("short") ? project.scrollWidth : Math.min(project.scrollWidth, 2.5 * parseFloat(getComputedStyle(project).fontSize))) + parseFloat(sep.width) + parseFloat(sep.marginLeft) + parseFloat(sep.marginRight);
    }
    const flapEl = destEl.querySelector<HTMLElement>(".flap")!;
    const tail = parseFloat(getComputedStyle(destEl).columnGap) + flapEl.offsetWidth;
    // O que a palheta tem além da largura de RODANDO (ela guarda a de FRONT PARADO em todos os estados) tira do piso da
    // branch, não das ações: a 960, "Parar tudo" ia para o ⋯.
    const wider = Math.max(0, flapEl.offsetWidth - parseFloat(getComputedStyle(flapEl).minWidth));
    const floor = (b: number) => destEl.style.setProperty("--floor", `${Math.ceil(head + b + tail)}px`);
    // O recado de rotina ("Parou à força em 5,7 s · …") só fica na faixa se a branch em serviço couber inteira ao lado
    // dele: ele encolhia a branch recém-trocada por 8 s, e a verdade da tela cedia ao fecho. Sem espaço, primeiro sai o
    // nome da anterior (que já está INATIVA no painel; fica no title e no leitor de tela), depois ele vai para o canto
    // do terminal. Inteiro ou para o canto, a 1440 ele quase nunca ficava, com 235px livres.
    if (lastStopEl.childElementCount) {
      floor(textWidth(branch));
      if (ceded(lastStopEl) && lastStopEl.querySelector(".who")) {
        lastStopEl.classList.add("short");
        lastStopEl.title = noteText(lastStopEl);
      }
      lastStopEl.classList.toggle("out", ceded(lastStopEl));
    }
    floor(Math.min(textWidth(branch), branchFloor - wider));
  }
  if (cededActions().length || cededOthers().length) moreBtn.hidden = false;
  // A largura que o que ficou usa de fato: o vão deixado pelo que quebrou volta para a branch (a 600 sobravam 89px
  // vazios ao lado de uma branch truncada). Sem a margem automática que empurra os outros projetos para a direita.
  const items = [...flowEl.querySelectorAll<HTMLElement>(":scope > a, .halt, #running > .other, #last-stop")];
  const setFlowW = () => {
    flowEl.classList.add("measuring");
    const used = Math.max(0, ...items.filter((i) => i.offsetWidth && !ceded(i)).map((i) => i.offsetLeft + i.offsetWidth));
    flowEl.classList.remove("measuring");
    flowEl.style.setProperty("--flow-w", `${Math.ceil(used + parseFloat(getComputedStyle(flowEl).paddingRight))}px`);
  };
  setFlowW();
  // O recado cede antes do projeto do destino: inteiro por pouco, ele espremia o destino abaixo do piso (a 960
  // recolhido, 156px de 229) e o "INTERNO /" saía com o recado de 8 s ao lado.
  const squeezed = () => !!branch && branch.getBoundingClientRect().width < Math.min(textWidth(branch), BRANCH_MIN);
  while (squeezed() && lastStopEl.childElementCount && !lastStopEl.classList.contains("out")) {
    if (!lastStopEl.classList.contains("short") && lastStopEl.querySelector(".who")) {
      lastStopEl.classList.add("short");
      lastStopEl.title = noteText(lastStopEl);
    } else lastStopEl.classList.add("out");
    setFlowW();
  }

  // O sufixo do par ("feature-api ⇄ feature-app") é o primeiro a sair: o nome em comum é o que diz a worktree.
  if (branch?.querySelector(".pair-pre") && overflows(branch)) destEl.classList.add("bare");
  // Nem o piso mínimo da branch: o projeto e a "/" saem do destino (a 640px, com o painel acoplado em 200px, sobrava "INTERNO / …").
  if (frozen ? frozen.noProject : squeezed()) destEl.classList.add("no-project");
  cutDest(branch, nameNode);
  cutBack();

  // Quem não coube sai do Tab e do leitor de tela (o ⋯ oferece as ações); o recado não: é região viva e continua falando,
  // e a cópia dele vai para o canto do terminal. O primeiro da linha que passaria da borda some inteiro (`.cut`):
  // a porta pela metade, ou outro projeto com a palheta cortada.
  for (const i of items) {
    const gone = ceded(i);
    i.classList.toggle("cut", gone && i.offsetTop <= flowEl.clientHeight / 2);
    if (i !== lastStopEl) i.inert = gone || i.classList.contains("hold");
  }
  moreBtn.hidden = !current && !cededActions().length && !cededOthers().length;
  alertEl.classList.toggle("recover", haltTabEl.inert && !haltTabEl.hidden);

  // Falha em outro projeto que a faixa não mostra (quebrou, painel fechado): o botão do painel leva um quadrado
  // vermelho e "falha em PROJETO" no nome. Com o painel aberto ao lado, o painel já mostra.
  const open = !document.body.classList.contains("sidebar-off");
  const shown = items.filter((b) => b.classList.contains("other") && !b.inert && b.offsetParent).map((b) => b.dataset.key);
  const failing = toggleBtn.dataset.failing ? toggleBtn.dataset.failing.split("\u0000") : [];
  toggleBtn.dataset.alert = open ? "" : failing.filter((p) => !shown.includes(p)).map((p) => p.toUpperCase()).join(", ");
  labelToggle();
  renderTermNote();
}

/** O terminal onde o recado fica: o da aba aberta da worktree atual. */
function notePane() {
  const env = current ? envs.get(currentKey()!) : undefined;
  return env && (env.panes[tab] ?? Object.values(env.panes)[0]);
}

let noteFrame = 0;
/** O recado seguindo a saída: um render por quadro, por mais lotes que cheguem nele. */
function queueTermNote() {
  noteFrame ||= requestAnimationFrame(() => {
    noteFrame = 0;
    renderTermNote();
  });
}

/** Recado no terminal, sem custo de largura na faixa. Na troca, na linha logo abaixo do cursor (escondido) do terminal
 *  travado, onde a primeira tecla iria: no canto de cima, a 1440, ficava longe do olho. Depois, no canto, o "Parou em"
 *  que a faixa estreita cedeu: a meia tela a troca terminava sem fecho. aria-hidden: o #last-stop já falou. */
function renderTermNote() {
  const env = current ? envs.get(currentKey()!) : undefined;
  const st = env && stopping.get(env.project);
  // a conta do notePane, aqui em linha: o TypeScript estreita env a partir dela
  const pane = env && (env.panes[tab] ?? Object.values(env.panes)[0]);
  if (st && pane) {
    // Sem linha abaixo (cursor na última), vai para o canto: na linha do cursor cobriria o prompt.
    const next = pane.el.querySelector(".xterm-rows")?.children[pane.term.buffer.active.cursorY + 1];
    // Lê antes de escrever: a classe e o texto não mexem nas linhas, e a leitura não força outro layout.
    const top = next ? `${next.getBoundingClientRect().top - panesEl.getBoundingClientRect().top}px` : "";
    termNoteEl.classList.toggle("lock", !!next);
    termNoteEl.style.top = top;
    // Depois do Voltar, a que espera é a própria anterior: "Aguardando main parar" no terminal da main.
    const text =
      active[env.project] === st.fromId ? `Reiniciando ${proseName(st.from)} · digitação liberada quando subir` : `Aguardando ${proseName(st.from)} parar · digitação liberada em seguida`;
    if (termNoteEl.textContent !== text) termNoteEl.textContent = text;
    // o texto daqui não é cópia do #last-stop: o canto recopia na próxima vez
    delete termNoteEl.dataset.src;
    termNoteEl.hidden = false;
    return;
  }
  termNoteEl.classList.remove("lock");
  termNoteEl.style.top = "";
  const note = !!pane && !!lastStopEl.childElementCount && ceded(lastStopEl);
  // Parado à mão com "Subir API" no ⋯ (a 720 a faixa não tem lugar para ele): a única ação útil fica escrita no canto.
  const parked = !!pane && !note && !haltTabEl.hidden && haltTabEl.inert && lineState(env.project, current!.wt) === "held";
  termNoteEl.hidden = !note && !parked;
  if (!pane || termNoteEl.hidden) return;
  // Recopia só quando a origem muda: com a saída correndo, isto roda a cada quadro.
  const src = note ? lastStopEl.innerHTML : `${haltTabEl.dataset.label} · Ctrl+Shift+S`;
  if (termNoteEl.dataset.src !== src) {
    termNoteEl.dataset.src = src;
    termNoteEl.replaceChildren(...(note ? [...lastStopEl.children].map((c) => c.cloneNode(true)) : [src]));
  }
  // No canto, na primeira das 4 linhas de cima cuja saída termina antes dele: por cima de uma linha longa do dev
  // server, cobria a saída por 8 s. Nenhuma livre: sai (o leitor de tela já ouviu, e a linha voltou a INATIVA).
  const rows = pane.el.querySelector(".xterm-rows");
  if (!rows) return;
  const box = panesEl.getBoundingClientRect();
  const rowsBox = rows.getBoundingClientRect();
  const cell = rowsBox.width / pane.term.cols;
  const left = box.width - 16 - termNoteEl.offsetWidth;
  const buf = pane.term.buffer.active;
  const free = [0, 1, 2, 3].find((y) => rowsBox.left - box.left + (buf.getLine(buf.viewportY + y)?.translateToString(true).length ?? 0) * cell + 12 < left);
  const row = free === undefined ? null : rows.children[free];
  termNoteEl.hidden = !row;
  if (row) termNoteEl.style.top = `${row.getBoundingClientRect().top - box.top - 3}px`;
}
// A faixa (não o #running, que some e reaparece ao medir) muda de largura com a janela, o zoom e o painel.
new ResizeObserver(fitHeader).observe(headerEl);
// A Barlow chega depois do primeiro render e alarga os nomes sem mudar a largura da faixa.
document.fonts.addEventListener("loadingdone", () => {
  fitBranches();
  fitHeader();
});

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
  void readGit();
  // Worktree que sumiu (git worktree remove): mata os PTYs dela. Projeto com erro de git fica intacto.
  for (const [k, env] of envs) if (loaded.has(env.project) && !alive.has(k)) disposeEnv(k, env);
  for (const p of loaded) if (active[p] && !alive.has(key(p, active[p]))) delete active[p];
  saveActive();
  for (const k of Object.keys(savedPorts)) if (loaded.has(k.split("\u0000")[0]) && !alive.has(k)) delete savedPorts[k];
  save("ports", savedPorts);

  if (current) {
    const freshWt = alive.get(currentKey()!);
    if (freshWt) current.wt = freshWt;
    else if (loaded.has(current.project)) current = null;
  }
  render();
}

let gitRead = 0;

/** `git status` de todas as pastas, em paralelo no backend. Sem esperar: o painel aparece com a leitura anterior e o
 *  marcador entra quando ela chega. Só a última leitura vale (focos seguidos disparam várias). */
async function readGit() {
  const n = ++gitRead;
  const paths = config.projects.flatMap((p) => p.worktrees.flatMap((wt) => TABS.flatMap((t) => (wt[t] ? [wt[t]!.path] : []))));
  const res = await invoke<(GitState | null)[]>("git_status", { paths }).catch(() => null);
  if (!res || n !== gitRead) return;
  gitStates = new Map(paths.flatMap((p, i) => (res[i] ? [[p, res[i]!] as const] : [])));
  render();
}

// Lados que estavam de pé em cada worktree na última consulta: um que some sem troca é queda.
const wasUp = new Map<string, Tab[]>();

/** Queda de um lado vira recado no cabeçalho, que é região viva: só a palheta mudar não chega ao leitor de tela,
 *  e com o painel fechado nem aos olhos. A atual também: olhando a aba da API, o Front caído era só um ponto de 6px. */
function announceDrops() {
  for (const [k, env] of envs) {
    const [project, id] = k.split("\u0000");
    // Parando por uma troca: lado que some não é queda.
    if (stopping.get(project)?.fromId === id) {
      wasUp.delete(k);
      continue;
    }
    // Subindo: lado que ainda não veio não é queda, mas o que já subiu conta. Apagado aqui, a consulta em que o
    // start terminava zerava a memória, e um Front que caía 300 ms depois do RODANDO não dava recado nenhum.
    if (starting.has(k)) {
      wasUp.set(k, sides(k).up);
      continue;
    }
    const { up } = sides(k);
    // Parado pelo botão não é queda.
    const lost = (wasUp.get(k) ?? []).filter((t) => !up.includes(t) && !halted.has(env.panes[t]!.ptyId));
    wasUp.set(k, up);
    const wt = findWt(project, id);
    if (!lost.length || !wt) continue;
    const what = `${lost.map((t) => TAB_LABEL[t]).join(" e ")} ${lost.length > 1 ? "caíram" : "caiu"}`;
    const why = errorWhy(project, id, lost[0]);
    headerNote(true, project, what, noteWho(project, id, wt.label), why, upHere(project, id, lost), seeTerminal(project, id, lost[0]));
    notifyAway(project, wt.label, what, why);
  }
}

/** Falha com a janela na bandeja ou sem foco: notificação do sistema com o texto da segunda faixa. Uma por falha, como
 *  o recado: announceDrops e o fim do SUBINDO disparam uma vez por evento, não a cada consulta. */
function notifyAway(project: string, label: string, what: string, why: HTMLElement | null) {
  if (!document.hidden && document.hasFocus()) return;
  invoke("notify", { summary: `${what} · ${project} / ${label}`, body: why?.title ?? "" });
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
  // No SUBINDO, o lado de pé com porta conhecida só sobe quando ela aceita conexão em localhost (ports_open: em paralelo,
  // 150 ms no máximo, fora da thread principal; o pty_status já respondeu). Só consulta enquanto algo sobe.
  const probing = [...starting.keys()].flatMap(k => Object.values(envs.get(k)?.panes ?? {})).filter(p => busy.has(p.ptyId) && p.port !== null);
  const ports = [...new Set(probing.map(p => p.port!))];
  const answers = ports.length ? await invoke<boolean[]>("ports_open", { ports }).catch(() => []) : [];
  const open = new Set(ports.filter((_, i) => answers[i]));
  for (const [k, t] of starting) {
    // Start enviado: vira RODANDO quando todos os lados sobem (e atendem, com porta conhecida), ou desiste depois de 15 s
    // e diz quem ficou para trás. Aí a palheta segue o processo: o de pé que não respondeu fica RODANDO, com o recado.
    const { up, down } = sides(k);
    const panes = envs.get(k)?.panes ?? {};
    const deaf = deafSides(up.map(s => ({ tab: s, port: panes[s]!.port })), open);
    const end = startEnd(down.length, deaf.length, Date.now() - t);
    if (end === "subindo") continue;
    starting.delete(k);
    changed = true;
    const [project, id] = k.split("\u0000");
    const wt = findWt(project, id);
    if (!wt) continue;
    if (end === "rodando") {
      // Subiu numa porta que não é a atribuída: o projeto ignorou a variável (-p fixo no script, override do .env).
      const off = Object.values(panes).find((p) => portMismatch(p.assigned, p.port));
      if (off) {
        const what = `${TAB_LABEL[off.tab]} subiu na ${off.port}, não na ${off.assigned}`;
        const why = el("span", { className: "why", textContent: "· confira o parallelEnv", title: `O parallelEnv ${off.tab === "api" ? "da API" : "do Front"} precisa da variável que o servidor lê para a porta.` });
        headerNote(true, project, what, noteWho(project, id, wt.label), why, seeTerminal(project, id, off.tab));
        notifyAway(project, wt.label, what, why);
      }
      continue;
    }
    const what = lateText(down.map(s => TAB_LABEL[s]), deaf.map(s => ({ name: TAB_LABEL[s], port: panes[s]!.port! })));
    const late = down[0] ?? deaf[0];
    const why = errorWhy(project, id, late);
    headerNote(true, project, what, noteWho(project, id, wt.label), why, down.length ? upHere(project, id, down) : null, seeTerminal(project, id, late));
    notifyAway(project, wt.label, what, why);
  }
  if (changed) render();
}

// ---------- paleta ----------

type Item = { project: string; wt: Worktree };
let items: Item[] = [];
let sel = 0;

/** Destaca (em negrito, sem cor nova) onde os termos casam no texto visível de `root`, sem o que é só do leitor de tela:
 *  a paleta diz por que cada item entrou. Só os termos que casam em `source` (o projeto ou o rótulo cru): um termo que
 *  casou no projeto não acende letras soltas na branch. */
function markHits(root: HTMLElement, terms: string[], source: string, other: string) {
  const nodes: Text[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(".sr, .tag") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  while (walk.nextNode()) nodes.push(walk.currentNode as Text);
  const text = nodes.map((n) => n.data).join("").toLowerCase();
  // A subsequência só acende quando o termo não casou como trecho em nenhum dos dois campos: "int" achado em INTERNO
  // acendia i…n…t espalhados em "login-timeout".
  const hits = new Set(terms.filter((t) => source.includes(t) || (!other.includes(t) && matchAt(t, source))).flatMap((t) => matchAt(t, text) ?? []));
  if (!hits.size) return;
  let off = 0;
  for (const n of nodes) {
    const start = off;
    off += n.data.length;
    if (![...hits].some((i) => i >= start && i < off)) continue;
    const parts: (Node | string)[] = [];
    let run = "";
    let hit = false;
    const flush = () => {
      if (run) parts.push(hit ? el("b", { className: "hit", textContent: run }) : run);
      run = "";
    };
    for (let i = 0; i < n.data.length; i++) {
      if (hits.has(start + i) !== hit) {
        flush();
        hit = !hit;
      }
      run += n.data[i];
    }
    flush();
    n.replaceWith(...parts);
  }
}

/** `reset`: seleção no primeiro item que não é a atual. Ao abrir é a anterior (como no Alt+Tab, Ctrl+Shift+K e Enter voltam
 *  para ela); digitando, a atual (a mais recente) ganhava o desempate e o Enter nela não fazia nada. */
function renderPalette(reset = false) {
  const terms = paletteInput.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const recency = (it: Item) => {
    const r = recent.indexOf(key(it.project, it.wt.id));
    return r < 0 ? Infinity : r;
  };
  // Trecho inteiro no começo de uma palavra > trecho inteiro > subsequência (o pior termo decide); empate, o projeto que um
  // termo começa ("lei agr" no LEILAO: o Enter no INTERNO matava o servidor errado), depois a mais recente.
  const quality = (it: Item) => {
    const text = `${it.project} ${it.wt.label}`.toLowerCase();
    return Math.max(
      0,
      ...terms.map((q) => {
        const at = text.indexOf(q);
        return at < 0 ? 2 : at === 0 || /[\s/_.-]/.test(text[at - 1]) ? 0 : 1;
      }),
    );
  };
  items = config.projects
    .flatMap((p) => p.worktrees.map((wt) => ({ project: p.name, wt })))
    .filter((it) => matchItem(terms, it.project.toLowerCase(), it.wt.label.toLowerCase()))
    .sort((a, b) => quality(a) - quality(b) || projectTerms(terms, b.project.toLowerCase()) - projectTerms(terms, a.project.toLowerCase()) || recency(a) - recency(b));
  // Subsequência só quando nada casa como trecho: "log" achando l…o…g espalhados em "calculo-…-agrupados" era ruído.
  if (items.length && quality(items[0]) < 2) items = items.filter((it) => quality(it) < 2);
  if (reset) sel = items.length > 1 && currentKey() === key(items[0].project, items[0].wt.id) ? 1 : 0;
  sel = Math.min(sel, Math.max(items.length - 1, 0));
  paletteList.replaceChildren(
    ...(items.length
      ? items.map((it, i) => {
          const state = lineState(it.project, it.wt);
          const isCurrent = currentKey() === key(it.project, it.wt.id);
          const label = el("span", { className: "label" }, ...labelNodes(it.wt.label), soloTag(it.wt), isCurrent ? el("span", { className: "tag", textContent: "ATUAL" }) : null);
          const project = el("span", { className: "project", textContent: it.project });
          markHits(label, terms, it.wt.label.toLowerCase(), it.project.toLowerCase());
          markHits(project, terms, it.project.toLowerCase(), it.wt.label.toLowerCase());
          const li = el("li", { id: `opt-${i}`, onclick: () => choose(it) }, label, project, flap(state, `pal:${key(it.project, it.wt.id)}`, flapText(it.project, it.wt, state)));
          // Nome falado inteiro, com pausas e o lado: os spans juntos liam "hotfix/loginATUAL interno : rodando".
          // O que o Enter mata também na opção: a prévia ENCERRA é visual, e o rodapé só fala quando muda.
          const kills = wouldStop(it.project, it.wt.id);
          li.setAttribute("aria-label", `${spokenLabel(it.wt.label)}${isCurrent ? ", atual" : ""}${soloSay(it.wt)}, ${it.project}: ${say(it.project, it.wt, state)}${kills ? `; encerra ${spokenLabel(kills.label)}` : ""}`);
          // Tinta cheia só no que está em serviço (rodando, em movimento, a atual), como no painel.
          if (LIVE.includes(state) || isCurrent) li.classList.add("live");
          li.setAttribute("role", "option");
          li.setAttribute("aria-selected", String(i === sel));
          return li;
        })
      : [
          el("li", {
            className: "none",
            textContent: terms.length
              ? `Nenhuma worktree corresponde a "${paletteInput.value.trim()}".`
              : config.projects.length
                ? "Nenhuma worktree ainda."
                : "Nenhum projeto ainda: Enter cria o primeiro.",
          }),
        ]),
  );
  // Sem projeto, o Enter não tem o que trocar: cria o projeto, e o rodapé diz isso. Na atual ("int log" achando só ela),
  // o Enter só fecha a paleta: "trocar" prometia uma troca que não vem.
  const onCurrent = !!items[sel] && currentKey() === key(items[sel].project, items[sel].wt.id);
  // Ativa de outro projeto: o Enter só leva até ela, não troca nada.
  // Em paralelo, a de pé só é mostrada, e a parada sobe junto, sem encerrar nada.
  const par = !!items[sel] && isParallel(items[sel].project);
  const onActive = !!items[sel] && (active[items[sel].project] === items[sel].wt.id || (par && isLive(items[sel].project, items[sel].wt)));
  paletteEnter.textContent = !config.projects.length ? "criar projeto" : onCurrent ? "já é a atual" : onActive ? "ir para" : par ? "subir junto" : "trocar";
  paletteInput.placeholder = config.projects.length ? "Trocar de worktree…" : "Sem projeto: Enter cria o primeiro";
  // Busca sem resultado: o Enter não faz nada, e o rodapé não promete.
  paletteEnter.hidden = (paletteEnter.previousElementSibling as HTMLElement).hidden = !items.length && !!config.projects.length;
  // A troca é destrutiva: diz o que o Enter vai encerrar.
  const it = items[sel];
  const ends = it && wouldStop(it.project, it.wt.id);
  paletteNote.hidden = !ends;
  // Região viva: só reescreve quando muda; a cada tecla e seta ela repetia "Encerra main (node) em interno".
  const noteSig = ends ? `${it.project}\u0000${ends.id}\u0000${procs(it.project, ends).join()}` : "";
  if (paletteNote.dataset.sig !== noteSig) {
    paletteNote.dataset.sig = noteSig;
    paletteNote.replaceChildren(...(ends ? endsNote(ends, it.project) : []));
  }
  if (items.length) paletteInput.setAttribute("aria-activedescendant", `opt-${sel}`);
  else paletteInput.removeAttribute("aria-activedescendant");
  paletteList.children[sel]?.scrollIntoView({ block: "nearest" });
}

/** Caminho com ponto de quebra depois de cada "/": quebrava no meio da palavra ("…agrupad / os"). */
function pathNodes(path: string): (Node | string)[] {
  return path.split("/").flatMap((part, i) => (i ? [document.createElement("wbr"), `/${part}`] : [part]));
}

/** "[ENCERRA] feat/x (npm run dev) em INTERNO": a mesma prévia do painel, e diz o que mata. A palheta já é o verbo.
 *  Ainda não está parando, então a palheta não diz PARANDO. */
function endsNote(wt: Worktree, project: string, inPalette = true): (Node | string)[] {
  const names = procs(project, wt);
  // O texto num span só: solto no flex, cada pedaço viraria um item e os espaços sumiriam.
  const preview = flap("stop", "ends", "ENCERRA");
  preview.classList.add("preview");
  return [
    preview,
    el(
      "span",
      { className: "ends-text" },
      // A palheta ENCERRA é aria-hidden: sem o verbo, a região viva lia "main (node) em leilao".
      el("span", { className: "sr", textContent: "Encerra " }),
      el("strong", {}, ...labelNodes(wt.label)),
      ...(names.length ? [" ", el("span", { className: "procs", textContent: `(${names.join(", ")})` })] : []),
      ...(inPalette ? [" em ", el("span", { className: "project", textContent: project })] : [", que está rodando."]),
    ),
  ];
}

function openPalette() {
  palette.hidden = false;
  paletteInput.value = "";
  renderPalette(true);
  paletteInput.focus();
  refresh().then(() => renderPalette());
}

function closePalette() {
  palette.hidden = true;
  render(true);
}

function choose(it: Item | undefined) {
  palette.hidden = true;
  if (it) select(it.project, it.wt);
  else if (!config.projects.length) openProjectDialog();
  else render(true);
}

paletteInput.addEventListener("input", () => renderPalette(true));
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
  if (raw.includes("couldn't find remote ref")) return { field: "branch", text: "Essa branch não existe mais no origin." };
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
const prRow = addForm.querySelector<HTMLElement>(".pr-row")!;
const prSel = field<HTMLSelectElement>("pr");
const prHint = $("#pr-hint");
let defaultsReq = 0;
/** PRs abertas do projeto do diálogo; o valor de cada opção do "Da PR" é o índice aqui. */
let prs: PrEntry[] = [];
/** Número da PR aberta neste lado com a branch do campo (escolhida no "Da PR" ou digitada): ela é buscada antes de criar. */
const prNumber = (t: Tab) => prs.find((p) => !p.fork && p.branch === branchInput.value.trim())?.sides[t];

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
  loadPrs(req);
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

/** PRs abertas da API e do Front, juntas pela branch. Sem gh instalado ou logado, o campo some (como os de GitHub do Novo projeto);
 *  outro erro fica numa linha embaixo, com a saída crua no detalhe. Não segura o diálogo: a lista chega quando o gh responde. */
async function loadPrs(req: number) {
  prs = [];
  prSel.replaceChildren(el("option", { value: "", textContent: "Carregando as PRs abertas…" }));
  prSel.disabled = true;
  prHint.hidden = true;
  type Lists = Record<Tab, { Ok: GhPr[] } | { Err: string }>;
  let got: Lists;
  try {
    got = await invoke<Lists>("pull_requests", { project: projectSel.value });
  } catch (err) {
    got = { api: { Err: String(err) }, front: { Err: String(err) } };
  }
  if (req !== defaultsReq) return; // trocou de projeto ou reabriu no meio
  const errs = TABS.flatMap((t) => { const r = got[t]; return "Err" in r ? [{ t, err: r.Err }] : []; });
  // Enquanto carrega, o campo fica como a última resposta o deixou: sem gh, não pisca a cada abertura.
  prRow.hidden = errs.some((e) => /^(Instale|Entre no GitHub)/.test(e.err));
  if (prRow.hidden) return;
  prs = mergePrs(Object.fromEntries(TABS.flatMap((t) => { const r = got[t]; return "Ok" in r ? [[t, r.Ok]] : []; })));
  prSel.replaceChildren(
    el("option", { value: "", textContent: prs.length ? "Nenhuma" : "Nenhuma PR aberta" }),
    ...prs.map((p, i) => el("option", { value: String(i), textContent: prLabel(p), disabled: p.fork })),
  );
  // Depois de um erro parcial a branch fica travada: a PR também.
  prSel.disabled = !prs.length || branchInput.readOnly;
  if (errs.length) {
    const who = errs.map((e) => (e.t === "api" ? "da API" : "do Front")).join(" e ");
    prHint.replaceChildren(`Não consegui listar as PRs ${who}.`, el("details", {}, el("summary", { textContent: "Detalhe" }), ...errs.map((e) => el("code", { textContent: e.err }))));
    prHint.hidden = false;
  }
  syncSides();
}

/** Escolher a PR preenche a branch e marca os lados que têm a branch dela. */
prSel.addEventListener("change", () => {
  const p = prs[Number(prSel.value)];
  if (!prSel.value || !p) return;
  branchInput.value = p.branch;
  for (const t of TABS) if (!sideCheck(t).disabled) sideCheck(t).checked = !!p.sides[t];
});

/** Lado desmarcado: fieldset desabilitado (o checkbox da legend continua clicável) e sem validação. */
function syncSides() {
  // A branch digitada deixou de ser a da PR escolhida: o "Da PR" volta a Nenhuma.
  if (prSel.value && prs[Number(prSel.value)]?.branch !== branchInput.value.trim()) prSel.value = "";
  const branch = branchInput.value.trim() || "<branch>";
  const ends = openNow.checked ? wouldStop(projectSel.value, null) : undefined;
  openHint.hidden = !ends;
  openHint.replaceChildren(...(ends ? endsNote(ends, projectSel.value, false) : []));
  for (const t of TABS) {
    sideBox(t).disabled = !sideCheck(t).checked;
    const dir = sideDir(t).value.trim().replace(/\/+$/, "");
    // Da PR, a origem é a branch dela no origin, não o "A partir de".
    const pr = prNumber(t);
    const base = pr ? `PR #${pr}` : sideBase(t).value;
    sideBox(t)
      .querySelector(".preview")!
      .replaceChildren(...(dir ? [...pathNodes(`${dir}/${branch}`), ...(base ? [icon(FROM_ICON, "inline"), base] : [])] : ["Carregando…"]));
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
  const side = (t: Tab) => (sideCheck(t).checked ? { dir: sideDir(t).value, base: sideBase(t).value, fetch: !!prNumber(t) } : null);
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
    if (fe.created.length) branchInput.readOnly = prSel.disabled = true;
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
  // Nunca aberta nesta sessão, não há terminal para fechar.
  editForm.querySelector<HTMLElement>(".closes")!.hidden = !envs.has(key(project, wt.id));
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
      // "padrão do projeto: npm run dev": começando pelo script, parecia valor digitado. Vazio, o prefixo sai (CSS) e o placeholder diz o comando inteiro.
      cmd.placeholder = side.projectStart ? `padrão do projeto: ${side.projectStart}` : "Sem comando: abre só o shell";
      cmd.value = own.script;
      setPm(ePm(t), own.script ? own.pm : project.pm);
      // Renomear é a tarefa comum: o comando fica recolhido, salvo quando é próprio (aí é informação, não opção).
      ePart<HTMLDetailsElement>(t, ".cmd").open = !!own.script;
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
      ePart<HTMLElement>(t, ".has > .preview").replaceChildren(...pathNodes(move.checked ? `${dir}/${nb}` : side.path));
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
      ePart<HTMLElement>(t, ".create > .preview").replaceChildren(...(dir ? [...pathNodes(`${dir}/${nb}`), ...(base ? [icon(FROM_ICON, "inline"), base] : [])] : ["Carregando…"]));
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
  headerNote(false, null, newWt && newWt.label !== wt.label ? `Editada: ${wt.label} → ${newWt.label}` : `Editada: ${wt.label}`);
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

// ---------- portas do modo paralelo ----------

const portsDialog = $<HTMLDialogElement>("#ports-dialog");
const portsForm = portsDialog.querySelector("form")!;
const portsError = $("#ports-error");
const portInput = (t: Tab) => portsForm.elements.namedItem(t) as HTMLInputElement;
const portBox = (t: Tab) => portsForm.querySelector<HTMLFieldSetElement>(`fieldset[data-side="${t}"]`)!;
const portMsg = (t: Tab) => $(`#ports-${t}-error`);
let portsAsk: { project: string; wt: Worktree; def: Ports; taken: Set<number>; resolve: (p: Ports | "cancel") => void } | null = null;

portsForm.querySelector<HTMLButtonElement>(".open-config")!.addEventListener("click", () => invoke("open_config"));

/** Pergunta as portas da worktree que vai subir com outra do projeto de pé. Esc e Cancelar resolvem "cancel". */
function askPorts(project: string, wt: Worktree, proposal: Ports, def: Ports, taken: Set<number>): Promise<Ports | "cancel"> {
  portsAsk?.resolve("cancel");
  return new Promise((resolve) => {
    portsAsk = { project, wt, def, taken, resolve };
    portsForm.querySelector(".where")!.replaceChildren(el("span", { className: "project", textContent: project }), " / ", ...labelNodes(wt.label));
    for (const t of TABS) {
      const has = !!wt[t]?.startCommand;
      portBox(t).hidden = !has;
      portInput(t).value = has && proposal[t] !== null ? String(proposal[t]) : "";
      portBox(t).querySelector(".default")!.textContent = def[t] === null ? "Porta padrão desconhecida: diga em qual sobe." : `Padrão ${def[t]}, tomada por outra worktree ou programa.`;
    }
    portsError.textContent = "";
    clearInvalid(portsForm);
    renderPortVars();
    portsDialog.showModal();
    // O foco no primeiro campo vazio (porta desconhecida), senão no Subir: a proposta costuma bastar.
    const empty = TABS.find((t) => !portBox(t).hidden && !portInput(t).value);
    (empty ? portInput(empty) : portsForm.querySelector<HTMLElement>("button.primary")!).focus();
  });
}

/** Portas digitadas; null no lado sem servidor ou com o campo vazio. */
function typedPorts(): Ports {
  const one = (t: Tab) => (portBox(t).hidden || !portInput(t).value ? null : Number(portInput(t).value));
  return { api: one("api"), front: one("front") };
}

/** O que impede subir cada lado com as portas digitadas, ou "" (sem a checagem de porta ocupada, que é no envio). */
function portProblems(ports: Ports): Record<Tab, string> {
  const { wt, def } = portsAsk!;
  const out: Record<Tab, string> = { api: "", front: "" };
  for (const t of TABS) {
    if (portBox(t).hidden) continue;
    const tpl = wt[t]!.parallelEnv;
    const n = ports[t];
    out[t] =
      templateError(tpl) ??
      (n === null || !Number.isInteger(n) || n < 1024 || n > 65535
        ? "Porta entre 1024 e 65535."
        : t === "front" && n === ports.api
          ? "A mesma porta da API."
          : n !== def[t] && !movesOwnPort(tpl, t)
            ? `Sem variável com {${t}Port} no parallelEnv ${t === "api" ? "da API" : "do Front"}: ele subiria na ${def[t] ?? "padrão"} assim mesmo.`
            : "");
  }
  // O Front de um par precisa saber a API nova; sem {apiPort} ele falaria com a da outra worktree.
  if (!out.front && !portBox("front").hidden && wt.api && ports.api !== def.api && !Object.values(wt.front!.parallelEnv).some((v) => v.includes("{apiPort}")))
    out.front = `O Front falaria com a API na ${def.api ?? "padrão"}: ponha {apiPort} no parallelEnv do Front.`;
  return out;
}

/** As variáveis que cada lado vai receber, como sobem no terminal, e com quem o Front fala. */
function renderPortVars() {
  if (!portsAsk) return;
  const { wt, def } = portsAsk;
  const typed = typedPorts();
  const ports = { api: typed.api ?? def.api, front: typed.front ?? def.front };
  const problems = portProblems(typed);
  for (const t of TABS) {
    if (portBox(t).hidden) continue;
    const vars = Object.entries(fill(wt[t]!.parallelEnv, ports));
    const talks = t === "front" && wt.api && ports.api !== null && Object.values(wt.front!.parallelEnv).some((v) => v.includes("{apiPort}"));
    portBox(t).querySelector(".vars")!.replaceChildren(
      ...(vars.length ? vars.map(([k, v]) => el("code", { textContent: `${k}=${v}` })) : [el("span", { textContent: "Nenhuma variável no parallelEnv." })]),
      ...(talks ? [el("span", { className: "talks", textContent: `Front → API na ${ports.api}` })] : []),
    );
    // Ao digitar, o erro aparece sem roubar o foco; o campo só fica marcado no envio.
    portMsg(t).textContent = problems[t];
  }
}

portsForm.addEventListener("input", renderPortVars);

portsForm.addEventListener("submit", async (e) => {
  if ((e.submitter as HTMLButtonElement | null)?.value !== "ok" || !portsAsk) return;
  e.preventDefault();
  const ask = portsAsk;
  clearInvalid(portsForm);
  const ports = typedPorts();
  const problems = portProblems(ports);
  const bad = TABS.find((t) => problems[t]);
  if (bad) {
    portMsg(bad).textContent = problems[bad];
    return markInvalid(portInput(bad), portMsg(bad));
  }
  // Ocupada agora (outra worktree do app ou outro programa): diz qual e não sobe.
  const open = await portsOpen([ports.api, ports.front]);
  const busyAt = TABS.find((t) => ports[t] !== null && (ask.taken.has(ports[t]!) || open.has(ports[t]!)));
  if (busyAt) {
    const n = ports[busyAt]!;
    const who = runningOthers().find(({ wt }) => TABS.some((t) => envs.get(key(ask.project, wt.id))?.panes[t]?.port === n));
    portMsg(busyAt).textContent = `${n} está ocupada ${who ? `por ${who.p.name.toUpperCase()} / ${who.wt.label}` : "por outro programa"}.`;
    return markInvalid(portInput(busyAt), portMsg(busyAt));
  }
  if (portsAsk !== ask) return;
  savedPorts[key(ask.project, ask.wt.id)] = ports;
  save("ports", savedPorts);
  portsAsk = null;
  portsDialog.close();
  ask.resolve(ports);
});

// Esc, Cancelar ou outro pedido por cima: não sobe nada.
portsDialog.addEventListener("close", () => {
  portsAsk?.resolve("cancel");
  portsAsk = null;
});

// ---------- remover worktree ----------

const removeDialog = $<HTMLDialogElement>("#remove-dialog");
const removeForm = removeDialog.querySelector("form")!;
const removeError = removeDialog.querySelector<HTMLElement>(".error")!;
const removeBranch = removeForm.elements.namedItem("branch") as HTMLInputElement;
const removeOk = removeForm.querySelector<HTMLButtonElement>('button[value="ok"]')!;
const removeCancel = removeForm.querySelector<HTMLButtonElement>('button[value="cancel"]')!;
const removeOpen = editForm.querySelector<HTMLButtonElement>("button.remove")!;

// Por cima do editar (que só abre com a worktree parada): diz as pastas que somem antes de apagar.
removeOpen.addEventListener("click", () => {
  const { project, wt, branches } = editing!;
  const sides = TABS.filter((t) => wt[t]);
  removeForm.querySelector(".where")!.replaceChildren(el("span", { className: "project", textContent: project }), " / ", ...labelNodes(wt.label));
  removeForm.querySelector(".paths")!.replaceChildren(...sides.map((t) => el("p", { className: "preview" }, el("strong", { textContent: `${TAB_LABEL[t]}: ` }), ...pathNodes(wt[t]!.path))));
  removeForm.querySelector<HTMLElement>(".closes")!.hidden = !envs.has(key(project, wt.id));
  removeForm.querySelector(".branch-name")!.textContent = [...new Set(sides.map((t) => branches[t]))].join(" e ");
  removeBranch.checked = false;
  removeError.textContent = "";
  removeOk.disabled = false;
  removeDialog.showModal();
  // Destrutivo: o foco começa no Cancelar, para um Enter de reflexo não apagar nada.
  removeCancel.focus();
});

removeForm.addEventListener("submit", async (e) => {
  if ((e.submitter as HTMLButtonElement | null)?.value !== "ok" || !editing) return;
  e.preventDefault();
  if (isBusy(removeOk)) return;
  const ed = editing;
  const { project, wt } = ed;
  removeError.textContent = "";
  const state = lineState(project, wt);
  if (BUSY.includes(state)) {
    removeError.textContent = `${wt.label}, ${say(project, wt, state)}: troque para outra worktree do projeto antes de remover.`;
    return;
  }
  const side = (t: Tab) => (wt[t] ? { path: wt[t]!.path, branch: ed.branches[t] } : null);
  setBusy(removeOk, "Removendo…");
  let notes: string[];
  try {
    notes = await invoke<string[]>("remove_worktree", { req: { project, api: side("api"), front: side("front"), deleteBranch: removeBranch.checked } });
  } catch (err) {
    const fe = asFormError(err);
    removeError.textContent = fe.side && !fe.created.length ? `${TAB_LABEL[fe.side]}: ${fe.message}` : fe.message;
    // Um lado já saiu: a worktree mudou (virou solo), então não há o que repetir aqui.
    if (fe.created.length) {
      removeCancel.focus();
      removeOk.disabled = true;
      await forgetWorktree(project, wt);
    }
    return;
  } finally {
    clearBusy(removeOk, "Remover");
  }
  await forgetWorktree(project, wt);
  headerNote(false, null, [`Removida: ${wt.label}`, ...notes].join(" · "));
  render();
  removeDialog.close();
});

/** Depois de remover: mata os terminais dela, tira do "ativa" e das recentes e relê o painel sem ela. */
async function forgetWorktree(project: string, wt: Worktree) {
  const k = key(project, wt.id);
  const env = envs.get(k);
  if (env) disposeEnv(k, env);
  fresh.delete(k);
  if (active[project] === wt.id) delete active[project];
  saveActive();
  recent = recent.filter((r) => r !== k);
  save("recent", recent);
  if (currentKey() === k) current = null;
  editing = null;
  editDialog.close();
  await refresh();
}

// Cancelar volta ao editar, no botão que abriu; removida (o editar já fechou), o foco vai para o painel.
removeDialog.addEventListener("close", () => (editDialog.open ? removeOpen.focus() : focusBoard()));

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

/** Repositórios da conta logada no gh viram as sugestões do campo do GitHub; sem gh, uma linha diz o próximo passo.
 *  Com gh, cada lado ganha a escolha "Pasta local | Clonar do GitHub" e mostra um caminho só (o CSS esconde o outro). */
async function loadGithubRepos() {
  ghRepos ??= invoke<GithubRepos>("github_repos");
  try {
    const { login, repos } = await ghRepos;
    ghList.replaceChildren(...repos.map(full => el("option", { value: full })));
    for (const row of projectForm.querySelectorAll<HTMLElement>(".gh-row")) {
      row.hidden = false;
      row.querySelector(".gh-label")!.textContent = `Repositório no GitHub de ${login}`;
    }
    for (const src of projectForm.querySelectorAll<HTMLElement>(".source")) src.hidden = false;
    ghHint.hidden = true;
  } catch (err) {
    ghRepos = null;
    for (const src of projectForm.querySelectorAll<HTMLElement>(".source")) src.hidden = true;
    // O backend já traduz os dois casos comuns (gh ausente, sem login); o resto (saída do gh, erro inesperado) vira
    // um resumo com a saída crua no detalhe, como o erro de git no painel.
    const raw = String(err);
    const known = /^(Instale|Entre no GitHub)/.test(raw);
    // Os dois conhecidos já dizem o que falta e para quê ("Instale o GitHub CLI (gh) para clonar do GitHub."): uma linha só,
    // sem o "não está disponível" na frente, que a quebrava em duas antes de qualquer campo.
    ghHint.replaceChildren(
      known ? raw : "Clonar do GitHub: o gh não respondeu como esperado. Confira com ",
      ...(known
        ? []
        : [el("code", { textContent: "gh auth status" }), " no terminal.", el("details", {}, el("summary", { textContent: "Detalhe" }), el("code", { textContent: raw }))]),
    );
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
    // Clonado, o lado volta para a pasta local: o caminho e as worktrees lidas ficam à vista.
    setSource(t, "local");
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

/** Pasta local ou GitHub, no lado `t`. */
function setSource(t: Tab, src: "local" | "gh") {
  projectForm.querySelector<HTMLInputElement>(`input[name="${t}-source"][value="${src}"]`)!.checked = true;
}

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
  // Repositório vazio com o GitHub escolhido: o erro aparece no campo da pasta, que precisa estar à vista.
  for (const t of TABS) if (!pfield(`${t}-repo`).value.trim()) setSource(t, "local");
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
  if (configError) return headerNote(false, null, "Não consegui reler: o config tem um problema.");
  const after = worktreeNames();
  const added = [...after].filter(([k]) => !before.has(k)).map(([, name]) => name);
  const removed = [...before].filter(([k]) => !after.has(k)).map(([, name]) => name);
  if (!added.length && !removed.length) return headerNote(false, null, "Worktrees relidas: nada mudou.");
  const parts = [
    added.length === 1 ? `nova: ${added[0]}` : added.length ? `${added.length} novas` : "",
    removed.length === 1 ? `saiu: ${removed[0]}` : removed.length ? `${removed.length} saíram` : "",
  ].filter(Boolean);
  headerNote(false, null, `Worktrees relidas: ${parts.join(" · ")}.`);
}

reloadBtn.addEventListener("click", () => reload());

// ---------- barra lateral ----------

const toggleBtn = $("#toggle-sidebar");

/** Nome do botão do painel, com a falha de outro projeto quando houver ("Abrir o painel · falha em LEILAO"). */
function labelToggle() {
  const alert = toggleBtn.dataset.alert;
  const label = `${toggleBtn.dataset.label}${alert ? ` · falha em ${alert}` : ""}`;
  toggleBtn.classList.toggle("alert", !!alert);
  if (toggleBtn.getAttribute("aria-label") === label) return;
  toggleBtn.title = `${label} (Ctrl+Shift+B)`;
  toggleBtn.setAttribute("aria-label", label);
}

function setSidebar(open: boolean) {
  document.body.classList.toggle("sidebar-off", !open);
  toggleBtn.dataset.label = open ? "Recolher o painel" : "Abrir o painel";
  labelToggle();
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
const SIDEBAR_W = { min: 200, max: 480, default: 300 };
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
    // Com a paleta aberta, só o próprio Ctrl+Shift+K (que a fecha): os outros agiam atrás dela (Ctrl+Shift+X parava a API
    // e o rodapé dela ficava desatualizado).
    if (!palette.hidden && e.code !== "KeyK") {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.code === "KeyK") palette.hidden ? openPalette() : closePalette();
    else if (e.code === "KeyB") toggleAndFocus();
    else if (e.code === "KeyE") focusBoard();
    else if (e.code === "KeyH") helpEl.togglePopover();
    else if (e.code === "KeyN" || e.code === "KeyL" || e.code === "KeyO" || e.code === "KeyF") {
      if (!config.projects.length) {
        headerNote(false, null, "Sem projeto ainda: crie um primeiro.");
        emptyEl.querySelector<HTMLButtonElement>(".btn.primary")?.focus();
      } else if (e.code === "KeyN") openAddDialog(current?.project);
      else if (e.code === "KeyO") openInEditor();
      else if (e.code === "KeyF") openSearch();
      else reload();
    } else if (e.code === "KeyJ") {
      if (current?.wt.api && current.wt.front) setTab(tab === "api" ? "front" : "api", true);
      // Solo: não há o que alternar, e o atalho diz por quê.
      else if (current) headerNote(false, current.project, `${current.wt.api ? "Só API" : "Só Front"}: nada para alternar`);
    } else if (e.code === "KeyX") toggleRun(e.altKey, "stop");
    else if (e.code === "KeyS") toggleRun(e.altKey, "start");
    // Ctrl+Shift+R não recarrega o webview (a recarga mataria todos os PTYs): o preventDefault na captura, aqui embaixo.
    else if (e.code === "KeyR") toggleRun(e.altKey, "restart");
    else return;
    e.preventDefault();
    e.stopPropagation();
  },
  true,
);

// ---------- busca no terminal ----------

/** Ctrl+Shift+F: a barra sobre o terminal visível, com o foco nela (aberta, o texto fica selecionado para trocar). */
function openSearch() {
  if (!current) return headerNote(false, null, "Escolha uma worktree primeiro.");
  searchEl.hidden = false;
  searchInput.select();
  searchInput.focus();
}

/** Procura no terminal visível (a aba aberta agora). A ocorrência fica selecionada, na seleção do terminal (--selection);
 *  sem nenhuma, a barra diz. `incremental`: digitando, fica na mesma ocorrência enquanto ela ainda casa. */
function find(dir: "next" | "prev", incremental = false) {
  const ck = currentKey();
  const pane = ck ? envs.get(ck)?.panes[tab] : undefined;
  const q = searchInput.value;
  if (!pane || !q) return void (searchSay.textContent = "");
  const found = dir === "next" ? pane.search.findNext(q, { incremental }) : pane.search.findPrevious(q);
  searchSay.textContent = found ? "" : "Nada encontrado";
}

/** Esc ou o x: fecha e devolve o foco ao terminal. A ocorrência segue selecionada, para copiar. */
function closeSearch() {
  searchEl.hidden = true;
  searchSay.textContent = "";
  render(true);
}

searchInput.addEventListener("input", () => find("next", true));
searchInput.addEventListener("keydown", e => {
  const act = searchKey(e);
  if (!act) return;
  e.preventDefault();
  if (act === "close") closeSearch();
  else find(act);
});
searchEl.querySelector("button")!.addEventListener("click", closeSearch);

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

// ---------- tema ----------

const themeBtn = $<HTMLButtonElement>("#theme");

function applyTheme() {
  if (themeChoice === systemTheme()) themeChoice = null;
  save("theme", themeChoice);
  const now = theme();
  document.documentElement.dataset.theme = now;
  const next = now === "light" ? "escuro" : "claro";
  themeBtn.setAttribute("aria-label", `Mudar para o tema ${next}`);
  themeBtn.title = `Tema ${now === "light" ? "claro" : "escuro"}${themeChoice ? "" : " (do sistema)"} · clique para o ${next}`;
  for (const env of envs.values()) for (const pane of Object.values(env.panes)) pane.term.options.theme = termTheme();
}

themeBtn.addEventListener("click", () => {
  themeChoice = theme() === "light" ? "dark" : "light";
  applyTheme();
});
scheme.addEventListener("change", applyTheme);
applyTheme();

// Só o terminal visível, uma vez por quadro: os ocultos se ajustam ao aparecer (render), e arrastando a barra
// o ajuste espera soltar (o lostpointercapture redesenha). Antes, cada quadro do arraste mandava pty_resize a todos.
let fitFrame = 0;
new ResizeObserver(() => {
  if (fitFrame || document.body.classList.contains("resizing")) return;
  fitFrame = requestAnimationFrame(() => {
    fitFrame = 0;
    const ck = currentKey();
    const pane = ck && envs.get(ck)?.panes[tab];
    if (pane) fitPane(pane);
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
