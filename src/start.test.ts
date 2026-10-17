import { test } from "node:test";
import assert from "node:assert/strict";
import { deafSides, lateText, startEnd } from "./start.ts";

test("lado com porta conhecida só sobe quando ela responde; sem porta, o processo basta", () => {
  const up = [
    { tab: "api", port: 3333 },
    { tab: "front", port: null }
  ];
  assert.deepEqual(deafSides(up, new Set()), ["api"]);
  assert.deepEqual(deafSides(up, new Set([3333])), []);
  assert.deepEqual(deafSides([{ tab: "front", port: 3000 }], new Set([3333])), ["front"]);
});

test("SUBINDO vira RODANDO quando ninguém ficou para trás, e desiste depois de 15 s", () => {
  assert.equal(startEnd(0, 0, 200), "rodando");
  assert.equal(startEnd(0, 1, 200), "subindo");
  assert.equal(startEnd(1, 0, 14000), "subindo");
  assert.equal(startEnd(0, 1, 15001), "atrasado");
  assert.equal(startEnd(0, 0, 20000), "rodando");
});

test("o recado do atraso diz quem e por quê", () => {
  assert.equal(lateText(["API"], []), "API não subiu em 15 s");
  assert.equal(lateText(["API", "Front"], []), "API e Front não subiram em 15 s");
  assert.equal(lateText(["API"], [{ name: "Front", port: 3000 }]), "API não subiu em 15 s");
  assert.equal(lateText([], [{ name: "Front", port: 3000 }]), "Front não respondeu na porta 3000 em 15 s");
  assert.equal(lateText([], [{ name: "API", port: 3333 }, { name: "Front", port: 3000 }]), "API e Front não responderam nas portas 3333 e 3000 em 15 s");
});
