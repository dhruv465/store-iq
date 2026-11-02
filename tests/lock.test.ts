import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/src/db.js";

async function withLock(pid: string): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "storeiq-lock-"));
  const path = join(base, "pg");
  await mkdir(`${path}.lock`, { recursive: true, mode: 0o700 });
  if (pid) await writeFile(`${path}.lock/pid`, pid, { mode: 0o600 });
  return path;
}

test("a lock left by a dead process is reclaimed, and ends up owned by us", async () => {
  const path = await withLock(String(2 ** 22));
  const db = await openDatabase(path);
  assert.equal((await readFile(`${path}.lock/pid`, "utf8")).trim(), String(process.pid));
  await db.close();
});

test("a lock with no pid file is reclaimed too", async () => {
  const path = await withLock("");
  const db = await openDatabase(path);
  await db.close();
});

test("a lock held by a running process is respected", async () => {
  const path = await withLock(String(process.pid));
  await assert.rejects(openDatabase(path, 0), /already open by pid/);
});

test("a predecessor still shutting down is waited out, not refused", async () => {
  const path = await withLock(String(process.pid));
  setTimeout(() => void rm(`${path}.lock`, { recursive: true, force: true }), 200);
  const db = await openDatabase(path, 4000);
  await db.close();
});
