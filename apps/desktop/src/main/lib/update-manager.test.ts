import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { UpdateState } from "../../shared/types";
import { UpdateManager, type UpdaterLike } from "./update-manager";

interface FakeUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  feedUrl: string | null;
  checkResult: { isUpdateAvailable: boolean; updateInfo: { version: string } } | null;
  checkError: Error | null;
  handlers: Map<string, Array<(...args: unknown[]) => void>>;
  downloadCalls: number;
  installCalls: number;
  setFeedURL(options: { provider: "generic"; url: string }): void;
  checkForUpdates(): Promise<FakeUpdater["checkResult"]>;
  downloadUpdate(): Promise<string[]>;
  quitAndInstall(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
}

function createUpdater(): FakeUpdater {
  const updater: FakeUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    feedUrl: null,
    checkResult: { isUpdateAvailable: true, updateInfo: { version: "0.1.3" } },
    checkError: null,
    handlers: new Map(),
    downloadCalls: 0,
    installCalls: 0,
    setFeedURL(options) {
      this.feedUrl = options.url;
    },
    async checkForUpdates() {
      if (this.checkError) throw this.checkError;
      return this.checkResult;
    },
    async downloadUpdate() {
      this.downloadCalls += 1;
      this.emit("download-progress", {
        percent: 42,
        transferred: 42,
        total: 100,
        bytesPerSecond: 10,
      });
      return ["update.exe"];
    },
    quitAndInstall() {
      this.installCalls += 1;
    },
    on(event, handler) {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
    },
    emit(event, ...args) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    },
  };
  return updater;
}

function managerFor(updater: FakeUpdater, emit?: (state: UpdateState) => void): UpdateManager {
  return new UpdateManager({
    updater: updater as unknown as UpdaterLike,
    currentVersion: "0.1.2",
    platform: "win32",
    isPackaged: true,
    emit,
  });
}

void describe("UpdateManager", () => {
  void it("disables updates outside packaged Windows", () => {
    const manager = new UpdateManager({ platform: "linux", isPackaged: true });
    assert.equal(manager.getState().status, "unsupported");
  });

  void it("checks, downloads, and installs an available update", async () => {
    const updater = createUpdater();
    const manager = managerFor(updater);

    manager.initialize();
    assert.equal(updater.autoDownload, false);
    assert.equal(updater.autoInstallOnAppQuit, true);
    assert.equal(updater.feedUrl, "https://ai.zzzvoid.com/api/updates/win32/x64/");

    const available = await manager.check();
    assert.equal(available.status, "available");
    assert.equal(available.availableVersion, "0.1.3");

    const downloaded = await manager.download();
    assert.equal(downloaded.status, "downloaded");
    assert.equal(downloaded.progress?.percent, 100);
    assert.equal(updater.downloadCalls, 1);

    manager.install();
    assert.equal(updater.installCalls, 1);
  });

  void it("maps check failures to a recoverable error state", async () => {
    const updater = createUpdater();
    updater.checkError = new Error("network timeout");
    const manager = managerFor(updater);

    const state = await manager.check();
    assert.equal(state.status, "error");
    assert.equal(state.errorCode, "network");
  });

  void it("keeps a downloaded update when an active task blocks installation", async () => {
    const updater = createUpdater();
    let canInstall = false;
    const manager = new UpdateManager({
      updater: updater as unknown as UpdaterLike,
      currentVersion: "0.1.2",
      platform: "win32",
      isPackaged: true,
      canInstall: () => canInstall,
    });

    await manager.check();
    await manager.download();
    assert.equal(manager.install().errorCode, "busy");
    assert.equal(updater.installCalls, 0);

    canInstall = true;
    manager.install();
    assert.equal(updater.installCalls, 1);
  });
});
