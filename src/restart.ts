/** O que o Reiniciar (Ctrl+Shift+R; com Alt, os dois lados) diz no cabeçalho em vez de agir, ou null quando ele reinicia:
 *  para o que roda e sobe o start de novo. Lado sem start não reinicia; parado, não há o que reiniciar, e o recado diz
 *  quem sobe. A troca e a parada em andamento são vistas antes, como no Parar e no Subir.
 *  `what`: os lados pedidos ("API", "API e Front"); `hasStart`: algum deles tem start; `running`: algum com start roda. */
export function restartRefusal(o: { what: string; all: boolean; hasStart: boolean; running: boolean }): string | null {
  if (!o.hasStart) return `${o.what}: sem comando de start`;
  if (!o.running) return `Nada rodando ${o.all ? "na worktree" : `em ${o.what}`} · Ctrl+Shift+${o.all ? "Alt+" : ""}S sobe`;
  return null;
}
