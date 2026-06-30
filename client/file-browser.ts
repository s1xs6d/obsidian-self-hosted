import { BASE_URL } from "./config";
import { esc, injectCSS, setIcon } from "./lib/dom";
import { dirname, humanSize, iconName, joinPath } from "./lib/file-path";
import { openObsidianModal } from "./lib/modal";
import type { ObsidianMenu, ObsidianNotice } from "./lib/obsidian-types";
import { buildFromTemplate } from "./remote/menu";

const CSS = [
  ".sfb-modal{width:700px;max-width:92vw;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;}",
  ".sfb-modal .modal-title{text-align:left;}",
  ".sfb-modal .modal-content{flex:1;display:flex;flex-direction:column;overflow:hidden;padding:0;min-height:0;}",
  ".sfb-content{flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;}",
  ".sfb-topbar{display:flex;align-items:center;gap:8px;padding:5px 10px;flex-shrink:0;border-bottom:1px solid var(--background-modifier-border);}",
  ".sfb-breadcrumb{flex:1;display:flex;flex-wrap:nowrap;align-items:center;overflow-x:auto;min-width:0;scrollbar-width:none;gap:0;}",
  ".sfb-breadcrumb::-webkit-scrollbar{display:none;}",
  ".sfb-crumb{color:var(--text-accent);cursor:pointer;padding:2px 5px;border-radius:3px;font-size:12px;white-space:nowrap;opacity:.8;}",
  ".sfb-crumb:hover{opacity:1;background:var(--background-modifier-hover);}",
  ".sfb-crumb.sfb-cur{color:var(--text-normal);cursor:default;opacity:1;}",
  ".sfb-crumb.sfb-cur:hover{background:none;}",
  ".sfb-crumb-sep{color:var(--text-muted);font-size:11px;padding:0 1px;flex-shrink:0;}",
  ".sfb-body{flex:1;overflow:auto;min-height:260px;position:relative;}",
  ".sfb-empty{padding:32px;text-align:center;color:var(--text-muted);font-size:13px;}",
  ".sfb-ferr{padding:16px;color:var(--text-error);font-size:13px;}",
  ".sfb-list{padding:4px 0;}",
  ".sfb-li{display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:13px;user-select:none;border-radius:0;}",
  ".sfb-li:hover{background:var(--background-modifier-hover);}",
  ".sfb-li.sel{background:var(--interactive-accent);color:var(--text-on-accent);}",
  ".sfb-li.sel .sfb-li-size{color:inherit;opacity:.8;}",
  ".sfb-li.dim{opacity:.4;cursor:default;pointer-events:none;}",
  ".sfb-li-ico{width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}",
  ".sfb-li-ico svg{width:16px;height:16px;stroke:currentColor;}",
  ".sfb-li-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;}",
  ".sfb-li-size{font-size:11px;opacity:.6;flex-shrink:0;padding-left:12px;white-space:nowrap;}",
  ".sfb-bottombar{display:flex;align-items:center;gap:8px;padding:8px 12px;flex-shrink:0;border-top:1px solid var(--background-modifier-border);font-size:12px;}",
  ".sfb-bottombar .sfb-filter-info{flex:1;color:var(--text-muted);}",
  ".sfb-bottombar button{font-size:12px;padding:4px 14px;}",
  ".sfb-dlg{display:flex;flex-direction:column;gap:10px;padding:2px 0 4px;}",
  ".sfb-dlg p{margin:0;font-size:14px;}",
  ".sfb-dlg input[type=text]{width:100%;box-sizing:border-box;}",
  ".sfb-dlg-btns{display:flex;justify-content:flex-end;gap:8px;}",
  ".sfb-body.sfb-drop-active{outline:2px dashed var(--interactive-accent);outline-offset:-4px;background:var(--background-modifier-hover);}",
].join("");

