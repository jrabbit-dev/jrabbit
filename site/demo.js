// The landing page runs a small copy of the jrabbit overlay so visitors can try pointing.
// Pins stay in this tab. Send shows what an agent would receive; nothing leaves the page.

const PROMPT =
  "Set up jrabbit in this project: read https://jrabbit.dev/start.md and follow it. When it's ready, open a review of my local dev server.";
const CLIENTS = {
  claude: { cmd: "claude mcp add jrabbit -- npx -y jrabbit", note: "Run it from your project root." },
  codex: { cmd: "codex mcp add jrabbit -- npx -y jrabbit", note: "Run it from your project root." },
  cursor: {
    cmd: `{
  "mcpServers": {
    "jrabbit": {
      "command": "npx",
      "args": ["-y", "jrabbit"],
      "env": { "JRABBIT_ROOT": "\${workspaceFolder}" }
    }
  }
}`,
    note: "Add it to <code>.cursor/mcp.json</code> in your project, next to any servers you already have.",
  },
};
let client = "claude";

const FRAMES = {
  a: "M9 0h3v1h-3zM7 1h3v1h-3zM2 2h5v1h-5zM1 3h1v1h-1zM3 3h2v1h-2zM7 3h5v1h-5zM13 3h1v1h-1zM0 4h5v1h-5zM6 4h7v1h-7zM1 5h12v1h-12zM2 6h2v1h-2zM8 6h6v1h-6zM1 7h2v1h-2zM10 7h4v1h-4zM0 8h1v1h-1zM11 8h5v1h-5z",
  b: "M9 0h3v1h-3zM7 1h3v1h-3zM2 2h5v1h-5zM1 3h1v1h-1zM3 3h2v1h-2zM7 3h5v1h-5zM13 3h1v1h-1zM0 4h5v1h-5zM6 4h7v1h-7zM1 5h12v1h-12zM3 6h2v1h-2zM7 6h6v1h-6zM4 7h2v1h-2zM7 7h4v1h-4zM2 8h4v1h-4zM8 8h4v1h-4z",
  c: "M9 0h3v1h-3zM7 1h3v1h-3zM2 2h5v1h-5zM1 3h1v1h-1zM3 3h2v1h-2zM7 3h5v1h-5zM13 3h1v1h-1zM0 4h5v1h-5zM6 4h7v1h-7zM1 5h12v1h-12zM2 6h3v1h-3zM8 6h6v1h-6zM4 7h2v1h-2zM11 7h4v1h-4zM12 8h4v1h-4z",
};

// Agent marks for the setup button (Simple Icons, 24×24): Claude Code, Codex, Cursor.
const AGENTS = {
  claude: "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z",
  openai: "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z",
  cursor: "M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23",
};
const COPY_ICON = "M9 9h11v11H9zM5 15H4V4h11v1";
const DONE_ICON = "M5 12.5l4.5 4.5L19 7.5";

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const SVG = "http://www.w3.org/2000/svg";
const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...children);
  return el;
}

function announce(text) {
  const live = $("#announce");
  live.textContent = "";
  requestAnimationFrame(() => (live.textContent = text));
}

/* ───────── Copy buttons ───────── */

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h("textarea", { style: "position:fixed;opacity:0" });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function swapLabel(span, text) {
  span.textContent = text;
  if (!reduced.matches)
    span.animate([{ filter: "blur(3px)", opacity: 0.3 }, { filter: "blur(0)", opacity: 1 }], { duration: 220, easing: EASE_OUT });
}

function icon(d, cls, attrs = {}) {
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  if (cls) s.setAttribute("class", cls);
  const p = document.createElementNS(SVG, "path");
  p.setAttribute("d", d);
  for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
  s.append(p);
  return s;
}

// The setup button shows who it works with, then what it does, then that it copies.
function agentMarks() {
  return h("span", { class: "agents", "aria-hidden": "true" }, ...Object.values(AGENTS).map((d) => h("span", {}, icon(d))));
}
function copyMarks() {
  const line = { fill: "none", stroke: "currentColor", "stroke-width": "1.75", "stroke-linejoin": "round", "stroke-linecap": "round" };
  return h("span", { class: "copy-mark", "aria-hidden": "true" }, icon(COPY_ICON, "copy-icon", line), icon(DONE_ICON, "done-icon", line));
}

