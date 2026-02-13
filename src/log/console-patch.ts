import { emitLog, getOriginalConsole } from "./emit";

let _isPatched = false;

const _savedConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};

export function patchConsole(): void {
  if (_isPatched) return;

  const originalConsole = getOriginalConsole();

  console.log = (...args: unknown[]) => {
    emitLog("info", args);
  };

  console.info = (...args: unknown[]) => {
    emitLog("info", args);
  };

  console.warn = (...args: unknown[]) => {
    emitLog("warn", args);
  };

  console.error = (...args: unknown[]) => {
    emitLog("error", args);
  };

  console.debug = (...args: unknown[]) => {
    emitLog("debug", args);
  };

  _isPatched = true;
}

export function unpatchConsole(): void {
  if (!_isPatched) return;

  console.log = _savedConsole.log;
  console.info = _savedConsole.info;
  console.warn = _savedConsole.warn;
  console.error = _savedConsole.error;
  console.debug = _savedConsole.debug;

  _isPatched = false;
}
