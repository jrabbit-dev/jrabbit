import type { NewPinInput, Pin, ServerEvent } from "../shared/types.js";

/** live: connected. offline: jrabbit is not running. expired: jrabbit restarted with another token. */
export type Connection = "connecting" | "live" | "offline" | "expired";

const RETRY_MS = 2000;

export class Api {
  constructor(private token: string) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`/__jrabbit/api${path}`, {
      method,
      headers: { "content-type": "application/json", "x-jrabbit-token": this.token },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error(`jrabbit ${path}: ${res.status}`);
    return res.json() as Promise<T>;
  }

  createPin = (input: NewPinInput) => this.call<Pin>("POST", "/pins", input);
  deletePin = (id: string) => this.call("DELETE", `/pins/${id}`);
  send = () => this.call<{ sent: number }>("POST", "/send");
  approve = (id: string) => this.call<Pin>("POST", `/pins/${id}/approve`);
  reopen = (id: string, note: string) => this.call<Pin>("POST", `/pins/${id}/reopen`, { note });
  after = (id: string, shot: string | null) => this.call("POST", `/pins/${id}/after`, { shot });
  approveRule = (slug: string) => this.call("POST", `/rules/${slug}/approve`);
  deleteRule = (slug: string) => this.call("DELETE", `/rules/${slug}`);
  archive = () => this.call<{ archived: number }>("POST", "/archive");

  shotUrl = (rel: string) => `/__jrabbit/shots/${rel.split("/").pop()}?t=${this.token}`;

  /** Why the event stream dropped: our token is no longer valid, or jrabbit is gone. */
  private async diagnose(): Promise<"expired" | "offline" | "live"> {
    try {
      const res = await fetch(`/__jrabbit/api/ping?t=${this.token}`, { cache: "no-store" });
      if (res.status === 401) return "expired";
      return res.ok ? "live" : "offline";
    } catch {
      return "offline";
    }
  }

  /** Server events, reconnecting on its own while jrabbit restarts. Returns a cleanup function. */
  events(onEvent: (e: ServerEvent) => void, onConnection: (c: Connection) => void): () => void {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      source = new EventSource(`/__jrabbit/api/events?t=${this.token}`);
      source.onopen = () => onConnection("live");
      source.onerror = async () => {
        source?.close();
        const status = await this.diagnose();
        if (stopped) return;
        onConnection(status === "live" ? "connecting" : status);
        // An expired token never comes back: the page must reload to get the new one.
        if (status !== "expired") retry = setTimeout(connect, RETRY_MS);
      };
      for (const type of ["state", "capture-after", "toast"]) {
        source.addEventListener(type, (e) => onEvent(JSON.parse((e as MessageEvent).data)));
      }
    };

    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }
}
