// Polyfills must come first — other modules may need them at import time.
import "./crypto";
import "./buffer";
import "./clipboard";

// Core utilities
import "./process";
import "./log";
import "./config";
import "./sync-xhr";

// Networking
import "./conn-modal";
import "./websocket";
import "./ipc";

// File system / path / OS shims
import "./path";
import "./os";
import "./fs";

// UI
import "./file-browser";
import "./vault-detect";
import "./fake-window";
import "./remote/index";
import "./electron";

// Side-effect modules
import "./globals";
import "./contextmenu";
import "./obsidian-api";

// Start WebSocket connections once DOM is ready
import "./ready";
import { wsConnect, wsfsConnect } from "./websocket";

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    wsConnect();
    wsfsConnect();
  });
} else {
  wsConnect();
  wsfsConnect();
}
