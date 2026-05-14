import type { Response } from "express";
import type { SseEvent } from "../shared/types.ts";

export function setupSse(res: Response): (e: SseEvent) => void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(": connected\n\n");

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
  res.on("close", () => clearInterval(heartbeat));

  return (event: SseEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
}
