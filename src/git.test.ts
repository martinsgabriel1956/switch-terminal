import { test } from "node:test";
import assert from "node:assert/strict";
import { gitSay, gitSummary } from "./git.ts";

const clean = { changed: 0, untracked: 0, ahead: 0, behind: 0 };

test("fala só o que não é zero, no singular e no plural", () => {
  assert.equal(gitSay({ changed: 3, untracked: 1, ahead: 2, behind: 0 }), "3 arquivos alterados, 1 não rastreado, 2 commits à frente");
  assert.equal(gitSay({ ...clean, behind: 1 }), "1 commit atrás");
  assert.equal(gitSay(clean), "");
});

test("par: marcador se qualquer lado mudou, commits somados, texto por lado", () => {
  const s = gitSummary([
    ["API", { ...clean, untracked: 2, ahead: 1 }],
    ["Front", { ...clean, ahead: 2, behind: 1 }],
  ]);
  assert.deepEqual(s, { dirty: true, ahead: 3, behind: 1, text: "API: 2 não rastreados, 1 commit à frente; Front: 2 commits à frente, 1 commit atrás" });
  assert.equal(gitSummary([["API", clean], ["Front", { ...clean, changed: 1 }]]).text, "Front: 1 arquivo alterado");
});

test("solo sem o nome do lado; lado não lido não conta", () => {
  assert.equal(gitSummary([["API", { ...clean, changed: 2 }]]).text, "2 arquivos alterados");
  assert.deepEqual(gitSummary([["API", undefined], ["Front", undefined]]), { dirty: false, ahead: 0, behind: 0, text: "" });
});
