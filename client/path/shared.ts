export function normalizeStringPosix(path, allowAboveRoot) {
  let res = "";
  let lastSlash = -1;
  let dots = 0;
  let code;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) {
      code = path.charCodeAt(i);
    } else if (code === 47) {
      break;
    } else {
      code = 47;
    }
    if (code === 47) {
      if (lastSlash === i - 1 || dots === 1) {
        // skip double slashes and '.'
      } else if (lastSlash !== i - 1 && dots === 2) {
        if (res.length > 2) {
          const start = res.lastIndexOf("/");
          if (start !== res.length - 1) {
            res = start === -1 ? "" : res.slice(0, start);
            lastSlash = i;
            dots = 0;
            continue;
          }
        } else if (res.length > 0) {
          res = "";
          lastSlash = i;
          dots = 0;
          continue;
        }
        if (allowAboveRoot) {
          res = res.length > 0 ? res + "/.." : "..";
        }
      } else {
        const seg = path.slice(lastSlash + 1, i);
        res = res.length > 0 ? res + "/" + seg : seg;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === 46 && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

export function normalizeStringWin32(path, allowAboveRoot) {
  let res = "";
  let lastSlash = -1;
  let dots = 0;
  let code;
  for (let i = 0; i <= path.length; ++i) {
    if (i < path.length) {
      code = path.charCodeAt(i);
    } else if (code === 47 || code === 92) {
      break;
    } else {
      code = 47;
    }
    if (code === 47 || code === 92) {
      if (lastSlash === i - 1 || dots === 1) {
        // skip double slashes and '.'
      } else if (lastSlash !== i - 1 && dots === 2) {
        if (res.length < 2 || res.slice(-2) !== "..") {
          if (res.length > 2) {
            const idx = Math.max(res.lastIndexOf("/"), res.lastIndexOf("\\"));
            if (idx !== res.length - 1) {
              res = idx === -1 ? "" : res.slice(0, idx);
              lastSlash = i;
              dots = 0;
              continue;
            }
          } else if (res.length > 0) {
            res = "";
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res = res.length > 0 ? res + "\\.." : "..";
        }
      } else {
        const seg = path.slice(lastSlash + 1, i);
        res = res.length > 0 ? res + "\\" + seg : seg;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === 46 && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

export function isPathSeparator(code) {
  return code === 47 || code === 92;
}

export function isWindowsDeviceRoot(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
