// Entry point. Subcommands:
//   serve (default)     — start Express on 127.0.0.1:PORT
//   mcp                 — run stdio MCP server (also runnable directly)

import express from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { registerRoutes } from "./routes.ts";
import { log, logPath } from "./log.ts";

const sub = process.argv[2];

if (sub === "mcp") {
  await import("./mcp-tools-server.ts");
} else {
  await startServer();
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(cors({ origin: true }));

  app.use(
    pinoHttp({
      logger: log,
      autoLogging: {
        // Skip noisy GETs in stdout but keep them in the file at debug level.
        ignore: (req) => req.url?.startsWith("/api/sessions/") && req.url.endsWith("/events") || false,
      },
      customLogLevel: (_req, res, err) => {
        if (err) return "error";
        if (res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "debug";
      },
    })
  );

  app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
  registerRoutes(app);

  const port = Number(process.env.PORT ?? 7457);
  app.listen(port, "127.0.0.1", () => {
    log.warn({ port, logPath }, `daemon listening at http://127.0.0.1:${port} · log file ${logPath}`);
  });

  // Surface uncaught errors so they don't disappear silently.
  process.on("uncaughtException", (err) => log.error({ err }, "uncaughtException"));
  process.on("unhandledRejection", (reason) => log.error({ reason }, "unhandledRejection"));
}
