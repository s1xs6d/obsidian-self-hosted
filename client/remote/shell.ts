import { OshFileBrowser } from "../file-browser";
import { asyncPost } from "../ipc";
import { warn } from "../log";

export const shell = {
  showItemInFolder(path) {
    warn("shell.showItemInFolder: " + path);
    const dir = path.includes("/") ? path.replace(/\/[^/]*$/, "") || "/" : path;
    try {
      new OshFileBrowser({ mode: "browse", path: dir, title: "File Browser" }).open();
    } catch (e) {
      warn("showItemInFolder error: " + e);
    }
  },
  openExternal(url) {
    if (url?.startsWith("obsidian://")) {
      globalThis.dispatchEvent(new CustomEvent("obsidian-protocol", { detail: url }));
      return Promise.resolve();
    }
    globalThis.open(url, "_blank", "noopener,noreferrer");
    return Promise.resolve();
  },
  openPath(path) {
    warn("shell.openPath: " + path);
    try {
      new OshFileBrowser({ mode: "browse", path, title: "File Browser" }).open();
    } catch (e) {
      warn("openPath error: " + e);
    }
    return Promise.resolve("");
  },
  beep() {},
  moveItemToTrash(path, deleteOnFail) {
    return asyncPost("/api/fs/trash", { path, deleteOnFail: !!deleteOnFail })
      .then(() => true)
      .catch(() => false);
  },
  readShortcutLink(path) {
    return { target: path };
  },
  writeShortcutLink() {
    return false;
  },
};
