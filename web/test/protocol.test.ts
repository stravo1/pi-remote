import assert from "node:assert/strict";
import { test } from "node:test";
import { getSessionTitle, orderProjects, projectHash, projectPathFromHash } from "../src/protocol.ts";

test("round-trips project paths in their page hash", () => {
  const hash = projectHash("/home/me/Code/my project");
  assert.equal(hash, "#project:%2Fhome%2Fme%2FCode%2Fmy%20project");
  assert.equal(projectPathFromHash(hash), "/home/me/Code/my project");
  assert.equal(projectPathFromHash("#one"), undefined);
});

test("titles a session by its name, then its first message, then New session", () => {
  const session = { id: "one", firstMessage: "", modified: 1, isRunning: false };
  assert.equal(getSessionTitle({ ...session, name: "Named" }), "Named");
  assert.equal(getSessionTitle({ ...session, firstMessage: "Hello" }), "Hello");
  assert.equal(getSessionTitle(session), "New session");
});

test("puts the project with the last user message first, or last for a phone", () => {
  const item = (id: string, modified: number, lastUserMessage?: number) => ({
    id,
    firstMessage: id,
    modified,
    lastUserMessage,
    isRunning: false,
  });
  const projects = [
    { path: "/p/idle", sessions: [item("idle-old", 100, 100)] },
    { path: "/p/empty", sessions: [] },
    { path: "/p/busy", sessions: [item("busy-old", 200, 200), item("busy-new", 900, 900)] },
    // A running reply changes modified, but the user's last message keeps this chat in place.
    { path: "/p/running", sessions: [item("running", 1000, 150)] },
  ];

  assert.deepEqual(
    orderProjects(projects, true).map((project) => [project.path, project.sessions.map((session) => session.id)]),
    [
      ["/p/busy", ["busy-new", "busy-old"]],
      ["/p/running", ["running"]],
      ["/p/idle", ["idle-old"]],
      ["/p/empty", []],
    ],
  );
  assert.deepEqual(
    orderProjects(projects, false).map((project) => [project.path, project.sessions.map((session) => session.id)]),
    [
      ["/p/empty", []],
      ["/p/idle", ["idle-old"]],
      ["/p/running", ["running"]],
      ["/p/busy", ["busy-old", "busy-new"]],
    ],
  );
});
