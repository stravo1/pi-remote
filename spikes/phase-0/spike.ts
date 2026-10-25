import { createWriteStream, mkdirSync } from "node:fs";
import { type AgentSession, createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

export const MODEL_PROVIDER = "openrouter";
export const MODEL_ID = "deepseek/deepseek-v4-flash";
export const OUT_DIR = new URL("./out/", import.meta.url).pathname;

export async function openSession(sessionManager = SessionManager.inMemory(process.cwd())) {
	const modelRuntime = await ModelRuntime.create();
	const model = modelRuntime.getModel(MODEL_PROVIDER, MODEL_ID);
	if (!model) throw new Error(`Model not found: ${MODEL_PROVIDER}/${MODEL_ID}`);
	const { session } = await createAgentSession({ model, modelRuntime, thinkingLevel: "high", sessionManager });
	return session;
}

// Writes every event unchanged, one JSON line each, with a receive timestamp.
export function logEvents(session: AgentSession, caseName: string) {
	mkdirSync(OUT_DIR, { recursive: true });
	const file = createWriteStream(`${OUT_DIR}${caseName}.jsonl`);
	const unsubscribe = session.subscribe((event) => {
		file.write(`${JSON.stringify({ receivedAt: Date.now(), event })}\n`);
	});
	return () => {
		unsubscribe();
		return new Promise<void>((resolve) => file.end(resolve));
	};
}

export function eventTypes(session: AgentSession) {
	const types: string[] = [];
	session.subscribe((event) => types.push(event.type));
	return types;
}
