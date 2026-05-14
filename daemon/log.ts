// Structured logging via pino. Writes JSON lines to ~/.beaver-designus/daemon.log
// and a human-readable stream to stdout. Level override via env or CLI.

import pino, { type Logger } from "pino";
import { mkdirSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const LOG_DIR = join(homedir(), ".beaver-designus");
mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = join(LOG_DIR, "daemon.log");

const level = process.env.BEAVER_DESIGNUS_LOG_LEVEL ?? "info";

// File stream — always JSON, full fidelity. App lifetime, append.
const fileStream = createWriteStream(LOG_FILE, { flags: "a" });

export const log: Logger = pino(
  {
    level,
    base: { app: "beaver-designus" },
    redact: {
      paths: ["headers.authorization", "headers.cookie", "req.headers.authorization"],
      remove: true,
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream([
    { stream: fileStream, level },
    // Human-readable stdout — pino-pretty via dynamic require would add an
    // extra dep; for now just send raw JSON to stdout at warn+ so info noise
    // stays in the file.
    { stream: process.stdout, level: "warn" },
  ])
);

export const logPath = LOG_FILE;
