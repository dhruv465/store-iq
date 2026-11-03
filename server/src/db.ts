import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IncomingMessage } from "./webhook.js";
import { newSession, type Reply, type Session } from "./types.js";
import type { SavedCustomer } from "./brain.js";

/** A notice about today's offers is not worth delivering tomorrow, so one waits out a shift and
 *  then stops. */
export const NOTICE_LIFE_HOURS = 12;

/** A gap this long on the floor means the next customer walked up. */
export const INTERACTION_IDLE_MS = 30 * 60 * 1000;

const SCHEMA = `
create table if not exists inbox (
  message_id text primary key,
  phone text not null,
  message_type text not null,
  raw jsonb not null,
  sent_at timestamptz,
  received_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  done_at timestamptz,
  error text
);
create index if not exists inbox_pending on inbox (received_at) where done_at is null;
create table if not exists outbox (
  id bigserial primary key,
  phone text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending',
  lease_token uuid,
  lease_until timestamptz,
  provider_id text,
  error text
);
create index if not exists outbox_pending on outbox (id) where status = 'pending';
create table if not exists expert_questions (
  id bigserial primary key,
  reference text not null unique,
  phone text not null,
  area text not null,
  owner text not null,
  question text not null,
  asked_at timestamptz not null default now(),
  answered_at timestamptz
);
create table if not exists visits (
  reference text primary key,
  phone text not null,
  associate text,
  store text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists visits_recent on visits (created_at desc);
create table if not exists notices (
  id serial primary key,
  body text not null,
  created_at timestamptz not null default now()
);
create table if not exists notice_deliveries (
  notice_id integer not null references notices (id) on delete cascade,
  phone text not null,
  delivered_at timestamptz,
  primary key (notice_id, phone)
);
create index if not exists notice_waiting on notice_deliveries (phone) where delivered_at is null;
create table if not exists associates (
  phone text primary key,
  name text not null,
  added_at timestamptz not null default now()
);
create table if not exists conversations (
  interaction_id text primary key,
  phone text not null,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists conversations_day on conversations (updated_at);
create table if not exists customers (
  id text primary key,
  phone text not null unique,
  name text,
  card jsonb not null default '{}',
  history jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists sessions (
  phone text primary key,
  version integer not null default 0,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
`;

/** The measure the store visits led with: who spoke about the price first. A figure leaving before
 *  the home is assessed is Store IQ doing the thing the visits caught the floor doing, whatever the
 *  reason — including a customer who walked up to one set and pointed at it. */
export function pricedEarly(session: Session, reply: Reply): boolean {
  return !session.assessed && /\bRs ?[\d,]{4,}/.test(reply.text);
}

/** What DB needs from a database: PGlite on the laptop and in tests, Postgres on the server. */
type Queryable = {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
};

export class DB {
  constructor(
    private readonly pg: Queryable,
    readonly close: () => Promise<void>,
  ) {}

  /** Persisted before the webhook returns 200, so a duplicate delivery is a no-op. */
  async enqueue(messages: IncomingMessage[]): Promise<void> {
    for (const message of messages)
      await this.pg.query(
        `insert into inbox (message_id, phone, message_type, raw, sent_at) values ($1,$2,$3,$4,$5)
         on conflict (message_id) do nothing`,
        [message.message_id, message.phone, message.message_type, JSON.stringify(message.raw), message.sent_at ?? null],
      );
  }

  async claimInbox(token: string): Promise<any | null> {
    const result = await this.pg.query<any>(
      `update inbox set lease_token = $1, lease_until = now() + interval '90 seconds'
       where message_id = (
         select message_id from inbox
         where done_at is null and (lease_until is null or lease_until < now())
         order by received_at limit 1
       ) returning *`,
      [token],
    );
    return result.rows[0] ?? null;
  }

  async finishInbox(id: string, token: string, error?: string): Promise<void> {
    await this.pg.query(`update inbox set done_at = now(), error = $3 where message_id = $1 and lease_token = $2`, [
      id,
      token,
      error ?? null,
    ]);
  }

