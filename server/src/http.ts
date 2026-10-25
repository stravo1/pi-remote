import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2",
};

export async function serveHttp(request: IncomingMessage, response: ServerResponse, directory: string): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  if (path === "/api/ping") {
    response.writeHead(204).end();
    return;
  }
  const root = resolve(directory);
  const file = resolve(root, path === "/" ? "index.html" : `.${path}`);
  if (!file.startsWith(`${root}${sep}`)) {
    response.writeHead(404).end();
    return;
  }
  await serveFile(file, request, response);
}

async function serveFile(file: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const content = await readFile(file);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream",
      "Content-Length": content.length,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!["ENOENT", "ENOTDIR", "EISDIR"].includes(code ?? "")) throw error;
    response.writeHead(404).end();
  }
}
