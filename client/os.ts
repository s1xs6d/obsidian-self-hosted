import { ipcSendSync } from "./ipc";
import { proc } from "./process";

export const osShim = {
  platform: () => proc.platform,
  arch: () => proc.arch || "x64",
  release: () => "20.0.0",
  type() {
    if (proc.platform === "darwin") return "Darwin";
    if (proc.platform === "win32") return "Windows_NT";
    return "Linux";
  },
  version: () => "",
  hostname: () => "localhost",
  homedir() {
    return ipcSendSync("get-home-dir") || (proc.platform === "win32" ? "C:\\Users\\user" : "/home/user");
  },
  tmpdir() {
    return proc.platform === "win32" ? "C:\\Temp" : "/tmp";
  },
  EOL: proc.platform === "win32" ? "\r\n" : "\n",
  cpus() {
    const count = navigator.hardwareConcurrency || 4;
    return Array.from({ length: count }, () => ({
      model: "Browser CPU",
      speed: 0,
      times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
    }));
  },
  freemem: () => 2 * 1024 * 1024 * 1024,
  totalmem: () => 8 * 1024 * 1024 * 1024,
  loadavg: () => [0, 0, 0],
  networkInterfaces: () => ({}),
  userInfo() {
    return {
      username: "user",
      uid: 1000,
      gid: 1000,
      shell: "/bin/bash",
      homedir: osShim.homedir(),
    };
  },
  uptime: () => performance.now() / 1000,
  constants: { signals: {}, errno: {} },
};