for (const btn of document.querySelectorAll("[data-copy]")) {
  const label = btn.textContent.trim();
  const span = h("span", { class: "label" }, label);
  btn.replaceChildren(span);
  if (btn.dataset.copy === "prompt") {
    btn.classList.add("setup");
    btn.prepend(agentMarks());
    btn.append(copyMarks());
  }
  let timer;
  btn.addEventListener("click", async () => {
    const ok = await copy(btn.dataset.copy === "prompt" ? PROMPT : CLIENTS[client].cmd);
    swapLabel(span, ok ? "Copied" : "Copy failed");
    btn.toggleAttribute("data-done", ok);
    announce(ok ? (btn.dataset.copy === "prompt" ? "Setup prompt copied" : client === "cursor" ? "Cursor config copied" : "Command copied") : "Copy failed");
    if (ok && btn.dataset.copy === "prompt") hop();
    clearTimeout(timer);
    timer = setTimeout(() => {
      swapLabel(span, label);
      btn.removeAttribute("data-done");
    }, 1600);
  });
}

/* ───────── Install tabs ───────── */

const tabs = [...document.querySelectorAll(".clients [role=tab]")];
const pill = h("span", { class: "pill", "aria-hidden": "true" });
$(".clients").prepend(pill);
$(".clients").classList.add("has-pill");
function placePill(tab) {
  pill.style.translate = `${tab.offsetLeft}px 0`;
  pill.style.width = `${tab.offsetWidth}px`;
}
placePill(tabs[0]);
// The tabs live in a closed <details>, so measure again whenever it opens.
function settlePill() {
  pill.removeAttribute("data-ready");
  placePill(tabs.find((t) => t.dataset.client === client));
  requestAnimationFrame(() => pill.setAttribute("data-ready", ""));
}
document.fonts?.ready.then(settlePill);
$(".manual").addEventListener("toggle", (e) => e.target.open && settlePill());

function pickClient(tab) {
  client = tab.dataset.client;
  placePill(tab);
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
  }
  $("#cmd").setAttribute("aria-labelledby", tab.id);
  $("#cmd-text").textContent = CLIENTS[client].cmd;
  $("#cmd-note").innerHTML = CLIENTS[client].note;
}
for (const t of tabs) {
  t.addEventListener("click", () => pickClient(t));
  t.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const next = tabs[(tabs.indexOf(t) + step + tabs.length) % tabs.length];
    pickClient(next);
    next.focus();
  });
}

/* ───────── Pixels ───────── */

// Frame paths are runs of cells: "M9 0h3v1h-3z" is three cells on row 0 from x 9.
function cells(d) {
  const out = [];
  for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)/g)) for (let i = 0; i < +w; i++) out.push([+x + i, +y]);
  return out;
}
// Terminal texture: each cell is a block with a hairline gap, like █ in a monospace grid.
function cell(x, y, cls) {
  const r = document.createElementNS(SVG, "rect");
  r.setAttribute("x", x + 0.05);
  r.setAttribute("y", y + 0.09);
  r.setAttribute("width", 0.9);
  r.setAttribute("height", 0.82);
  if (cls) r.setAttribute("class", cls);
  return r;
}

/* ───────── Hero rabbit: an endless run over carrots. Autopilot until you play. ───────── */

const stage = $(".stage");
const bunny = $(".bunny");
const field = $(".field");
const ground = $(".ground");
const score = $(".score");
for (const [name, d] of Object.entries(FRAMES)) {
  const g = document.createElementNS(SVG, "g");
  g.setAttribute("class", `f ${name}`);
  g.setAttribute("fill", "currentColor");
  for (const [x, y] of cells(d)) g.append(cell(x, y));
  bunny.append(g);
}

