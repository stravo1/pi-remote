import { fileURLToPath } from "node:url";
import { getConfigurationFile } from "./config.ts";
import { PiAdapter } from "./pi-adapter.ts";
import { Transport } from "./transport.ts";

const configuration = await getConfigurationFile(process.argv[2]);
const adapter = await PiAdapter.fromConfiguration(configuration);
const transport = new Transport(adapter, configuration, fileURLToPath(new URL("../../web/dist/", import.meta.url)));

try {
  await new Promise<void>((resolve, reject) => {
    transport.server.once("error", reject);
    transport.server.listen(configuration.port, configuration.host, () => resolve());
  });
} catch (error) {
  await transport.close();
  await adapter.close();
  throw error;
}
console.log(`pi remote listening on ${configuration.host}:${configuration.port}`);

let isClosing = false;
async function close(): Promise<void> {
  if (isClosing) return;
  isClosing = true;
  await adapter.close();
  await transport.close();
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void close().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  }));
}
