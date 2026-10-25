import { logEvents, openSession } from "./spike.ts";

const mode = process.argv[2];
if (mode !== "steer" && mode !== "followUp") throw new Error("Usage: node p05-queue.ts steer|followUp");

const session = await openSession();
const stopLog = logEvents(session, mode === "steer" ? "steer" : "follow-up");
let sent = false;
session.subscribe(async (event) => {
	if (event.type !== "tool_execution_start" || sent) return;
	sent = true;
	const text = "Also say the word BANANA in your final reply.";
	const disposition = await (mode === "steer" ? session.steer(text) : session.followUp(text));
	console.log("disposition:", JSON.stringify(disposition));
});
try {
	await session.prompt("Run exactly this with the bash tool: `for i in 1 2 3 4; do echo $i; sleep 1; done`. Then reply in one line.");
} finally {
	await stopLog();
	session.dispose();
}