// Carrots, drawn in the same cells. Rows top to bottom: g is a leaf, X is carrot.
const CARROTS = [
  ["g g", " g ", "XXX", " X "],
  ["g g", " g ", "XXX", "XXX", " X "],
  ["g g g g", " g   g ", "XXX XXX", " X   X "],
];
function sprite(rows) {
  const el = document.createElementNS(SVG, "svg");
  el.setAttribute("viewBox", `0 0 ${rows[0].length} ${rows.length}`);
  el.setAttribute("fill", "currentColor");
  el.style.width = `calc(var(--c) * ${rows[0].length})`;
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => ch !== " " && el.append(cell(x, y, ch === "g" ? "leaf" : ""))),
  );
  return el;
}

/* ───────── How it works: one pixel icon per step, drawn on the rabbit's grid ───────── */

// "#" ink, "g" green. Each icon sits left-aligned and vertically centered in a 16×12 box, so the four line up with the text.
const STEP_ICONS = {
  // A browser window with the jrabbit bar in the corner.
  open: ["###########", "#         #", "###########", "#         #", "#         #", "#         #", "#         #", "#     ggg #", "#         #", "###########"],
  // The pointer, filled with the overlay's green.
  point: ["#      ", "##     ", "#g#    ", "#gg#   ", "#ggg#  ", "#gggg# ", "#ggggg#", "#gg####", "#g#g#  ", "## #g# ", "#   #g#", "     ##"],
  // The agent edits code.
  fix: ["   ##   ## ##   ", "  ##    ##  ##  ", " ##    ##    ## ", "##     ##     ##", " ##    ##    ## ", "  ##  ##    ##  ", "   ## ##   ##   "],
  // Approved.
  check: ["         ##", "        ## ", "       ##  ", "##    ##   ", " ##  ##    ", "  ####     ", "   ##      "],
};
function boxed(rows, w = 16, hgt = 12) {
  const top = Math.floor((hgt - rows.length) / 2);
  const blank = " ".repeat(w);
  return Array.from({ length: hgt }, (_, y) => (rows[y - top] ?? blank).padEnd(w));
}
for (const li of document.querySelectorAll(".steps li[data-icon]")) {
  const icon = sprite(boxed(STEP_ICONS[li.dataset.icon]));
  icon.setAttribute("class", "glyph");
  icon.setAttribute("aria-hidden", "true");
  li.prepend(icon);
}

const SPEED = 28; // cells per second
const JUMP_MS = 1000;
const JUMP_H = 7; // cells, clears the 5-row carrot
const IDLE_MS = 5000; // back to autopilot after this long without input
const run = { raf: 0, last: 0, dist: 0, spawnIn: 1.4, carrots: [], jump: null, y: 0, auto: true, input: 0, score: 0 };
const HINT = matchMedia("(pointer: coarse)").matches ? "Tap to jump" : "Space to jump";
let c = 0;
let rabbitX = 0;
let fieldW = 0;

function measure() {
  c = bunny.getBoundingClientRect().width / 16;
  const f = field.getBoundingClientRect();
  fieldW = f.width;
  rabbitX = stage.getBoundingClientRect().right - 16 * c - f.left;
}

function jump(now) {
  if (run.jump !== null || !run.raf) return;
  run.jump = now;
  stage.classList.add("air");
}

function setScore(n) {
  run.score = n;
  score.textContent = run.auto ? HINT : String(n).padStart(3, "0");
}

function play() {
  if (!run.raf) return;
  const now = performance.now();
  run.input = now;
  if (run.auto) {
    run.auto = false;
    stage.classList.add("playing");
    setScore(0);
  }
  jump(now);
}

let hitTimer;
function hit() {
  setScore(0);
  stage.classList.remove("hit");
  void stage.offsetWidth; // restart the blink
  stage.classList.add("hit");
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => stage.classList.remove("hit"), 900);
}

