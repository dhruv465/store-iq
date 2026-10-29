/** The portal's side of the manager API. Every write carries the portal's own header: the server
 *  refuses a state-changing call without it, which is what stops a page the manager happens to
 *  visit from reaching these routes with their cached credentials. */

export type FloorRow = {
  phone: string;
  name: string;
  conversations: number;
  homeCards: number;
  readBack: number;
  median: number;
  best: number;
  guide: number;
  homeBeforePrice: number;
  onRoster: boolean;
  lastSeen?: string;
  lastSeenLabel: string;
  quiet: boolean;
};

export type Floor = {
  summary: string;
  rows: FloorRow[];
  reachable: number;
  waiting: number;
  rosterEmpty: boolean;
  maxScore: number;
  guide: number;
  from: string;
};

export type Preview = {
  message: string;
  to: { phone: string; name: string }[];
  unreachable: { phone: string; name: string }[];
  rosterEmpty: boolean;
};

/** Thrown when the portal is not signed in, so the app can show the sign-in card rather than an
 *  error the manager cannot act on. */
export class NeedsSignIn extends Error {}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/manager${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-store-iq": "portal", ...init.headers },
  });
  if (response.status === 401) throw new NeedsSignIn("Sign in to see the floor.");
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `The server answered ${response.status}.`);
  }
  return (await response.json()) as T;
}

export const api = {
  signIn: (password: string) => call<{ ok: true }>("/login", { method: "POST", body: JSON.stringify({ password }) }),
  floor: () => call<Floor>("/floor"),
  addAssociate: (name: string, phone: string) =>
    call<{ ok: true }>("/roster", { method: "POST", body: JSON.stringify({ name, phone }) }),
  removeAssociate: (phone: string) => call<{ ok: true }>(`/roster/${encodeURIComponent(phone)}`, { method: "DELETE" }),
  preview: (text: string) =>
    call<Preview>("/broadcast/preview", { method: "POST", body: JSON.stringify({ text }) }),
  broadcast: (text: string) =>
    call<{ queued: number; waiting: number }>("/broadcast", { method: "POST", body: JSON.stringify({ text }) }),
};
