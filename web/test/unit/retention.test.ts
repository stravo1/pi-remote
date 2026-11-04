import assert from "node:assert/strict";
import { test } from "node:test";
import { getDayCount, getRetentionChoice, getRetentionDays } from "../../src/retention.ts";

test("maps stored days to a select value and back", () => {
  assert.equal(getRetentionChoice(undefined), "");
  assert.equal(getRetentionChoice(null), "never");
  assert.equal(getRetentionChoice(1), "1");
  assert.equal(getRetentionChoice(7), "7");
  assert.equal(getRetentionChoice(30), "30");
  assert.equal(getRetentionChoice(14), "custom");
  assert.equal(getRetentionDays("never"), null);
  assert.equal(getRetentionDays("1"), 1);
  assert.equal(getRetentionDays("7"), 7);
  assert.equal(getRetentionDays("30"), 30);
  assert.equal(getRetentionDays("custom"), undefined);
  assert.equal(getRetentionDays(""), undefined);
});

test("reads a typed day count as a whole number of days", () => {
  assert.equal(getDayCount("14"), 14);
  assert.equal(getDayCount("1"), 1);
  assert.equal(getDayCount("0"), undefined);
  assert.equal(getDayCount("-3"), undefined);
  assert.equal(getDayCount("2.5"), undefined);
  assert.equal(getDayCount(""), undefined);
  assert.equal(getDayCount("days"), undefined);
});
