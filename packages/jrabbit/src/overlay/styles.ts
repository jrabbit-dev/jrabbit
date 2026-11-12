export const css = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; }
.root {
  --bg: #0b0b0b; --fg: #f5f5f5; --muted: #8a8a8a; --line: rgba(255,255,255,.12);
  --accent: #b4ff39; --danger: #ff6b5e; --shadow: 0 8px 24px rgba(0,0,0,.28), 0 0 0 1px rgba(255,255,255,.06);
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  font: 12px/1.45 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  color: var(--fg); -webkit-font-smoothing: antialiased;
}
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; transition: scale 160ms var(--ease-out); }
/* Press feedback. "scale" instead of "transform" so it never fights positioning transforms. */
button:not(:disabled):active { scale: .97; }
button:focus-visible, textarea:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }

.bar {
  position: fixed; right: 16px; bottom: 16px; pointer-events: auto;
  display: flex; align-items: center; gap: 2px; padding: 4px;
  background: var(--bg); border-radius: 10px; box-shadow: var(--shadow);
}
.bar button { height: 28px; padding: 0 10px; border-radius: 7px; white-space: nowrap; }
.bar button[aria-pressed="true"] { background: var(--fg); color: var(--bg); }
.bar .send { background: var(--accent); color: #000; }
.bar button:disabled { background: transparent; color: var(--muted); cursor: default; }
.logo { display: flex; align-items: center; padding: 0 8px 0 6px; overflow: hidden; }
.logo svg { width: 24px; height: auto; display: block; }
/* Point mode: the rabbit runs in place. Three frames (stretch, gather, push), 140ms each,
   stepped like a sprite; on the stretch it is off the ground, one pixel up. */
.logo :is(.b, .c) { visibility: hidden; }
.logo:is(.running, .dash) .a { animation: frame 420ms steps(1) infinite; translate: 0 -1px; }
.logo:is(.running, .dash) .b { animation: frame 420ms steps(1) -280ms infinite; }
.logo:is(.running, .dash) .c { animation: frame 420ms steps(1) -140ms infinite; }
@keyframes frame { 0% { visibility: visible; } 33.333% { visibility: hidden; } }
/* Send: the rabbit sprints off with the pins and comes back from the other side. */
.logo.dash svg { animation: dash 700ms; }
@keyframes dash {
  0% { translate: 0; animation-timing-function: cubic-bezier(.5, 0, .75, 0); }
  45% { translate: -40px; }
  45.01% { translate: 40px; animation-timing-function: var(--ease-out); }
  100% { translate: 0; }
}
kbd { color: var(--muted); margin-left: 6px; font: inherit; }

.status { display: flex; align-items: center; gap: 6px; padding: 0 10px 0 4px; color: var(--muted); white-space: nowrap; }
.status i { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); transition: background-color 200ms ease; }
.status[data-tone="ok"] i { background: var(--accent); }
.status[data-tone="busy"] i { background: var(--fg); }
.status[data-tone="error"] { color: var(--fg); }
.status[data-tone="error"] i { background: var(--danger); }
.bar .reload { height: 22px; padding: 0 8px; margin-left: 2px; border-radius: 5px; background: var(--fg); color: var(--bg); }

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
.peek {
  position: fixed; width: 260px; padding: 10px 12px; pointer-events: none;
  background: var(--bg); color: var(--fg); border-radius: 8px; box-shadow: var(--shadow);
  transition: opacity 150ms var(--ease-out);
}
.peek .row { justify-content: flex-start; gap: 8px; margin: 0; }
.peek .comment { margin: 6px 0 0; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.peek .summary { margin: 6px 0 0; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.composer {
  position: fixed; width: 300px; pointer-events: auto; padding: 10px;
  background: var(--bg); border-radius: 10px; box-shadow: var(--shadow);
  transform-origin: top left; transition: opacity 150ms var(--ease-out), scale 150ms var(--ease-out);
}
.composer .error { color: var(--danger); margin-top: 8px; }
.composer textarea {
  display: block; width: 100%; min-height: 72px; resize: vertical; padding: 8px;
  font: inherit; color: var(--fg); background: rgba(255,255,255,.05);
  border: 1px solid var(--line); border-radius: 6px;
}
.composer .head { display: flex; gap: 8px; align-items: baseline; margin-bottom: 8px; }
.composer .meta { flex: 1; min-width: 0; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.composer .link { flex: none; color: var(--muted); text-decoration: underline; text-underline-offset: 2px; }
.composer .link:hover { color: var(--fg); }
.btn.ghost { background: none; color: var(--muted); margin-right: auto; }
.row { display: flex; gap: 6px; align-items: center; justify-content: flex-end; margin-top: 8px; }
.row .grow { flex: 1; }
.row.archive { margin: 0; padding: 10px 14px; justify-content: flex-start; }
.btn { height: 26px; padding: 0 10px; border-radius: 6px; background: rgba(255,255,255,.08); }
.btn.primary { background: var(--fg); color: var(--bg); }
.btn.accent { background: var(--accent); color: #000; }
.btn:disabled { opacity: .5; cursor: default; }

.panel {
  position: fixed; right: 16px; bottom: 60px; width: 360px; max-height: min(70vh, 640px);
  overflow: auto; pointer-events: auto; background: var(--bg); border-radius: 10px; box-shadow: var(--shadow);
  transform-origin: bottom right; transition: opacity 200ms var(--ease-out), scale 200ms var(--ease-out);
}
.tabs { display: flex; gap: 2px; padding: 6px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--bg); }
.tabs button { padding: 4px 8px; border-radius: 6px; color: var(--muted); }
.tabs button[aria-selected="true"] { color: var(--fg); background: rgba(255,255,255,.08); }
.tabs .close { margin-left: auto; width: 26px; display: grid; place-items: center; padding: 0; }
.tabs .close svg { width: 10px; height: 10px; }
.empty { padding: 20px 14px; color: var(--muted); }
.item { padding: 12px 14px; border-bottom: 1px solid var(--line); }
.item:last-child { border-bottom: 0; }
.item header { display: flex; gap: 8px; align-items: baseline; margin-bottom: 4px; }
.item .n { font-weight: 700; }
.item .took { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
.badge { padding: 0 6px; border-radius: 4px; background: rgba(255,255,255,.08); color: var(--muted); }
.badge[data-status="draft"] { color: var(--fg); }
.badge[data-status="sent"] { color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: none; }
.badge[data-status="working"] { color: #000; background: var(--accent); }
.badge[data-status="resolved"] { color: var(--bg); background: var(--fg); }
.src { color: var(--muted); word-break: break-all; margin-top: 4px; }
.note { color: var(--muted); margin-top: 4px; }
.shots { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px; }
.shots figure { margin: 0; }
.shots figcaption { color: var(--muted); margin-bottom: 2px; }
.shots img { display: block; width: 100%; height: 90px; object-fit: contain; background: #fff; border-radius: 4px; }
.shots[data-wide] { grid-template-columns: max-content; overflow-x: auto; padding-bottom: 2px; }
.shots[data-wide] figcaption { position: sticky; left: 0; width: max-content; }
.shots[data-wide] img { width: auto; height: auto; max-width: none; max-height: 90px; }
.reopen textarea { width: 100%; min-height: 48px; margin-top: 8px; padding: 6px; font: inherit; color: var(--fg); background: rgba(255,255,255,.05); border: 1px solid var(--line); border-radius: 6px; }
.rule-body { white-space: pre-wrap; color: var(--muted); margin-top: 4px; }

.toast {
  position: fixed; left: 50%; bottom: 16px; translate: -50% 0; pointer-events: none;
  padding: 6px 12px; background: var(--bg); border-radius: 8px; box-shadow: var(--shadow);
  transition: opacity 200ms var(--ease-out), translate 200ms var(--ease-out);
}

/* Enter states: panel grows from the toolbar, composer from the click, toast rises. */
@starting-style {
  .panel, .composer { opacity: 0; scale: .97; }
  .peek { opacity: 0; }
  .toast { opacity: 0; translate: -50% 6px; }
}

/* Hover only where a real pointer exists, so taps don't leave stuck highlights. */
@media (hover: hover) and (pointer: fine) {
  .bar button:not(:disabled):not([aria-pressed="true"]):not(.send):not(.reload):hover { background: rgba(255,255,255,.08); }
  .bar .send:not(:disabled):hover { filter: brightness(1.08); }
  .tabs .close:hover { color: var(--fg); background: rgba(255,255,255,.08); }
  .btn:not(.primary):not(.accent):not(:disabled):hover { background: rgba(255,255,255,.14); }
  .btn.primary:not(:disabled):hover, .btn.accent:not(:disabled):hover { filter: brightness(1.08); }
}

/* Keep fades (they help orientation), drop movement. */
@media (prefers-reduced-motion: reduce) {
  button { transition: none; }
  .logo:is(.running, .dash) :is(.a, .b, .c) { animation: none; translate: none; }
  .logo.dash svg { animation: dash 1ms; }
  button:not(:disabled):active { scale: none; }
  .panel, .composer, .toast { transition: opacity 150ms ease; }
  @starting-style {
    .panel, .composer { scale: none; }
    .toast { translate: -50% 0; }
  }
}
`;

/** 8-bit rabbit, 16×9 grid, running left. Frame A: stretched (the logo). */
export const rabbitPath =
  "M9 0h3v1h-3zM7 1h3v1h-3zM2 2h5v1h-5zM1 3h1v1h-1zM3 3h2v1h-2zM7 3h5v1h-5zM13 3h1v1h-1zM0 4h5v1h-5zM6 4h7v1h-7zM1 5h12v1h-12zM2 6h2v1h-2zM8 6h6v1h-6zM1 7h2v1h-2zM10 7h4v1h-4zM0 8h1v1h-1zM11 8h5v1h-5z";

/** Frame B: legs gathered under the body. */
export const rabbitPathGathered =
  "M9 0h3v1h-3zM7 1h3v1h-3zM2 2h5v1h-5zM1 3h1v1h-1zM3 3h2v1h-2zM7 3h5v1h-5zM13 3h1v1h-1zM0 4h5v1h-5zM6 4h7v1h-7zM1 5h12v1h-12zM3 6h2v1h-2zM7 6h6v1h-6zM4 7h2v1h-2zM7 7h4v1h-4zM2 8h4v1h-4zM8 8h4v1h-4z";

/** Frame C: pushing off, hind legs stretched back to the ground. */
export const rabbitPathPush =
  "M9 0h3v1h-3zM7 1h3v1h-3zM2 2h5v1h-5zM1 3h1v1h-1zM3 3h2v1h-2zM7 3h5v1h-5zM13 3h1v1h-1zM0 4h5v1h-5zM6 4h7v1h-7zM1 5h12v1h-12zM2 6h3v1h-3zM8 6h6v1h-6zM4 7h2v1h-2zM11 7h4v1h-4zM12 8h4v1h-4z";
