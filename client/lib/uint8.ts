export function uint8ToBase64(arr) {
  let raw = "";
  for (let i = 0; i < arr.length; i++) raw += String.fromCharCode(arr[i]);
  return btoa(raw);
}

export function base64ToUint8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function uint8ToHex(arr) {
  let h = "";
  for (let i = 0; i < arr.length; i++) h += (arr[i] < 16 ? "0" : "") + arr[i].toString(16);
  return h;
}
