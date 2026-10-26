// Deploys run npm ci --omit=dev, so Husky is not installed there.
const husky = await import("husky").catch(() => undefined);
if (husky) console.log(husky.default());
