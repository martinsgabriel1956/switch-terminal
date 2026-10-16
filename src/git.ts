/** Estado do git de um lado, lido pelo `git_status` do backend. */
export type GitState = { changed: number; untracked: number; ahead: number; behind: number };

const count = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : "");

/** "3 arquivos alterados, 2 commits à frente"; vazio quando não há o que dizer. */
export function gitSay(s: GitState) {
  return [
    count(s.changed, "arquivo alterado", "arquivos alterados"),
    count(s.untracked, "não rastreado", "não rastreados"),
    count(s.ahead, "commit à frente", "commits à frente"),
    count(s.behind, "commit atrás", "commits atrás"),
  ]
    .filter(Boolean)
    .join(", ");
}

/** Os lados de uma worktree num marcador só: há mudança se qualquer lado tem, e os commits somam. O texto diz por lado
 *  num par ("API: 3 arquivos alterados; Front: 1 commit atrás") e sem o lado na solo. Lado ainda não lido não conta. */
export function gitSummary(sides: [side: string, state: GitState | undefined][]) {
  const known = sides.filter((s): s is [string, GitState] => !!s[1]);
  const said = known.map(([side, s]) => [side, gitSay(s)] as const).filter(([, t]) => t);
  return {
    dirty: known.some(([, s]) => s.changed + s.untracked > 0),
    ahead: known.reduce((n, [, s]) => n + s.ahead, 0),
    behind: known.reduce((n, [, s]) => n + s.behind, 0),
    text: said.map(([side, t]) => (sides.length > 1 ? `${side}: ${t}` : t)).join("; "),
  };
}
