import { test } from "node:test";
import assert from "node:assert/strict";
import { restartRefusal } from "./restart.ts";

test("reinicia o lado com start que está rodando", () => {
  assert.equal(restartRefusal({ what: "API", all: false, hasStart: true, running: true }), null);
  assert.equal(restartRefusal({ what: "API e Front", all: true, hasStart: true, running: true }), null);
});

test("parado, não há o que reiniciar, e o recado diz quem sobe", () => {
  assert.equal(restartRefusal({ what: "Front", all: false, hasStart: true, running: false }), "Nada rodando em Front · Ctrl+Shift+S sobe");
  assert.equal(restartRefusal({ what: "API e Front", all: true, hasStart: true, running: false }), "Nada rodando na worktree · Ctrl+Shift+Alt+S sobe");
});

test("lado sem start não reinicia, nem com algo rodando nele", () => {
  assert.equal(restartRefusal({ what: "API", all: false, hasStart: false, running: true }), "API: sem comando de start");
  assert.equal(restartRefusal({ what: "API", all: false, hasStart: false, running: false }), "API: sem comando de start");
});
