import { BASE_URL, vaultQuery } from "../config";
import { syncXhr } from "../sync-xhr";
import type { FsPayload, FsResult } from "../types";
import { wsfsInvoke } from "../websocket";
import { makeError } from "./types";
import type { FsCallback } from "./types";

export function fsSyncCall(op: string, payload: FsPayload): FsResult {
  const result = syncXhr("POST", `${BASE_URL}/api/fs/${op}${vaultQuery()}`, payload);
  if (!result) throw new Error(`fs.${op} failed: no response from server`);
  if (result.error) {
    const err = makeError(result.error, result.code, result.path || payload.path);
    throw err;
  }
  return result as FsResult;
}

export function fsAsyncCall(op: string, payload: FsPayload, cb: FsCallback<FsResult>): void {
  wsfsInvoke(op, payload)
    .then((result: unknown) => {
      const r = result as FsResult | undefined;
      if (r?.error) {
        cb(makeError(r.error, r.code, r.path || payload.path));
      } else {
        cb(null, r);
      }
    })
    .catch(() => {
      fetch(`${BASE_URL}/api/fs/${op}${vaultQuery()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then((r) => r.json())
        .then((result: unknown) => {
          const r = result as FsResult | undefined;
          if (r?.error) {
            cb(makeError(r.error, r.code, r.path || payload.path));
          } else {
            cb(null, r);
          }
        })
        .catch((e: Error) => cb(e));
    });
}
