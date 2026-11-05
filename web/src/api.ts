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
  stepMarks?: Record<string, number>;
};

export type OpenQuestion = {
  reference: string;
  area: string;
  owner: string;
  phone: string;
  question?: string;
  asked_at?: string;
};

/** A check-back after a sale: delivery, the installer's call, that it works, or a service problem. */
export type FollowUp = {
  id: number;
  what: string;
  due_on: string;
  customer_name: string | null;
  product: string;
  associate: string;
  overdue: boolean;
  due: boolean;
};

export type ObjectionInsight = {
  claim: string;
  count: number;
  confirm?: string;
  correct?: string;
  associates: string[];
};

export type ProductInsight = {
  sku: string;
  name: string;
  brand: string;
  price: number;
  stock: number;
  shortlistedCount: number;
  selectedCount: number;
};

export type FeedItem = {
  interactionId: string;
  phone: string;
  associate: string;
  step: string;
  score: number;
  homeFactsCount: number;
  room?: string;
  distance?: string;
  budget?: number;
  shortlist: string[];
  selectionSku?: string;
  pricedBeforeHome: boolean;
  consent: boolean;
  siteChecked: boolean;
  startedAt: string;
  turnsCount: number;
  lastLine?: string;
};

export type Floor = {
  summary: string;
  rows: FloorRow[];
  openQuestions?: OpenQuestion[];
  followUps?: FollowUp[];
  reachable: number;
  waiting: number;
  rosterEmpty: boolean;
  maxScore: number;
  guide: number;
  from: string;
  objections?: ObjectionInsight[];
  products?: ProductInsight[];
  feed?: FeedItem[];
  /** What the model has cost since the server started, in US dollars, and which model it is. */
  spend?: number;
  model?: string;
};

export type Preview = {
  message: string;
  to: { phone: string; name: string }[];
  unreachable: { phone: string; name: string }[];
  rosterEmpty: boolean;
};

export type VideoBrief = {
  status: "scripting" | "rendering" | "checking" | "ready" | "failed";
  brief: string;
  heard?: string;
  script?: string;
  video?: string;
  error?: string;
  cost: number;
};

/** A notice or a morning brief the manager sent, newest first. */
export type SentBroadcast = {
  id: number;
  kind: "notice" | "video";
  body: string;
  video?: string | null;
  queued: number;
  waiting: number;
  sent_at: string;
};

/** The current video brief, and once it is ready, who it would reach. */
export type VideoBriefView = { job: VideoBrief | null; caption: string | null } & Partial<Omit<Preview, "message">>;

/** Thrown when the portal is not signed in, so the app can show the sign-in card rather than an
 *  error the manager cannot act on. */
export class NeedsSignIn extends Error {}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/manager${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-store-iq": "portal", ...init.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.status === 401) throw new NeedsSignIn(body.error ?? "Sign in to see the floor.");
    throw new Error(body.error ?? `The server answered ${response.status}.`);
  }
  return (await response.json()) as T;
}

export const api = {
  signIn: (username: string, password: string) =>
    call<{ ok: true }>("/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  signOut: () => call<{ ok: true }>("/logout", { method: "POST" }),
  history: (kind: SentBroadcast["kind"]) => call<{ sent: SentBroadcast[] }>(`/broadcasts/${kind}`),
  floor: () => call<Floor>("/floor"),
  addAssociate: (name: string, phone: string) =>
    call<{ ok: true }>("/roster", { method: "POST", body: JSON.stringify({ name, phone }) }),
  removeAssociate: (phone: string) => call<{ ok: true }>(`/roster/${encodeURIComponent(phone)}`, { method: "DELETE" }),
  preview: (text: string) => call<Preview>("/broadcast/preview", { method: "POST", body: JSON.stringify({ text }) }),
  broadcast: (text: string) =>
    call<{ queued: number; waiting: number }>("/broadcast", { method: "POST", body: JSON.stringify({ text }) }),
  videoBrief: () => call<VideoBriefView>("/video-brief"),
  makeVideoBrief: (brief: string) =>
    call<{ job: VideoBrief }>("/video-brief", { method: "POST", body: JSON.stringify({ brief }) }),
  discardVideoBrief: () => call<{ ok: true }>("/video-brief", { method: "DELETE" }),
  sendVideoBrief: (video: string) =>
    call<{ queued: number; waiting: number }>("/video-brief/send", { method: "POST", body: JSON.stringify({ video }) }),
  doneFollowUp: (id: number) => call<{ ok: true; id: number }>(`/followup/${id}/done`, { method: "POST" }),
  resolveQuestion: (reference: string) =>
    call<{ ok: true; reference: string }>(`/expert/${encodeURIComponent(reference)}/resolve`, { method: "POST" }),
};
