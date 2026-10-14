import { test } from "node:test";
import assert from "node:assert/strict";
import { backName, middleCut, nameTail } from "./branch.ts";

test("o fim que fica à vista é a última palavra, ou os últimos 7 caracteres", () => {
  assert.equal(nameTail("calculo-de-comissao-do-leiloeiro-agrupados"), "agrupados");
  assert.equal(nameTail("LEI-1423-ajuste-de-lances-automaticos"), "maticos");
  assert.equal(nameTail("leiloes-ao-vivo"), "");
});

test("trunca no meio, mantendo o fim, no maior começo que cabe", () => {
  const w = (s: string) => s.length; // um caractere = 1
  assert.equal(middleCut("calculo-de-comissao-do-leiloeiro-agrupados", 20, w), "calculo-de…agrupados");
  assert.equal(middleCut("leiloes-ao-vivo", 8, w), "leiloes…");
  assert.equal(middleCut("calculo-de-comissao-do-leiloeiro-agrupados", 5, w), "…agrupados");
});

test("o Voltar apertado fica com a cauda, e o nome curto fica inteiro", () => {
  assert.equal(backName("calculo-de-juros-agrupados", true), "agrupados");
  assert.equal(backName("login-timeout", true), "login-timeout");
  assert.equal(backName("calculo-de-juros-agrupados", false), "calculo-de-juros-agrupados");
});
