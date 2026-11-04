import { useEffect, useRef, useState } from "preact/hooks";
import type { OverlayState, Pin, Rule } from "../shared/types.js";
import type { Api } from "./api.js";
import { capture, describe, findElement, reactDebug } from "./dom.js";
import { rabbitPath } from "./styles.js";

type Mode = "idle" | "point";
type Tab = "pins" | "rules";

interface Props {
  api: Api;
  host: HTMLElement;
}

const Rabbit = () => (
  <svg viewBox="0 0 16 9" shape-rendering="crispEdges" aria-hidden="true">
    <path fill="currentColor" d={rabbitPath} />
  </svg>
);

/** Preact 11 does not append "px" to numeric style values. */
const px = (n: number) => `${Math.round(n)}px`;

const isOurs = (e: Event, host: HTMLElement) => e.composedPath().includes(host);

export function App({ api, host }: Props) {
  const [state, setState] = useState<OverlayState>({ pins: [], rules: [], target: null });
  const [mode, setMode] = useState<Mode>("idle");
  const [hover, setHover] = useState<{ rect: DOMRect; label: string } | null>(null);
  const [target, setTarget] = useState<Element | null>(null);
  const [panel, setPanel] = useState<Tab | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2400);
  };

  // Server events: state, after-capture requests, toasts.
  useEffect(
    () =>
      api.events(async (e) => {
        if (e.type === "state") setState(e.state);
        if (e.type === "toast") showToast(e.message);
        if (e.type === "capture-after") {
          if (e.path !== location.pathname) return;
          // Give HMR time to apply the agent's change.
          let el: Element | null = null;
          for (let i = 0; i < 6 && !el; i++) {
            await new Promise((r) => setTimeout(r, i === 0 ? 1500 : 800));
            el = findElement(e.selector, e.text);
          }
          await api.after(e.id, el ? await capture(el, host) : null).catch(() => undefined);
        }
      }),
    [],
  );

  // Pointing: highlight under the cursor, click selects, the app never sees the click.
  useEffect(() => {
    if (mode !== "point" || target) return;
    const move = (e: PointerEvent) => {
      if (isOurs(e, host)) return setHover(null);
      const el = e.target as Element;
      const { component } = reactDebug(el);
      const tag = el.tagName.toLowerCase();
      setHover({ rect: el.getBoundingClientRect(), label: component ? `${component} · ${tag}` : tag });
    };
    const block = (e: Event) => {
      if (isOurs(e, host)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const click = (e: MouseEvent) => {
      if (isOurs(e, host)) return;
      block(e);
      setTarget(e.target as Element);
      setHover(null);
    };
    const opts = { capture: true };
    window.addEventListener("pointermove", move, opts);
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup"]) window.addEventListener(t, block, opts);
    window.addEventListener("click", click, opts);
    return () => {
      window.removeEventListener("pointermove", move, opts);
      for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup"]) window.removeEventListener(t, block, opts);
      window.removeEventListener("click", click, opts);
      setHover(null);
    };
  }, [mode, target]);

  // Keyboard: P toggles pointing, Esc leaves.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.composedPath().some((n) => n instanceof HTMLTextAreaElement || n instanceof HTMLInputElement || (n as HTMLElement).isContentEditable);
      if (e.key === "Escape") {
        if (target) setTarget(null);
        else setMode("idle");
      } else if (!typing && (e.key === "p" || e.key === "P") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setMode((m) => (m === "point" ? "idle" : "point"));
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [target]);

  // Markers follow scroll, resize and layout changes.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    const now = () => setTick((t) => t + 1);
    window.addEventListener("scroll", now, { capture: true, passive: true });
    window.addEventListener("resize", now);
    return () => {
      clearInterval(id);
      window.removeEventListener("scroll", now, { capture: true });
      window.removeEventListener("resize", now);
    };
  }, []);

  const drafts = state.pins.filter((p) => p.status === "draft");
  const here = state.pins.filter((p) => p.page.path === location.pathname && p.status !== "approved");
  const draftRules = state.rules.filter((r) => r.status === "draft");

  const send = async () => {
    const { sent } = await api.send();
    setMode("idle");
    showToast(`Sent ${sent} pin${sent === 1 ? "" : "s"} to your agent`);
  };

  return (
    <div class="root">
      {here.map((p) => (
        <Marker key={p.id} pin={p} onClick={() => setPanel("pins")} />
      ))}

      {hover && (
        <div
          class="hover"
          data-inside={hover.rect.top < 24 ? "" : undefined}
          style={{ left: px(hover.rect.left), top: px(hover.rect.top), width: px(hover.rect.width), height: px(hover.rect.height) }}
        >
          <span>{hover.label}</span>
        </div>
      )}

      {target && (
        <Composer
          el={target}
          host={host}
          api={api}
          onSelect={setTarget}
          onDone={(pin) => {
            setTarget(null);
            if (pin) showToast(`#${pin.n} added. Press Send when ready.`);
          }}
        />
      )}

      {panel && <Panel tab={panel} setTab={setPanel} state={state} api={api} />}

      <div class="bar" role="toolbar" aria-label="jrabbit">
        <span class="logo" title="jrabbit">
          <Rabbit />
        </span>
        <button aria-pressed={mode === "point"} onClick={() => setMode(mode === "point" ? "idle" : "point")} title="Point at an element (P)">
          Point<kbd>P</kbd>
        </button>
        <button aria-pressed={panel !== null} onClick={() => setPanel(panel ? null : "pins")}>
          Pins {state.pins.filter((p) => p.status !== "approved").length}
          {draftRules.length > 0 && ` · Rules ${draftRules.length}`}
        </button>
        <button class="send" disabled={drafts.length === 0} onClick={send}>
          Send {drafts.length || ""}
        </button>
      </div>

      {toast && <div class="toast">{toast}</div>}
    </div>
  );
}

