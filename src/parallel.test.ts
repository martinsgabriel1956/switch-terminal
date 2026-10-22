import { test } from "node:test";
import assert from "node:assert/strict";
import { envPrefix, fill, movesOwnPort, nextFree, portMismatch, propose, templateError } from "./parallel.ts";

const LEILAO = {
  api: { SERVER_PORT: "{apiPort}", WEB_URL: "http://localhost:{frontPort}" },
  front: { PORT: "{frontPort}", NEXT_PUBLIC_API_URL: "http://localhost:{apiPort}/api" },
};

test("a próxima porta livre pula as tomadas e desiste depois de 100", () => {
  assert.equal(nextFree(3333, new Set()), 3334);
  assert.equal(nextFree(3333, new Set([3334, 3335])), 3336);
  const all = new Set(Array.from({ length: 100 }, (_, i) => 3334 + i));
  assert.equal(nextFree(3333, all), null);
  assert.equal(nextFree(65535, new Set()), null);
});

test("a proposta fica na padrão livre, anda na tomada e não inventa a desconhecida", () => {
  assert.deepEqual(propose({ api: 3333, front: 3000 }, new Set([3000])), { api: 3333, front: 3001 });
  assert.deepEqual(propose({ api: 3333, front: null }, new Set([3333])), { api: 3334, front: null });
});

test("o modelo vira as variáveis com as portas; sem porta, a variável sai", () => {
  assert.deepEqual(fill(LEILAO.front, { api: 3334, front: 3001 }), { PORT: "3001", NEXT_PUBLIC_API_URL: "http://localhost:3334/api" });
  assert.deepEqual(fill(LEILAO.api, { api: 3334, front: null }), { SERVER_PORT: "3334" });
  assert.deepEqual(fill({ FIXO: "sim" }, { api: null, front: null }), { FIXO: "sim" });
});

test("o prefixo usa o env com aspas simples, e some sem variáveis", () => {
  assert.equal(envPrefix({}), "");
  assert.equal(envPrefix({ PORT: "3001", URL: "http://localhost:3334/api" }), "env 'PORT=3001' 'URL=http://localhost:3334/api' ");
  assert.equal(envPrefix({}, true), "");
  assert.equal(envPrefix({ PORT: "3001", URL: "http://localhost:3334/api" }, true), 'set "PORT=3001" && set "URL=http://localhost:3334/api" && ');
});

test("o modelo com nome inválido, aspa ou placeholder errado é recusado", () => {
  assert.equal(templateError(LEILAO.api), null);
  assert.equal(templateError(LEILAO.front), null);
  assert.match(templateError({ "NEXT-URL": "x" })!, /NEXT-URL/);
  assert.match(templateError({ URL: "it's" })!, /aspa/);
  assert.match(templateError({ URL: 'a"b' })!, /aspa/);
  assert.match(templateError({ PORT: "{apiport}" })!, /\{apiport\}/);
});

test("o lado só muda de porta se alguma variável usa o placeholder dele", () => {
  assert.equal(movesOwnPort(LEILAO.api, "api"), true);
  assert.equal(movesOwnPort(LEILAO.api, "front"), true);
  assert.equal(movesOwnPort({ WEB_URL: "http://localhost:{frontPort}" }, "api"), false);
  assert.equal(movesOwnPort({}, "front"), false);
});

test("a porta que subiu só acusa quando as duas são conhecidas e diferem", () => {
  assert.equal(portMismatch(3334, 3333), true);
  assert.equal(portMismatch(3334, 3334), false);
  assert.equal(portMismatch(3334, null), false);
  assert.equal(portMismatch(null, 3333), false);
});