function tick(now) {
  const dt = run.last ? Math.min(0.05, (now - run.last) / 1000) : 0;
  run.last = now;
  const dx = SPEED * c * dt;
  run.dist += dx;
  // The rabbit faces left, so the world slides right under it.
  ground.style.translate = `${(run.dist % (16 * c)) - 16 * c}px 0`;

  if (!run.auto && run.jump === null && now - run.input > IDLE_MS) {
    run.auto = true;
    stage.classList.remove("playing");
    setScore(0);
  }

  if (run.jump !== null) {
    const p = (now - run.jump) / JUMP_MS;
    if (p >= 1) {
      run.jump = null;
      run.y = 0;
      bunny.style.translate = "";
      stage.classList.remove("air");
    } else {
      // Flat-topped arc, snapped to whole cells so it moves like a sprite.
      run.y = Math.round(JUMP_H * Math.min(1, 1.7 * Math.sin(Math.PI * p)));
      bunny.style.translate = `0 ${-run.y * c}px`;
    }
  }

  if ((run.spawnIn -= dt) <= 0) {
    const rows = CARROTS[Math.floor(Math.random() * CARROTS.length)];
    const el = sprite(rows);
    field.append(el);
    run.carrots.push({ el, cols: rows[0].length, rows: rows.length, x: -rows[0].length * c, seen: false, done: false });
    run.spawnIn = 1.3 + Math.random() * 1.9;
  }
  // The rabbit's body, minus the ears and tail that stick out of the 16 cells.
  const bodyL = rabbitX + 2 * c;
  const bodyR = rabbitX + 14 * c;
  for (const k of run.carrots) {
    k.x += dx;
    k.el.style.translate = `${Math.round(k.x)}px 0`;
    const right = k.x + k.cols * c;
    if (run.auto && !k.seen && right >= rabbitX - 3 * c) {
      k.seen = true;
      jump(now);
    }
    if (k.done) continue;
    if (right > bodyL && k.x < bodyR && run.y < k.rows) {
      k.done = true;
      hit();
    } else if (k.x >= bodyR) {
      k.done = true;
      if (!run.auto) setScore(run.score + 1);
    }
  }
  run.carrots = run.carrots.filter((k) => k.x < fieldW || k.el.remove());
  run.raf = requestAnimationFrame(tick);
}

let heroVisible = true;
function sync() {
  const on = heroVisible && !document.hidden;
  if (on && !run.raf) {
    measure();
    run.last = 0;
    stage.classList.add("running");
    run.raf = requestAnimationFrame(tick);
  } else if (!on && run.raf) {
    cancelAnimationFrame(run.raf);
    run.raf = 0;
    stage.classList.remove("running");
  }
}

function hop() {
  jump(performance.now());
}

if (!reduced.matches) {
  // Runs in from the right on first load, then keeps running.
  stage.classList.add("live", "entering");
  setTimeout(() => stage.classList.remove("entering"), 1180);
  setScore(0);
  new IntersectionObserver(([e]) => {
    heroVisible = e.isIntersecting;
    sync();
  }).observe(stage);
  document.addEventListener("visibilitychange", sync);
  addEventListener("resize", measure);
  stage.addEventListener("pointerdown", (e) => {
    if (e.button === 0 && state.mode !== "point") play();
  });
  addEventListener("keydown", (e) => {
    if ((e.code !== "Space" && e.code !== "ArrowUp") || e.repeat || !heroVisible || state.mode === "point") return;
    if (e.target.closest?.("input, textarea, select, button, a, [contenteditable]")) return;
    e.preventDefault();
    play();
  });
}

let scrolling = false;
// The toolbar rabbit runs while the page scrolls.
let scrollTimer;
addEventListener(
  "scroll",
  () => {
    if (reduced.matches) return;
    if (!scrolling) {
      scrolling = true;
      render();
    }
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      scrolling = false;
      render();
    }, 180);
  },
  { passive: true },
);

/* ───────── End band hare: prints in when it comes into view ───────── */

const hare = $(".hare");
if (hare && !reduced.matches) {
  const path = hare.querySelector("path");
  const g = document.createElementNS(SVG, "g");
  g.setAttribute("fill", "currentColor");
  for (const [, x, y] of path.getAttribute("d").matchAll(/M(\d+)\.05 (\d+)\.09/g)) {
    const r = cell(+x, +y);
    r.style.setProperty("--d", `${+y * 55 + +x * 7}ms`);
    g.append(r);
  }
  path.replaceWith(g);
  hare.classList.add("waiting");
  const io = new IntersectionObserver(
    ([e]) => {
      if (!e.isIntersecting) return;
      hare.classList.replace("waiting", "printing");
      io.disconnect();
    },
    { threshold: 0.5 },
  );
  io.observe(hare);
}

