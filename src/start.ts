/** Quanto o SUBINDO espera antes de dizer quem ficou para trás. */
export const START_MS = 15000;

/** Um lado com processo em primeiro plano e a porta do dev server lida da saída do terminal (desta subida ou da anterior). */
export type Probe<T> = { tab: T; port: number | null };

/** Lados de pé que ainda seguram o SUBINDO: a porta é conhecida e não aceitou conexão. Sem porta conhecida, o processo
 *  basta, como antes: o lado sobe quando ele aparece. */
export function deafSides<T>(up: Probe<T>[], open: ReadonlySet<number>): T[] {
  return up.filter(s => s.port !== null && !open.has(s.port)).map(s => s.tab);
}

/** SUBINDO → RODANDO: sobe quando nenhum lado ficou sem processo (`down`) nem com a porta fechada (`deaf`); passados
 *  15 s, desiste e o cabeçalho diz quem ficou para trás (`atrasado`). */
export function startEnd(down: number, deaf: number, elapsedMs: number): "subindo" | "rodando" | "atrasado" {
  if (!down && !deaf) return "rodando";
  return elapsedMs > START_MS ? "atrasado" : "subindo";
}

/** "API não subiu em 15 s" (sem processo) ou "Front não respondeu na porta 3000 em 15 s" (de pé, porta fechada). Com os
 *  dois, fala do que não subiu: é ele que vira SEM API. */
export function lateText(down: string[], deaf: { name: string; port: number }[]) {
  if (down.length) return `${down.join(" e ")} ${down.length > 1 ? "não subiram" : "não subiu"} em 15 s`;
  const names = deaf.map(d => d.name).join(" e ");
  const ports = deaf.map(d => d.port).join(" e ");
  return deaf.length > 1 ? `${names} não responderam nas portas ${ports} em 15 s` : `${names} não respondeu na porta ${ports} em 15 s`;
}
