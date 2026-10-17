import { test } from "node:test";
import assert from "node:assert/strict";
import { searchKey } from "./search.ts";

test("Enter vai para a próxima, Shift+Enter para a anterior, Esc fecha", () => {
  assert.equal(searchKey({ key: "Enter", shiftKey: false }), "next");
  assert.equal(searchKey({ key: "Enter", shiftKey: true }), "prev");
  assert.equal(searchKey({ key: "Escape", shiftKey: false }), "close");
  assert.equal(searchKey({ key: "Escape", shiftKey: true }), "close");
});

test("o resto é texto do campo", () => {
  assert.equal(searchKey({ key: "a", shiftKey: false }), null);
  assert.equal(searchKey({ key: "F", shiftKey: true }), null);
  assert.equal(searchKey({ key: "ArrowDown", shiftKey: false }), null);
});
