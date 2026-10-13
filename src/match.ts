/** Onde `q` casa em `text` (os dois já em minúsculas): o trecho inteiro, senão a subsequência ("fx" em "feature-x");
 *  null se não casa. Os índices servem para destacar na paleta por que o item entrou. */
export function matchAt(q: string, text: string): number[] | null {
  const at = text.indexOf(q);
  if (at >= 0) return Array.from({ length: q.length }, (_, i) => at + i);
  const hits: number[] = [];
  for (let i = 0; i < text.length && hits.length < q.length; i++) if (text[i] === q[hits.length]) hits.push(i);
  return hits.length === q.length ? hits : null;
}

/** Cada termo da busca casa dentro do projeto ou dentro da branch, nunca atravessando os dois: "log" não casa
 *  "leilao" + "landing". Termos separados por espaço: "int login" é o projeto e a branch. */
export function matchItem(terms: string[], project: string, label: string) {
  return terms.every((t) => matchAt(t, project) || matchAt(t, label));
}