  async session(phone: string): Promise<Session> {
    const result = await this.pg.query<{ version: number; state: Session; updated_at: string }>(
      `select version, state, updated_at from sessions where phone = $1`,
      [phone],
    );
    const row = result.rows[0];
    if (!row) return newSession(phone);
    const session = { ...row.state, phone, version: row.version };
    // Interaction-scoped: a long gap means a different customer is standing there now.
    const idleMs = Date.now() - Date.parse(String(row.updated_at));
    if (Number.isFinite(idleMs) && idleMs > INTERACTION_IDLE_MS) {
      const fresh = newSession(phone);
      return {
        ...fresh,
        version: row.version,
        language: session.language,
        steps_done: session.steps_done.filter((step) => step === "brief"),
      };
    }
    return session;
  }

  /** Compare-and-set on version: a replayed message never overwrites a newer card. */
  async commit(session: Session, replies: Reply[]): Promise<boolean> {
    for (const reply of replies) if (pricedEarly(session, reply)) session.priced_before_home = true;
    const next = session.version + 1;
    const state = JSON.stringify({ ...session, version: next });
    const updated = await this.pg.query(
      `insert into sessions (phone, version, state) values ($1, $2, $3)
       on conflict (phone) do update set version = $2, state = $3, updated_at = now()
       where sessions.version = $4
       returning phone`,
      [session.phone, next, state, session.version],
    );
    if (!updated.rows.length) return false;
    // The session row is one per associate and the next customer overwrites it, so the day is kept
    // here instead: one row per interaction, which is what a manager is actually counting.
    await this.pg.query(
      `insert into conversations (interaction_id, phone, state) values ($1, $2, $3)
       on conflict (interaction_id) do update set state = $3, updated_at = now()`,
      [session.interaction_id, session.phone, state],
    );
    // The card follows the customer, not the associate: their next visit starts from it.
    if (session.customer)
      await this.pg.query(
        `insert into customers (id, phone, name, card, history) values ($1, $2, $3, $4, $5)
         on conflict (phone) do update set name = coalesce(excluded.name, customers.name), card = $4, history = $5,
         updated_at = now()`,
        [
          session.customer.id,
          session.customer.phone,
          session.customer.name ?? null,
          JSON.stringify(session.card),
          JSON.stringify(session.history),
        ],
      );
    for (const reply of replies)
      await this.pg.query(`insert into outbox (phone, payload) values ($1, $2)`, [
        session.phone,
        JSON.stringify(reply),
      ]);
    session.version = next;
    return true;
  }

  async findCustomer(phone: string): Promise<SavedCustomer | null> {
    const result = await this.pg.query<SavedCustomer>(
      `select id, name, card, history from customers where phone = $1`,
      [phone],
    );
    return result.rows[0] ?? null;
  }

