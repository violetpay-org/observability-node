import { format as utilFormat } from "node:util";
import { trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import type { Logger } from "@opentelemetry/api-logs";

import type { LogEntry, LogLevel } from "./types";
import { LOG_LEVEL_PRIORITY, SEVERITY_NUMBER } from "./types";
import { format } from "./stdout-formatter";

const LIB_NAME = "@point3/observability";

const _originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
} as const;

let _isEmitting = false;

let _otelLogger: Logger | undefined;

function getOtelLogger(): Logger {
  if (!_otelLogger) {
    _otelLogger = logs.getLogger(LIB_NAME);
  }
  return _otelLogger;
}

export function getOriginalConsole(): typeof _originalConsole {
  return _originalConsole;
}

export function getConfiguredLogLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env && env in LOG_LEVEL_PRIORITY) {
    return env as LogLevel;
  }
  return "info";
}

export function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[getConfiguredLogLevel()];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Error) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function extractActiveSpan(): { traceId?: string; spanId?: string } {
  const span = trace.getActiveSpan();
  if (!span) return {};

  const ctx = span.spanContext();
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

function buildMessage(args: unknown[]): { message: string; attributes?: Record<string, unknown>; error?: Error } {
  if (args.length === 0) return { message: "" };

  const first = args[0];

  if (isPlainObject(first)) {
    const { message, ...rest } = first;
    const msg = typeof message === "string" ? message : utilFormat(first);
    const attributes = Object.keys(rest).length > 0 ? rest : undefined;
    return { message: msg, attributes };
  }

  let error: Error | undefined;
  for (const arg of args) {
    if (arg instanceof Error) {
      error = arg;
      break;
    }
  }

  return { message: utilFormat(...args), error };
}

const STDERR_LEVELS: ReadonlySet<LogLevel> = new Set(["error", "fatal"]);

export function emitLog(level: LogLevel, args: unknown[]): void {
  if (!shouldLog(level)) return;

  if (_isEmitting) {
    const consoleFn = STDERR_LEVELS.has(level) ? _originalConsole.error : _originalConsole.log;
    consoleFn(utilFormat(...args));
    return;
  }

  _isEmitting = true;
  try {
    const { message, attributes, error } = buildMessage(args);
    const { traceId, spanId } = extractActiveSpan();

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      traceId,
      spanId,
      attributes,
      error,
    };

    const output = format(entry);
    if (STDERR_LEVELS.has(level)) {
      process.stderr.write(output + "\n");
    } else {
      process.stdout.write(output + "\n");
    }

    const otelLogger = getOtelLogger();
    otelLogger.emit({
      severityNumber: SEVERITY_NUMBER[level],
      severityText: level.toUpperCase(),
      body: message,
      attributes: {
        ...attributes,
        ...(error && {
          "exception.type": error.name,
          "exception.message": error.message,
          "exception.stacktrace": error.stack,
        }),
      },
    });
  } finally {
    _isEmitting = false;
  }
}
