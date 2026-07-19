import { BASE_URL, getVaultId } from "./config";
import { ipcSendSync } from "./ipc";
import { warn } from "./log";
import type { ObsidianMenu } from "./lib/obsidian-types";
import { openTerminal } from "./terminal";

// Wrap window.eval to intercept every plugin load so we can:
// 1. Capture the Obsidian public API (Menu, setIcon, etc.) once.
// 2. Wrap Obsidian's internal `require` with a fallback to our globalThis.require
//    shim for Node.js built-in modules that Obsidian's require doesn't handle
//    in a browser context (e.g. "util", "child_process", "fs").
//
// Obsidian evaluates each plugin as:
//   window.eval("(function anonymous(require,module,exports){…})")
// and passes its internal `require` as the first arg.
(() => {
  const _realEval = window.eval;
  window.eval = (code) => {
    let result = _realEval.call(window, code);
    if (typeof code === "string" && code.includes("(require,module,exports)") && typeof result === "function") {
      const _origFn = result;
      result = function (require, module, exports) {
        // Capture Obsidian public API once.
        if (!window.__oshObsAPI && typeof require === "function") {
          try {
            const api = require("obsidian");
            if (api && typeof api.Menu === "function") window.__oshObsAPI = api;
          } catch (_) {}
        }

        // Wrap require: try Obsidian's internal require first; fall back to our
        // shim for modules Obsidian doesn't know (Node built-ins, etc.).
        const ourRequire = globalThis.require;
        if (typeof require === "function" && typeof ourRequire === "function") {
          const patchedRequire = (moduleName: string) => {
            try {
              const mod = require(moduleName);
              return mod != null ? mod : ourRequire(moduleName);
            } catch (_) {
              return ourRequire(moduleName);
            }
          };
          // Preserve require.resolve / require.cache that Obsidian's internal
          // require exposes (some plugins read require.cache).
          try { Object.assign(patchedRequire, require); } catch (_) {}
          return _origFn.call(this, patchedRequire, module, exports);
        }
        return _origFn.call(this, require, module, exports);
      };
    }
    return result;
  };
})();

