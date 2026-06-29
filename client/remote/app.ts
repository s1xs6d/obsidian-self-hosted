import { ipcSendSync } from "../ipc";
import { debugLog } from "../log";

export const app = {
  getVersion() {
    return "1.12.7";
  },
  getName() {
    return "Obsidian";
  },
  getPath(name) {
    // Return "" for userData/appData so that Obsidian's icon URL builder O()
    // produces a server-relative path ("api/icon?timestamp") instead of a
    // file:// URL that the browser cannot fetch from an http origin.
    if (name === "userData" || name === "appData") return "";
    return ipcSendSync("get-path", name) || "/";
  },
  getLocale() {
    return (navigator.language || "en-US").split("-")[0];
  },
  getLocaleCountryCode() {
    return (navigator.language || "en-US").split("-")[1] || "US";
  },
  isPackaged: true,
  isReady() {
    return true;
  },
  whenReady() {
    return Promise.resolve();
  },
  quit() {
    globalThis.close();
  },
  exit() {
    globalThis.close();
  },
  relaunch() {
    globalThis.location.reload();
  },
  focus() {},
  hide() {},
  show() {},
  dock: {
    bounce() {
      return 0;
    },
    cancelBounce() {},
    setBadge() {},
    getBadge() {
      return "";
    },
    hide() {},
    show() {
      return Promise.resolve();
    },
    setMenu() {},
    setIcon() {},
  },
  on() {},
  once() {},
  removeListener() {},
  removeAllListeners() {},
  emit() {},
};