function Marker({ pin, onClick }: { pin: Pin; onClick: () => void }) {
  const el = findElement(pin.element.selector, pin.element.text);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return null;
  return (
    <button
      class="marker"
      data-status={pin.status}
      style={{ position: "fixed", left: px(r.left), top: px(r.top) }}
      onClick={onClick}
      title={pin.comment}
    >
      {pin.n}
    </button>
  );
}

function Composer(props: { el: Element; host: HTMLElement; api: Api; onSelect: (el: Element) => void; onDone: (pin: Pin | null) => void }) {
  const { el, host, api, onSelect, onDone } = props;
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), [el]);

  const r = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left), innerWidth - 308);
  const top = r.bottom + 8 + 160 < innerHeight ? r.bottom + 8 : Math.max(8, r.top - 168);
  const { component } = reactDebug(el);

  const submit = async () => {
    if (!comment.trim() || busy) return;
    setBusy(true);
    try {
      const pin = await api.createPin({
        comment,
        page: { url: location.href, path: location.pathname, title: document.title },
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1 },
        element: describe(el),
        debug: reactDebug(el).entries,
        shot: await capture(el, host),
      });
      onDone(pin);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div class="composer" style={{ left: px(left), top: px(top) }}>
      <div class="meta">
        {component ? `${component} · ` : ""}
        {el.tagName.toLowerCase()}
      </div>
      <textarea
        ref={ref}
        value={comment}
        placeholder="What should change?"
        onInput={(e) => setComment((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
      />
      <div class="row">
        <button
          class="btn grow"
          style={{ textAlign: "left" }}
          disabled={!el.parentElement || el.parentElement === document.body}
          onClick={() => el.parentElement && onSelect(el.parentElement)}
          title="Select the parent element"
        >
          ↑ Parent
        </button>
        <button class="btn" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button class="btn primary" disabled={!comment.trim() || busy} onClick={submit}>
          {busy ? "Adding…" : "Add ⌘↵"}
        </button>
      </div>
    </div>
  );
}

function Panel({ tab, setTab, state, api }: { tab: Tab; setTab: (t: Tab) => void; state: OverlayState; api: Api }) {
  const pins = [...state.pins].reverse();
  return (
    <div class="panel">
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "pins"} onClick={() => setTab("pins")}>
          Pins
        </button>
        <button role="tab" aria-selected={tab === "rules"} onClick={() => setTab("rules")}>
          Rules
        </button>
      </div>
      {tab === "pins" &&
        (pins.length ? pins.map((p) => <PinItem key={p.id} pin={p} api={api} />) : <p class="empty">No pins yet. Press P and click an element.</p>)}
      {tab === "rules" &&
        (state.rules.length ? (
          state.rules.map((r) => <RuleItem key={r.slug} rule={r} api={api} />)
        ) : (
          <p class="empty">No rules yet. Your agent proposes them when you repeat a correction.</p>
        ))}
    </div>
  );
}

function PinItem({ pin, api }: { pin: Pin; api: Api }) {
  const [reopening, setReopening] = useState(false);
  const [note, setNote] = useState("");
  const src = pin.source ? `${pin.source.file}:${pin.source.line}` : null;
  const lastNote = [...pin.history].reverse().find((h) => h.note);
  return (
    <div class="item">
      <header>
        <span class="n">#{pin.n}</span>
        <span class="badge" data-status={pin.status}>
          {pin.status}
        </span>
      </header>
      <p>{pin.comment}</p>
      {src && <p class="src">{src}</p>}
      {lastNote && <p class="note">{lastNote.by === "agent" ? "Agent" : "You"}: {lastNote.note}</p>}
      {(pin.shots.before || pin.shots.after) && (
        <div class="shots">
          <figure>
            <figcaption>Before</figcaption>
            {pin.shots.before && <img src={api.shotUrl(pin.shots.before)} alt={`Before #${pin.n}`} />}
          </figure>
          <figure>
            <figcaption>After</figcaption>
            {pin.shots.after && <img src={api.shotUrl(pin.shots.after) + `&v=${pin.updatedAt}`} alt={`After #${pin.n}`} />}
          </figure>
        </div>
      )}
      {pin.status === "draft" && (
        <div class="row">
          <button class="btn" onClick={() => api.deletePin(pin.id)}>
            Delete
          </button>
        </div>
      )}
      {pin.status === "resolved" && !reopening && (
        <div class="row">
          <button class="btn" onClick={() => setReopening(true)}>
            Reopen
          </button>
          <button class="btn accent" onClick={() => api.approve(pin.id)}>
            Approve
          </button>
        </div>
      )}
      {reopening && (
        <div class="reopen">
          <textarea value={note} placeholder="What is still wrong?" onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
          <div class="row">
            <button class="btn" onClick={() => setReopening(false)}>
              Cancel
            </button>
            <button
              class="btn primary"
              onClick={async () => {
                await api.reopen(pin.id, note);
                setReopening(false);
                setNote("");
              }}
            >
              Reopen and send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RuleItem({ rule, api }: { rule: Rule; api: Api }) {
  return (
    <div class="item">
      <header>
        <span class="n">{rule.title}</span>
        <span class="badge">{rule.status}</span>
      </header>
      <p class="rule-body">{rule.body}</p>
      <p class="src">{rule.path}</p>
      {rule.status === "draft" && (
        <div class="row">
          <button class="btn accent" onClick={() => api.approveRule(rule.slug)}>
            Approve rule
          </button>
        </div>
      )}
    </div>
  );
}
