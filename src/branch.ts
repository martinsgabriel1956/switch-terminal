/** Fim do nome que fica à vista quando ele trunca: a última palavra ("agrupados") ou os últimos 7 caracteres.
 *  Nome curto não tem: cabe inteiro, ou trunca no fim. */
export function nameTail(rest: string) {
  if (rest.length <= 18) return "";
  const word = rest.slice(rest.lastIndexOf("-") + 1);
  return word.length >= 3 && word.length <= 10 ? word : rest.slice(-7);
}

/** Maior "começo…fim" de `full` que cabe em `avail`, pela largura `w` de cada texto: "calculo-de-comis…agrupados". */
export function middleCut(full: string, avail: number, w: (s: string) => number) {
  const tail = nameTail(full);
  const head = full.slice(0, full.length - tail.length);
  let lo = 0;
  let hi = head.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (w(`${head.slice(0, mid)}…${tail}`) <= avail) lo = mid;
    else hi = mid - 1;
  }
  return `${head.slice(0, lo)}…${tail}`;
}

/** Maior "…fim" de `full` que cabe em `avail`, começando numa palavra: "…de-lotes-por-leilao", não "…or-de-lotes-…".
 *  O complemento do corte do painel, que guarda o começo. */
export function endCut(full: string, avail: number, w: (s: string) => number) {
  let lo = 0;
  let hi = full.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (w(`…${full.slice(mid)}`) <= avail) hi = mid;
    else lo = mid + 1;
  }
  if (!lo) return full;
  // No meio de uma palavra: pula para a próxima, se sobrar ao menos uma palavra depois.
  const next = /[-/_]/.test(full[lo - 1]) ? -1 : full.slice(lo).search(/[-/_][^-/_]/);
  return `…${full.slice(next < 0 ? lo : lo + next + 1)}`;
}
