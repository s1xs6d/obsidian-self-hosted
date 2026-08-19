import { posix } from "./path/posix";
import { win32 } from "./path/win32";

(posix as Record<string, unknown>).win32 = win32;
(posix as Record<string, unknown>).posix = posix;
(win32 as Record<string, unknown>).win32 = win32;
(win32 as Record<string, unknown>).posix = posix;

const pathShim = posix;

globalThis.pathShim = pathShim;

export { posix, win32 };
export default pathShim;
export { pathShim };
