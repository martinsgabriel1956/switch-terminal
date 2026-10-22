/** Portas de uma worktree no modo paralelo; null: lado sem servidor ou porta desconhecida. */
export type Ports = { api: number | null; front: number | null };
/** `parallelEnv` de um lado: { "SERVER_PORT": "{apiPort}", "WEB_URL": "http://localhost:{frontPort}" }. */
export type EnvTemplate = Record<string, string>;

const PLACEHOLDER = /\{(\w+)\}/g;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PORT_OF = { apiPort: "api", frontPort: "front" } as const;

/** A primeira porta depois de `from` que ninguém tomou; null se as 100 seguintes estão tomadas. */
export function nextFree(from: number, taken: ReadonlySet<number>): number | null {
  for (let p = from + 1; p <= Math.min(from + 100, 65535); p++) if (!taken.has(p)) return p;
  return null;
}

/** A padrão se livre, senão a próxima livre; sem padrão conhecida, null (o diálogo pede). */
export function propose(defaults: Ports, taken: ReadonlySet<number>): Ports {
  const one = (d: number | null) => (d === null ? null : taken.has(d) ? nextFree(d, taken) : d);
  return { api: one(defaults.api), front: one(defaults.front) };
}

/** Troca {apiPort}/{frontPort} pelas portas. A variável cujo placeholder não tem porta (a solo sem o outro lado) sai:
 *  subir com "http://localhost:{frontPort}" literal seria pior que não passar nada. */
export function fill(tpl: EnvTemplate, ports: Ports): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(tpl)) {
    let missing = false;
    const filled = value.replace(PLACEHOLDER, (all, ph: string) => {
      const port = ph in PORT_OF ? ports[PORT_OF[ph as keyof typeof PORT_OF]] : null;
      if (port === null) missing = true;
      return String(port ?? all);
    });
    if (!missing) out[name] = filled;
  }
  return out;
}

/** "env 'K=v' 'K2=v2' " antes do start. O env, e não "K=v cmd": o mesmo em fish, bash e zsh. As aspas simples
 *  valem nos três; valor com aspa simples é recusado no templateError. */
export function envPrefix(vars: Record<string, string>): string {
  const pairs = Object.entries(vars).map(([k, v]) => `'${k}=${v}'`);
  return pairs.length ? `env ${pairs.join(" ")} ` : "";
}

/** O que está errado no parallelEnv de um lado, ou null. */
export function templateError(tpl: EnvTemplate): string | null {
  for (const [name, value] of Object.entries(tpl)) {
    if (!NAME.test(name)) return `nome de variável inválido: ${name}`;
    if (value.includes("'")) return `${name} tem aspa simples, que o app não passa ao shell`;
    const bad = [...value.matchAll(PLACEHOLDER)].find((m) => !(m[1] in PORT_OF));
    if (bad) return `${name}: ${bad[0]} não existe (use {apiPort} ou {frontPort})`;
  }
  return null;
}

/** O lado consegue mudar a própria porta? Alguma variável dele usa o placeholder dele. */
export const movesOwnPort = (tpl: EnvTemplate, side: "api" | "front") => Object.values(tpl).some((v) => v.includes(`{${side}Port}`));

/** Subiu numa porta diferente da atribuída (o projeto ignorou a variável)? Sem uma das duas, não acusa. */
export const portMismatch = (assigned: number | null, seen: number | null) => assigned !== null && seen !== null && assigned !== seen;
