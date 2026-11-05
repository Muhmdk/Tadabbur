"use client";

import { useEffect, useState } from "react";

export const APPEARANCES = [
  { id: "classic", name: "Original", note: "Warm stone · modern type" },
  { id: "burgundy", name: "Burgundy Majlis", note: "Claret · gold · paired columns" },
  { id: "ivory", name: "Ivory Manuscript", note: "Parchment · fine borders · Naskh" },
  { id: "midnight", name: "Midnight Mihrab", note: "Ink blue · brass · architectural" },
] as const;
export type Appearance = typeof APPEARANCES[number]["id"];

export function appearanceFrom(value: string | null): Appearance {
  return APPEARANCES.find((item) => item.id === value)?.id ?? "classic";
}

export function withAppearance(href: string, appearance: Appearance): string {
  const url = new URL(href, "http://local.invalid");
  url.searchParams.set("theme", appearance);
  return /^https?:/.test(href) ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>("classic");
  useEffect(() => {
    const query = new URL(window.location.href).searchParams.get("theme");
    let saved: string | null = null;
    try { saved = localStorage.getItem("tadabbur-appearance"); } catch { /* Selection still works when storage is unavailable. */ }
    setAppearance(appearanceFrom(query ?? saved));
  }, []);

  function chooseAppearance(next: Appearance) {
    setAppearance(next);
    const url = new URL(window.location.href);
    url.searchParams.set("theme", next);
    window.history.replaceState(null, "", url);
    try { localStorage.setItem("tadabbur-appearance", next); } catch { /* URL preserves the selection. */ }
  }
  return { appearance, chooseAppearance };
}
