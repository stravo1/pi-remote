import { logEvents, openSession } from "./spike.ts";

const session = await openSession();
const stopLog = logEvents(session, "abort");
let abortTimer: NodeJS.Timeout | undefined;
session.subscribe((event) => {
  if (event.type === "tool_execution_start" && !abortTimer) {
    abortTimer = setTimeout(() => session.abort(), 3500);
  }
});
try {
  await session.prompt(
    "Run exactly this with the bash tool: `for i in 1 2 3 4 5 6 7 8 9 10; do echo $i; sleep 1; done`",
  );
  console.log("prompt resolved");
} catch (error) {
  console.log("prompt rejected:", error);
} finally {
  console.log("last message:", JSON.stringify(session.messages.at(-1)).slice(0, 400));
  await stopLog();
  session.dispose();
}
