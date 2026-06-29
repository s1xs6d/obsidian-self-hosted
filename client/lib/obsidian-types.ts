export interface ObsidianNotice {
  hide(): void;
  setMessage(msg: string): this;
  containerEl?: { addClass?(cls: string): void; removeClass?(cls: string): void };
}

export interface ObsidianMenuItem {
  setTitle(title: string): this;
  setIcon?(icon: string): this;
  setSubmenu?(): ObsidianMenu;
  onClick(cb: () => void): this;
  setDisabled?(disabled: boolean): this;
}

export interface ObsidianMenu {
  addItem(cb: (item: ObsidianMenuItem) => void): void;
  addSeparator(): void;
  showAtMouseEvent(e: MouseEvent): void;
  showAtPosition(pos: { x: number; y: number }): void;
  hide(): void;
}
