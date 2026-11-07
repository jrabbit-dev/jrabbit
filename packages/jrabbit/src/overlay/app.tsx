import { useEffect, useRef, useState } from "preact/hooks";
import type { OverlayState, Pin, Rule } from "../shared/types.js";
import type { Api, Connection } from "./api.js";
import { capture, describe, findElement, reactDebug } from "./dom.js";
import { rabbitPath, rabbitPathGathered, rabbitPathPush } from "./styles.js";
import { rebase } from "../shared/url.js";

type Mode = "idle" | "point";
type Tab = "pins" | "rules";

interface Props {
  api: Api;
  host: HTMLElement;
}

const Rabbit = () => (
  <svg viewBox="0 -1 16 10" shape-rendering="crispEdges" aria-hidden="true">
    <path class="a" fill="currentColor" d={rabbitPath} />
    <path class="b" fill="currentColor" d={rabbitPathGathered} />
    <path class="c" fill="currentColor" d={rabbitPathPush} />
  </svg>
);

/** Preact 11 does not append "px" to numeric style values. */
const px = (n: number) => `${Math.round(n)}px`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isOurs = (e: Event, host: HTMLElement) => e.composedPath().includes(host);

export function App({ api, host }: Props) {
  const [state, setState] = useState<OverlayState>({ pins: [], rules: [], target: null, agent: "none" });
  const [connection, setConnection] = useState<Connection>("connecting");
  const live = connection === "live";
  const [mode, setMode] = useState<Mode>("idle");
  const [hover, setHover] = useState<{ rect: DOMRect; label: string } | null>(null);
  const [target, setTarget] = useState<Element | null>(null);
  const [panel, setPanel] = useState<Tab | null>(null);
  const [dash, setDash] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2400);
  };

  // Server events: state, after-capture requests, toasts.
  useEffect(() => {
    // One capture at a time (they share the page), all counting from when they were asked.
    let captures = Promise.resolve();
    return api.events((e) => {
      if (e.type === "state") setState(e.state);
      if (e.type === "toast") showToast(e.message);
      if (e.type === "capture-after") {
        if (e.path !== location.pathname) return;
        const asked = Date.now();
        captures = captures.then(async () => {
          // Give HMR time to apply the agent's change.
          let el: Element | null = null;
          for (let i = 0; i < 6 && !el; i++) {
            await sleep(i === 0 ? Math.max(0, asked + 1500 - Date.now()) : 800);
            el = findElement(e.selector, e.text);
          }
          const shot = el ? await capture(el, host).catch(() => null) : null;
          await api.after(e.id, shot).catch(() => undefined);
        });
      }
    }, setConnection);
  }, []);

  // Absolute links and forms to the dev server stay in the review.
  useEffect(() => {
    const origin = state.target;
    if (!origin) return;
    const toReview = (url: string) => rebase(url, origin, location.origin);
    const link = (e: MouseEvent) => {
      if (isOurs(e, host)) return;
      const a = e.composedPath().find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement);
      const next = a?.href && toReview(a.href);
      if (a && next) a.href = next;
    };
    const submit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      const action = (e.submitter as HTMLButtonElement | null)?.formAction || form.action;
      const next = action && toReview(action);
      if (next) form.action = next;
    };
    const opts = { capture: true };
    window.addEventListener("click", link, opts);
    window.addEventListener("auxclick", link, opts);
    window.addEventListener("submit", submit, opts);
    return () => {
      window.removeEventListener("click", link, opts);
      window.removeEventListener("auxclick", link, opts);
      window.removeEventListener("submit", submit, opts);
    };
  }, [state.target]);

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

  // Keyboard: P toggles pointing. Esc closes the composer, then point mode, then the panel.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.composedPath().some((n) => n instanceof HTMLTextAreaElement || n instanceof HTMLInputElement || (n as HTMLElement).isContentEditable);
      if (e.key === "Escape") {
        if (target) setTarget(null);
        else if (mode === "point") setMode("idle");
        else setPanel(null);
      } else if (live && !typing && (e.key === "p" || e.key === "P") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setMode((m) => (m === "point" ? "idle" : "point"));
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [target, live, mode]);

  // Leave point mode if the connection drops: pins could not be saved.
  useEffect(() => {
    if (!live) setMode("idle");
  }, [live]);

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
    try {
      const { sent } = await api.send();
      setMode("idle");
      setDash(true);
      const pins = `${sent} pin${sent === 1 ? "" : "s"}`;
      showToast(
        state.agent === "listening"
          ? `Sent ${pins} to your agent`
          : state.agent === "none"
            ? `Saved ${pins}. No agent connected yet.`
            : `Sent ${pins}. Your agent is not waiting: tell it to check jrabbit.`,
      );
    } catch {
      showToast("Could not send. Is jrabbit still running?");
    }
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

      {panel && <Panel tab={panel} setTab={setPanel} onClose={() => setPanel(null)} state={state} api={api} />}

      <div class="bar" role="toolbar" aria-label="jrabbit">
        <span
          class={dash ? "logo dash" : mode === "point" ? "logo running" : "logo"}
          title="jrabbit"
          onAnimationEnd={(e) => e.animationName === "dash" && setDash(false)}
        >
          <Rabbit />
        </span>
        <Status connection={connection} state={state} />
        <button
          aria-pressed={mode === "point"}
          disabled={!live}
          onClick={() => setMode(mode === "point" ? "idle" : "point")}
          title="Point at an element (P)"
        >
          Point<kbd>P</kbd>
        </button>
        <button aria-pressed={panel !== null} onClick={() => setPanel(panel ? null : "pins")}>
          Pins {state.pins.filter((p) => p.status !== "approved").length}
          {draftRules.length > 0 && ` · Rules ${draftRules.length}`}
        </button>
        <button class="send" disabled={!live || drafts.length === 0} onClick={send}>
          Send {drafts.length || ""}
        </button>
      </div>

      {toast && <div class="toast">{toast}</div>}
    </div>
  );
}

