import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getDiffKind,
  getRequestedDiff,
  getToolCommand,
  getToolSource,
  splitToolName,
  type ToolCall,
} from "../src/tools.ts";

function fakeTool(name: string, arguments_: Record<string, unknown>, output = ""): ToolCall {
  return { id: "one", name, arguments: arguments_, status: "pending", output };
}

test("shows commands and requested edit and write diffs as plain text", () => {
  const tool: ToolCall = {
    id: "one",
    name: "edit",
    arguments: { path: "a.ts", oldText: "old\nline", newText: "<script>" },
    status: "pending",
    output: "",
  };
  assert.equal(getToolCommand(tool), "a.ts");
  assert.equal(getRequestedDiff(tool), "-old\n-line\n+<script>");
  tool.name = "write";
  tool.arguments = { path: "new.ts", content: "one\ntwo" };
  assert.equal(getRequestedDiff(tool), "+one\n+two");
  assert.deepEqual(["+2 new", "-1 old", " 3 same"].map(getDiffKind), ["added", "removed", "context"]);
  assert.equal(getToolCommand(tool), "new.ts");
});

test("previews codemode scripts and shows the full script in the expanded output", () => {
  const tool = fakeTool("codemode", { code: "const one = 1\nconst two = 2\nreturn one + two" });
  assert.equal(getToolCommand(tool), "const one = 1 const two = 2");
  assert.equal(getToolSource(tool), "const one = 1\nconst two = 2\nreturn one + two");
  tool.arguments = { code: "   \n  return await tools.mcp__github__list({})\n  " };
  assert.equal(getToolCommand(tool), "return await tools.mcp__github__list({})");
  tool.arguments = { code: "" };
  assert.equal(getToolCommand(tool), "JavaScript");
});

test("previews a tool search by its query", () => {
  const tool = fakeTool("tool_search", { query: " create an issue  ", limit: 5 });
  assert.equal(getToolCommand(tool), "Search tools: create an issue");
  tool.arguments = { limit: 5 };
  assert.equal(getToolCommand(tool), "Search tools");
});

test("summarizes MCP tool arguments by their most useful value", () => {
  const tool = fakeTool("mcp__github__create_issue", { title: "Flaky login test", body: "failing 3 of 10 runs" });
  assert.equal(getToolCommand(tool), "Flaky login test");
  tool.arguments = { query: "systemd user services", description: "less useful" };
  assert.equal(getToolCommand(tool), "systemd user services");
  tool.arguments = { query: "a".repeat(100) };
  assert.equal(getToolCommand(tool), "a".repeat(79) + "\u2026");
  tool.arguments = { owner: "pi", body: "no useful key" };
  assert.equal(getToolCommand(tool), '{"owner":"pi","body":"no useful key"}');
  tool.arguments = { count: 3 };
  assert.equal(getToolCommand(tool), "count: 3");
  tool.arguments = { count: [1, 2] };
  assert.equal(getToolCommand(tool), '{"count":[1,2]}');
  // A string path stays the row, whatever the tool name.
  tool.name = "mcp__files__read";
  tool.arguments = { path: "src/main.ts" };
  assert.equal(getToolCommand(tool), "src/main.ts");
});

test("splits mcp tool names into the server and the tool", () => {
  assert.deepEqual(splitToolName("bash"), { tool: "bash" });
  assert.deepEqual(splitToolName("tool_search"), { tool: "tool_search" });
  assert.deepEqual(splitToolName("mcp__github__create_issue"), { server: "github", tool: "create_issue" });
  assert.deepEqual(splitToolName("mcp__only-no-separator"), { tool: "only-no-separator" });
});
