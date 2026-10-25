import { isDeepStrictEqual } from "node:util";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { logEvents, openSession } from "./spike.ts";

const session = await openSession();
const finished = structuredClone(session.messages);
let buffer: AgentSessionEvent[] = [];
const runningTools = new Set<string>();
const gaps = { messages: new Set<string>(), queue: new Set<string>(), tools: new Set<string>() };
let checks = 0;

function toolsInBuffer() {
	const ids = new Set<string>();
	for (const event of buffer) {
		if (event.type === "tool_execution_start") ids.add(event.toolCallId);
		if (event.type === "tool_execution_end") ids.delete(event.toolCallId);
	}
	return ids;
}

function queueInBuffer() {
	const last = buffer.findLast((event) => event.type === "queue_update");
	return last ? [...last.steering, ...last.followUp] : [];
}

// Subscribed before the logger, so it sees each event first, as the server would.
session.subscribe((event) => {
	if (event.type === "message_end") finished.push(event.message);
	if (event.type === "tool_execution_start") runningTools.add(event.toolCallId);
	if (event.type === "tool_execution_end") runningTools.delete(event.toolCallId);
	buffer = event.type === "message_end" ? [] : [...buffer, event];
	checks++;
	if (!isDeepStrictEqual(session.messages, finished)) gaps.messages.add(event.type);
	const queue = [...session.getSteeringMessages(), ...session.getFollowUpMessages()];
	if (!isDeepStrictEqual(queue, queueInBuffer())) gaps.queue.add(event.type);
	if (!isDeepStrictEqual(runningTools, toolsInBuffer())) gaps.tools.add(event.type);
});

const stopLog = logEvents(session, "snapshot");
let sent = false;
session.subscribe((event) => {
	if (event.type !== "tool_execution_start" || sent) return;
	sent = true;
	session.followUp("Also say the word BANANA in your final reply.");
});
try {
	await session.prompt(
		"Make two bash tool calls in parallel in one response: `sleep 2; echo a` and `sleep 4; echo b`. Then reply in one line.",
	);
} finally {
	await stopLog();
	console.log("checks:", checks);
	console.log("gaps:", JSON.stringify(Object.fromEntries(Object.entries(gaps).map(([k, v]) => [k, [...v]]))));
	session.dispose();
}