/* ───────── Section titles: decode in when they scroll into view ───────── */

const SWAPS = 3;
const SWAP_MS = 40;
const STAGGER_MS = 22;

// Split a heading into letter slots. Screen readers get the plain text; the slots are aria-hidden.
function code(title) {
  const text = title.textContent.replace(/\s+/g, " ").trim();
  const shown = h("span", { "aria-hidden": "true" });
  const chars = [];
  text.split(" ").forEach((word, i) => {
    if (i) shown.append(" ");
    const w = h("span", { class: "w" });
    for (const ch of word) chars.push(w.appendChild(h("span", { class: "ch" }, ch)));
    shown.append(w);
  });
  title.dataset.text = text;
  title.replaceChildren(h("span", { class: "sr-only" }, text), shown);
  title.classList.add("coded");
  return { chars, pool: [...text.replace(/[^a-z]/gi, "")] };
}

// Each slot shows a few random letters from the title, then the real one, left to right.
function decode({ chars, pool }) {
  const t0 = performance.now();
  const shownAt = new Int8Array(chars.length).fill(-1);
  const step = (now) => {
    let left = 0;
    chars.forEach((c, i) => {
      const k = Math.floor((now - t0 - i * STAGGER_MS) / SWAP_MS);
      if (k >= SWAPS) {
        if (shownAt[i] !== SWAPS) {
          shownAt[i] = SWAPS;
          c.removeAttribute("data-g");
          c.classList.add("set");
        }
        return;
      }
      left++;
      if (k < 0 || k === shownAt[i]) return;
      shownAt[i] = k;
      c.dataset.g = pool[Math.floor(Math.random() * pool.length)];
    });
    if (left) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

if (!reduced.matches) {
  const titles = new Map([...document.querySelectorAll(".row h2, .end h2")].map((t) => [t, code(t)]));
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        decode(titles.get(e.target));
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px" },
  );
  titles.forEach((_, t) => io.observe(t));
}

/* ───────── Background texture: faint ink cells on slow noise, denser where the cursor moves ───────── */

const canvas = $(".texture");
const ctx = canvas.getContext("2d");
const CELL = 14;
const SHADES = [0, 0.018, 0.032, 0.048, 0.065]; // empty, ░ ▒ ▓ █ in ink on white
const FRAME_MS = 1000 / 15;
const tex = { cols: 0, rows: 0, levels: null, raf: 0, last: 0, mx: 0, my: 0, x: 0, y: 0, energy: 0 };

// Value noise: a hashed lattice blended with smoothstep. Enough for a slow drifting field.
function hash(x, y) {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = x - xi, v = y - yi;
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

function sizeTexture() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  tex.cols = Math.ceil(innerWidth / CELL);
  tex.rows = Math.ceil(innerHeight / CELL);
  tex.levels = new Uint8Array(tex.cols * tex.rows);
}

function paintTexture(t) {
  const { cols, rows, levels } = tex;
  const z = t * 0.00005;
  const R = 160;
  // The cursor glow trails the pointer and fades when it stops.
  tex.x += (tex.mx - tex.x) * 0.25;
  tex.y += (tex.my - tex.y) * 0.25;
  tex.energy *= 0.9;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let v = noise(c * 0.07 + z, r * 0.07 - z) * 0.7 + noise(c * 0.19 - z * 2, r * 0.19) * 0.3;
      if (tex.energy > 0.01) {
        const dx = c * CELL - tex.x, dy = r * CELL - tex.y;
        v += tex.energy * Math.max(0, 1 - Math.hypot(dx, dy) / R) * 0.6;
      }
      levels[r * cols + c] = Math.max(0, Math.min(4, Math.floor((v - 0.52) * 10)));
    }
  }
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.fillStyle = "#000";
  for (let s = 1; s <= 4; s++) {
    ctx.globalAlpha = SHADES[s];
    ctx.beginPath();
    for (let i = 0; i < levels.length; i++) {
      if (levels[i] === s) ctx.rect((i % cols) * CELL + 1, Math.floor(i / cols) * CELL + 1, CELL - 2, CELL - 2);
    }
    ctx.fill();
  }
}

