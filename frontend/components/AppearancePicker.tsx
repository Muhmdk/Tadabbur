"use client";

import { useRef } from "react";
import { APPEARANCES, type Appearance } from "@/lib/appearance";

type Props = { appearance: Appearance; onChange: (appearance: Appearance) => void; compact?: boolean };

export default function AppearancePicker({ appearance, onChange, compact = false }: Props) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  function choose(next: Appearance) {
    onChange(next);
    if (menuRef.current) {
      menuRef.current.open = false;
      menuRef.current.querySelector("summary")?.focus();
    }
  }
  const choices = <fieldset className="appearance-choices"><legend>Choose a display design</legend><div className="appearance-options">{APPEARANCES.map((item) => <button type="button" key={item.id} aria-pressed={appearance === item.id} onClick={() => choose(item.id)} className="appearance-option"><span className={`appearance-swatch swatch-${item.id}`} aria-hidden="true"><span className="swatch-ornament">✦</span><span className="swatch-arabic" lang="ar">تدبّر</span><span className="swatch-english">Listen. Understand.</span></span><span className="appearance-option-title">{item.name}<span aria-hidden="true">{appearance === item.id ? "✓" : "↗"}</span></span><span className="appearance-option-note">{item.note}</span></button>)}</div></fieldset>;
  return compact ? <details className="appearance-menu" ref={menuRef}><summary className="mono">Design / {APPEARANCES.find((item) => item.id === appearance)?.name} <span aria-hidden="true">⌄</span></summary>{choices}</details> : <div className="appearance-gallery">{choices}</div>;
}