// Create an Obsidian Notice with loading/success/error state transitions.
// Obsidian uses is-loading / mod-success / mod-error on containerEl.
function _notice(message) {
  const api = window.__oshObsAPI;
  if (api && typeof api.Notice === "function") {
    const n = new (api.Notice as new (msg: string, timeout?: number) => ObsidianNotice)(message, 0);
    n.containerEl?.addClass?.("is-loading");
    return {
      setMessage: (msg) => n.setMessage(msg),
      success: (msg) => {
        n.containerEl?.removeClass?.("is-loading");
        n.containerEl?.addClass?.("mod-success");
        if (msg) n.setMessage(msg);
        setTimeout(() => n.hide(), 3000);
      },
      error: (msg) => {
        n.containerEl?.removeClass?.("is-loading");
        n.containerEl?.addClass?.("mod-error");
        if (msg) n.setMessage(msg);
        setTimeout(() => n.hide(), 4000);
      },
    };
  }
  // Fallback when Notice API is not available yet
  return { setMessage: () => {}, success: () => {}, error: () => {} };
}

// Show an Obsidian-style context menu. Uses the Obsidian Menu API if available,
// otherwise falls back to our buildFromTemplate implementation.
function _showMenu(evt, items) {
  const api = window.__oshObsAPI;
  if (api && typeof api.Menu === "function") {
    const menu = new (api.Menu as new () => ObsidianMenu)();
    for (const item of items) {
      if (item.type === "separator") {
        try {
          menu.addSeparator();
        } catch (_) {}
        continue;
      }
      menu.addItem((i) => {
        i.setTitle(item.label);
        if (item.icon)
          try {
            i.setIcon?.(item.icon);
          } catch (_) {}
        if (item.disabled)
          try {
            i.setDisabled?.(true);
          } catch (_) {}
        i.onClick(item.click || (() => {}));
      });
    }
    menu.showAtMouseEvent(evt);
  } else {
    buildFromTemplate(items).popup({ x: evt.clientX, y: evt.clientY });
  }
}

// Open a modal with a text input and OK/Cancel buttons.
function _inputModal(title, defaultValue, placeholder, onConfirm) {
  const wrap = document.createElement("div");
  wrap.className = "sfb-dlg";

  const input = document.createElement("input");
  input.type = "text";
  input.value = defaultValue || "";
  if (placeholder) input.placeholder = placeholder;
  wrap.appendChild(input);

  const btnRow = document.createElement("div");
  btnRow.className = "sfb-dlg-btns";

  let handle = null;
  const doConfirm = () => {
    const val = input.value.trim();
    if (!val) return;
    handle?.close?.();
    onConfirm(val);
  };
  const doCancel = () => handle?.close?.();

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "취소";
  cancelBtn.addEventListener("click", doCancel);
  btnRow.appendChild(cancelBtn);

  const okBtn = document.createElement("button");
  okBtn.className = "mod-cta";
  okBtn.textContent = "확인";
  okBtn.addEventListener("click", doConfirm);
  btnRow.appendChild(okBtn);

  wrap.appendChild(btnRow);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doConfirm();
    }
    if (e.key === "Escape") doCancel();
  });

  handle = openObsidianModal({ title, content: wrap });
  setTimeout(() => {
    input.focus();
    input.select();
  }, 80);
}

// Open a confirmation modal (삭제 확인 등).
function _confirmModal(title, message, confirmLabel, onConfirm) {
  const wrap = document.createElement("div");
  wrap.className = "sfb-dlg";

  const msg = document.createElement("p");
  msg.textContent = message;
  wrap.appendChild(msg);

  const btnRow = document.createElement("div");
  btnRow.className = "sfb-dlg-btns";

  let handle = null;
  const doConfirm = () => {
    handle?.close?.();
    onConfirm();
  };
  const doCancel = () => handle?.close?.();

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "취소";
  cancelBtn.addEventListener("click", doCancel);
  btnRow.appendChild(cancelBtn);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "mod-warning";
  confirmBtn.textContent = confirmLabel || "확인";
  confirmBtn.addEventListener("click", doConfirm);
  btnRow.appendChild(confirmBtn);

  wrap.appendChild(btnRow);
  handle = openObsidianModal({ title, content: wrap });
}

