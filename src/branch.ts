/** Fim do nome que fica à vista quando ele trunca: a última palavra ("agrupados") ou os últimos 7 caracteres.
 *  Nome curto não tem: cabe inteiro, ou trunca no fim. */
export function nameTail(rest: string) {
  if (rest.length <= 18) return "";
  const word = rest.slice(rest.lastIndexOf("-") + 1);
  return word.length >= 3 && word.length <= 10 ? word : rest.slice(-7);
}

/** O nome no Voltar da faixa da troca: apertada, só a cauda ("Voltar agrupados"). Nome curto não tem cauda e fica
 *  inteiro (e trunca no fim): com a cauda vazia, o botão dizia só "Voltar", sem para onde. */
export function backName(full: string, tight: boolean) {
  const tail = nameTail(full);
  return tight && tail ? tail : full;
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
