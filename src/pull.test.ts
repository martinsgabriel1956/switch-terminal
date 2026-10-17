import { test } from "node:test";
import assert from "node:assert/strict";
import { pullErrorLine, pullErrorSummary } from "./pull.ts";

const NOT_FF = "hint: Diverging branches can't be fast-forwarded, you need to either:\nhint:\nhint: \tgit merge --no-ff\nhint:\nfatal: Not possible to fast-forward, aborting.";

test("erro do pull vira uma frase legível", () => {
  assert.equal(pullErrorSummary(NOT_FF), "a branch divergiu da remota, não é fast-forward");
  assert.equal(pullErrorSummary("There is no tracking information for the current branch.\nPlease specify which branch you want to merge with."), "a branch não tem upstream");
  assert.equal(pullErrorSummary("error: Your local changes to the following files would be overwritten by merge:\n\tsrc/a.ts"), "mudanças locais seriam sobrescritas");
  assert.equal(pullErrorSummary("fatal: Could not read from remote repository."), "não consegui falar com o origin");
  assert.equal(pullErrorSummary("fatal: algo novo"), "o git pull falhou");
});

test("a linha do erro cru é a do fatal, não a das dicas", () => {
  assert.equal(pullErrorLine(NOT_FF), "fatal: Not possible to fast-forward, aborting.");
  assert.equal(pullErrorLine("There is no tracking information for the current branch.\n"), "There is no tracking information for the current branch.");
  assert.equal(pullErrorLine(""), "");
});