async function _copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (_) {}
    document.body.removeChild(ta);
  }
}

interface OshFileBrowserOpts {
  mode?: string;
  selectMode?: string;
  title?: string;
  onSelect?: ((path: string) => void) | null;
  onClose?: (() => void) | null;
  filters?: Array<{ name?: string; extensions?: string[] }> | null;
  path?: string;
}

export class OshFileBrowser {
  mode: string;
  selectMode: string;
  title: string;
  onSelect: ((path: string) => void) | null;
  onClose: (() => void) | null;
  private _filters: Array<{ name?: string; extensions?: string[] }> | null;
  private _initPath: string;
  private _path: string;
  private _homeDir: string;
  private _entries: Array<{ name: string; isDir: boolean; size?: number; mtime?: number }>;
  private _error: string | null;
  private _showHidden: boolean;
  private _selectedPath: string | null;
  private _body: HTMLElement | null;
  private _breadcrumb: HTMLElement | null;
  private _modalHandle: { close(): void; modalEl?: HTMLElement; modal?: HTMLElement } | null;

  constructor(opts: OshFileBrowserOpts = {}) {
    this.mode = opts.mode || "browse";
    this.selectMode = opts.selectMode || "any";
    this.title = opts.title || "File Browser";
    this.onSelect = opts.onSelect || null;
    this.onClose = opts.onClose || null;
    this._filters = opts.filters || null;
    this._initPath = opts.path || "";
    this._path = "";
    this._homeDir = "";
    this._entries = [];
    this._error = null;
    this._showHidden = false;
    this._selectedPath = null;
    this._body = this._breadcrumb = null;
    this._modalHandle = null;
  }

  open() {
    injectCSS(CSS);
    this._build();

    if (this._initPath) {
      this._navigate(this._initPath);
    } else {
      fetch(BASE_URL + "/api/config")
        .then((r) => r.json())
        .then((cfg: { home?: string }) => {
          this._homeDir = cfg.home || "/";
          this._navigate(this._homeDir);
        })
        .catch(() => this._navigate("/"));
    }
  }

  close() {
    const cb = this.onClose;
    this.onClose = null;
    if (this._modalHandle) {
      const h = this._modalHandle;
      this._modalHandle = null;
      h.close();
    }
    cb?.();
  }

