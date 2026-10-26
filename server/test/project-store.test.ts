import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { ProjectStore } from "../src/project-store.ts";

async function setup(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "pi-remote-groups-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("creates a folder in the root, lists it, and keeps it after a restart", async (context) => {
  const root = await setup(context);
  const path = await new ProjectStore(root).create("notes");
  assert.equal(path, join(root, "notes"));
  assert.deepEqual(await new ProjectStore(root).list(), [path]);
  assert.deepEqual(JSON.parse(await readFile(join(root, ".pi-remote", "projects.json"), "utf8")), [path]);
});

test("removes a project from the list and keeps its folder", async (context) => {
  const root = await setup(context);
  const store = new ProjectStore(root);
  const path = await store.create("notes");
  await store.remove(path);
  assert.deepEqual(await new ProjectStore(root).list(), []);
  assert.ok((await lstat(path)).isDirectory());
  await assert.rejects(store.remove(path), /Unknown project/);
});

test("adopts an existing folder once and lists it once", async (context) => {
  const root = await setup(context);
  await mkdir(join(root, "existing"));
  const store = new ProjectStore(root);
  await store.create("existing");
  await store.create("existing");
  assert.deepEqual(await store.list(), [join(root, "existing")]);
});

for (const name of ["", ".hidden", "../escape", "a/b", "a b", "-flag", "x".repeat(65), "/abs"]) {
  test(`rejects the name ${JSON.stringify(name)}`, async (context) => {
    const store = new ProjectStore(await setup(context));
    await assert.rejects(store.create(name), /Use letters/);
    assert.deepEqual(await store.list(), []);
  });
}

test("rejects a name that is a file", async (context) => {
  const root = await setup(context);
  await writeFile(join(root, "file"), "x");
  await assert.rejects(new ProjectStore(root).create("file"), /EEXIST|not a folder/);
});

test("rejects a symlink that leaves the root", async (context) => {
  const root = await setup(context);
  await symlink(tmpdir(), join(root, "link"));
  await assert.rejects(new ProjectStore(root).create("link"), /not a folder/);
});

test("is disabled without a root", async () => {
  const store = new ProjectStore();
  assert.deepEqual(await store.list(), []);
  await assert.rejects(store.create("notes"), /not enabled/);
});

test("handles several creates at once without losing one", async (context) => {
  const root = await setup(context);
  const store = new ProjectStore(root);
  await Promise.all(["a", "b", "c"].map((name) => store.create(name)));
  assert.equal((await new ProjectStore(root).list()).length, 3);
});
