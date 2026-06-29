import { debugLog } from "../log";

type ExtDiv = HTMLDivElement & { _parentEl?: HTMLElement };

export function buildFromTemplate(template) {
  const _items = Array.isArray(template) ? template : [];
  const _listeners = {};
  let _openMenus: ExtDiv[] = [];
  let _keyHandler = null;

  const emit = (event) =>
    (_listeners[event] || []).forEach((cb) => {
      try {
        cb();
      } catch (_) {}
    });

  function closeFromLevel(from) {
    for (let i = _openMenus.length - 1; i >= from; i--) _openMenus[i]?.remove();
    _openMenus.length = from;
  }
  function closeMenu() {
    closeFromLevel(0);
    if (_keyHandler) {
      document.removeEventListener("keydown", _keyHandler, true);
      _keyHandler = null;
    }
    document.removeEventListener("mousedown", outsideClick, true);
    document.removeEventListener("contextmenu", outsideClick, true);
    emit("menu-will-close");
  }
  function outsideClick(e) {
    if (!_openMenus.some((m) => m?.contains(e.target))) closeMenu();
  }

  function openSubmenu(subItems, parentEl, level) {
    closeFromLevel(level + 1);
    const subDiv = buildMenuEl(subItems, level + 1);
    subDiv._parentEl = parentEl;
    _openMenus[level + 1] = subDiv;
    document.body.appendChild(subDiv);

    const rect = parentEl.getBoundingClientRect();
    const subW = subDiv.offsetWidth;
    const subH = subDiv.offsetHeight;
    let x = rect.right + 2;
    if (x + subW > innerWidth - 4) x = rect.left - subW - 2;
    let y = rect.top;
    if (y + subH > innerHeight - 4) y = innerHeight - subH - 4;
    subDiv.style.left = Math.max(4, x) + "px";
    subDiv.style.top = Math.max(4, y) + "px";

    let leaveTimer = null;
    subDiv.addEventListener("mouseleave", (e) => {
      const parentMenu = _openMenus[level];
      if (parentMenu?.contains(e.relatedTarget as Node | null)) return;
      leaveTimer = setTimeout(() => {
        if (_openMenus[level + 1] === subDiv) {
          closeFromLevel(level + 1);
          parentEl?.classList.remove("selected");
        }
      }, 250);
    });
    subDiv.addEventListener("mouseenter", () => {
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
    });
  }

  function buildMenuEl(items, level): ExtDiv {
    const div = document.createElement("div") as ExtDiv;
    div.className = "menu";
    div.style.cssText = `position:fixed;z-index:${100000 + level * 100};`;
    const scroll = document.createElement("div");
    scroll.className = "menu-scroll";
    div.appendChild(scroll);
    div.classList.add("mod-no-icon");

    let hoverTimer = null;
    items.forEach((item) => {
      if (item.type === "separator") {
        const sep = document.createElement("div");
        sep.className = "menu-separator";
        scroll.appendChild(sep);
        return;
      }
      const hasSubmenu = !!item.submenu?.length;
      const el = document.createElement("div");
      el.className = "menu-item" + (item.enabled === false ? " is-disabled" : "");

      const iconEl = document.createElement("span");
      iconEl.className = "menu-item-icon";
      el.appendChild(iconEl);
      const titleEl = document.createElement("span");
      titleEl.className = "menu-item-title";
      titleEl.textContent = item.label || "";
      el.appendChild(titleEl);

      if (item.checked) {
        const chk = document.createElement("span");
        chk.className = "menu-item-icon mod-checked";
        chk.innerHTML =
          '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        el.appendChild(chk);
      }
      if (hasSubmenu) {
        const arr = document.createElement("span");
        arr.className = "menu-item-icon mod-submenu";
        arr.innerHTML =
          '<svg class="svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
        el.appendChild(arr);
      }

      el.addEventListener("mouseenter", () => {
        if (hoverTimer) {
          clearTimeout(hoverTimer);
          hoverTimer = null;
        }
        scroll.querySelectorAll(".menu-item").forEach((i) => i.classList.remove("selected"));
        if (item.enabled !== false) el.classList.add("selected");
        if (hasSubmenu && item.enabled !== false) {
          if (_openMenus[level + 1]?._parentEl === el) return;
          hoverTimer = setTimeout(() => openSubmenu(item.submenu, el, level), 120);
        } else {
          closeFromLevel(level + 1);
        }
      });
      el.addEventListener("mouseleave", (e) => {
        const childMenu = _openMenus[level + 1];
        if (childMenu?._parentEl === el && childMenu.contains(e.relatedTarget as Node | null)) return;
        el.classList.remove("selected");
      });

      if (item.enabled !== false) {
        el.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
        if (!hasSubmenu && item.click) {
          el.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeMenu();
            item.click(item, null, e);
          });
        }
        if (hasSubmenu) {
          el.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (_openMenus[level + 1]?._parentEl === el) return;
            openSubmenu(item.submenu, el, level);
          });
        }
      }
      scroll.appendChild(el);
    });

    div.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    return div;
  }

  return {
    on(event, cb) {
      (_listeners[event] = _listeners[event] || []).push(cb);
      return this;
    },
    off(event, cb) {
      if (_listeners[event]) _listeners[event] = _listeners[event].filter((f) => f !== cb);
      return this;
    },
    removeListener(event, cb) {
      return this.off(event, cb);
    },
    popup(opts) {
      closeMenu();
      const x = opts?.x ?? 0;
      const y = opts?.y ?? 0;
      const topDiv = buildMenuEl(_items, 0);
      _openMenus = [topDiv];
      document.body.appendChild(topDiv);
      const w = topDiv.offsetWidth || 0;
      const h = topDiv.offsetHeight || 0;
      topDiv.style.left = Math.max(4, Math.min(x, innerWidth - w - 4)) + "px";
      topDiv.style.top = Math.max(4, Math.min(y, innerHeight - h - 4)) + "px";
      setTimeout(() => {
        document.addEventListener("mousedown", outsideClick, true);
        document.addEventListener("contextmenu", outsideClick, true);
      }, 0);
      _keyHandler = (e) => {
        if (e.key === "Escape") closeMenu();
      };
      document.addEventListener("keydown", _keyHandler, true);
    },
    closePopup: closeMenu,
    append() {},
    insert() {},
    items: _items,
    getMenuItemById(id) {
      return _items.find((i) => i.id === id) || null;
    },
  };
}

export const Menu = {
  buildFromTemplate,
  setApplicationMenu() {},
  getApplicationMenu() {
    return null;
  },
};

export function MenuItem(opts) {
  return Object.assign({ enabled: true, visible: true, checked: false, click: null }, opts || {});
}
