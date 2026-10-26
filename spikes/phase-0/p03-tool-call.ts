import { logEvents, openSession } from "./spike.ts";

const session = await openSession();
const stopLog = logEvents(session, "tool-call");
try {
  await session.prompt("Run `echo hello` with the bash tool, then tell me the output in one line.");
} finally {
  await stopLog();
  session.dispose();
}
