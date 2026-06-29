export function joinPath(dir, name) {
  return dir === "/" ? "/" + name : dir + "/" + name;
}

export function dirname(p) {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

export function basename(p) {
  return p.slice(p.lastIndexOf("/") + 1);
}

export function humanSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(1) + " GB";
}

export function iconName(name, isDir) {
  if (isDir) return "folder";
  const ext = (name.lastIndexOf(".") > 0 ? name.slice(name.lastIndexOf(".") + 1) : "").toLowerCase();
  if (/^(md|markdown)$/.test(ext)) return "file-text";
  if (/^(txt|log|rst)$/.test(ext)) return "file-text";
  if (/^(js|ts|jsx|tsx|py|go|rs|c|cpp|h|java|rb|sh|bash|zsh|fish|lua|php|swift|kt|dart)$/.test(ext))
    return "file-code-2";
  if (/^(css|scss|less|sass|html|htm|xml|vue|svelte)$/.test(ext)) return "file-code-2";
  if (/^(png|jpg|jpeg|gif|svg|webp|bmp|ico|tiff|avif|heic)$/.test(ext)) return "image";
  if (/^(mp3|wav|ogg|flac|m4a|aac|opus)$/.test(ext)) return "music";
  if (/^(mp4|mov|avi|mkv|webm|m4v|wmv)$/.test(ext)) return "video";
  if (/^(zip|tar|gz|rar|7z|bz2|xz)$/.test(ext)) return "archive";
  if (/^pdf$/.test(ext)) return "file-text";
  if (/^(json|yaml|yml|toml|jsonc|json5)$/.test(ext)) return "braces";
  if (/^csv$/.test(ext)) return "table";
  if (/^(ttf|otf|woff|woff2)$/.test(ext)) return "type";
  return "file";
}
