import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = readFileSync(resolve(projectRoot, "lib/operator-session.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function("module", "exports", compiled)(mod, mod.exports);
const { loadOperatorSession, saveOperatorSession, clearOperatorSession, reconnectDelayMs } = mod.exports;

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("a prepared session survives a page reload", () => {
  const storage = memoryStorage();
  saveOperatorSession(storage, { id: "abc" });
  assert.deepEqual(loadOperatorSession(storage), { id: "abc" });
  clearOperatorSession(storage);
  assert.equal(loadOperatorSession(storage), null);
});

test("a corrupt stored session is ignored", () => {
  const storage = memoryStorage();
  storage.setItem("tadabbur.operator-session", "{not json");
  assert.equal(loadOperatorSession(storage), null);
});

test("speaker reconnects back off quickly and then retry every five seconds", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10].map(reconnectDelayMs), [500, 1000, 2000, 4000, 5000, 5000]);
});