function texTick(now) {
  tex.raf = requestAnimationFrame(texTick);
  if (now - tex.last < FRAME_MS) return; // stepped, like the rest of the pixel motion
  tex.last = now;
  paintTexture(now);
}

function syncTexture() {
  const on = !document.hidden && !reduced.matches;
  if (on && !tex.raf) tex.raf = requestAnimationFrame(texTick);
  else if (!on && tex.raf) {
    cancelAnimationFrame(tex.raf);
    tex.raf = 0;
  }
}

sizeTexture();
paintTexture(0);
syncTexture();
addEventListener("resize", () => {
  sizeTexture();
  paintTexture(performance.now());
});
document.addEventListener("visibilitychange", syncTexture);
if (matchMedia("(pointer: fine)").matches) {
  addEventListener(
    "pointermove",
    (e) => {
      if (tex.energy < 0.01) {
        tex.x = e.clientX;
        tex.y = e.clientY;
      }
      tex.energy = Math.min(1, tex.energy + Math.hypot(e.clientX - tex.mx, e.clientY - tex.my) / 120);
      tex.mx = e.clientX;
      tex.my = e.clientY;
    },
    { passive: true },
  );
}

/* ───────── Overlay ───────── */

const state = { mode: "idle", pins: [], target: null, dashing: false };

const svg = document.createElementNS(SVG, "svg");
svg.setAttribute("viewBox", "0 -1 16 10");
svg.setAttribute("shape-rendering", "crispEdges");
svg.setAttribute("aria-hidden", "true");
for (const [cls, d] of Object.entries(FRAMES)) {
  const p = document.createElementNS(SVG, "path");
  p.setAttribute("class", cls);
  p.setAttribute("fill", "currentColor");
  p.setAttribute("d", d);
  svg.append(p);
}

const logo = h("span", { class: "jr-logo enter" }, svg);
const pointBtn = h("button", { type: "button", "aria-pressed": "false", onclick: () => setMode(state.mode === "point" ? "idle" : "point") }, "Point", h("kbd", {}, "P"));
const pinsBtn = h("button", { type: "button", disabled: true, onclick: nextPin }, "Pins 0");
const sendBtn = h("button", { type: "button", class: "send", disabled: true, onclick: send }, "Send");
const bar = h("div", { class: "jr jr-bar", role: "toolbar", "aria-label": "jrabbit demo" }, logo, pointBtn, pinsBtn, sendBtn);
const hover = h("div", { class: "jr jr-hover", hidden: true }, h("span"));
document.body.append(bar, hover);

setTimeout(() => logo.classList.remove("enter"), reduced.matches ? 0 : 1300);

function render() {
  pointBtn.setAttribute("aria-pressed", String(state.mode === "point"));
  const running = state.mode === "point" || scrolling;
  logo.classList.toggle("running", running);
  logo.classList.toggle("dash", state.dashing);
  const unsent = state.pins.filter((p) => p.status === "open").length;
  pinsBtn.textContent = `Pins ${state.pins.length}`;
  pinsBtn.disabled = state.pins.length === 0;
  sendBtn.textContent = unsent ? `Send ${unsent}` : "Send";
  sendBtn.disabled = unsent === 0;
  document.documentElement.classList.toggle("jr-pointing", state.mode === "point");
}

function setMode(mode) {
  state.mode = mode;
  if (mode !== "point") hover.hidden = true;
  if (mode === "point") announce("Point mode on. Click an element to pin it. Esc to stop.");
  render();
}

/* Pick the element under the pointer: skip the overlay, the page shell, and SVG internals. */
function pick(node) {
  if (!(node instanceof Element) || node.closest(".jr")) return null;
  const el = node.closest("svg, .coded, .roll") || node;
  if (el === document.body || el === document.documentElement || el.matches("main, main > section")) return null;
  return el;
}

function docRect(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
}

