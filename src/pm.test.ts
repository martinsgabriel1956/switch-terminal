import { test } from "node:test";
import assert from "node:assert/strict";
import { joinStart, pmOf, rewrite, splitStart, switchPm } from "./pm.ts";

test("reconhece o package manager pelo primeiro trecho", () => {
  assert.equal(pmOf("pnpm install && pnpm dev"), "pnpm");
  assert.equal(pmOf("  yarn dev"), "yarn");
  assert.equal(pmOf("make dev && npm run dev"), null);
  assert.equal(pmOf("bun dev"), null);
  assert.equal(pmOf(""), null);
});

test("reescreve scripts e instalação em cada trecho", () => {
  assert.equal(rewrite("npm install && npm run dev", "pnpm"), "pnpm install && pnpm dev");
  assert.equal(rewrite("pnpm dev:api --port 3001", "npm"), "npm run dev:api --port 3001");
  assert.equal(rewrite("yarn", "npm"), "npm install");
  assert.equal(rewrite("npm ci", "yarn"), "yarn install");
  assert.equal(rewrite("make setup && npm i", "pnpm"), "make setup && pnpm install");
  assert.equal(rewrite("", "pnpm"), "");
});

test("separa o start em prefixo fixo e script, e junta de volta", () => {
  assert.deepEqual(splitStart("npm run dev:api --port 3001"), { pm: "npm", script: "dev:api --port 3001" });
  assert.deepEqual(splitStart("npm test"), { pm: "npm", script: "test" });
  assert.deepEqual(splitStart("pnpm dev"), { pm: "pnpm", script: "dev" });
  assert.deepEqual(splitStart("npm install && npm run dev"), { pm: null, script: "npm install && npm run dev" });
  assert.deepEqual(splitStart("make dev"), { pm: null, script: "make dev" });
  assert.deepEqual(splitStart(""), { pm: null, script: "" });
  assert.equal(joinStart("npm", " dev:api "), "npm run dev:api");
  assert.equal(joinStart("yarn", ""), "", "script vazio é sem comando, nunca só o prefixo");
  assert.equal(joinStart(null, "make dev"), "make dev");
});

test("trocar de package manager nunca perde o prefixo", () => {
  assert.equal(switchPm("npm", "pnpm", "dev:api"), "dev:api");
  assert.equal(switchPm("npm", null, "dev:api"), "npm run dev:api");
  assert.equal(switchPm(null, "yarn", "pnpm dev:mock"), "dev:mock");
  assert.equal(switchPm(null, "yarn", "make dev"), "dev");
  assert.equal(switchPm(null, "pnpm", ""), "dev");
});
