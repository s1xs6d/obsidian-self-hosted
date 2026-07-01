// Augment a plain Uint8Array with a toString(encoding?) that decodes bytes
// instead of giving the default "0,1,2,…" representation.
// Used as global.Buffer by plugins (e.g. simple-git) that do:
//   E = global.Buffer; E.concat(chunks).toString("utf8")
function wrapBuffer(u8: Uint8Array): Uint8Array {
  (u8 as unknown as { toString: (enc?: string, s?: number, e?: number) => string }).toString =
    function (encoding?: string, start?: number, end?: number): string {
      const slice = u8.subarray(start ?? 0, end ?? u8.length);
      const enc = (encoding ?? "utf8").toLowerCase().replace(/-/g, "");
      if (enc === "hex")
        return Array.from(slice).map((b) => b.toString(16).padStart(2, "0")).join("");
      if (enc === "base64") {
        let bin = "";
        slice.forEach((b) => (bin += String.fromCharCode(b)));
        return btoa(bin);
      }
      if (enc === "ascii" || enc === "binary" || enc === "latin1") {
        let s = "";
        slice.forEach((b) => (s += String.fromCharCode(b & 0x7f)));
        return s;
      }
      return new TextDecoder("utf-8").decode(slice);
    };
  (u8 as unknown as { copy: (t: Uint8Array, ts?: number, ss?: number, se?: number) => number }).copy =
    function (target: Uint8Array, targetStart = 0, sourceStart = 0, sourceEnd = u8.length) {
      const src = u8.subarray(sourceStart, sourceEnd);
      target.set(src, targetStart);
      return src.length;
    };
  (u8 as unknown as { write: (s: string, o?: number, l?: number, enc?: string) => number }).write =
    function (str: string, offset = 0, _length?: number, encoding?: string) {
      const bytes = bufferFrom(str, encoding);
      u8.set(bytes, offset);
      return bytes.length;
    };
  return u8;
}

function bufferFrom(
  data: string | ArrayBuffer | Uint8Array | number[],
  encoding?: string,
): Uint8Array {
  if (typeof data === "string") {
    if (encoding === "base64") {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return wrapBuffer(bytes);
    }
    if (encoding === "hex") {
      const bytes = new Uint8Array(data.length / 2);
      for (let i = 0; i < bytes.length; i++)
        bytes[i] = parseInt(data.slice(i * 2, i * 2 + 2), 16);
      return wrapBuffer(bytes);
    }
    if (encoding === "ascii" || encoding === "binary" || encoding === "latin1") {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
      return wrapBuffer(bytes);
    }
    return wrapBuffer(new TextEncoder().encode(data));
  }
  if (data instanceof ArrayBuffer) return wrapBuffer(new Uint8Array(data));
  if (Array.isArray(data)) return wrapBuffer(new Uint8Array(data));
  if (data instanceof Uint8Array) return wrapBuffer(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return wrapBuffer(new Uint8Array(0));
}

if (!globalThis.Buffer) {
  globalThis.Buffer = {
    from: bufferFrom,
    isBuffer: (obj: unknown) => obj instanceof Uint8Array,
    concat(list: Uint8Array[], totalLength?: number): Uint8Array {
      const total = totalLength ?? list.reduce((acc, b) => acc + (b?.length ?? 0), 0);
      const result = new Uint8Array(total);
      let offset = 0;
      for (const b of list) {
        if (b?.length) {
          result.set(b, offset);
          offset += b.length;
        }
      }
      return wrapBuffer(result);
    },
    alloc(size: number, fill?: number | string): Uint8Array {
      const buf = new Uint8Array(size);
      if (fill !== undefined)
        buf.fill(typeof fill === "string" ? fill.charCodeAt(0) : fill);
      return wrapBuffer(buf);
    },
    allocUnsafe: (size: number): Uint8Array => wrapBuffer(new Uint8Array(size)),
  } as unknown as typeof globalThis.Buffer;
}