  /** Saved customers whose first name is in these words: "what did Rahul want last time?" found
   *  nothing, because only a number was ever looked up. */
  async namesIn(said: string): Promise<string[]> {
    const result = await this.pg.query<{ name: string }>(
      `select distinct name from customers
       where length(split_part(name, ' ', 1)) > 2 and position(lower(split_part(name, ' ', 1)) in lower($1)) > 0`,
      [said],
    );
    return result.rows
      .map((row) => row.name)
      .filter((name) => {
        const first = name.split(" ")[0]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(^|[^\\p{L}\\p{M}])${first}($|[^\\p{L}\\p{M}])`, "iu").test(said);
      });
  }

  async send(phone: string, reply: Reply): Promise<void> {
    await this.pg.query(`insert into outbox (phone, payload) values ($1, $2)`, [phone, JSON.stringify(reply)]);
  }

  async claimOutbox(token: string): Promise<any | null> {
    const result = await this.pg.query<any>(
      `update outbox set lease_token = $1, lease_until = now() + interval '60 seconds'
       where id = (
         select id from outbox
         where status = 'pending' and (lease_until is null or lease_until < now())
         order by id limit 1
       ) returning *`,
      [token],
    );
    return result.rows[0] ?? null;
  }

  async finishOutbox(id: number, token: string, status: string, providerId?: string, error?: string): Promise<void> {
    await this.pg.query(
      `update outbox set status = $3, provider_id = $4, error = $5 where id = $1 and lease_token = $2`,
      [id, token, status, providerId ?? null, error ?? null],
    );
  }

  /** Meta only allows a free-form reply within 24 hours of an inbound message from that number. */
  async withinWindow(phone: string): Promise<boolean> {
    const rows = await this.pg.query<{ fresh: boolean }>(
      `select coalesce(max(coalesce(sent_at, received_at)) > now() - interval '24 hours', false) as fresh
       from inbox where phone = $1`,
      [phone],
    );
    return rows.rows[0]?.fresh === true;
  }

  /** Last outbound attempts, for diagnosing what the provider actually accepted. */
  async recentSends(limit = 5): Promise<Record<string, unknown>[]> {
    const rows = await this.pg.query<Record<string, unknown>>(
      // The first line of the reply, so a local watcher can see what the floor was actually told
      // rather than only that something left. Localhost only, like the endpoint that serves it.
      `select id, phone, status, provider_id, error, created_at,
              split_part(payload ->> 'text', chr(10), 1) as said
       from outbox order by id desc limit $1`,
      [limit],
    );
    return rows.rows;
  }

  /** Forget one number completely: its conversations, its session, its place on the roster and
   *  anything held for it. Build-time test numbers have to be clearable before a demo without
   *  taking the real floor with them, so it is one number at a time and never a pattern. */
  async forget(phone: string): Promise<Record<string, number>> {
    if (!/^[1-9]\d{6,14}$/.test(phone)) throw Error("Not a phone number");
    const counts: Record<string, number> = {};
    for (const table of [
      "conversations",
      "sessions",
      "associates",
      "notice_deliveries",
      "inbox",
      "outbox",
      "expert_questions",
      "visits",
    ]) {
      const result = await this.pg.query(`delete from ${table} where phone = $1`, [phone]);
      counts[table] = result.affectedRows ?? 0;
    }
    return counts;
  }

  /** Extra points: a store visit, spoken by whoever made it. The visits of 10 and 11 October are
   *  the reason this product exists, and they were written up by hand afterwards; an associate
   *  standing in a competitor's shop can only speak. */
  async logVisit(row: {
    reference: string;
    phone: string;
    associate?: string;
    store: string;
    body: string;
  }): Promise<void> {
    await this.pg.query(
      `insert into visits (reference, phone, associate, store, body) values ($1, $2, $3, $4, $5)
       on conflict (reference) do nothing`,
      [row.reference, row.phone, row.associate ?? null, row.store, row.body],
    );
  }

  async recentVisits(limit = 20): Promise<Record<string, unknown>[]> {
    const rows = await this.pg.query<Record<string, unknown>>(
      `select reference, phone, associate, store, body, created_at from visits order by created_at desc limit $1`,
      [limit],
    );
    return rows.rows;
  }

  /** Extra points: a question the floor could not answer, routed to a named owner. */
  async logQuestion(row: {
    reference: string;
    phone: string;
    area: string;
    owner: string;
    question: string;
  }): Promise<void> {
    await this.pg.query(
      `insert into expert_questions (reference, phone, area, owner, question) values ($1,$2,$3,$4,$5)
       on conflict (reference) do nothing`,
      [row.reference, row.phone, row.area, row.owner, row.question],
    );
  }

  /** The phone comes back too: a manager looking at an open question wants to know which associate
   *  is waiting on the answer, and it is the only handle for clearing a test one. */
  async openQuestions(): Promise<
    { reference: string; area: string; owner: string; phone: string; question: string; asked_at: string }[]
  > {
    const rows = await this.pg.query<{
      reference: string;
      area: string;
      owner: string;
      phone: string;
      question: string;
      asked_at: string;
    }>(
      `select reference, area, owner, phone, question, asked_at from expert_questions where answered_at is null order by id desc limit 20`,
    );
    return rows.rows;
  }

  /** Mark an expert question answered/resolved once the manager or specialist handles it. */
  async resolveQuestion(reference: string): Promise<boolean> {
    const result = await this.pg.query(
      `update expert_questions set answered_at = now() where reference = $1 and answered_at is null`,
      [reference],
    );
    return (result.affectedRows ?? 0) > 0;
  }

  /** Every conversation touched today, for the department manager view. */
  /** Every conversation of the shift, not every associate: one associate serves many customers. */
  async today(): Promise<Session[]> {
    const rows = await this.pg.query<{ state: Session }>(
      `select state from conversations where updated_at > now() - interval '12 hours' order by updated_at`,
    );
    return rows.rows.map((row) => row.state);
  }

  /** The manager's roster, with when each person last wrote to the number. An associate who has
   *  done nothing today has to be visible, or "who has been quiet" cannot be answered. */
  async roster(): Promise<{ phone: string; name: string; lastSeen?: string }[]> {
    const rows = await this.pg.query<{ phone: string; name: string; last_seen: string | null }>(
      `select a.phone, a.name, (select max(received_at) from inbox i where i.phone = a.phone) as last_seen
       from associates a order by a.name`,
    );
    return rows.rows.map((row) => ({
      phone: row.phone,
      name: row.name,
      ...(row.last_seen ? { lastSeen: row.last_seen } : {}),
    }));
  }

  /** Re-adding an associate corrects the spelling of their name rather than failing. */
  async addAssociate(phone: string, name: string): Promise<void> {
    await this.pg.query(
      `insert into associates (phone, name) values ($1, $2) on conflict (phone) do update set name = $2`,
      [phone, name],
    );
  }

  async removeAssociate(phone: string): Promise<void> {
    await this.pg.query(`delete from associates where phone = $1`, [phone]);
  }

  /** A floor notice, and who it is meant for. WhatsApp will not carry a free-form message to
   *  somebody who has not written in 24 hours, so the ones who cannot be reached now are held and
   *  go out the moment they next write. A notice about today stops being worth delivering after
   *  the shift, so it expires rather than arriving tomorrow morning. */
  async queueNotice(body: string, phones: string[]): Promise<number> {
    const created = await this.pg.query<{ id: number }>(`insert into notices (body) values ($1) returning id`, [body]);
    const id = created.rows[0]!.id;
    for (const phone of phones)
      await this.pg.query(`insert into notice_deliveries (notice_id, phone) values ($1, $2) on conflict do nothing`, [
        id,
        phone,
      ]);
    return id;
  }

  /** Notices this associate has not been given yet, oldest first, that are still worth giving. */
  async waitingNotices(phone: string, lifeHours = NOTICE_LIFE_HOURS): Promise<{ id: number; body: string }[]> {
    const rows = await this.pg.query<{ id: number; body: string }>(
      `select n.id, n.body from notice_deliveries d join notices n on n.id = d.notice_id
       where d.phone = $1 and d.delivered_at is null and n.created_at > now() - make_interval(hours => $2)
       order by n.created_at`,
      [phone, lifeHours],
    );
    return rows.rows;
  }

  async markNoticeDelivered(id: number, phone: string): Promise<void> {
    await this.pg.query(`update notice_deliveries set delivered_at = now() where notice_id = $1 and phone = $2`, [
      id,
      phone,
    ]);
  }

  /** How many notices are still waiting on somebody, so the manager is not left wondering. */
  async noticesWaiting(lifeHours = NOTICE_LIFE_HOURS): Promise<number> {
    const rows = await this.pg.query<{ waiting: number }>(
      `select count(*)::int as waiting from notice_deliveries d join notices n on n.id = d.notice_id
       where d.delivered_at is null and n.created_at > now() - make_interval(hours => $1)`,
      [lifeHours],
    );
    return rows.rows[0]?.waiting ?? 0;
  }

  /** Associates who may be sent a message right now: they wrote to us inside Meta's 24 hour window. */
  async reachable(): Promise<string[]> {
    const rows = await this.pg.query<{ phone: string }>(
      `select distinct phone from inbox where received_at > now() - interval '24 hours'`,
    );
    return rows.rows.map((row) => row.phone);
  }

  async health(): Promise<Record<string, number>> {
    const counts = await this.pg.query<{ inbox: number; outbox: number; attention: number }>(
      `select
         (select count(*) from inbox where done_at is null)::int as inbox,
         (select count(*) from outbox where status = 'pending')::int as outbox,
         (select count(*) from outbox where status in ('failed','uncertain'))::int as attention`,
    );
    return counts.rows[0] as unknown as Record<string, number>;
  }
}

/** Whether the lock directory was left behind by a process that is no longer running. A kill, a
 *  crash or a closed laptop leaves one, and a lock nobody owns must not keep the number off the air. */
async function abandoned(lock: string): Promise<boolean> {
  let pid: number;
  try {
    pid = Number((await readFile(`${lock}/pid`, "utf8")).trim());
  } catch {
    return true; // No pid file: the owner never finished claiming it.
  }
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // EPERM means the process is alive and someone else's, which is not abandoned.
    return (error as NodeJS.ErrnoException).code !== "EPERM";
  }
}

/** Claims the lock, waiting out a predecessor that is still shutting down. A watch restart and a
 *  quick manual restart are both exactly that: the new server starts while the old one is closing. */
async function claimLock(lock: string, waitMs: number): Promise<void> {
  const deadline = Date.now() + waitMs;
  for (let first = true; ; first = false) {
    if (!first && Date.now() >= deadline)
      throw Error(
        `Database already open by pid ${await readFile(`${lock}/pid`, "utf8").catch(() => "?")}. Run one server only.`,
      );
    try {
      await mkdir(lock, { mode: 0o700 });
      return;
    } catch {
      if (await abandoned(lock)) {
        console.error("Clearing a lock left behind by a stopped server");
        await rm(lock, { recursive: true, force: true });
      } else await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

export async function openDatabase(
  path = process.env.LOCAL_DB_PATH || "data/runtime/pg",
  claimWaitMs = 4000,
): Promise<DB> {
  if (path !== "memory://") await mkdir(resolve(path), { recursive: true, mode: 0o700 });
  const lock = path === "memory://" ? null : `${resolve(path)}.lock`;
  if (lock) {
    await claimLock(lock, claimWaitMs);
    await writeFile(`${lock}/pid`, String(process.pid), { mode: 0o600 });
    // Two servers reclaiming the same abandoned lock would both get this far; the last pid written
    // owns it, and the other steps aside rather than sharing one database.
    if ((await readFile(`${lock}/pid`, "utf8")).trim() !== String(process.pid))
      throw Error("Another server claimed the database first. Run one server only.");
  }
  const pg = new PGlite(path);
  try {
    await pg.exec(SCHEMA);
    return new DB(pg, async () => {
      await pg.close();
      if (lock) await rm(lock, { recursive: true });
    });
  } catch (error) {
    await pg.close();
    if (lock) await rm(lock, { recursive: true });
    throw error;
  }
}

/** A real Postgres, for a host whose memory cannot hold PGlite: it needs over 1 GB to start and
 *  Render's free instance has 512 MB. One connection, so queries run one at a time as they do in
 *  PGlite, and a pool so a dropped connection is reopened rather than taking the process down. */
export async function openPostgres(url: string): Promise<DB> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  pool.on("error", (error) => console.error("Postgres connection lost:", error.message));
  const db: Queryable = {
    query: async (sql, params) => {
      const result = await pool.query(sql, params);
      return { rows: result.rows, affectedRows: result.rowCount ?? 0 };
    },
    exec: (sql) => pool.query(sql),
  };
  try {
    await db.exec(SCHEMA);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return new DB(db, () => pool.end());
}
