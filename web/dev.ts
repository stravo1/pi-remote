import { createServer } from "vite";
import { getConfigurationFile } from "../server/src/config.ts";

if (!process.argv[2]) throw new Error("Usage: npm run dev -w web -- /absolute/path/to/config.json");
const configuration = await getConfigurationFile(process.argv[2]);
const origin = new URL(configuration.origin);
if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !origin.port) {
  throw new Error("The development origin must be http://127.0.0.1:<port>.");
}
if (Number(origin.port) === configuration.port) {
  throw new Error("The frontend and backend must use different development ports.");
}
const target = `http://${configuration.host}:${configuration.port}`;
const server = await createServer({
  server: {
    host: "127.0.0.1", port: Number(origin.port), strictPort: true,
    proxy: {
      "/api": { target },
      "/ws": { target, ws: true, headers: { "Remote-User": configuration.allowedUser } },
    },
  },
});
await server.listen();
server.printUrls();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void server.close());
}
