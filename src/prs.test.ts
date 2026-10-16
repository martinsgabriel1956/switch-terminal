import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePrs, prLabel, type GhPr } from "./prs.ts";

const pr = (number: number, headRefName: string, isCrossRepository = false): GhPr => ({ number, title: `t${number}`, headRefName, author: { login: "ana" }, isCrossRepository });

test("a mesma branch nos dois repos vira uma entrada que marca os dois lados", () => {
  const got = mergePrs({ api: [pr(12, "feat/x"), pr(13, "fix/y")], front: [pr(30, "feat/x"), pr(31, "so-front")] });
  assert.deepEqual(
    got.map((e) => [e.branch, e.sides]),
    [
      ["feat/x", { api: 12, front: 30 }],
      ["fix/y", { api: 13 }],
      ["so-front", { front: 31 }],
    ],
  );
  assert.equal(prLabel(got[0]), "API #12 + Front #30 · t12 · ana");
});

test("PR de fork não junta com a branch de mesmo nome e diz por que fica desabilitada", () => {
  const got = mergePrs({ api: [pr(1, "main", true), pr(2, "main", true)], front: [pr(3, "main")] });
  assert.deepEqual(got.map((e) => [e.fork, e.sides]), [[true, { api: 1 }], [true, { api: 2 }], [false, { front: 3 }]]);
  assert.match(prLabel(got[0]), /de fork/);
});
