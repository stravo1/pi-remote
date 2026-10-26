import assert from "node:assert/strict";
import { test } from "node:test";
import { getConfiguration, getConfigurationFile } from "../src/config.ts";

const valid = {
  host: "127.0.0.1",
  port: 7710,
  origin: "https://pi.example.com",
  allowedUser: "me",
  projectsRoot: "/tmp/projects",
  idleMinutes: 30,
};

test("accepts the spec configuration", () => {
  assert.deepEqual(getConfiguration(valid), valid);
});

for (const field of Object.keys(valid)) {
  test(`names the missing ${field} field`, () => {
    const configuration: Record<string, unknown> = { ...valid };
    delete configuration[field];
    assert.throws(() => getConfiguration(configuration), new RegExp(`"${field}"`));
  });
}

for (const [field, value] of [
  ["host", "0.0.0.0"],
  ["port", 0],
  ["port", 1.5],
  ["port", 65536],
  ["origin", "https://pi.example.com/path"],
  ["origin", "file:///tmp"],
  ["allowedUser", " "],
  ["projects", ["/tmp/project"]],
  ["idleMinutes", -1],
  ["projectsRoot", "relative"],
  ["projectsRoot", " "],
] as const) {
  test(`rejects invalid ${field}: ${JSON.stringify(value)}`, () => {
    assert.throws(() => getConfiguration({ ...valid, [field]: value }), new RegExp(`"${field}"`));
  });
}

test("requires a configuration file on the command line", async () => {
  await assert.rejects(getConfigurationFile(undefined), /Usage:/);
});

test("validates explicit model selection", () => {
  assert.throws(() => getConfiguration({ ...valid, model: { provider: "openrouter" } }), /model.id/);
});

test("requires a projects root", () => {
  const configuration: Record<string, unknown> = { ...valid };
  delete configuration.projectsRoot;
  assert.throws(() => getConfiguration(configuration), /"projectsRoot"/);
});

test("validates optional push settings", () => {
  const push = { contact: "mailto:me@example.com", file: "/home/me/.config/pi-remote/push.json" };
  assert.deepEqual(getConfiguration({ ...valid, push }).push, push);
  assert.throws(() => getConfiguration({ ...valid, push: { ...push, contact: "me" } }), /push.contact/);
  assert.throws(() => getConfiguration({ ...valid, push: { ...push, file: "push.json" } }), /push.file/);
});
