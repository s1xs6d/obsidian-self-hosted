import { ipcSendSync } from "../ipc";
import { uint8ToBase64 } from "../lib/uint8";

function ssSetPassword(service, account, password) {
  try {
    const r = ipcSendSync("secret-storage-set", service, account, password) as { ok?: boolean } | null;
    return !!r?.ok;
  } catch (_) {
    return false;
  }
}
function ssGetPassword(service, account) {
  try {
    const r = ipcSendSync("secret-storage-get", service, account) as { value?: string } | null;
    return r ? r.value || null : null;
  } catch (_) {
    return null;
  }
}
function ssDeletePassword(service, account) {
  try {
    const r = ipcSendSync("secret-storage-delete", service, account) as { ok?: boolean } | null;
    return !!r?.ok;
  } catch (_) {
    return false;
  }
}

export const safeStorage = {
  isEncryptionAvailable() {
    try {
      const r = ipcSendSync("safe-storage-is-available") as { available?: boolean } | null;
      return !!r?.available;
    } catch (_) {
      return false;
    }
  },
  getSelectedStorageBackend() {
    try {
      const r = ipcSendSync("safe-storage-backend") as { backend?: string } | null;
      return r?.backend || "basic_text";
    } catch (_) {
      return "basic_text";
    }
  },
  encryptString(plainText) {
    const r = ipcSendSync("safe-storage-encrypt", plainText) as { encrypted?: string } | null;
    if (!r?.encrypted) throw new Error("encryption failed");
    const base64Str = r.encrypted;
    interface SafeStorageBuffer extends Uint8Array {
      toString(encoding?: string): string;
    }
    const buf = new Uint8Array(atob(base64Str).length);
    for (let i = 0; i < buf.length; i++) buf[i] = atob(base64Str).charCodeAt(i);
    const safeBuf = buf as SafeStorageBuffer;
    safeBuf.toString = function (this: SafeStorageBuffer, encoding?: string): string {
      if (encoding === "base64") return base64Str;
      if (encoding === "hex") {
        let h = "";
        for (let i = 0; i < this.length; i++) h += (this[i] < 16 ? "0" : "") + this[i].toString(16);
        return h;
      }
      return new TextDecoder().decode(this);
    };
    return safeBuf;
  },
  decryptString(encrypted) {
    const arr =
      encrypted instanceof Uint8Array
        ? encrypted
        : encrypted?.buffer
          ? new Uint8Array(encrypted.buffer, encrypted.byteOffset || 0, encrypted.byteLength)
          : new Uint8Array(0);
    const r = ipcSendSync("safe-storage-decrypt", uint8ToBase64(arr)) as { plaintext?: string | null } | null;
    if (!r || r.plaintext == null) throw new Error("decryption failed");
    return r.plaintext;
  },
  setPassword: ssSetPassword,
  getPassword: ssGetPassword,
  deletePassword: ssDeletePassword,
  setSecret: (id, secret) => ssSetPassword("osh", id, secret),
  getSecret: (id) => ssGetPassword("osh", id),
  deleteSecret: (id) => ssDeletePassword("osh", id),
  listSecrets() {
    try {
      const r = ipcSendSync("secret-storage-list", "osh") as { ids?: string[] } | null;
      return r?.ids || [];
    } catch (_) {
      return [];
    }
  },
};
