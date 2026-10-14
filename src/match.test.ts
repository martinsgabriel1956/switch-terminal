import { test } from "node:test";
import assert from "node:assert/strict";
import { matchAt, matchItem, projectTerms } from "./match.ts";

test("trecho inteiro antes da subsequência", () => {
  assert.deepEqual(matchAt("log", "feat/login"), [5, 6, 7]);
  assert.deepEqual(matchAt("fx", "feature-x"), [0, 8]);
  assert.equal(matchAt("xz", "feature-x"), null);
});

test("um termo não atravessa projeto e branch; termos separados casam um em cada", () => {
  assert.equal(matchItem(["log"], "leilao", "feat/landing-nova"), false);
  assert.equal(matchItem(["log"], "interno", "hotfix/login"), true);
  assert.equal(matchItem(["int", "login"], "interno", "hotfix/login"), true);
  assert.equal(matchItem(["intlogin"], "interno", "hotfix/login"), false);
});

test("termo que começa o projeto desempata a favor dele", () => {
  assert.equal(projectTerms(["lei", "agr"], "leilao"), 1);
  assert.equal(projectTerms(["lei", "agr"], "interno"), 0);
});
