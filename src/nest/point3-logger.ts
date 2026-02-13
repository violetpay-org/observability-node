import type { LoggerService, LogLevel } from "@nestjs/common";

import { emitLog } from "../log/emit";
import type { LogLevel as Point3LogLevel } from "../log/types";

const NEST_LEVEL_MAP: Record<string, Point3LogLevel> = {
  log: "info",
  error: "error",
  warn: "warn",
  debug: "debug",
  verbose: "verbose",
  fatal: "fatal",
};

function isStackTrace(value: unknown): value is string {
  return typeof value === "string" && value.includes("\n") && value.includes("at ");
}

function extractContext(params: unknown[]): { context?: string; rest: unknown[] } {
  if (params.length === 0) return { rest: [] };

  const last = params[params.length - 1];
  if (typeof last === "string" && !isStackTrace(last)) {
    return { context: last, rest: params.slice(0, -1) };
  }

  return { rest: [...params] };
}

export class Point3Logger implements LoggerService {
  private readonly defaultContext?: string;

  constructor(context?: string) {
    this.defaultContext = context;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("log", message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("error", message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("warn", message, optionalParams);
  }

  debug?(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("debug", message, optionalParams);
  }

  verbose?(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("verbose", message, optionalParams);
  }

  fatal?(message: unknown, ...optionalParams: unknown[]): void {
    this.emit("fatal", message, optionalParams);
  }

  setLogLevels?(_levels: LogLevel[]): void {
    // no-op: log level is controlled by LOG_LEVEL env var
  }

  private emit(nestLevel: string, message: unknown, optionalParams: unknown[]): void {
    const { context, rest } = extractContext(optionalParams);
    const resolvedContext = context ?? this.defaultContext;

    const level = NEST_LEVEL_MAP[nestLevel] ?? "info";

    const args: unknown[] = [message, ...rest];

    if (resolvedContext) {
      const attrs = { "nest.context": resolvedContext };
      if (args.length === 1 && typeof args[0] === "string") {
        args[0] = { message: args[0], ...attrs };
      } else {
        args.push(attrs);
      }
    }

    emitLog(level, args);
  }
}