// Intercept window.app for two purposes:
// 1. Keychain localStorage bypass: route 'secrets-encrypted' / 'secrets-meta' through
//    server-side storage so the keychain survives browser data clears and is
//    accessible from any device mounting the vault.
// 2. Ribbon menu button: add a hamburger menu to the left ribbon that exposes
//    the navigation commands normally in the Electron title bar.
(() => {
  if (!getVaultId()) return;

  const SECRET_KEYS = { "secrets-encrypted": true, "secrets-meta": true };

  const CMD_ICON = {
    "file-explorer:new-file": "file-plus",
    "file-explorer:new-file-in-new-pane": "separator-vertical",
    "workspace:new-tab": "plus",
    "workspace:new-window": "app-window",
    "switcher:open": "file-search",
    "workspace:close": "x",
    "workspace:close-window": "x-circle",
    "workspace:export-pdf": "download",
    "editor:open-search": "search",
    "editor:open-search-replace": "search-check",
    "editor:insert-wikilink": "link",
    "editor:insert-link": "external-link",
    "editor:insert-callout": "quote",
    "editor:insert-blockquote": "text-quote",
    "editor:insert-codeblock": "code",
    "editor:insert-mathblock": "sigma",
    "editor:insert-table": "table",
    "editor:insert-footnote": "baseline",
    "editor:toggle-bullet-list": "list",
    "editor:toggle-numbered-list": "list-ordered",
    "editor:toggle-checklist-status": "list-checks",
    "editor:attach-file": "paperclip",
    "editor:fold-all": "fold-vertical",
    "editor:unfold-all": "unfold-vertical",
    "editor:fold-more": "fold-vertical",
    "editor:fold-less": "unfold-vertical",
    "editor:set-heading-1": "heading-1",
    "editor:set-heading-2": "heading-2",
    "editor:set-heading-3": "heading-3",
    "editor:set-heading-4": "heading-4",
    "editor:set-heading-5": "heading-5",
    "editor:set-heading-6": "heading-6",
    "editor:set-heading-0": "pilcrow",
    "editor:toggle-bold": "bold",
    "editor:toggle-italics": "italic",
    "editor:toggle-code": "code",
    "editor:toggle-highlight": "highlighter",
    "editor:toggle-strikethrough": "strikethrough",
    "editor:toggle-comments": "message-square",
    "markdown:toggle-preview": "book-open",
    "editor:toggle-source": "code-2",
    "app:toggle-left-sidebar": "panel-left",
    "app:toggle-right-sidebar": "panel-right",
    "app:toggle-ribbon": "layout-sidebar-left",
    "workspace:split-vertical": "flip-horizontal-2",
    "workspace:split-horizontal": "flip-vertical-2",
    "app:go-back": "arrow-left",
    "app:go-forward": "arrow-right",
    "workspace:move-to-new-window": "picture-in-picture-2",
    "app:open-settings": "settings",
    "app:show-release-notes": "newspaper",
    "app:show-debug-info": "bug",
    "app:open-sandbox-vault": "flask-conical",
  };
  const SECTION_ICON = {
    File: "file",
    Edit: "pencil",
    Insert: "plus-circle",
    Format: "paintbrush",
    View: "layout-dashboard",
    Window: "app-window",
    Help: "help-circle",
  };
  const FALLBACK_SECTIONS = [
    {
      label: "File",
      items: [
        "file-explorer:new-file",
        "file-explorer:new-file-in-new-pane",
        "workspace:new-tab",
        "workspace:new-window",
        null,
        "switcher:open",
        null,
        "workspace:close",
        "workspace:close-window",
        null,
        "workspace:export-pdf",
      ],
    },
    { label: "Edit", items: ["editor:open-search", "editor:open-search-replace"] },
    {
      label: "Insert",
      items: [
        "editor:insert-wikilink",
        "editor:insert-link",
        "editor:insert-callout",
        "editor:insert-blockquote",
        "editor:insert-codeblock",
        "editor:insert-mathblock",
        "editor:insert-table",
        "editor:insert-footnote",
        "editor:attach-file",
      ],
    },
    {
      label: "Format",
      items: [
        "editor:toggle-bold",
        "editor:toggle-italics",
        "editor:toggle-code",
        "editor:toggle-highlight",
        "editor:toggle-strikethrough",
        "editor:toggle-comments",
        null,
        "editor:set-heading-1",
        "editor:set-heading-2",
        "editor:set-heading-3",
        "editor:set-heading-4",
        "editor:set-heading-5",
        "editor:set-heading-6",
        "editor:set-heading-0",
        null,
        "editor:toggle-bullet-list",
        "editor:toggle-numbered-list",
        "editor:toggle-checklist-status",
        null,
        "editor:fold-all",
        "editor:unfold-all",
      ],
    },
    {
      label: "View",
      items: [
        "markdown:toggle-preview",
        "editor:toggle-source",
        null,
        "app:toggle-left-sidebar",
        "app:toggle-right-sidebar",
        "app:toggle-ribbon",
        null,
        "workspace:split-vertical",
        "workspace:split-horizontal",
        "workspace:move-to-new-window",
      ],
    },
    { label: "Window", items: ["app:go-back", "app:go-forward"] },
    {
      label: "Help",
      items: ["app:show-release-notes", "app:show-debug-info", "app:open-sandbox-vault"],
    },
  ];

  function sfbSetIcon(el, icon) {
    const api = window.__oshObsAPI;
    if (api && typeof api.setIcon === "function") api.setIcon(el, icon);
  }

  function withOshSections(sections) {
    if (!window.__oshTerminal) return sections;
    return sections.concat([
      {
        label: "OSH",
        icon: "terminal",
        items: [{ cmd: "osh:open-terminal", label: "Open terminal", icon: "terminal" }],
      },
    ]);
  }

  function buildMenuStructure(app) {
    const mgr = app?.appMenuBarManager;
    let template = null;
    if (mgr && typeof mgr.buildMenu === "function") {
      try {
        template = mgr.buildMenu();
      } catch (_) {}
    }

    if (Array.isArray(template) && template.length) {
      const sections = [];
      template.forEach((section) => {
        if (!section.submenu || section.label === "Obsidian") return;
        const label = section.label.replace(/^&/, "");
        const items = [];
        function processItems(list) {
          list.forEach((item) => {
            if (item.type === "separator") {
              items.push(null);
              return;
            }
            if (!item.label) return;
            if (item.submenu) {
              if (items.length && items[items.length - 1] !== null) items.push(null);
              processItems(item.submenu);
              return;
            }
            if (!item.appCommand) return;
            items.push({
              cmd: item.appCommand,
              label: item.label,
              icon: CMD_ICON[item.appCommand] || "",
            });
          });
        }
        processItems(section.submenu);
        while (items.length && items[0] === null) items.shift();
        while (items.length && items[items.length - 1] === null) items.pop();
        if (items.length) sections.push({ label, icon: SECTION_ICON[label] || "", items });
      });
      if (sections.length) return withOshSections(sections);
    }

    const cmds = app?.commands?.commands || {};
    return withOshSections(
      FALLBACK_SECTIONS.map((s) => ({
        label: s.label,
        icon: SECTION_ICON[s.label] || "",
        items: s.items.map((id) => {
          if (!id) return null;
          return { cmd: id, label: cmds[id]?.name || id, icon: CMD_ICON[id] || "" };
        }),
      })),
    );
  }

  function showObsidianMenu(app, triggerEvt) {
    const api = window.__oshObsAPI;
    const menu = new (api.Menu as new () => ObsidianMenu)();
    buildMenuStructure(app).forEach((section) => {
      menu.addItem((item) => {
        item.setTitle(section.label);
        item.setIcon?.(section.icon);
        if (typeof item.setSubmenu === "function") {
          const sub = item.setSubmenu();
          section.items.forEach((si) => {
            if (!si) {
              sub.addSeparator();
              return;
            }
            sub.addItem((sItem) => {
              sItem.setTitle(si.label);
              if (si.icon) sItem.setIcon?.(si.icon);
              sItem.onClick(() => {
                try {
                  app.commands.executeCommandById(si.cmd);
                } catch (_) {}
              });
            });
          });
        }
      });
    });
    menu.showAtMouseEvent(triggerEvt);
  }

  function showDomToolbarMenu(app, triggerEvt) {
    const menuEl = document.createElement("div");
    menuEl.className = "menu osh-toolbar-menu";
    buildMenuStructure(app).forEach((section) => {
      const hdr = document.createElement("div");
      hdr.className = "menu-item mod-disabled";
      const hdrIco = document.createElement("div");
      hdrIco.className = "menu-item-icon";
      sfbSetIcon(hdrIco, section.icon);
      const hdrTitle = document.createElement("div");
      hdrTitle.className = "menu-item-title";
      hdrTitle.textContent = section.label;
      hdr.appendChild(hdrIco);
      hdr.appendChild(hdrTitle);
      menuEl.appendChild(hdr);

      section.items.forEach((item) => {
        if (!item) {
          const sep = document.createElement("div");
          sep.className = "menu-separator";
          menuEl.appendChild(sep);
          return;
        }
        const el = document.createElement("div");
        el.className = "menu-item";
        const ico = document.createElement("div");
        ico.className = "menu-item-icon";
        sfbSetIcon(ico, item.icon);
        const title = document.createElement("div");
        title.className = "menu-item-title";
        title.textContent = item.label;
        el.appendChild(ico);
        el.appendChild(title);
        const cmd = item.cmd;
        el.addEventListener("mousedown", (e) => {
          e.preventDefault();
          menuEl.remove();
          try {
            app.commands.executeCommandById(cmd);
          } catch (_) {}
        });
        menuEl.appendChild(el);
      });
      const sep = document.createElement("div");
      sep.className = "menu-separator";
      menuEl.appendChild(sep);
    });

    document.body.appendChild(menuEl);
    const mw = menuEl.offsetWidth || 220;
    const mh = menuEl.offsetHeight || 300;
    menuEl.style.left = Math.min(triggerEvt.clientX, innerWidth - mw - 4) + "px";
    menuEl.style.top = Math.min(triggerEvt.clientY, innerHeight - mh - 4) + "px";
    setTimeout(() => {
      const dismiss = (e) => {
        if (!menuEl.contains(e.target)) {
          menuEl.remove();
          document.removeEventListener("mousedown", dismiss, true);
        }
      };
      document.addEventListener("mousedown", dismiss, true);
    }, 0);
  }

  function showToolbarMenu(app, triggerEvt) {
    const existing = document.querySelector(".osh-toolbar-menu");
    if (existing) {
      existing.remove();
      return;
    }
    const api = window.__oshObsAPI;
    if (api && typeof api.Menu === "function") showObsidianMenu(app, triggerEvt);
    else showDomToolbarMenu(app, triggerEvt);
  }

  function addRibbonButton(app) {
    try {
      app.workspace.leftRibbon.addRibbonItemButton("osh:toolbar-menu", "menu", "Menu", (evt) =>
        showToolbarMenu(app, evt),
      );
    } catch (e) {
      warn("osh: failed to add ribbon button: " + e);
    }
  }

  // Registers "Open terminal" as a real Obsidian command (not a ribbon icon)
  // so it shows up as an entry in the Menu button's dropdown — via
  // buildMenuStructure's "osh:open-terminal" reference — and, as a bonus,
  // in the command palette and hotkey settings like any other command.
  function registerTerminalCommand(app) {
    if (!window.__oshTerminal) return;
    try {
      app.commands.addCommand({
        id: "osh:open-terminal",
        name: "Open terminal",
        icon: "terminal",
        callback: () => openTerminal(),
      });
    } catch (e) {
      warn("osh: failed to register terminal command: " + e);
    }
  }

  function patchApp(app) {
    if (!app || app.__oshLsPatch) return;
    if (typeof app.loadLocalStorage !== "function") return;
    app.__oshLsPatch = true;

    // Obsidian's FileSystemAdapter.queue() races each FS op against a kill-
    // Promise whose reject is stored as killLastAction. When the real op wins
    // (normal case), the kill-Promise is left pending with no rejection handler.
    // After 60 s of FS inactivity the 6e4-ms debounce fires adapter.kill(),
    // rejecting that orphaned Promise → "File system operation timed out."
    // In OSH, vault loading finishes and goes quiet, reliably triggering this.
    // Native Electron masks it because ongoing user edits keep resetting the
    // timer. The error is always a false alarm (the real op already succeeded),
    // so we suppress it here.
    window.addEventListener("unhandledrejection", (ev) => {
      if ((ev.reason as Error | null)?.message === "File system operation timed out.") {
        ev.preventDefault();
      }
    });

    const _origLoad = app.loadLocalStorage.bind(app);
    const _origSave = app.saveLocalStorage.bind(app);

    app.loadLocalStorage = (key) => {
      if (!SECRET_KEYS[key]) return _origLoad(key);
      try {
        const r = ipcSendSync("ls-backup-get", key) as Record<string, unknown>;
        if (r?.value != null) {
          try {
            return JSON.parse(r.value as string);
          } catch (_) {
            return r.value;
          }
        }
      } catch (e) {
        warn("ls-backup-get failed: " + e);
      }
      return null;
    };

    app.saveLocalStorage = (key, val) => {
      if (!SECRET_KEYS[key]) return _origSave(key, val);
      try {
        if (val == null) ipcSendSync("ls-backup-delete", key);
        else ipcSendSync("ls-backup-set", key, JSON.stringify(val));
      } catch (e) {
        warn("ls-backup-set failed: " + e);
      }
    };

    // Poll until workspace exists before hooking onLayoutReady
    (function waitForWorkspace() {
      if (app.workspace && typeof app.workspace.onLayoutReady === "function") {
        // Intercept getLeavesOfType so that *every* call for 'file-explorer'
        // leaves ensures the view has fileItems initialised before the caller
        // sees it. Doing this once in onLayoutReady is not enough: the plugin's
        // addAll() calls getLeavesOfType independently, and the view may still
        // be an eD deferred stub (fileItems === undefined) at that moment.
        //
        // eD stubs have no fileItems property; when obsidian-icon-folder's
        // setIcons iterates Object.entries(plugin.data) — which includes a
        // "settings" key — it evaluates fileExplorer.view.fileItems["settings"]
        // on an undefined fileItems → "Cannot read properties of undefined
        // (reading 'settings')". Setting fileItems={} on the stub turns the
        // access into a no-op undefined lookup rather than a TypeError.
        if (!(app.workspace as { __oshGlotPatch?: boolean }).__oshGlotPatch) {
          (app.workspace as { __oshGlotPatch?: boolean }).__oshGlotPatch = true;
          const _origGlot = app.workspace.getLeavesOfType.bind(app.workspace) as (t: string) => { view?: { fileItems?: unknown } }[];
          (app.workspace as { getLeavesOfType: (t: string) => unknown[] }).getLeavesOfType = function (type: string) {
            const leaves = _origGlot(type);
            if (type === "file-explorer") {
              for (const leaf of leaves) {
                if (leaf.view && leaf.view.fileItems === undefined) leaf.view.fileItems = {};
              }
            }
            return leaves;
          };
        }

        app.workspace.onLayoutReady(() => {
          registerTerminalCommand(app);
          addRibbonButton(app);
        });
      } else {
        setTimeout(waitForWorkspace, 50);
      }
    })();

    // Poll until the community-plugins manager is available, then register a
    // beforeunload handler that writes the current enabledPlugins set via
    // sendBeacon. This guarantees persistence even when the user refreshes
    // within the 1-second requestSaveConfig debounce window: sendBeacon
    // completes in the background regardless of page navigation.
    (function waitForPlugins() {
      const pm = app.plugins as {
        enabledPlugins?: Set<string>;
        saveConfig?: () => Promise<void>;
        requestSaveConfig?: { run?: () => void };
      } | undefined;
      if (pm && pm.enabledPlugins instanceof Set && typeof pm.saveConfig === "function") {
        window.addEventListener("beforeunload", () => {
          const vaultId = getVaultId();
          if (!vaultId) return;
          const adapter = (app.vault as { adapter?: { basePath?: string } } | undefined)?.adapter;
          const basePath = adapter?.basePath;
          const configDir =
            (app.vault as { configDir?: string } | undefined)?.configDir || ".obsidian";
          if (!basePath) return;
          const filePath = basePath + "/" + configDir + "/community-plugins.json";
          const list = Array.from(pm.enabledPlugins as Set<string>);
          const payload = JSON.stringify({
            path: filePath,
            data: JSON.stringify(list, null, 2),
            encoding: "utf8",
            flag: "w",
          });
          navigator.sendBeacon(
            BASE_URL + "/api/fs/writeFile?vault=" + encodeURIComponent(vaultId),
            new Blob([payload], { type: "application/json" }),
          );
        });
      } else {
        setTimeout(waitForPlugins, 50);
      }
    })();
  }

  if (window.app) {
    patchApp(window.app);
  } else {
    let _appVal;
    Object.defineProperty(window, "app", {
      configurable: true,
      enumerable: true,
      get() {
        return _appVal;
      },
      set(v) {
        _appVal = v;
        patchApp(v);
      },
    });
  }
})();