/** Where things stand, in one glance: is jrabbit up, and is an agent on the other end. */
function Status({ connection, state }: { connection: Connection; state: OverlayState }) {
  let tone: "ok" | "busy" | "idle" | "error" = "idle";
  let label: string;
  let hint: string;
  if (connection === "offline") {
    tone = "error";
    label = "Stopped";
    hint = "jrabbit is not running. Ask your agent to open the review again.";
  } else if (connection === "expired") {
    tone = "error";
    label = "Session ended";
    hint = "jrabbit restarted. Reload the page to reconnect.";
  } else if (connection === "connecting") {
    label = "Connecting…";
    hint = "Connecting to jrabbit";
  } else {
    const working = state.pins.filter((p) => p.status === "open" && p.deliveredAt).map((p) => `#${p.n}`);
    if (state.agent === "none") {
      label = "No agent";
      hint = "Pins are saved locally. Your agent receives them when it calls wait_for_feedback.";
    } else if (working.length) {
      tone = "busy";
      label = `Working on ${working.slice(0, 3).join(" ")}${working.length > 3 ? "…" : ""}`;
      hint = "Your agent is changing the code for these pins.";
    } else if (state.agent === "listening") {
      tone = "ok";
      label = "Listening";
      hint = "Your agent is waiting. Point, comment, then Send.";
    } else {
      tone = "busy";
      label = "Agent connected";
      hint = "Your agent is connected but not waiting. Pins you send wait until you tell it to check jrabbit.";
    }
  }
  return (
    <span class="status" data-tone={tone} title={hint} role="status" aria-live="polite">
      <i aria-hidden="true" />
      {label}
      {connection === "expired" && (
        <button class="reload" onClick={() => location.reload()}>
          Reload
        </button>
      )}
    </span>
  );
}

/**
 * Large wide elements (nav bars, banners) would shrink to a sliver side by side. Stack them
 * instead, near their real size, and scroll before and after together. Small ones still fit.
 */
const isWide = ({ element: { rect } }: Pin) => rect.width > 320 && rect.width > rect.height * 2;

/** What the human reads on a pin: "open" splits into sent (not picked up yet) and working. */
const statusLabel = (p: Pin) => (p.status === "open" ? (p.deliveredAt ? "working" : "sent") : p.status);