function showHover(el) {
  const r = docRect(el);
  Object.assign(hover.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  hover.firstChild.textContent = label(el);
  hover.toggleAttribute("data-inside", r.y - scrollY < 28);
  hover.hidden = false;
}

function label(el) {
  const tag = el.tagName.toLowerCase();
  const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/)[0] : "";
  return tag + cls;
}

document.addEventListener("pointermove", (e) => {
  if (state.mode !== "point" || state.target || e.pointerType === "touch") return;
  const el = pick(e.target);
  if (el) showHover(el);
  else hover.hidden = true;
});

// Capture phase so page buttons and links don't act while pointing.
document.addEventListener(
  "click",
  (e) => {
    if (state.mode !== "point" || state.target) return;
    const el = pick(e.target);
    if (!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openComposer(el);
  },
  true,
);

/* ───────── Composer ───────── */

let composer = null;

function openComposer(el) {
  state.target = el;
  showHover(el);
  const field = h("textarea", { "aria-label": "What should change?", placeholder: "What should change?", rows: 3 });
  const add = h("button", { type: "button", class: "add", disabled: true, onclick: () => addPin(field.value) }, "Add pin");
  field.addEventListener("input", () => (add.disabled = !field.value.trim()));
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && field.value.trim()) {
      e.preventDefault();
      addPin(field.value);
    }
  });
  composer = h(
    "div",
    { class: "jr jr-composer", role: "dialog", "aria-label": `Pin ${label(el)}` },
    h("div", { class: "target" }, label(el)),
    field,
    h("div", { class: "actions" }, h("span", {}, "Esc to cancel"), add),
  );
  document.body.append(composer);

  const r = docRect(el);
  const w = composer.offsetWidth;
  const hgt = composer.offsetHeight;
  const below = r.y + r.h + 8;
  const fitsBelow = below + hgt < scrollY + innerHeight - 64;
  const left = Math.max(scrollX + 16, Math.min(r.x, scrollX + innerWidth - w - 16));
  composer.style.left = `${left}px`;
  composer.style.top = `${fitsBelow ? below : Math.max(scrollY + 16, r.y - hgt - 8)}px`;
  field.focus({ preventScroll: true });
}

function closeComposer() {
  composer?.remove();
  composer = null;
  const el = state.target;
  state.target = null;
  hover.hidden = true;
  return el;
}

function addPin(text) {
  const el = closeComposer();
  const n = state.pins.length + 1;
  const marker = h("div", { class: "jr jr-marker", "data-status": "open", role: "img", "aria-label": `Pin ${n}: ${text.trim()}` }, String(n));
  document.body.append(marker);
  state.pins.push({ id: pinId(), n, status: "open", comment: text.trim(), el, marker, view: viewport() });
  placeMarker(state.pins.at(-1));
  announce(`Pin ${n} added. Press Send when you're done.`);
  render();
  pointBtn.focus({ preventScroll: true });
}

function placeMarker(pin) {
  const r = docRect(pin.el);
  pin.marker.style.left = `${r.x}px`;
  pin.marker.style.top = `${r.y}px`;
}
addEventListener("resize", () => state.pins.forEach(placeMarker));

let cursor = -1;
function nextPin() {
  if (!state.pins.length) return;
  cursor = (cursor + 1) % state.pins.length;
  state.pins[cursor].el.scrollIntoView({ block: "center", behavior: reduced.matches ? "auto" : "smooth" });
}

/* ───────── Send: build what the agent would get ───────── */

