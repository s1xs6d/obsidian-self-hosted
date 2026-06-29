import { normalizeStringPosix } from "./shared";

function resolve(..._args: string[]): string {
  let resolvedPath = "";
  let resolvedAbsolute = false;
  for (let i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    let p;
    if (i >= 0) {
      p = arguments[i];
    } else {
      p = "/";
    }
    if (!p || typeof p !== "string") continue;
    resolvedPath = p + "/" + resolvedPath;
    resolvedAbsolute = p.charCodeAt(0) === 47;
  }
  resolvedPath = normalizeStringPosix(resolvedPath, !resolvedAbsolute);
  if (resolvedAbsolute) {
    return resolvedPath.length > 0 ? "/" + resolvedPath : "/";
  }
  if (resolvedPath.length > 0) {
    return resolvedPath;
  }
  return ".";
}

function normalize(path) {
  if (!path || typeof path !== "string") return ".";
  const isAbsolute = path.charCodeAt(0) === 47;
  const trailingSlash = path.charCodeAt(path.length - 1) === 47;
  path = normalizeStringPosix(path, !isAbsolute);
  if (!path && !isAbsolute) path = ".";
  if (path && trailingSlash) path += "/";
  return isAbsolute ? "/" + path : path;
}

function isAbsolute(path) {
  return typeof path === "string" && path.length > 0 && path.charCodeAt(0) === 47;
}

function join() {
  const parts = [];
  for (let i = 0; i < arguments.length; i++) {
    const arg = arguments[i];
    if (arg && typeof arg === "string") parts.push(arg);
  }
  if (parts.length === 0) return ".";
  let joined = parts.join("/");
  if (joined.charCodeAt(0) === 47 && joined.charCodeAt(1) === 47) {
    joined = joined.slice(1);
  }
  return normalize(joined);
}

function relative(from, to) {
  if (from === to) return "";
  from = resolve(from);
  to = resolve(to);
  if (from === to) return "";
  const fromStart = 1;
  const fromEnd = from.length;
  const fromLen = fromEnd - fromStart;
  let toStart = 1;
  const toLen = to.length - toStart;
  const length = fromLen < toLen ? fromLen : toLen;
  let lastCommonSep = -1;
  let i = 0;
  for (; i <= length; ++i) {
    if (i === length) {
      if (toLen > length) {
        if (to.charCodeAt(toStart + i) === 47) return to.slice(toStart + i + 1);
        if (i === 0) return to.slice(toStart + i);
      } else if (fromLen > length) {
        if (from.charCodeAt(fromStart + i) === 47) lastCommonSep = i;
        else if (i === 0) lastCommonSep = 0;
      }
      break;
    }
    const fromCode = from.charCodeAt(fromStart + i);
    const toCode = to.charCodeAt(toStart + i);
    if (fromCode !== toCode) break;
    if (fromCode === 47) lastCommonSep = i;
  }
  let out = "";
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.charCodeAt(i) === 47) {
      out = out.length === 0 ? ".." : out + "/..";
    }
  }
  if (out.length > 0) return out + to.slice(toStart + lastCommonSep);
  toStart += lastCommonSep;
  if (to.charCodeAt(toStart) === 47) ++toStart;
  return to.slice(toStart);
}

function dirname(path) {
  if (!path || typeof path !== "string" || path.length === 0) return ".";
  const hasRoot = path.charCodeAt(0) === 47;
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 1; --i) {
    if (path.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? "/" : ".";
  if (hasRoot && end === 1) return "/";
  return path.slice(0, end);
}

function basename(path, ext) {
  if (ext !== undefined && typeof ext !== "string") throw new TypeError('"ext" argument must be a string');
  if (!path || typeof path !== "string") return "";
  let start = 0;
  let end = -1;
  let matchedSlash = true;
  let i;
  for (i = path.length - 1; i >= 0; --i) {
    if (path.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }
  if (end === -1) return "";
  const base = path.slice(start, end);
  if (!ext) return base;
  if (ext.length >= base.length) return base;
  const extIdx = end - ext.length;
  const extStart = extIdx - start;
  if (base.slice(extStart) !== ext) return base;
  return path.slice(start, extIdx);
}

function extname(path) {
  if (!path || typeof path !== "string") return "";
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  for (let i = path.length - 1; i >= 0; --i) {
    const code = path.charCodeAt(i);
    if (code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (
    startDot === -1 ||
    end === -1 ||
    preDotState === 0 ||
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    return "";
  }
  return path.slice(startDot, end);
}

function format(pathObject) {
  if (!pathObject || typeof pathObject !== "object")
    throw new TypeError('The "pathObject" argument must be an Object.');
  const dir = pathObject.dir || pathObject.root || "";
  const base = pathObject.base || (pathObject.name || "") + (pathObject.ext || "");
  if (!dir) return base;
  if (dir === pathObject.root) return dir + base;
  return dir + "/" + base;
}

function parse(path) {
  const ret = { root: "", dir: "", base: "", ext: "", name: "" };
  if (!path || typeof path !== "string") return ret;
  if (path.length === 0) return ret;
  const isAbsolute = path.charCodeAt(0) === 47;
  const start = isAbsolute ? 1 : 0;
  if (isAbsolute) ret.root = "/";
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;
  for (let i = path.length - 1; i >= start; --i) {
    const code = path.charCodeAt(i);
    if (code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46) {
      if (startDot === -1) startDot = i;
      else if (preDotState !== 1) preDotState = 1;
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (
    startDot === -1 ||
    end === -1 ||
    preDotState === 0 ||
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    if (end !== -1) {
      if (startPart === 0 && isAbsolute) ret.base = ret.name = path.slice(1, end);
      else ret.base = ret.name = path.slice(startPart, end);
    }
  } else {
    if (startPart === 0 && isAbsolute) {
      ret.name = path.slice(1, startDot);
      ret.base = path.slice(1, end);
    } else {
      ret.name = path.slice(startPart, startDot);
      ret.base = path.slice(startPart, end);
    }
    ret.ext = path.slice(startDot, end);
  }
  if (startPart > 0) ret.dir = path.slice(0, startPart - 1);
  else if (isAbsolute) ret.dir = "/";
  return ret;
}

export const posix = {
  resolve,
  normalize,
  isAbsolute,
  join,
  relative,
  dirname,
  basename,
  extname,
  format,
  parse,
  sep: "/",
  delimiter: ":",
};
