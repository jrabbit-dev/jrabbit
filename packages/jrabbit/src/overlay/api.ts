import type { NewPinInput, Pin, ServerEvent } from "../shared/types.js";

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

  shotUrl = (rel: string) => `/__jrabbit/shots/${rel.split("/").pop()}?t=${this.token}`;

  events(onEvent: (e: ServerEvent) => void): () => void {
    const source = new EventSource(`/__jrabbit/api/events?t=${this.token}`);
    for (const type of ["state", "capture-after", "toast"]) {
      source.addEventListener(type, (e) => onEvent(JSON.parse((e as MessageEvent).data)));
    }
    return () => source.close();
  }
}
