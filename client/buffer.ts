if (!globalThis.Buffer) {
  globalThis.Buffer = {
    from(data, encoding) {
      if (typeof data === "string") {
        if (encoding === "base64") {
          const bin = atob(data);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return bytes;
        }
        return new TextEncoder().encode(data);
      }
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      if (Array.isArray(data)) return new Uint8Array(data);
      return data;
    },
    isBuffer: (obj) => obj instanceof Uint8Array,
    concat(list, totalLength) {
      const total = totalLength ?? list.reduce((acc, b) => acc + b.length, 0);
      const result = new Uint8Array(total);
      let offset = 0;
      list.forEach((b) => {
        result.set(b, offset);
        offset += b.length;
      });
      return result;
    },
    alloc(size, fill) {
      const buf = new Uint8Array(size);
      if (fill !== undefined) buf.fill(typeof fill === "string" ? fill.charCodeAt(0) : fill);
      return buf;
    },
    allocUnsafe: (size) => new Uint8Array(size),
  };
}
