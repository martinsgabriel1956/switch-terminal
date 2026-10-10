/** Package managers do seletor do comando de start. Bun fica de fora por ora: cai em "Outro". */
export type Pm = "npm" | "yarn" | "pnpm";
export const PMS: Pm[] = ["npm", "yarn", "pnpm"];

export const isPm = (word: string | null | undefined): word is Pm => PMS.some(pm => pm === word);
/** Valor do seletor: "" é "Outro". */
export const asPm = (value: string | undefined): Pm | null => (isPm(value) ? value : null);

/** O que fica fixo antes do script: o campo guarda só o script ("dev:api --port 3001"). */
export const PREFIX: Record<Pm, string> = { npm: "npm run", yarn: "yarn", pnpm: "pnpm" };

/** Subcomandos de instalação: viram `<pm> install` (pnpm e yarn não têm `ci`). */
const INSTALL = ["install", "i", "ci"];

/** O package manager que abre o comando ("pnpm install && pnpm dev" → pnpm); null para outro comando ou vazio. */
export function pmOf(cmd: string): Pm | null {
  const first = cmd.trim().split(/\s+/)[0];
  return isPm(first) ? first : null;
}

/** Um trecho "npm run dev" no package manager pedido; trecho que não começa com um deles fica como está. */
function rewriteSegment(segment: string, to: Pm): string {
  const [first, ...rest] = segment.trim().split(/\s+/);
  if (!isPm(first)) return segment.trim();
  const args = first === "npm" && rest[0] === "run" ? rest.slice(1) : rest;
  // "yarn" sozinho instala.
  if (!args.length || INSTALL.includes(args[0])) return [to, "install", ...args.slice(1)].join(" ");
  return [to, ...(to === "npm" ? ["run"] : []), ...args].join(" ");
}

/** Reescreve cada trecho separado por `&&`: "npm install && npm run dev" → "pnpm install && pnpm dev". */
export function rewrite(cmd: string, to: Pm): string {
  if (!cmd.trim()) return cmd;
  return cmd.split("&&").map(segment => rewriteSegment(segment, to)).join(" && ");
}

/** Start do config em package manager + script ("npm run dev:api" → npm, "dev:api"; `npm test` → npm, "test").
 *  Encadeado com `&&`, de outro tipo ou vazio é "Outro" (pm null), com o texto inteiro. */
export function splitStart(cmd: string): { pm: Pm | null; script: string } {
  const pm = pmOf(cmd);
  if (!pm || cmd.includes("&&")) return { pm: null, script: cmd.trim() };
  const normalized = rewrite(cmd, pm);
  const prefix = `${PREFIX[pm]} `;
  return normalized.startsWith(prefix) ? { pm, script: normalized.slice(prefix.length) } : { pm: null, script: cmd.trim() };
}

/** De volta ao texto do config: script vazio é sem comando; "Outro" é o texto como está. */
export const joinStart = (pm: Pm | null, script: string) => (pm && script.trim() ? `${PREFIX[pm]} ${script.trim()}` : script.trim());

/** O campo depois de trocar de package manager: entre package managers só o prefixo muda; vindo de "Outro" fica o
 *  script do texto (ou "dev"); indo para "Outro", o comando inteiro fica livre para editar. */
export function switchPm(from: Pm | null, to: Pm | null, field: string): string {
  if (!to) return joinStart(from, field);
  if (from) return field;
  const { pm, script } = splitStart(field);
  return pm ? script : "dev";
}
