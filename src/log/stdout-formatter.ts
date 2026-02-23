import type { LogEntry, LogLevel } from "./types";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const GRAY = "\x1b[90m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";

const LEVEL_COLOR: Record<LogLevel, string> = {
  fatal: MAGENTA,
  error: RED,
  warn: YELLOW,
  info: GREEN,
  debug: CYAN,
  verbose: GRAY,
};

function formatTimestamp(date: Date): string {
  return date.toISOString();
}

export function formatPretty(entry: LogEntry): string {
  const color = LEVEL_COLOR[entry.level];
  const level = `${color}${entry.level.toUpperCase().padEnd(7)}${RESET}`;
  const timestamp = `${GRAY}${formatTimestamp(entry.timestamp)}${RESET}`;
  const message = entry.message;

  let line = `${level} ${timestamp} ${message}`;

  if (entry.traceId) {
    line += ` ${GRAY}trace_id=${entry.traceId}${RESET}`;
  }

  if (entry.error) {
    line += `\n${RED}${entry.error.stack ?? entry.error.message}${RESET}`;
  }

  if (entry.attributes && Object.keys(entry.attributes).length > 0) {
    line += ` ${GRAY}${JSON.stringify(entry.attributes)}${RESET}`;
  }

  return line;
}

export function formatJson(entry: LogEntry): string {
  const seen = new WeakSet<object>();

  const record: Record<string, unknown> = {
    level: entry.level,
    message: entry.message,
    timestamp: entry.timestamp.toISOString(),
  };

  if (entry.traceId) record.trace_id = entry.traceId;
  if (entry.spanId) record.span_id = entry.spanId;
  if (entry.attributes) record.attributes = entry.attributes;
  if (entry.error) {
    record.error = {
      name: entry.error.name,
      message: entry.error.message,
      stack: entry.error.stack,
    };
  }

  return JSON.stringify(record, (_key, value: unknown) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  });
}

export function format(entry: LogEntry): string {
  return formatPretty(entry);
}
