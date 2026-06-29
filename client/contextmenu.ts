import { remote } from "./remote/index";

// Shim Event.prototype.win so Obsidian's context-menu handler doesn't TypeError.
// Obsidian does: Yl.isDesktopApp && e.win.electron — we provide `win` without
// `electron` so the && short-circuits to falsy, skipping the spellcheck path
// that would call stopPropagation and suppress the editor context menu.
if (!("win" in Event.prototype)) {
  try {
    Object.defineProperty(Event.prototype, "win", {
      get() {
        return { setTimeout: setTimeout.bind(window), clearTimeout: clearTimeout.bind(window) };
      },
      configurable: true,
    });
  } catch (_) {}
}

// Global contextmenu interception.
// Electron webContents never shows the browser-native menu — we replicate that:
// 1. Prevent the native menu. 2. Let Obsidian handlers see a fresh event.
// 3. For INPUT/TEXTAREA, show an edit menu if Obsidian didn't already.
(() => {
  let _redispatch = false;

  function makeReEvent(e) {
    return new MouseEvent("contextmenu", {
      clientX: e.clientX,
      clientY: e.clientY,
      screenX: e.screenX,
      screenY: e.screenY,
      button: e.button,
      buttons: e.buttons,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      relatedTarget: e.relatedTarget,
      bubbles: true,
      cancelable: true,
      view: window,
    });
  }

  // Capture phase:
  // Case 1: .cm-content (contentEditable) — stop + re-dispatch on cmContent
  // Case 2: .cm-gutters — let propagate (scrollDOM handler fires viewport menu)
  // Case 3: .cm-sizer outside .cm-content — suppress without custom menu
  // Case 4: outside editor — stop + re-dispatch on original target
  document.addEventListener(
    "contextmenu",
    (e) => {
      if (_redispatch) return;
      const target = e.target as HTMLElement | null;
      const markdownView = target?.closest?.(".markdown-source-view");

      if (markdownView) {
        const cmContent = markdownView.querySelector(".cm-content");
        if (cmContent?.contains(target)) {
          e.preventDefault();
          e.stopPropagation();
          const re = makeReEvent(e);
          _redispatch = true;
          try {
            cmContent.dispatchEvent(re);
          } finally {
            _redispatch = false;
          }
          return;
        }
        if (target?.closest?.(".cm-gutters")) return;
        const sizer = markdownView.querySelector(".cm-sizer");
        if (sizer?.contains(target)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      const re = makeReEvent(e);
      _redispatch = true;
      try {
        target.dispatchEvent(re);
      } finally {
        _redispatch = false;
      }
    },
    true,
  );

  // Bubble phase: edit menu fallback for plain INPUT / TEXTAREA only
  document.addEventListener("contextmenu", (e) => {
    if (_redispatch) {
      _redispatch = false;
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA") return;
    e.preventDefault();
    const cx = e.clientX;
    const cy = e.clientY;
    requestAnimationFrame(() => {
      setTimeout(() => {
        const menus = document.querySelectorAll(".menu");
        for (const m of menus) {
          if ((m as HTMLElement).offsetParent !== null) return;
        }
        remote.Menu.buildFromTemplate([
          { role: "cut", label: "Cut" },
          { role: "copy", label: "Copy" },
          { role: "paste", label: "Paste" },
          { type: "separator" },
          { role: "selectAll", label: "Select All" },
        ]).popup({ x: cx, y: cy });
      }, 0);
    });
  });
})();