function Marker({ pin, onClick }: { pin: Pin; onClick: () => void }) {
  const [peek, setPeek] = useState(false);
  const el = findElement(pin.element.selector, pin.element.text);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return null;
  return (
    <>
      <button
        class="marker"
        data-status={pin.status}
        style={{ position: "fixed", left: px(r.left), top: px(r.top) }}
        onClick={onClick}
        onPointerEnter={() => setPeek(true)}
        onPointerLeave={() => setPeek(false)}
        onFocus={() => setPeek(true)}
        onBlur={() => setPeek(false)}
        aria-label={`Pin ${pin.n}: ${pin.comment}`}
      >
        {pin.n}
      </button>
      {peek && <Peek pin={pin} r={r} />}
    </>
  );
}

const PEEK_W = 260;

/** Hover preview of a pin: its element outlined and a card with the comment. */
function Peek({ pin, r }: { pin: Pin; r: DOMRect }) {
  const right = r.left + 14 + PEEK_W > innerWidth - 8;
  const below = r.top < innerHeight - 160;
  const src = pin.source ? `${pin.source.file}:${pin.source.line}` : null;
  return (
    <>
      <div class="hover" style={{ left: px(r.left), top: px(r.top), width: px(r.width), height: px(r.height) }} />
      <div
        class="peek"
        style={{
          left: px(right ? r.left - 14 - PEEK_W : r.left + 14),
          ...(below ? { top: px(r.top + 14) } : { bottom: px(innerHeight - r.top + 14) }),
        }}
      >
        <div class="row">
          <strong>#{pin.n}</strong>
          <span class="badge" data-status={statusLabel(pin)}>
            {statusLabel(pin)}
          </span>
        </div>
        <p class="comment">{pin.comment}</p>
        {pin.resolution && <p class="summary">{pin.resolution.summary}</p>}
        {src && <div class="src">{src}</div>}
      </div>
    </>
  );
}

function Composer(props: { el: Element; host: HTMLElement; api: Api; onSelect: (el: Element) => void; onDone: (pin: Pin | null) => void }) {
  const { el, host, api, onSelect, onDone } = props;
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), [el]);

  const r = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left), innerWidth - 308);
  const top = r.bottom + 8 + 160 < innerHeight ? r.bottom + 8 : Math.max(8, r.top - 168);
  const { component } = reactDebug(el);

  const submit = async () => {
    if (!comment.trim() || busy) return;
    setBusy(true);
    setError(false);
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
      setError(true);
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
      {error && <p class="error">Could not save the pin. Is jrabbit still running?</p>}
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

function Panel({ tab, setTab, onClose, state, api }: { tab: Tab; setTab: (t: Tab) => void; onClose: () => void; state: OverlayState; api: Api }) {
  const pins = [...state.pins].reverse();
  const approved = state.pins.filter((p) => p.status === "approved").length;
  return (
    <div class="panel">
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "pins"} onClick={() => setTab("pins")}>
          Pins
        </button>
        <button role="tab" aria-selected={tab === "rules"} onClick={() => setTab("rules")}>
          Rules
        </button>
        <button class="close" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      {tab === "pins" &&
        (pins.length ? pins.map((p) => <PinItem key={p.id} pin={p} api={api} />) : <p class="empty">No pins yet. Press P and click an element.</p>)}
      {tab === "pins" && approved > 0 && (
        <div class="row archive">
          <button class="btn" onClick={() => api.archive()} title="Move approved pins to .jrabbit/archive">
            Archive {approved} approved
          </button>
        </div>
      )}
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
        <span class="badge" data-status={statusLabel(pin)}>
          {statusLabel(pin)}
        </span>
      </header>
      <p>{pin.comment}</p>
      {src && <p class="src">{src}</p>}
      {lastNote && <p class="note">{lastNote.by === "agent" ? "Agent" : "You"}: {lastNote.note}</p>}
      {(pin.shots.before || pin.shots.after) && (
        <div class="shots" data-wide={isWide(pin) ? "" : undefined}>
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
      <div class="row">
        <button class="btn" onClick={() => api.deleteRule(rule.slug)}>
          {rule.status === "draft" ? "Discard" : "Remove"}
        </button>
        {rule.status === "draft" && (
          <button class="btn accent" onClick={() => api.approveRule(rule.slug)}>
            Approve rule
          </button>
        )}
      </div>
    </div>
  );
}
