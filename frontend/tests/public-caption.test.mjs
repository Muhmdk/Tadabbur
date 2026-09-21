import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function loadTypeScript(path, jsx = false) {
  const source = readFileSync(resolve(projectRoot, path), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: jsx ? ts.JsxEmit.ReactJSX : undefined,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(require, module, module.exports);
  return module.exports;
}

const CaptionRenderer = loadTypeScript("components/CaptionRenderer.tsx", true).default;
const { resolveEndpoints } = loadTypeScript("lib/endpoints.ts");
const { nextPartialCaptionState, selectPublicCaption } = loadTypeScript("lib/public-caption.ts");
const ordinary = {
  type: "caption.final",
  sessionId: "session",
  chunkId: "chunk",
  source: "Arabic source marker",
  sourceLang: "ar",
  translations: { en: "English translation marker" },
  timestamp: 1,
};

for (const variant of ["projector", "attendee"]) {
  const show = (caption, extra = {}) => renderToStaticMarkup(
    React.createElement(CaptionRenderer, { caption, targetLanguage: "en", variant, ...extra }),
  );

  test(`${variant}: Quran final contains no source or translation`, () => {
    const html = show({ ...ordinary, isQuranicCandidate: true, isQuranicHadithCandidate: true });
    assert.match(html, /Quran being read/);
    assert.doesNotMatch(html, /Arabic source marker|English translation marker/);
  });

  test(`${variant}: confirmed manual Quran mode suppresses an ordinary caption`, () => {
    const html = show(ordinary, { isQuranActive: true });
    assert.match(html, /Quran being read/);
    assert.doesNotMatch(html, /Arabic source marker|English translation marker/);
  });

  test(`${variant}: uncertain scripture withholds translation`, () => {
    const html = show({ ...ordinary, isQuranicHadithCandidate: true });
    assert.match(html, /Scriptural passage being read/);
    assert.doesNotMatch(html, /English translation marker/);
  });

  test(`${variant}: ordinary caption shows Arabic and English`, () => {
    const html = show(ordinary);
    assert.match(html, /Arabic source marker/);
    assert.match(html, /English translation marker/);
  });

  test(`${variant}: Quran notice stays visible between recited clauses until ordinary speech is final`, () => {
    const quran = { ...ordinary, chunkId: "verse", isQuranicCandidate: true };
    const duringNextPartial = selectPublicCaption(quran, "listening", false);
    const held = show(duringNextPartial.caption, { isQuranActive: duringNextPartial.isQuranActive });
    assert.match(held, /Quran being read/);
    assert.doesNotMatch(held, /Arabic source marker|English translation marker|Listening for the next phrase/);

    const afterOrdinaryFinal = selectPublicCaption(ordinary, "none", false);
    const resumed = show(afterOrdinaryFinal.caption, { isQuranActive: afterOrdinaryFinal.isQuranActive });
    assert.doesNotMatch(resumed, /Quran being read/);
    assert.match(resumed, /English translation marker/);
  });
}

test("LAN browser host resolves the backend on the same device", () => {
  assert.deepEqual(resolveEndpoints("http://192.168.1.50:3000/join/session"), {
    api: "http://192.168.1.50:8000",
    ws: "ws://192.168.1.50:8000",
    join: "http://192.168.1.50:3000",
  });
});

test("HTTPS fallback uses secure same-origin endpoints", () => {
  assert.deepEqual(resolveEndpoints("https://captions.example.org/join/session"), {
    api: "https://captions.example.org",
    ws: "wss://captions.example.org",
    join: "https://captions.example.org",
  });
});

test("partial Quran detection stays latched until the next final caption", () => {
  assert.equal(nextPartialCaptionState("none", true), "quran");
  assert.equal(nextPartialCaptionState("quran", false), "quran");
  assert.equal(nextPartialCaptionState("none", false), "listening");
});
