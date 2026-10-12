import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";

// General-purpose structured application logging (separate from process-mining
// event logs in processLog.ts). Every line is a single JSON object to stdout,
// so it works unmodified whether read by `docker logs`, tailed to a file, or
// shipped to a log aggregator later -- no separate "production" logging setup
// is needed. This is deliberately dependency-free (no pino/winston) to keep
// each service's install footprint small, but the shape (level, timestamp,
// service, msg, ...meta) matches what those libraries produce.

type Level = "debug" | "info" | "warn" | "error";

const SERVICE_NAME = process.env.SERVICE_NAME || "unknown-service";

function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  const line = {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    msg,
    ...meta,
  };
  (level === "error" ? console.error : console.log)(JSON.stringify(line));
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => write("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write("error", msg, meta),
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/** Express middleware: logs every HTTP request/response with a correlation id and timing. */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  logger.info("request received", { requestId, method: req.method, path: req.originalUrl });

  res.on("finish", () => {
    logger.info("request completed", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });

  next();
}
