import assert from "node:assert/strict";
import { test } from "node:test";
import { getDiffKind, getRequestedDiff, getToolCommand, type ToolCall } from "../src/tools.ts";

test("shows commands and requested edit and write diffs as plain text", () => {
  const tool: ToolCall = { id: "one", name: "edit", arguments: { path: "a.ts", oldText: "old\nline", newText: "<script>" }, status: "pending", output: "" };
  assert.equal(getToolCommand(tool), "a.ts");
  assert.equal(getRequestedDiff(tool), "-old\n-line\n+<script>");
  tool.name = "write";
  tool.arguments = { path: "new.ts", content: "one\ntwo" };
  assert.equal(getRequestedDiff(tool), "+one\n+two");
  assert.deepEqual(["+2 new", "-1 old", " 3 same"].map(getDiffKind), ["added", "removed", "context"]);
});
