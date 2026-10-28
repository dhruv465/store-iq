import { PGlite } from "@electric-sql/pglite";
import { mkdir, rm, writeFile } from "node:fs/promises";
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
create table if not exists sessions (
  phone text primary key,
  version integer not null default 0,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
`;

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

export async function openDatabase(path = process.env.LOCAL_DB_PATH || "data/runtime/pg"): Promise<DB> {
  if (path !== "memory://") await mkdir(resolve(path), { recursive: true, mode: 0o700 });
  const lock = path === "memory://" ? null : `${resolve(path)}.lock`;
  if (lock) {
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch {
      throw Error("Database already open or unclean shutdown. Check the .lock/pid and run one server only.");
    }
    await writeFile(`${lock}/pid`, String(process.pid), { mode: 0o600 });
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
