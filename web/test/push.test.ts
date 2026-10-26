import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeKey } from "../src/push.ts";

test("decodes a base64url server key", () => {
  assert.deepEqual([...decodeKey("-_8")], [251, 255]);
  assert.deepEqual([...decodeKey(Buffer.from("hello").toString("base64url"))], [...Buffer.from("hello")]);
});
