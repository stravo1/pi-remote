import { openSession } from "./spike.ts";

const session = await openSession();
try {
	await session.prompt("Reply with one short sentence. Do not use tools.");
	const last = session.messages.at(-1);
	console.log(JSON.stringify(last?.content));
} finally {
	session.dispose();
}
