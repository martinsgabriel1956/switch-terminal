/** Erro do `git pull --ff-only` numa frase (o backend roda com LC_ALL=C: a saída vem em inglês). O cru fica no detalhe. */
export function pullErrorSummary(raw: string) {
  const err = raw.toLowerCase();
  if (err.includes("not possible to fast-forward") || err.includes("diverging branches")) return "a branch divergiu da remota, não é fast-forward";
  if (err.includes("no tracking information")) return "a branch não tem upstream";
  if (err.includes("would be overwritten")) return "mudanças locais seriam sobrescritas";
  if (err.includes("not currently on a branch")) return "HEAD destacado, sem branch para atualizar";
  if (err.includes("could not read from remote") || err.includes("could not resolve host") || err.includes("unable to access") || err.includes("authentication failed"))
    return "não consegui falar com o origin";
  return "o git pull falhou";
}

/** A linha que diz o erro ("fatal: Not possible to fast-forward, aborting."), não as dicas ("hint: …") antes dela. */
export function pullErrorLine(raw: string) {
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  return lines.find(l => /^(fatal|error):/i.test(l)) ?? lines[0] ?? "";
}
