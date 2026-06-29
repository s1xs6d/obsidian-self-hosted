export interface ModalHandle {
  close(): void;
}

export interface DomModalHandle {
  container: HTMLElement;
  close: () => void;
  modal: HTMLElement;
  content: HTMLElement;
}

export function openObsidianModal(Config): ModalHandle | DomModalHandle {
  const api = window.__oshObsAPI;
  const app = window.app;
  if (api && typeof api.Modal === "function" && app) {
    let _forceClose = false;
    class ShimModal extends (api.Modal as new (...args: unknown[]) => {
      titleEl: HTMLElement;
      contentEl: HTMLElement;
      open(): void;
      close(): void;
      containerEl?: HTMLElement;
      modalEl?: HTMLElement;
    }) {
      constructor() {
        super(app);
      }
      // Obsidian's backdrop click calls this.close() directly, so we intercept
      // it here to honour Config.closable === false.
      close() {
        if (Config.closable === false && !_forceClose) return;
        super.close();
      }
      onOpen() {
        if (Config.title) this.titleEl.textContent = Config.title;
        if (Config.content instanceof HTMLElement) {
          this.contentEl.appendChild(Config.content);
        }
        if (Config.buttons?.length) {
          const btnRow = document.createElement("div");
          btnRow.className = "modal-button-container";
          for (const { text, cta, onClick } of Config.buttons) {
            const btn = document.createElement("button");
            if (cta) btn.className = "mod-cta";
            btn.textContent = text;
            btn.onclick = onClick;
            btnRow.appendChild(btn);
          }
          this.contentEl.appendChild(btnRow);
        }
        Config.onOpen?.(this);
      }
      onClose() {
        if (Config.content instanceof HTMLElement && Config.content.parentNode) {
          Config.content.remove();
        }
        Config.onClose?.(this);
      }
    }
    const instance = new ShimModal();
    instance.open();
    // Return a wrapper so callers can force-close regardless of closable flag.
    return {
      close() { _forceClose = true; instance.close(); },
    };
  }
  return openDomModal(Config);
}

export function openDomModal(Config): DomModalHandle {
  const container = document.createElement("div");
  container.className = "modal-container";

  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.onclick = () => {
    if (Config.closable !== false) close();
  };
  container.appendChild(bg);

  const modal = document.createElement("div");
  modal.className = "modal";
  if (Config.width) modal.style.maxWidth = Config.width;

  if (Config.title) {
    const header = document.createElement("div");
    header.className = "modal-header";
    const titleEl = document.createElement("div");
    titleEl.className = "modal-title";
    titleEl.textContent = Config.title;
    header.appendChild(titleEl);
    modal.appendChild(header);
  }

  const content = document.createElement("div");
  content.className = "modal-content";
  if (Config.content) {
    if (typeof Config.content === "string") {
      content.innerHTML = Config.content;
    } else if (Config.content instanceof HTMLElement) {
      content.appendChild(Config.content);
    }
  }
  modal.appendChild(content);

  if (Config.buttons?.length) {
    const btnContainer = document.createElement("div");
    btnContainer.className = "modal-button-container";
    Config.buttons.forEach(({ text, cta, onClick }) => {
      const btn = document.createElement("button");
      if (cta) btn.className = "mod-cta";
      btn.textContent = text;
      btn.onclick = onClick;
      btnContainer.appendChild(btn);
    });
    modal.appendChild(btnContainer);
  }

  container.appendChild(modal);
  document.body.appendChild(container);

  function close() {
    container.remove();
    Config.onClose?.();
  }

  return { container, close, modal, content };
}
