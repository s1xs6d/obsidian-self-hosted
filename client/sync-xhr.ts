import { warn } from "./log";

// Synchronous XHR — blocks the JS thread until the server responds.
// Required because Obsidian calls ipcRenderer.sendSync(), which must return a
// value before yielding. Use sparingly; only for IPC channels that need it.
export function syncXhr(method, url, body) {
  const xhr = new XMLHttpRequest();
  xhr.open(method, url, false /* synchronous */);
  if (body !== undefined) {
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(JSON.stringify(body));
  } else {
    xhr.send();
  }
  if (xhr.status === 0 || xhr.status >= 400) {
    warn("syncXhr " + method + " " + url + " → " + xhr.status);
    return null;
  }
  try {
    return JSON.parse(xhr.responseText);
  } catch (_) {
    return null;
  }
}
