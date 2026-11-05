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
const { APPEARANCES, appearanceFrom, withAppearance } = loadTypeScript("lib/appearance.ts");

test("display designs preserve the original and validate saved or shared choices", () => {
  assert.equal(APPEARANCES.length, 4);
  for (const { id } of APPEARANCES) assert.equal(appearanceFrom(id), id);
  assert.equal(appearanceFrom("unknown"), "classic");
  assert.equal(appearanceFrom(null), "classic");
});

test("design links preserve the session, other parameters and anchor", () => {
  assert.equal(withAppearance("/display/session?theme=classic&test=1#captions", "burgundy"), "/display/session?theme=burgundy&test=1#captions");
  assert.equal(withAppearance("https://example.org/join/session", "ivory"), "https://example.org/join/session?theme=ivory");
});
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

  test(`${variant}: live Arabic never borrows English from the previous phrase`, () => {
    for (const text of ["New", "New Arabic", "New Arabic phrase"]) {
      const selected = selectPublicCaption(ordinary, "listening", false, text);
      const html = show(selected.caption, { interimSource: selected.interimSource });
      assert.match(html, new RegExp(text));
      assert.doesNotMatch(html, /English translation marker/);
      assert.doesNotMatch(html, /Arabic source marker|Waiting for the speaker|A moment to listen/);
    }
  });

  test(`${variant}: English appears with its own finalized Arabic and remains during silence`, () => {
    const selected = selectPublicCaption(ordinary, "none", false);
    const html = show(selected.caption, { interimSource: selected.interimSource });
    assert.match(html, /Arabic source marker/);
    assert.match(html, /English translation marker/);
    assert.equal(selected.interimSource, "");
  });

  test(`${variant}: the first partial is visible before any translation exists`, () => {
    const html = show(null, { interimSource: "First spoken words" });
    assert.match(html, /First spoken words/);
    assert.doesNotMatch(html, /English translation marker/);
  });

  test(`${variant}: Quran detection immediately hides live Arabic and retained English`, () => {
    const selected = selectPublicCaption(ordinary, "quran", false, "Unsafe partial");
    assert.equal(selected.interimSource, "");
    const html = show(selected.caption, { interimSource: "Unsafe partial", isQuranActive: selected.isQuranActive });
    assert.match(html, /Quran being read/);
    assert.doesNotMatch(html, /Unsafe partial|English translation marker|Arabic source marker/);
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

test("manual Quran mode and held scripture cannot expose new partial text", () => {
  assert.equal(selectPublicCaption(ordinary, "listening", true, "Unsafe partial").interimSource, "");
  assert.equal(selectPublicCaption({ ...ordinary, isQuranicHadithCandidate: true }, "listening", false, "Unsafe partial").interimSource, "");
});
