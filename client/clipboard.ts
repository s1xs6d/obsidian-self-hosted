// Capture the native clipboard references before Obsidian patches them.
// Obsidian overwrites navigator.clipboard.writeText to go through our shim,
// which would create an infinite call cycle. Storing the originals here lets
// remote.clipboard bypass the patched version.
//
// On non-secure contexts (HTTP from another device), navigator.clipboard is
// undefined. We install a document.execCommand('copy') fallback so Obsidian's
// direct writeText calls succeed silently.

let nativeWrite = null;
let nativeRead = null;

const cb = navigator.clipboard;


if (cb) {
  if (typeof cb.writeText === "function") nativeWrite = cb.writeText.bind(cb);
  if (typeof cb.readText === "function") nativeRead = cb.readText.bind(cb);
}

if (!nativeWrite) {
  nativeWrite = (text) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (_) {}
    return Promise.resolve();
  };
}
if (!nativeRead) {
  nativeRead = () => Promise.resolve("");
}

if (!navigator.clipboard) {
  try {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      enumerable: true,
      get: () => ({
        writeText: nativeWrite,
        readText: nativeRead,
        write: () => Promise.resolve(),
        read: () => Promise.resolve([]),
      }),
    });
  } catch (_) {}
}

export { nativeWrite as clipboardWrite, nativeRead as clipboardRead };
