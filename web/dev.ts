import { isIP } from "node:net";
import { createServer } from "vite";
import { getConfigurationFile } from "../server/src/config.ts";

if (!process.argv[2]) throw new Error("Usage: npm run dev -w web -- /absolute/path/to/config.json [--lan]");
const isOnNetwork = process.argv.includes("--lan");
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
    host: isOnNetwork ? "0.0.0.0" : "127.0.0.1",
    port: Number(origin.port),
    strictPort: true,
    proxy: {
      "/api": { target },
      "/ws": {
        target,
        ws: true,
        headers: { "Remote-User": configuration.allowedUser },
        configure: (proxy) =>
          proxy.on("proxyReqWs", (request, incoming) => {
            if (isOnNetwork && isSameAddress(incoming.headers.origin, incoming.headers.host)) {
              request.setHeader("Origin", configuration.origin);
            }
          }),
      },
    },
  },
});
await server.listen();
server.printUrls();
if (isOnNetwork) console.warn("Anyone on this network can use pi through this server without a login.");
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void server.close());
}

// The backend accepts only the configured origin. On the network, a page loaded from an IP address
// sends that address as its origin. Other sites and DNS rebinding keep their own origin and stay blocked.
function isSameAddress(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host || origin !== `http://${host}`) return false;
  return isIP(new URL(origin).hostname) !== 0;
}
