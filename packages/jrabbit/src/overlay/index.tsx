import { render } from "preact";
import { Api } from "./api.js";
import { App } from "./app.js";
import { css } from "./styles.js";

declare global {
  interface Window {
    __jrabbit?: boolean;
  }
}

(() => {
  if (window.__jrabbit || window.top !== window) return; // once per page, never in iframes
  const script = document.currentScript as HTMLScriptElement | null;
  const token = script ? new URL(script.src).searchParams.get("t") : null;
  if (!token) return;
  window.__jrabbit = true;

  const mount = () => {
    // Outside <body> so the app's own rendering never touches it.
    const host = document.createElement("jrabbit-overlay");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = css;
    shadow.appendChild(style);
    const container = document.createElement("div");
    shadow.appendChild(container);
    render(<App api={new Api(token)} host={host} />, container);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
