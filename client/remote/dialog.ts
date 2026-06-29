import { BASE_URL, vaultQuery } from "../config";
import { OshFileBrowser } from "../file-browser";
import { ipcRenderer } from "../ipc";
import { syncXhr } from "../sync-xhr";
import {
  handleCreateVaultParentSelected,
  isCreateVaultContext,
  showOpenDialogSync,
  showSaveDialogSync,
} from "../vault-detect";

function safeOpts(windowOrOpts, opts) {
  return opts !== undefined && opts !== null && typeof opts === "object" ? opts : windowOrOpts;
}

const _MIME_BY_EXT = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  bmp: "image/bmp",
};

/**
 * Update the Custom App Icon setting-item description to show the icon preview.
 * Uses the trigger element (the "Choose" button) to locate the right DOM node
 * without depending on the localized setting name text.
 */
function _updateIconSettingItem(triggerEl, dataUrl) {
  const settingItem = triggerEl ? triggerEl.closest(".setting-item") : null;
  if (!settingItem) return;
  const desc = settingItem.querySelector(".setting-item-description");
  if (!desc) return;
  desc.innerHTML = "";
  const img = document.createElement("img");
  img.width = 64;
  img.height = 64;
  img.src = dataUrl;
  desc.appendChild(img);
  // Show the reset (extra-setting) button that Obsidian hides when no icon is set.
  const extraBtn = settingItem.querySelector(".extra-setting-button");
  if (extraBtn) extraBtn.style.display = "";
  // Show the Relaunch button (mod-cta) which Obsidian normally shows via x.buttonEl.show().
  // It is the only mod-cta button inside the same setting-item-control.
  const restartBtn = settingItem.querySelector(".setting-item-control button.mod-cta");
  if (restartBtn) restartBtn.style.display = "";
}

/**
 * Handle a file-pick result when the sync dialog already returned undefined.
 * Since the caller has exited, we process the file directly via an async fetch
 * so we can read files from outside the vault (used for custom app icon, etc.).
 */
async function _handleLateFilePick(selectedPath, triggerEl) {
  const fn = selectedPath.split("/").pop();
  if (!fn) return;
  try {
    const resp = await fetch(`${BASE_URL}/api/browse/readfile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: selectedPath }),
    });
    const data = await resp.json();
    if (!data || !data.base64) return;
    ipcRenderer.sendSync("set-icon", fn, data.base64);
    const ext = fn.split(".").pop().toLowerCase();
    const mime = _MIME_BY_EXT[ext] || "image/png";
    const dataUrl = `data:${mime};base64,${data.base64}`;
    _updateIconSettingItem(triggerEl, dataUrl);
  } catch (_) {}
}

export const dialog = {
  showOpenDialogSync: (opts) => {
    if (opts?.properties?.includes("openFile")) {
      // Primary: use server-side native OS file picker (sync XHR)
      const result = syncXhr("POST", `${BASE_URL}/api/native/open-file${vaultQuery()}`, opts || {});
      if (result && !result.canceled && !result.cancelled && result.filePaths?.length) {
        return result.filePaths;
      }
      // Fallback: open the OshFileBrowser asynchronously.
      // The caller already got undefined (cancelled), so the result is handled
      // directly via _handleLateFilePick.
      // Capture the active element now so _handleLateFilePick can locate the
      // setting-item that triggered the dialog (works regardless of locale).
      const triggerEl = document.activeElement;
      const o = opts || {};
      new OshFileBrowser({
        mode: "select",
        selectMode: "file",
        path: o.defaultPath || "",
        title: o.title || "Select file",
        filters: o.filters || null,
        onSelect: (selectedPath) => _handleLateFilePick(selectedPath, triggerEl),
      }).open();
      return undefined;
    }
    return showOpenDialogSync(opts);
  },
  showOpenDialog(windowOrOpts, opts) {
    const o = safeOpts(windowOrOpts, opts) || {};
    const triggerEl = document.activeElement;
    const selectMode = (o.properties || []).includes("openFile") ? "file" : "folder";
    return new Promise((resolve) => {
      new OshFileBrowser({
        mode: "select",
        selectMode,
        path: o.defaultPath || "",
        title: o.title || (selectMode === "file" ? "Select file" : "Select folder"),
        filters: o.filters || null,
        onSelect(selectedPath) {
          if (isCreateVaultContext(triggerEl)) {
            handleCreateVaultParentSelected(selectedPath, triggerEl);
            resolve({ canceled: true, filePaths: [] });
          } else {
            resolve({ canceled: false, filePaths: [selectedPath] });
          }
        },
        onClose() {
          resolve({ canceled: true, filePaths: [] });
        },
      }).open();
    });
  },
  showSaveDialogSync: (opts) => showSaveDialogSync(opts),
  showSaveDialog(windowOrOpts, opts) {
    const o = safeOpts(windowOrOpts, opts) || {};
    return Promise.resolve({ canceled: false, filePath: showSaveDialogSync(o) });
  },
  showMessageBox(windowOrOpts, opts) {
    const o = safeOpts(windowOrOpts, opts) || {};
    const msg = o.message || "";
    const detail = o.detail || "";
    const buttons = o.buttons || ["OK"];
    if (buttons.length === 1) {
      alert(msg + (detail ? "\n\n" + detail : ""));
      return Promise.resolve({ response: 0, checkboxChecked: false });
    }
    if (buttons.length === 2) {
      const ok = confirm(msg + (detail ? "\n\n" + detail : "") + `\n\n[OK = ${buttons[0]} / Cancel = ${buttons[1]}]`);
      return Promise.resolve({ response: ok ? 0 : 1, checkboxChecked: false });
    }
    return Promise.resolve({ response: 0, checkboxChecked: false });
  },
  showMessageBoxSync(windowOrOpts, opts) {
    const o = safeOpts(windowOrOpts, opts) || {};
    alert((o.message || "") + (o.detail ? "\n\n" + o.detail : ""));
    return 0;
  },
  showErrorBox(title, content) {
    alert(`[${title}]\n${content}`);
  },
};
