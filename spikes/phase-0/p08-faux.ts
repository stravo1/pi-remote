import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { logEvents, OUT_DIR } from "./spike.ts";

const faux = fauxProvider();
faux.setResponses([
  fauxAssistantMessage([fauxToolCall("bash", { command: "echo faux" })], { stopReason: "toolUse" }),
  (context) => fauxAssistantMessage(fauxText(`Saw ${context.messages.at(-1)?.role}.`)),
]);

// An auth file that does not exist proves that no provider key is used.
const authPath = `${OUT_DIR}no-auth.json`;
const modelRuntime = await ModelRuntime.create({ authPath, refreshOnCreate: false });
modelRuntime.registerNativeProvider(faux.provider);
const { session } = await createAgentSession({
  model: faux.getModel(),
  modelRuntime,
  sessionManager: SessionManager.inMemory(process.cwd()),
});
const stopLog = logEvents(session, "faux");
try {
  await session.prompt("Run the scripted tool call.");
  console.log(session.messages.map((m) => `${m.role}: ${JSON.stringify(m.content).slice(0, 90)}`).join("\n"));
  console.log("calls:", faux.state.callCount, "pending:", faux.getPendingResponseCount());
} finally {
  await stopLog();
  session.dispose();
}
