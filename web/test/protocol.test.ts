import assert from "node:assert/strict";
import { test } from "node:test";
import { getSessionTitle } from "../src/protocol.ts";

test("titles a session by its name, then its first message, then New session", () => {
  const session = { id: "one", firstMessage: "", modified: 1, isRunning: false };
  assert.equal(getSessionTitle({ ...session, name: "Named" }), "Named");
  assert.equal(getSessionTitle({ ...session, firstMessage: "Hello" }), "Hello");
  assert.equal(getSessionTitle(session), "New session");
});
