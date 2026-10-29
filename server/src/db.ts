import { PGlite } from "@electric-sql/pglite";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IncomingMessage } from "./webhook.js";
import { newSession, type Reply, type Session } from "./types.js";

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

export class DB {
  constructor(
    private readonly pg: PGlite,
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
      return { ...fresh, version: row.version, language: session.language, steps_done: session.steps_done.filter((step) => step === "brief") };
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
    for (const reply of replies)
      await this.pg.query(`insert into outbox (phone, payload) values ($1, $2)`, [session.phone, JSON.stringify(reply)]);
    session.version = next;
    return true;
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
      `select id, phone, status, provider_id, error, created_at from outbox order by id desc limit $1`,
      [limit],
    );
    return rows.rows;
  }

  /** Extra points: a question the floor could not answer, routed to a named owner. */
  async logQuestion(row: { reference: string; phone: string; area: string; owner: string; question: string }): Promise<void> {
    await this.pg.query(
      `insert into expert_questions (reference, phone, area, owner, question) values ($1,$2,$3,$4,$5)
       on conflict (reference) do nothing`,
      [row.reference, row.phone, row.area, row.owner, row.question],
    );
  }

  async openQuestions(): Promise<{ reference: string; area: string; owner: string }[]> {
    const rows = await this.pg.query<{ reference: string; area: string; owner: string }>(
      `select reference, area, owner from expert_questions where answered_at is null order by id desc limit 20`,
    );
    return rows.rows;
  }

  /** Every conversation touched today, for the department manager view. */
  async today(): Promise<Session[]> {
    const rows = await this.pg.query<{ state: Session }>(
      `select state from sessions where updated_at > now() - interval '12 hours'`,
    );
    return rows.rows.map((row) => row.state);
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
      throw Error(`Database already open by pid ${await readFile(`${lock}/pid`, "utf8").catch(() => "?")}. Run one server only.`);
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
