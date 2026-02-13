import { SeverityNumber } from "@opentelemetry/api-logs";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "verbose";

export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  verbose: 5,
};

export const SEVERITY_NUMBER: Record<LogLevel, SeverityNumber> = {
  fatal: SeverityNumber.FATAL,
  error: SeverityNumber.ERROR,
  warn: SeverityNumber.WARN,
  info: SeverityNumber.INFO,
  debug: SeverityNumber.DEBUG,
  verbose: SeverityNumber.TRACE,
};

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  traceId?: string;
  spanId?: string;
  attributes?: Record<string, unknown>;
  error?: Error;
}
