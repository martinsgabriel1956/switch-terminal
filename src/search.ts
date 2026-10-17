/** Tecla no campo de busca do terminal: Enter vai para a próxima ocorrência, Shift+Enter para a anterior, Esc fecha.
 *  O resto é texto do campo. */
export function searchKey(e: { key: string; shiftKey: boolean }): "next" | "prev" | "close" | null {
  if (e.key === "Escape") return "close";
  if (e.key !== "Enter") return null;
  return e.shiftKey ? "prev" : "next";
}
