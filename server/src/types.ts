import { randomUUID } from "node:crypto";
import type { Lang } from "./i18n.js";
import type { Pack, Product, Search } from "./pack.js";
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
  /** What this customer said they need from this kind of product, named by the model. Most of the
   *  named fields below were a television's; only the budget is still asked of the model. */
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
  /** The customer's saved card, once the associate has given their mobile number. The number is a
   *  lookup key only: nothing is ever sent to it (Rule 5). */
  customer?: { id: string; phone: string; name?: string };
  /** The offer opens only after both are true. */
  assessed: boolean;
  demonstrated: boolean;
  shortlist: string[];
  /** What the customer actually picked. Set only from an explicit tap, never inferred. */
  selection?: {
    sku: string;
    accessories: string[];
    charges: string[];
    /** Real catalogue lines offered with the pick, such as the brand's wall mount, at their real price. */
    offered?: Pack["accessories"];
  };
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
  /** The catalogue search this conversation is on, kept so a tap or a follow-up stays on the same
   *  products. The whole session state is one jsonb column, so this costs no migration. */
  search?: Search;
  /** The rows on the associate's screen, with their offers. Each turn is a new search, so "offers on
   *  these" used to be answered from a different set of products than the ones they were looking at. */
  shown?: { products: Product[]; offers: Record<string, any>[] };
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
