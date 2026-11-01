import { randomUUID } from "node:crypto";
import type { Lang } from "./i18n.js";
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
  /** Everything this product needs that a television did not. The named fields below are a
   *  television's home; a washing machine's is a covered balcony, a daily wash and 8 kg, and a
   *  card that cannot hold those can never be assessed — which left recommend, complete and close
   *  unreachable for anything but a TV. */
  facts?: Record<string, string>;
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
  language: Lang;
  step: Step;
  card: HomeCard;
  /** The offer opens only after both are true. */
  assessed: boolean;
  demonstrated: boolean;
  shortlist: string[];
  /** What the customer actually picked. Set only from an explicit tap, never inferred. */
  selection?: { sku: string; accessories: string[]; charges: string[] };
  /** Section 4H: the customer summary only goes out with consent. */
  consent: boolean;
  /** The next thing they say is a store visit, not a customer. Set by asking to log one, cleared
   *  as soon as it is filed, so a visit can never be mistaken for a home. */
  logging_visit?: boolean;
  /** The associate's own name, as WhatsApp gives it, so the manager's view is people not numbers. */
  associate?: string;
  /** A figure left Store IQ before the home was assessed. The store visits' headline measure was
   *  who spoke about the price first, and they found it was us in 6 of 6 conversations. */
  priced_before_home?: boolean;
  /** The site was checked with the customer before the installer was booked. The store visits found
   *  an installer who came and left because the wall needed a hole nobody had asked about. */
  site_checked?: boolean;
  /** What this conversation is about, in the associate's own words, kept so a tap does not lose
   *  it. The whole session state is one jsonb column, so this costs no migration. */
  subject?: string;
  /** Customer objections / claims validated during this interaction. */
  objections?: string[];
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
    consent: false,
    objections: [],
    history: [],
    steps_done: [],
  };
}
