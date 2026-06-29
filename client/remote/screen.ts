export const screen = {
  getPrimaryDisplay() {
    const ws = window.screen;
    return {
      id: 0,
      label: "Built-in Display",
      bounds: { x: 0, y: 0, width: ws.width, height: ws.height },
      workArea: { x: 0, y: 0, width: ws.availWidth, height: ws.availHeight },
      workAreaSize: { width: ws.availWidth, height: ws.availHeight },
      size: { width: ws.width, height: ws.height },
      scaleFactor: devicePixelRatio || 1,
      rotation: 0,
      touchSupport: "unknown",
      accelerometerSupport: "unknown",
      monochrome: false,
      colorDepth: ws.colorDepth || 24,
      colorSpace: "",
      depth: ws.colorDepth || 24,
      displayFrequency: 60,
      internal: true,
    };
  },
  getAllDisplays() {
    return [this.getPrimaryDisplay()];
  },
  getDisplayNearestPoint() {
    return this.getPrimaryDisplay();
  },
  getDisplayMatching() {
    return this.getPrimaryDisplay();
  },
  getCursorScreenPoint() {
    return { x: 0, y: 0 };
  },
  dipToScreenPoint(p) {
    return p;
  },
  screenToDipPoint(p) {
    return p;
  },
  dipToScreenRect(r) {
    return r;
  },
  screenToDipRect(r) {
    return r;
  },
  on() {},
  removeListener() {},
};
