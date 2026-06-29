import { BASE_URL, vaultQuery } from "./config";
import { OshFileBrowser } from "./file-browser";
import { ipcSendSync } from "./ipc";
import { warn } from "./log";
import { syncXhr } from "./sync-xhr";

// Returns true if the browse button that triggered the picker is inside
// the "create new vault" section (as opposed to "open vault").
export function isCreateVaultContext(triggerEl) {
  if (!triggerEl) return false;
  if (triggerEl.closest(".mod-create-vault")) return true;
  const settingItem = triggerEl.closest(".setting-item");
  if (!settingItem?.parentElement) return false;
  return settingItem.parentElement.querySelector('.setting-item input[type="text"]') !== null;
}

// Called after the user picks a parent directory in "create vault" mode.
// starter.js's internal state is inaccessible, so we:
// 1. Store the path globally, 2. Update the location description in the DOM,
// 3. Capture the Create button click at capture phase to read the vault name ourselves.
export function handleCreateVaultParentSelected(parentPath, triggerEl) {
  globalThis._oshParentDir = parentPath;

  const settingEl = triggerEl?.closest(".setting-item");
  if (settingEl) {
    const descEl = settingEl.querySelector(".setting-item-description");
    if (descEl) {
      descEl.textContent = parentPath;
      descEl.style.cssText += ";color:var(--text-accent);word-break:break-all;";
    }
  }

  const panel = triggerEl?.closest(".modal-content,.vertical-tab-content,.workspace-leaf-content") || document.body;
  const createBtn = panel.querySelector("button.mod-cta");
  if (!createBtn) return;

  function captureCreate(e) {
    e.stopImmediatePropagation();
    createBtn.removeEventListener("click", captureCreate, true);
    const nameInput = panel.querySelector('input[type="text"]');
    const vaultName = (nameInput ? nameInput.value : "").trim();
    if (!vaultName) {
      warn("vault 이름이 비어 있습니다.");
      return;
    }
    ipcSendSync("vault-open", globalThis._oshParentDir + "/" + vaultName, true);
  }
  createBtn.addEventListener("click", captureCreate, true);
}

interface OpenDialogOpts {
  properties?: string[];
  defaultPath?: string;
  title?: string;
  filters?: Array<{ name?: string; extensions?: string[] }> | null;
}

// showOpenDialogSync is called synchronously by Obsidian — we can't block for
// user input, so we open the file browser asynchronously and return undefined
// (Obsidian treats undefined as "cancelled").
export function showOpenDialogSync(opts: OpenDialogOpts = {}) {
  const triggerEl = document.activeElement;
  const props = opts.properties || [];
  const selectMode = props.includes("openFile") ? "file" : "folder";

  setTimeout(() => {
    new OshFileBrowser({
      mode: "select",
      selectMode,
      path: opts.defaultPath || "",
      title: opts.title || (selectMode === "file" ? "파일 선택" : "폴더 선택"),
      filters: opts.filters || null,
      onSelect(selectedPath) {
        if (isCreateVaultContext(triggerEl)) handleCreateVaultParentSelected(selectedPath, triggerEl);
        else if (selectMode === "folder") ipcSendSync("vault-open", selectedPath);
      },
    }).open();
  }, 0);

  return undefined;
}

export function showSaveDialogSync(opts = {}) {
  const result = syncXhr("POST", `${BASE_URL}/api/native/save-dialog${vaultQuery()}`, opts);
  if (!result || result.canceled || result.cancelled) return undefined;
  return result.filePath || undefined;
}
