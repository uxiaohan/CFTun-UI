import { createApp } from "./src/server.ts";
import { startupBanner } from "./src/startup.ts";

const app = createApp();
const hostname = process.env.SERVER_HOST ?? "0.0.0.0";
const port = Number(process.env.SERVER_PORT ?? 9911);
const frontendRoot = process.env.FRONTEND_DIR ?? `${import.meta.dir}/frontend/dist`;

const server = Bun.serve({ hostname, port, fetch: async (request, server) => {
  const url = new URL(request.url);
  if (url.pathname === "/api/connector/events") server.timeout(request, 0);
  if (url.pathname.startsWith("/api/")) return app.fetch(request);
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
  const assetPath = url.pathname === "/" ? "/index.html" : url.pathname;
  if (!assetPath.includes("..")) {
    const asset = Bun.file(`${frontendRoot}${assetPath}`);
    if (await asset.exists()) return new Response(request.method === "HEAD" ? null : asset, { headers: { "Cache-Control": assetPath === "/index.html" ? "no-cache" : "public, max-age=31536000, immutable" } });
  }
  const index = Bun.file(`${frontendRoot}/index.html`);
  return await index.exists() ? new Response(request.method === "HEAD" ? null : index, { headers: { "Cache-Control": "no-cache" } }) : new Response("Frontend is not built. Run bun run build:frontend.", { status: 503 });
} });
console.log(startupBanner(hostname, port));

if (app.db.getSetting("connector_auto_start") === "true" && app.db.getSetting("setup_completed") === "true") {
  void app.startConnector().catch((e) => console.error("Auto-start connector failed:", e));
}

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  server.stop(false);
  await app.connector.stop();
  app.db.close();
  process.exit(0);
}

process.on("SIGTERM", () => { shutdown().catch((e) => console.error("Shutdown error:", e)); });
process.on("SIGINT", () => { shutdown().catch((e) => console.error("Shutdown error:", e)); });
