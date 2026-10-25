import { isDeepStrictEqual } from "node:util";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { OUT_DIR, openSession } from "./spike.ts";

const cwd = process.cwd();
const sessionDir = `${OUT_DIR}sessions`;

const original = await openSession(SessionManager.create(cwd, sessionDir));
await original.prompt("Reply with the word PEAR and nothing else.");
const originalMessages = structuredClone(original.messages);
const originalId = original.sessionId;
original.dispose();

const listed = await SessionManager.list(cwd, sessionDir);
const info = listed.find((session) => session.id === originalId);
if (!info) throw new Error(`Session ${originalId} not in list: ${JSON.stringify(listed)}`);
console.log("listed:", JSON.stringify({ ...info, allMessagesText: undefined }));

const reopened = await openSession(SessionManager.open(info.path, sessionDir));
console.log("roles:", originalMessages.map((m) => m.role).join(","), "|", reopened.messages.map((m) => m.role).join(","));
console.log("messages match:", isDeepStrictEqual(originalMessages, reopened.messages));
reopened.dispose();
