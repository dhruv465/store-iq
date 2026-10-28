import { randomUUID } from "node:crypto";
/** Section 4 of the developer brief, A to I, in order. "demonstrate" lives inside recommend, which is
 *  how the brief names that stage, and shows up as the demonstration cue on each option. */
export const STEPS = [
  "brief",
  "assess",
  "validate",
  "translate",
  "recommend",
  "complete",
  "close",
  "follow_through",
  "review",
] as const;
export type Step = (typeof STEPS)[number];

/** What the associate has learned about the customer's home. Store IQ never guesses wealth or level. */
export type HomeCard = {
  room?: string;
  /** The brief's own example asks in metres; feet stays for an associate who answers in feet. */
  distance_m?: number;
  distance_feet?: number;
  space?: string;
  /** Section 3: the current product and why it is being replaced. */
  replacing?: string;
  /** Section 3: what the customer says matters, in their words. */
  priorities?: string[];
  /** Section 3: installation, delivery or site constraints. */
  site_constraints?: string[];
  light?: string;
  mount?: string;
  content?: string[];
  devices?: string[];
  family?: string;
  internet?: string;
  budget_rupees?: number;
  /** Set by the associate only. */
  start_level?: string;
};

export type Button = { id: string; title: string };
export type Reply = { text: string; buttons?: Button[] };

export type Turn = { who: "associate" | "storeiq"; text: string };

export type Session = {
  phone: string;
  version: number;
  /** One customer on the floor. A new customer starts a new interaction and an empty card. */
  interaction_id: string;
  interaction_started: string;
  /** Set once the associate has confirmed the card back; recommendations wait for it. */
  card_confirmed: boolean;
  language: "en" | "hi";
  step: Step;
  card: HomeCard;
  /** The offer opens only after both are true. */
  assessed: boolean;
  demonstrated: boolean;
  shortlist: string[];
  /** Bounded conversation memory; the full log lives in the database. */
  history: Turn[];
  steps_done: Step[];
};

export type Event = {
  id: string;
  phone: string;
  modality: "text" | "voice" | "image" | "interactive" | "other";
  text?: string;
  action?: string;
  audio?: { bytes: Uint8Array; mimeType: string };
  image?: { bytes: Uint8Array; mimeType: string };
  name?: string;
};

export function newSession(phone: string, interactionId = randomUUID()): Session {
  return {
    phone,
    version: 0,
    interaction_id: interactionId,
    interaction_started: new Date().toISOString(),
    card_confirmed: false,
    language: "en",
    step: "assess",
    card: {},
    assessed: false,
    demonstrated: false,
    shortlist: [],
    history: [],
    steps_done: [],
  };
}