const pinId = () => "pin_" + [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("");
const viewport = () => `${innerWidth}x${innerHeight}@${Math.round(devicePixelRatio * 10) / 10}x`;

function selector(el) {
  const parts = [];
  let node = el;
  while (node && node !== document.body && parts.length < 4) {
    if (node.id) {
      parts.unshift(`${node.tagName.toLowerCase()}#${node.id}`);
      break;
    }
    let part = node.tagName.toLowerCase();
    const cls = typeof node.className === "string" ? node.className.trim().split(/\s+/).filter(Boolean)[0] : "";
    if (cls) part += `.${cls}`;
    const same = node.parentElement ? [...node.parentElement.children].filter((c) => c.tagName === node.tagName) : [];
    if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(" > ");
}

const STYLE_KEYS = ["font-size", "font-weight", "line-height", "color", "background-color", "margin", "padding", "border-radius"];
function styles(el) {
  const cs = getComputedStyle(el);
  const out = {};
  for (const k of STYLE_KEYS) {
    const v = cs.getPropertyValue(k);
    if (v && v !== "0px" && v !== "normal" && v !== "rgba(0, 0, 0, 0)") out[k] = v;
  }
  return out;
}

let html = null;
async function sourceLine(el) {
  html ??= fetch(location.pathname, { cache: "force-cache" })
    .then((r) => (r.ok ? r.text() : ""))
    .catch(() => "");
  const lines = (await html).split("\n");
  const start = lines.findIndex((l) => l.includes("<body"));
  const tag = `<${el.tagName.toLowerCase()}`;
  const text = (el.dataset?.text ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 28);
  const tries = [el.id && `id="${el.id}"`, text, el.getAttribute("class") && `class="${el.getAttribute("class")}"`].filter(Boolean);
  for (const t of tries) {
    let i = lines.findIndex((l, n) => n > start && l.includes(t));
    if (i < 0) continue;
    // Text often sits on the line after its tag; walk back to the opening tag.
    for (let j = i; j > i - 4 && j > start; j--) if (lines[j].includes(tag)) { i = j; break; }
    return `site/index.html:${i + 1}`;
  }
  return null;
}

async function format(pin) {
  const el = pin.el;
  const r = el.getBoundingClientRect();
  const text = (el.dataset?.text ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
  const element = {
    tag: el.tagName.toLowerCase(),
    selector: selector(el),
    ...(text && { text: text.length > 80 ? text.slice(0, 79) + "…" : text }),
    size: `${Math.round(r.width)}x${Math.round(r.height)}`,
    styles: styles(el),
  };
  const source = await sourceLine(el);
  return {
    id: pin.id,
    n: pin.n,
    status: pin.status,
    comment: pin.comment,
    page: location.pathname,
    viewport: pin.view,
    element,
    ...(source && { source }),
  };
}

async function send() {
  const batch = state.pins.filter((p) => p.status === "open");
  if (!batch.length) return;
  for (const p of batch) {
    p.status = "sent";
    p.marker.dataset.status = "sent";
  }
  state.dashing = true;
  render();
  setTimeout(() => {
    state.dashing = false;
    render();
  }, reduced.matches ? 0 : 700);

  const out = await Promise.all(batch.map(format));
  const code = $("#payload");
  // Their own pin replaces the loop.
  loop.pause();
  loop.hidden = true;
  code.parentElement.hidden = false;
  const json = JSON.stringify(out.length === 1 ? out[0] : out, null, 2);
  // One span per line so the payload prints in like terminal output.
  code.replaceChildren(...json.split("\n").map((line, i, all) => h("span", { style: `--i:${i}` }, line + (i < all.length - 1 ? "\n" : ""))));
  code.removeAttribute("data-fresh");
  void code.offsetWidth;
  code.setAttribute("data-fresh", "");
  $("#agent-note").textContent =
    out.length === 1 ? "Your pin, as your agent reads it. A real review adds the screenshot." : `Your ${out.length} pins, as your agent reads them. A real review adds the screenshots.`;
  setMode("idle");
  $("#agent").scrollIntoView({ block: "start", behavior: reduced.matches ? "auto" : "smooth" });
  announce(`Sent ${batch.length} ${batch.length === 1 ? "pin" : "pins"}. The payload is in "What your agent gets".`);
}

/* ───────── Agent loop: plays only when motion is welcome; the poster stands in otherwise ───────── */

const loop = $("video.loop");
function syncLoop() {
  if (loop.hidden) return;
  if (reduced.matches) loop.pause();
  else loop.play().catch(() => {});
}
reduced.addEventListener("change", syncLoop);
syncLoop();

/* ───────── Keys ───────── */

addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (state.target) {
      closeComposer();
      pointBtn.focus({ preventScroll: true });
    } else if (state.mode === "point") setMode("idle");
    return;
  }
  const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "p" || e.key === "P") {
    e.preventDefault();
    setMode(state.mode === "point" ? "idle" : "point");
  }
});

render();
