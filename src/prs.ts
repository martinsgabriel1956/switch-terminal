type Tab = "api" | "front";

/** Uma PR como o `gh pr list --json number,title,headRefName,author,isCrossRepository` devolve. */
export type GhPr = { number: number; title: string; headRefName: string; author: { login: string }; isCrossRepository: boolean };
/** Uma entrada do "Da PR": a branch e o número da PR em cada lado que a tem. PR de fork fica sozinha (desabilitada). */
export type PrEntry = { branch: string; title: string; author: string; fork: boolean; sides: Partial<Record<Tab, number>> };

/** Junta as PRs da API e do Front pela branch: a mesma branch nos dois repos vira uma entrada que marca os dois lados.
 *  PR de fork não junta: o `headRefName` dela é do fork (muitas vezes "main") e não diz nada sobre a branch do outro lado. */
export function mergePrs(lists: Partial<Record<Tab, GhPr[]>>): PrEntry[] {
  const out: PrEntry[] = [];
  const byBranch = new Map<string, PrEntry>();
  for (const t of ["api", "front"] as Tab[]) {
    for (const pr of lists[t] ?? []) {
      const known = pr.isCrossRepository ? undefined : byBranch.get(pr.headRefName);
      if (known) {
        known.sides[t] ??= pr.number;
        continue;
      }
      const entry: PrEntry = { branch: pr.headRefName, title: pr.title, author: pr.author.login, fork: pr.isCrossRepository, sides: { [t]: pr.number } };
      out.push(entry);
      if (!entry.fork) byBranch.set(entry.branch, entry);
    }
  }
  return out;
}

/** "API #12 + Front #30 · Título · autor". */
export function prLabel(e: PrEntry) {
  const nums = (["api", "front"] as Tab[]).filter((t) => e.sides[t]).map((t) => `${t === "api" ? "API" : "Front"} #${e.sides[t]}`);
  return `${nums.join(" + ")} · ${e.title} · ${e.author}${e.fork ? " · de fork: crie pelo terminal (gh pr checkout)" : ""}`;
}
