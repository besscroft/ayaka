import { app } from "electron";
import type { BrowserWindow } from "electron";
import {
  autoUpdater,
  type ProgressInfo,
  type UpdateCheckResult,
  type UpdateInfo,
} from "electron-updater";
import type { UpdateErrorCode, UpdateState, UpdateStatus } from "../../shared/types";

export const UPDATE_FEED_URL = "https://ai.zzzvoid.com/api/updates/win32/x64/";

export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL(options: { provider: "generic"; url: string }): void;
  checkForUpdates(): Promise<UpdateCheckResult | null>;
  downloadUpdate(): Promise<string[]>;
  quitAndInstall(): void;
  on(event: "checking-for-update" | "update-not-available", handler: () => void): void;
  on(event: "update-available" | "update-downloaded", handler: (info: UpdateInfo) => void): void;
  on(event: "download-progress", handler: (progress: ProgressInfo) => void): void;
  on(event: "error", handler: (error: Error) => void): void;
}

interface UpdateManagerOptions {
  updater?: UpdaterLike;
  currentVersion?: string;
  platform?: NodeJS.Platform;
  isPackaged?: boolean;
  emit?: (state: UpdateState) => void;
  canInstall?: () => boolean;
  schedule?: (callback: () => void, delayMs: number) => NodeJS.Timeout;
}

const DEFAULT_STATE: UpdateState = {
  status: "idle",
  currentVersion: "0.0.0",
  availableVersion: null,
  progress: null,
  errorCode: null,
};

function isNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return /network|timeout|connect|offline|enotfound|econn/.test(message);
}

function errorCode(error: unknown): UpdateErrorCode {
  if (isNetworkError(error)) return "network";
  if (error instanceof Error && /manifest|version|checksum|invalid/i.test(error.message)) {
    return "invalid";
  }
  return "unknown";
}

function versionOf(info: UpdateInfo | null | undefined): string | null {
  const version = info?.version;
  return typeof version === "string" && version.length > 0 ? version : null;
}

export class UpdateManager {
  private updater: UpdaterLike | null;
  private readonly currentVersion: string;
  private readonly enabled: boolean;
  private emit?: (state: UpdateState) => void;
  private canInstall: () => boolean;
  private readonly schedule: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  private state: UpdateState;
  private operation: Promise<UpdateState> | null = null;
  private initialized = false;
  private scheduledCheck: NodeJS.Timeout | null = null;

  constructor(options: UpdateManagerOptions = {}) {
    this.updater = options.updater ?? null;
    this.currentVersion = options.currentVersion ?? defaultAppVersion();
    this.enabled =
      (options.platform ?? process.platform) === "win32" &&
      (options.isPackaged ?? defaultIsPackaged());
    this.emit = options.emit;
    this.canInstall = options.canInstall ?? (() => true);
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.state = {
      ...DEFAULT_STATE,
      status: this.enabled ? "idle" : "unsupported",
      currentVersion: this.currentVersion,
    };
  }

  getState(): UpdateState {
    return { ...this.state, progress: this.state.progress && { ...this.state.progress } };
  }

  setEmitter(emit: ((state: UpdateState) => void) | undefined): void {
    this.emit = emit;
  }

  setInstallGuard(canInstall: (() => boolean) | undefined): void {
    this.canInstall = canInstall ?? (() => true);
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    if (!this.enabled) return;

    const updater = this.getUpdater();

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    updater.setFeedURL({ provider: "generic", url: UPDATE_FEED_URL });
    updater.on("checking-for-update", () => this.setStatus("checking"));
    updater.on("update-available", (info: UpdateInfo) => {
      this.setState({
        status: "available",
        availableVersion: versionOf(info),
        progress: null,
        errorCode: null,
      });
    });
    updater.on("update-not-available", () => {
      this.setState({
        status: "not-available",
        availableVersion: null,
        progress: null,
        errorCode: null,
      });
    });
    updater.on("download-progress", (progress: ProgressInfo) => {
      this.setState({
        status: "downloading",
        progress: {
          percent: Number.isFinite(progress.percent) ? progress.percent : 0,
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond,
        },
        errorCode: null,
      });
    });
    updater.on("update-downloaded", (info: UpdateInfo) => {
      this.setState({
        status: "downloaded",
        availableVersion: versionOf(info) ?? this.state.availableVersion,
        progress: { percent: 100, transferred: 0, total: 0, bytesPerSecond: 0 },
        errorCode: null,
      });
    });
    updater.on("error", (error: Error) => {
      this.setState({ status: "error", errorCode: errorCode(error), progress: null });
    });
  }

  start(): void {
    this.initialize();
    if (!this.enabled || this.scheduledCheck) return;
    this.scheduledCheck = this.schedule(() => {
      this.scheduledCheck = null;
      void this.check();
    }, 5_000);
  }

  async check(): Promise<UpdateState> {
    if (!this.enabled) return this.getState();
    if (this.operation) return this.operation;
    this.initialize();
    this.operation = this.runCheck();
    try {
      return await this.operation;
    } finally {
      this.operation = null;
    }
  }

  async download(): Promise<UpdateState> {
    if (!this.enabled || this.state.status !== "available") return this.getState();
    if (this.operation) return this.operation;
    this.operation = this.runDownload();
    try {
      return await this.operation;
    } finally {
      this.operation = null;
    }
  }

  install(): UpdateState {
    const canRetryInstall = this.state.status === "error" && this.state.errorCode === "busy";
    if (this.enabled && (this.state.status === "downloaded" || canRetryInstall)) {
      if (!this.canInstall()) {
        this.setState({ status: "error", errorCode: "busy" });
        return this.getState();
      }
      this.getUpdater().quitAndInstall();
    }
    return this.getState();
  }

  private async runCheck(): Promise<UpdateState> {
    this.setStatus("checking");
    try {
      const result = await this.getUpdater().checkForUpdates();
      const version = versionOf(result?.updateInfo);
      if (!result?.isUpdateAvailable || !version) {
        this.setState({
          status: "not-available",
          availableVersion: null,
          progress: null,
          errorCode: null,
        });
      } else {
        this.setState({
          status: "available",
          availableVersion: version,
          progress: null,
          errorCode: null,
        });
      }
    } catch (error) {
      this.setState({ status: "error", progress: null, errorCode: errorCode(error) });
    }
    return this.getState();
  }

  private async runDownload(): Promise<UpdateState> {
    this.setState({ status: "downloading", progress: null, errorCode: null });
    try {
      await this.getUpdater().downloadUpdate();
      if (this.state.status !== "downloaded") {
        this.setState({
          status: "downloaded",
          progress: { percent: 100, transferred: 0, total: 0, bytesPerSecond: 0 },
          errorCode: null,
        });
      }
    } catch (error) {
      this.setState({ status: "error", progress: null, errorCode: errorCode(error) });
    }
    return this.getState();
  }

  private setStatus(status: UpdateStatus): void {
    this.setState({ status, errorCode: null });
  }

  private getUpdater(): UpdaterLike {
    if (!this.updater) this.updater = autoUpdater as unknown as UpdaterLike;
    return this.updater;
  }

  private setState(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.emit?.(this.getState());
  }
}

export function sendUpdateState(window: BrowserWindow | null, state: UpdateState): void {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send("updates:state-changed", state);
  }
}

export const updateManager = new UpdateManager();

function defaultAppVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return "0.0.0";
  }
}

function defaultIsPackaged(): boolean {
  try {
    return app.isPackaged;
  } catch {
    return false;
  }
}
