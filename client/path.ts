import { posix } from "./path/posix";
import { win32 } from "./path/win32";

(posix as Record<string, unknown>).win32 = win32;
(posix as Record<string, unknown>).posix = posix;
(win32 as Record<string, unknown>).win32 = win32;
(win32 as Record<string, unknown>).posix = posix;

const _proc = globalThis.process;
const isWindows =
  (typeof navigator !== "undefined" && /Win/i.test(navigator.platform)) ||
  (_proc && _proc.platform === "win32");

const pathShim = isWindows ? win32 : posix;

globalThis.pathShim = pathShim;

export { posix, win32 };
export default pathShim;
export { pathShim };