  _build() {
    const contentEl = document.createElement("div");
    contentEl.className = "sfb-content";

    const topbar = document.createElement("div");
    topbar.className = "sfb-topbar";
    contentEl.appendChild(topbar);

    const crumb = document.createElement("div");
    crumb.className = "sfb-breadcrumb";
    topbar.appendChild(crumb);
    this._breadcrumb = crumb;

    const body = document.createElement("div");
    body.className = "sfb-body";
    contentEl.appendChild(body);
    this._body = body;

    // Drag-and-drop upload from external files
    body.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      body.classList.add("sfb-drop-active");
    });
    body.addEventListener("dragleave", (e) => {
      if (!body.contains(e.relatedTarget as Node | null)) body.classList.remove("sfb-drop-active");
    });
    body.addEventListener("drop", (e) => {
      e.preventDefault();
      body.classList.remove("sfb-drop-active");
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) this._uploadFiles(files);
    });

    // Right-click on empty body area → new folder option
    body.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if ((e.target as HTMLElement).closest(".sfb-li")) return;
      this._showBodyContextMenu(e);
    });

    const bottombar = document.createElement("div");
    bottombar.className = "sfb-bottombar";
    contentEl.appendChild(bottombar);

    if (this._filters?.length) {
      const flt = document.createElement("span");
      flt.className = "sfb-filter-info";
      flt.textContent =
        "Allowed: " + this._filters.map((f) => (f.extensions || []).map((e) => "." + e).join(", ")).join(", ");
      bottombar.appendChild(flt);
    } else {
      const sp = document.createElement("span");
      sp.className = "sfb-filter-info";
      bottombar.appendChild(sp);
    }

    if (this.mode === "select") {
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      cancel.addEventListener("click", () => this.close());
      bottombar.appendChild(cancel);

      const select = document.createElement("button");
      select.className = "mod-cta";
      select.textContent = "Select";
      select.addEventListener("click", () => this._confirm());
      bottombar.appendChild(select);
    }

    this._modalHandle = openObsidianModal({
      title: this.title,
      width: "700px",
      content: contentEl,
      onClose: () => {
        this._modalHandle = null;
        const cb = this.onClose;
        this.onClose = null;
        cb?.();
      },
    });

    const modalEl = this._modalHandle.modalEl || this._modalHandle.modal;
    if (modalEl) modalEl.classList.add("sfb-modal");
  }

  _navigate(path) {
    this._body.innerHTML = '<div class="sfb-empty">Loading…</div>';
    const url = `${BASE_URL}/api/browse?path=${encodeURIComponent(path)}${this._showHidden ? "&hidden=1" : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((data: { path: string; parent: string; home: string; entries?: typeof this._entries; error?: string }) => {
        if (data.home && !this._homeDir) this._homeDir = data.home;
        this._path = data.path;
        this._entries = data.entries || [];
        this._error = data.error || null;
        this._updateCrumb(data.path, data.parent);
        this._renderList(data.parent);
        this._setSelected(null);
      })
      .catch((e) => {
        this._body.innerHTML = `<div class="sfb-ferr">Error: ${esc(e.message)}</div>`;
      });
  }

  _reload() {
    this._navigate(this._path);
  }

  _updateCrumb(path, parent: string) {
    const el = this._breadcrumb;
    el.innerHTML = "";

    const home = this._homeDir;
    const atHome = !parent; // server returns empty parent when at root

    const addCrumb = (text, p, isLast) => {
      const c = document.createElement("span");
      c.className = "sfb-crumb" + (isLast ? " sfb-cur" : "");
      c.textContent = text;
      if (!isLast) c.addEventListener("click", () => this._navigate(p));
      el.appendChild(c);
    };
    const addSep = () => {
      const s = document.createElement("span");
      s.className = "sfb-crumb-sep";
      s.textContent = "›";
      el.appendChild(s);
    };

    if (home) {
      // Show breadcrumbs relative to home dir.
      const homeLabel = home.split("/").filter(Boolean).pop() || "~";
      const rel = path.startsWith(home) ? path.slice(home.length) : "";
      const parts = rel.split("/").filter(Boolean);

      addCrumb(homeLabel, home, atHome && !parts.length);
      let acc = home;
      parts.forEach((p, i) => {
        acc += "/" + p;
        addSep();
        addCrumb(p, acc, i === parts.length - 1);
      });
    } else {
      // Fallback: full absolute path breadcrumbs from "/"
      const parts = path.split("/").filter(Boolean);
      addCrumb("/", "/", !parts.length);
      let acc = "";
      parts.forEach((p, i) => {
        acc += "/" + p;
        addSep();
        addCrumb(p, acc, i === parts.length - 1);
      });
    }

    el.scrollLeft = el.scrollWidth;
  }

  _setSelected(p) {
    this._selectedPath = p;
  }

  _confirm() {
    const path = this._selectedPath || this._path;
    if (!path) return;
    const cb = this.onSelect;
    this.onSelect = null;
    this.onClose = null;
    this.close();
    cb?.(path);
  }

  _isDim(entry) {
    if (this.mode !== "select") return false;
    if (this.selectMode === "folder") return !entry.isDir;
    if (this.selectMode === "file") return !entry.isDir && !this._matchesFilter(entry.name);
    return !entry.isDir && !this._matchesFilter(entry.name);
  }

  _isSelectable(entry) {
    if (this.mode !== "select") return false;
    if (this.selectMode === "folder") return entry.isDir;
    if (this.selectMode === "file") return !entry.isDir && this._matchesFilter(entry.name);
    return entry.isDir || this._matchesFilter(entry.name);
  }

  _matchesFilter(name) {
    if (!this._filters?.length) return true;
    const ext = (name.lastIndexOf(".") > 0 ? name.slice(name.lastIndexOf(".") + 1) : "").toLowerCase();
    return this._filters.some((f) => (f.extensions || []).some((e) => e === "*" || e.toLowerCase() === ext));
  }

  _renderList(parent: string) {
    this._body.innerHTML = "";
    if (this._error) {
      this._body.innerHTML = `<div class="sfb-ferr">Error: ${esc(this._error)}</div>`;
      return;
    }

    const list = document.createElement("div");
    list.className = "sfb-list";
    this._body.appendChild(list);

    // Server returns empty parent when the current dir IS the home root.
    if (parent) {
      const item = document.createElement("div");
      item.className = "sfb-li";
      const ico = document.createElement("div");
      ico.className = "sfb-li-ico";
      setIcon(ico, "arrow-up", "↑");
      const nameEl = document.createElement("span");
      nameEl.className = "sfb-li-name";
      nameEl.textContent = "..";
      item.appendChild(ico);
      item.appendChild(nameEl);
      item.addEventListener("click", () => this._navigate(parent));
      list.appendChild(item);
    }

    if (!this._entries.length) {
      const empty = document.createElement("div");
      empty.className = "sfb-empty";
      empty.textContent = "(empty directory)";
      list.appendChild(empty);
      return;
    }

    this._entries.forEach((entry) => {
      const fullPath = joinPath(this._path, entry.name);
      const isDir = entry.isDir;
      const dim = this._isDim(entry);
      const selectable = this._isSelectable(entry);

      const item = document.createElement("div");
      item.className = "sfb-li" + (dim ? " dim" : "") + (this._selectedPath === fullPath ? " sel" : "");

      const ico = document.createElement("div");
      ico.className = "sfb-li-ico";
      setIcon(ico, iconName(entry.name, isDir), isDir ? "📁" : "📄");
      item.appendChild(ico);

    
      const nameEl = document.createElement("span");
      nameEl.className = "sfb-li-name";
      nameEl.textContent = entry.name;
      nameEl.title = entry.name;
      item.appendChild(nameEl);

      const sizeEl = document.createElement("span");
      sizeEl.className = "sfb-li-size";
      if (!entry.isDir) {
        sizeEl.textContent =
          "mtime" in entry ? (Number.isFinite(entry.size) ? humanSize(entry.size) : "") : humanSize(entry.size);
      }
      item.appendChild(sizeEl);

      item.addEventListener("click", () => {
        if (isDir) {
          this._navigate(fullPath);
          return;
        }
        if (selectable) {
          list.querySelectorAll(".sfb-li.sel").forEach((i) => i.classList.remove("sel"));
          item.classList.add("sel");
          this._setSelected(fullPath);
        }
      });

      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._showContextMenu(e, entry, fullPath);
      });

      list.appendChild(item);
    });
  }

  // ── Context menus ────────────────────────────────────────────────────────

  _showContextMenu(evt, entry, fullPath) {
    const isFile = !entry.isDir;
    const items = [
      {
        label: "삭제",
        icon: "trash",
        click: () => this._doDelete(fullPath, entry.name),
      },
      { type: "separator" },
      {
        label: "경로 복사",
        icon: "copy",
        click: () => _copyToClipboard(fullPath),
      },
      { type: "separator" },
      {
        label: "파일명 수정",
        icon: "pencil",
        click: () => this._doRename(fullPath, entry.name),
      },
      {
        label: "이동",
        icon: "folder-input",
        click: () => this._doMove(fullPath),
      },
      {
        label: "복사",
        icon: "copy",
        click: () => this._doCopy(fullPath),
      },
    ];
    if (isFile) {
      items.push({ type: "separator" });
      items.push({
        label: "다운로드",
        icon: "download",
        click: () => this._doDownload(fullPath, entry.name),
      });
    }
    _showMenu(evt, items);
  }

  _showBodyContextMenu(evt) {
    _showMenu(evt, [
      {
        label: "새 폴더 생성",
        icon: "folder-plus",
        click: () => this._doMkdir(),
      },
    ]);
  }

  // ── Operations ──────────────────────────────────────────────────────────

  _doDelete(fullPath, name) {
    _confirmModal("삭제 확인", `"${name}"을(를) 삭제하시겠습니까?`, "삭제", () => {
      fetch(`${BASE_URL}/api/browse/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fullPath }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.error) alert("삭제 실패: " + data.error);
          else this._reload();
        })
        .catch((e) => alert("삭제 실패: " + e.message));
    });
  }

  _doRename(fullPath, currentName) {
    const dir = dirname(fullPath);
    _inputModal("파일명 수정", currentName, "새 이름 입력", (newName) => {
      if (!newName || newName === currentName) return;
      fetch(`${BASE_URL}/api/browse/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: fullPath, to: joinPath(dir, newName) }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.error) alert("이름 변경 실패: " + data.error);
          else this._reload();
        })
        .catch((e) => alert("이름 변경 실패: " + e.message));
    });
  }

  _doMove(fullPath) {
    const name = fullPath.split("/").pop();
    new OshFileBrowser({
      mode: "select",
      selectMode: "folder",
      title: "이동할 위치 선택",
      path: dirname(fullPath),
      onSelect: (destDir) => {
        fetch(`${BASE_URL}/api/browse/rename`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: fullPath, to: joinPath(destDir, name) }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.error) alert("이동 실패: " + data.error);
            else this._reload();
          })
          .catch((e) => alert("이동 실패: " + e.message));
      },
    }).open();
  }

  _doCopy(fullPath) {
    const name = fullPath.split("/").pop();
    new OshFileBrowser({
      mode: "select",
      selectMode: "folder",
      title: "복사할 위치 선택",
      path: dirname(fullPath),
      onSelect: (destDir) => {
        fetch(`${BASE_URL}/api/browse/copy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ src: fullPath, dest: joinPath(destDir, name) }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.error) alert("복사 실패: " + data.error);
            else this._reload();
          })
          .catch((e) => alert("복사 실패: " + e.message));
      },
    }).open();
  }

  _doDownload(fullPath, name) {
    const url = `${BASE_URL}/api/browse/download?path=${encodeURIComponent(fullPath)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  _doMkdir() {
    _inputModal("새 폴더 생성", "", "폴더 이름 입력", (name) => {
      fetch(`${BASE_URL}/api/browse/mkdir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: joinPath(this._path, name) }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.error) alert("생성 실패: " + data.error);
          else this._reload();
        })
        .catch((e) => alert("생성 실패: " + e.message));
    });
  }

  async _uploadFiles(files) {
    const total = files.length;
    const n = _notice(`업로드 중… (0/${total})`);
    let uploaded = 0;
    const errors = [];

    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file, file.name);
      try {
        const resp = await fetch(`${BASE_URL}/api/browse/upload?dir=${encodeURIComponent(this._path)}`, {
          method: "POST",
          body: fd,
        });
        const data = await resp.json();
        if (data.errors?.length) {
          errors.push(...data.errors);
        } else {
          uploaded++;
          n.setMessage(`업로드 중… (${uploaded}/${total})`);
        }
      } catch (e) {
        errors.push(`${file.name}: ${e.message}`);
      }
    }

    if (errors.length === 0) {
      n.success(`${uploaded}개 파일 업로드 완료`);
    } else if (uploaded === 0) {
      n.error(`업로드 실패: ${errors[0]}`);
    } else {
      n.error(`${uploaded}개 완료, ${errors.length}개 실패`);
    }

    this._reload();
  }
}
