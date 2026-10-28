import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedPhones, sendableTo } from "../server/src/worker.js";

test("no allowlist means any associate who writes in gets a reply", () => {
  assert.equal(sendableTo("919820000001", allowedPhones("")), true);
  assert.equal(sendableTo("919820000001", allowedPhones(undefined)), true);
});

test("setting the allowlist pins replies to those handsets", () => {
  const allowed = allowedPhones("919820000001, +919820000002");
  assert.equal(sendableTo("919820000001", allowed), true);
  assert.equal(sendableTo("919820000002", allowed), true, "a leading plus in the list is normalised");
  assert.equal(sendableTo("919999999999", allowed), false);
});

test("whitespace and empty entries do not accidentally restrict anything", () => {
  assert.equal(allowedPhones("  ,  , ").size, 0);
  assert.equal(sendableTo("919820000001", allowedPhones("  ,  , ")), true);
});
