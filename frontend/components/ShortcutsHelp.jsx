"use client";

import React, { useEffect } from "react";
import { DEFAULT_KEYS, NAV_ACTIONS } from "@/lib/keymap";

/* A discoverable cheat-sheet of every keyboard shortcut.
   Opened with "?" from anywhere, from the command palette, or the profile menu.
   Single-key actions read the user's own bindings (Settings → Preferences). */

const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

const GROUPS = [
  {
    title: "Navigate",
    dynamicNav: true,   // rows built from the user's keymap at render time
  },
  {
    title: "Actions",
    dynamic: true,   // rows built from the user's keymap at render time
  },
  {
    title: "Note & document editor",
    rows: [
      { keys: ["↵"], label: "New block below" },
      { keys: ["Shift", "↵"], label: "New line inside a text block" },
      { keys: ["Tab"], label: "Indent / nest a list item" },
      { keys: ["Shift", "Tab"], label: "Outdent a list item" },
      { keys: ["Backspace"], label: "Delete an empty block" },
      { keys: ["/"], label: "Open the block menu" },
    ],
  },
  {
    title: "Markdown shortcuts",
    rows: [
      { keys: ["-", "␣"], label: "Start a bullet" },
      { keys: ["[", "]", "␣"], label: "Start a to-do" },
      { keys: ["#", "␣"], label: "Start a heading" },
    ],
  },
];

function Keys({ keys }) {
  return (
    <span className="shorts-keys">
      {keys.map((k, i) =>
        k === "then" ? (
          <span key={i} className="thn">then</span>
        ) : (
          <span key={i} className="kbd">{k}</span>
        )
      )}
    </span>
  );
}

export default function ShortcutsHelp({ open, onClose, keymap = DEFAULT_KEYS }) {
  const show = (k) => (k === "/" ? "/" : k.toUpperCase());
  const navRows = NAV_ACTIONS.map((a) => ({
    keys: ["G", "then", (keymap[a.id] || a.def).toUpperCase()],
    label: a.label,
  }));
  const actionRows = [
    { keys: [mod, "K"], label: "Command palette" },
    { keys: [show(keymap.capture)], label: "Quick capture — save anything" },
    { keys: [show(keymap.newItem)], label: "New item (in current section)" },
    { keys: [show(keymap.search)], label: "Focus the filter / search box" },
    { keys: [show(keymap.theme)], label: "Toggle dark / light theme" },
    { keys: [show(keymap.sidebar)], label: "Toggle the sidebar" },
    { keys: ["?"], label: "Show this shortcuts sheet" },
    { keys: ["Esc"], label: "Close menus, forms & dialogs" },
  ];
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="pal-overlay" onClick={onClose} role="dialog" aria-label="Keyboard shortcuts">
      <div className="shorts" onClick={(e) => e.stopPropagation()}>
        <button className="shorts-close" onClick={onClose} aria-label="Close">✕</button>
        <h2 className="display">Keyboard shortcuts</h2>
        <div className="subtle">Work faster — most actions have a key. Press <span className="kbd">Esc</span> to close.</div>
        <div className="shorts-grid">
          {GROUPS.map((g) => (
            <div key={g.title} className="shorts-grp">
              <h4>{g.title}{(g.dynamic || g.dynamicNav) && <span className="subtle" style={{ fontSize: 10, marginLeft: 6 }}>customizable in Settings</span>}</h4>
              {(g.dynamic ? actionRows : g.dynamicNav ? navRows : g.rows).map((r) => (
                <div key={r.label} className="shorts-row">
                  <span className="lbl">{r.label}</span>
                  <Keys keys={r.keys} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
