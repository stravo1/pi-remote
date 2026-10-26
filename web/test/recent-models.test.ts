import assert from "node:assert/strict";
import test from "node:test";
import { loadRecentKeys, rememberModel } from "../src/recent-models.ts";

const model = (id: string) => ({ provider: "faux", id, name: id });

test("puts the newest model first and removes duplicates", () => {
  const keys = rememberModel(rememberModel([], model("a")), model("b"));
  assert.deepEqual(rememberModel(keys, model("a")), ["faux/a", "faux/b"]);
});

test("keeps at most four models", () => {
  const keys = ["a", "b", "c", "d"].reduce((list, id) => rememberModel(list, model(id)), [] as string[]);
  assert.deepEqual(rememberModel(keys, model("e")), ["faux/e", "faux/d", "faux/c", "faux/b"]);
});

test("returns an empty list when storage is missing", () => {
  assert.deepEqual(loadRecentKeys(), []);
});
