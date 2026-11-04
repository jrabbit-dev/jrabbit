export const css = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; }
.root {
  --bg: #0b0b0b; --fg: #f5f5f5; --muted: #8a8a8a; --line: rgba(255,255,255,.12);
  --accent: #b4ff39; --shadow: 0 8px 24px rgba(0,0,0,.28), 0 0 0 1px rgba(255,255,255,.06);
  font: 12px/1.45 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  color: var(--fg); -webkit-font-smoothing: antialiased;
}
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
button:focus-visible, textarea:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }

.bar {
  position: fixed; right: 16px; bottom: 16px; pointer-events: auto;
  display: flex; align-items: center; gap: 2px; padding: 4px;
  background: var(--bg); border-radius: 10px; box-shadow: var(--shadow);
}
.bar button { height: 28px; padding: 0 10px; border-radius: 7px; white-space: nowrap; }
.bar button:hover { background: rgba(255,255,255,.08); }
.bar button[aria-pressed="true"] { background: var(--fg); color: var(--bg); }
.bar .send { background: var(--accent); color: #000; }
.bar .send:hover { background: var(--accent); filter: brightness(1.08); }
.bar .send:disabled { background: transparent; color: var(--muted); cursor: default; }
.logo { display: flex; align-items: center; padding: 0 8px 0 6px; }
.logo svg { width: 24px; height: auto; display: block; }
kbd { color: var(--muted); margin-left: 6px; font: inherit; }

.hover {
  position: fixed; pointer-events: none; border: 1.5px solid var(--accent);
  background: rgba(180,255,57,.08); border-radius: 2px;
}
.hover span {
  position: absolute; left: -1.5px; bottom: 100%; margin-bottom: 4px; padding: 2px 6px;
  background: var(--bg); color: var(--fg); border-radius: 4px; white-space: nowrap;
}
.hover[data-inside] span { bottom: auto; top: 4px; left: 4px; margin: 0; }

.marker {
  position: absolute; pointer-events: auto; min-width: 20px; height: 20px; padding: 0 5px;
  display: grid; place-items: center; transform: translate(-50%, -50%);
  background: var(--bg); color: var(--fg); border: 1.5px solid var(--accent); border-radius: 10px;
  font-size: 11px; cursor: pointer;
}
.marker[data-status="resolved"] { border-color: var(--fg); }
.marker[data-status="approved"] { opacity: .45; border-color: var(--muted); }

.composer {
  position: fixed; width: 300px; pointer-events: auto; padding: 10px;
  background: var(--bg); border-radius: 10px; box-shadow: var(--shadow);
}
.composer textarea {
  display: block; width: 100%; min-height: 72px; resize: vertical; padding: 8px;
  font: inherit; color: var(--fg); background: rgba(255,255,255,.05);
  border: 1px solid var(--line); border-radius: 6px;
}
.composer .meta { color: var(--muted); margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row { display: flex; gap: 6px; align-items: center; justify-content: flex-end; margin-top: 8px; }
.row .grow { flex: 1; }
.btn { height: 26px; padding: 0 10px; border-radius: 6px; background: rgba(255,255,255,.08); }
.btn:hover { background: rgba(255,255,255,.14); }
.btn.primary { background: var(--fg); color: var(--bg); }
.btn.accent { background: var(--accent); color: #000; }
.btn:disabled { opacity: .5; cursor: default; }

.panel {
  position: fixed; right: 16px; bottom: 60px; width: 360px; max-height: min(70vh, 640px);
  overflow: auto; pointer-events: auto; background: var(--bg); border-radius: 10px; box-shadow: var(--shadow);
}
.tabs { display: flex; gap: 2px; padding: 6px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); }
.tabs button { padding: 4px 8px; border-radius: 6px; color: var(--muted); }
.tabs button[aria-selected="true"] { color: var(--fg); background: rgba(255,255,255,.08); }
.empty { padding: 20px 14px; color: var(--muted); }
.item { padding: 12px 14px; border-bottom: 1px solid var(--line); }
.item:last-child { border-bottom: 0; }
.item header { display: flex; gap: 8px; align-items: baseline; margin-bottom: 4px; }
.item .n { font-weight: 700; }
.badge { padding: 0 6px; border-radius: 4px; background: rgba(255,255,255,.08); color: var(--muted); }
.badge[data-status="draft"] { color: var(--fg); }
.badge[data-status="open"] { color: #000; background: var(--accent); }
.badge[data-status="resolved"] { color: var(--bg); background: var(--fg); }
.src { color: var(--muted); word-break: break-all; margin-top: 4px; }
.note { color: var(--muted); margin-top: 4px; }
.shots { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
.shots figure { margin: 0; }
.shots figcaption { color: var(--muted); margin-bottom: 2px; }
.shots img { display: block; width: 100%; height: 90px; object-fit: contain; background: #fff; border-radius: 4px; }
.reopen textarea { width: 100%; min-height: 48px; margin-top: 8px; padding: 6px; font: inherit; color: var(--fg); background: rgba(255,255,255,.05); border: 1px solid var(--line); border-radius: 6px; }
.rule-body { white-space: pre-wrap; color: var(--muted); margin-top: 4px; }

.toast {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); pointer-events: none;
  padding: 6px 12px; background: var(--bg); border-radius: 8px; box-shadow: var(--shadow);
  animation: in .18s ease-out;
}
@keyframes in { from { opacity: 0; transform: translate(-50%, 4px); } }
@media (prefers-reduced-motion: reduce) { .toast { animation: none; } }
`;

/** 8-bit rabbit, 16×9 grid, running left. */
export const rabbitPath =
  "M9 0h3v1h-3zM7 1h3v1h-3zM2 2h5v1h-5zM1 3h1v1h-1zM3 3h2v1h-2zM7 3h5v1h-5zM13 3h1v1h-1zM0 4h5v1h-5zM6 4h7v1h-7zM1 5h12v1h-12zM2 6h2v1h-2zM8 6h6v1h-6zM1 7h2v1h-2zM10 7h4v1h-4zM0 8h1v1h-1zM11 8h5v1h-5z";
