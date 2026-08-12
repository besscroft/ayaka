import { BrowserWindow, ipcMain, screen } from "electron";
import {
  DESKTOP_PET_WINDOW_SIZE,
  type DesktopPetConfig,
  type DesktopPetSelector,
  type DesktopPetSnapshot,
  type DesktopPetWindowConfig,
  type StorePetQuery,
} from "../../shared/types";
import {
  getDesktopPetSnapshot,
  isDesktopPetEnabled,
  setDesktopPetEnabledAsync as setDesktopPetEnabled,
  updateDesktopPetConfigAsync as updateDesktopPetConfig,
} from "./db";
import {
  beginLocalPetImport,
  commitLocalPetImport,
  deleteInstalledPet,
  ensureDesktopPetAsset,
  installStorePet,
  listDesktopPets,
  listStorePets,
} from "./desktop-pet-assets";
import {
  clampDesktopPetBounds,
  moveDesktopPetBounds,
  type DesktopPetBounds,
} from "./desktop-pet-bounds";

/**
 * 展开/收起桌宠时窗口大小的硬性范围。
 * 下限 = 球本身能塞下的最小值；上限 = 防止设置异常导致窗口飞出屏幕。
 */
interface DesktopPetWindowControllerOptions {
  preloadPath: string;
  rendererFilePath: string;
  rendererDevUrl?: string;
  /** 渲染层触发右键菜单时调用 */
  onContextMenu?: (win: BrowserWindow) => void;
  /** 同步托盘菜单状态（外部未接线时静默 no-op） */
  syncTrayMenu?: () => void;
}

export class DesktopPetWindowController {
  private petWindow: BrowserWindow | null = null;
  private saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;
  private closingFromApi = false;
  private isAppQuitting = false;

  constructor(private readonly options: DesktopPetWindowControllerOptions) {}

  registerIpcHandlers(): void {
    ipcMain.handle("desktopPet:getSnapshot", () => getDesktopPetSnapshot());
    ipcMain.handle("desktopPet:listPets", () => listDesktopPets());
    ipcMain.handle("desktopPet:listStore", (_event, query: StorePetQuery) =>
      listStorePets(query ?? {}),
    );
    ipcMain.handle("desktopPet:select", (_event, selector: DesktopPetSelector) =>
      this.selectPet(selector),
    );
    ipcMain.handle("desktopPet:installStore", (_event, id: string, replace?: boolean) =>
      this.installStore(id, Boolean(replace)),
    );
    ipcMain.handle("desktopPet:beginLocalImport", (_event, mode: "zip" | "folder") =>
      beginLocalPetImport(mode),
    );
    ipcMain.handle("desktopPet:commitLocalImport", (_event, token: string, replace?: boolean) =>
      this.commitLocalImport(token, Boolean(replace)),
    );
    ipcMain.handle("desktopPet:delete", (_event, selector: DesktopPetSelector) =>
      this.deletePet(selector),
    );
    ipcMain.handle("desktopPet:setEnabled", (_event, enabled: boolean) =>
      this.setEnabled(Boolean(enabled)),
    );
    ipcMain.handle("desktopPet:updateWindow", (_event, patch: Partial<DesktopPetWindowConfig>) =>
      this.updateWindow(patch),
    );
    ipcMain.handle("desktopPet:show", () => this.show());
    ipcMain.handle("desktopPet:hide", () => this.hide());
    ipcMain.handle("desktopPet:resetPosition", () => this.resetPosition());
    ipcMain.handle("desktopPet:moveWindowBy", (_event, delta: { dx?: unknown; dy?: unknown }) =>
      this.moveWindowBy(delta),
    );
    ipcMain.handle("desktopPet:showContextMenu", () => this.showContextMenu());
    ipcMain.handle("desktopPet:getLookDirection", () => this.getLookDirection());
    ipcMain.handle("desktopPet:setIgnoreMouseEvents", (_event, ignore: boolean) =>
      this.setIgnoreMouseEvents(Boolean(ignore)),
    );
  }

  async restoreIfEnabled(): Promise<void> {
    if (!isDesktopPetEnabled()) return;
    const snapshot = getDesktopPetSnapshot();
    await ensureDesktopPetAsset(snapshot.config.selectedPet);
    await this.ensureWindow(getDesktopPetSnapshot());
  }

  async setEnabled(enabled: boolean): Promise<DesktopPetSnapshot> {
    if (enabled) return this.show();
    return this.hide();
  }

  async show(): Promise<DesktopPetSnapshot> {
    const current = getDesktopPetSnapshot();
    await ensureDesktopPetAsset(current.config.selectedPet);
    const snapshot = await setDesktopPetEnabled(true);
    await this.ensureWindow(snapshot);
    this.options.syncTrayMenu?.();
    return getDesktopPetSnapshot();
  }

  async hide(): Promise<DesktopPetSnapshot> {
    const snapshot = await setDesktopPetEnabled(false);
    this.closePetWindow();
    this.options.syncTrayMenu?.();
    return snapshot;
  }

  async updateWindow(patch: Partial<DesktopPetWindowConfig>): Promise<DesktopPetSnapshot> {
    const snapshot = await updateDesktopPetConfig({ window: patch });
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      this.applyWindowConfig(snapshot.config);
    }
    return snapshot;
  }

  async selectPet(selector: DesktopPetSelector): Promise<DesktopPetSnapshot> {
    await ensureDesktopPetAsset(selector);
    const snapshot = await updateDesktopPetConfig({ selectedPet: selector });
    if (snapshot.enabled) {
      await this.ensureWindow(snapshot);
      this.reloadPetRenderer();
    }
    return getDesktopPetSnapshot();
  }

  async installStore(
    id: string,
    replace: boolean,
  ): Promise<Awaited<ReturnType<typeof installStorePet>>> {
    const installed = await installStorePet(id, replace);
    const snapshot = getDesktopPetSnapshot();
    if (snapshot.config.selectedPet === installed.selector && snapshot.enabled) {
      this.reloadPetRenderer();
    }
    return installed;
  }

  async commitLocalImport(
    token: string,
    replace: boolean,
  ): Promise<Awaited<ReturnType<typeof commitLocalPetImport>>> {
    const installed = await commitLocalPetImport(token, replace);
    const snapshot = getDesktopPetSnapshot();
    if (snapshot.config.selectedPet === installed.selector && snapshot.enabled) {
      this.reloadPetRenderer();
    }
    return installed;
  }

  async deletePet(selector: DesktopPetSelector): Promise<DesktopPetSnapshot> {
    const current = getDesktopPetSnapshot();
    if (current.config.selectedPet === selector) {
      const fallback: DesktopPetSelector = "builtin:paimon";
      await ensureDesktopPetAsset(fallback);
      await updateDesktopPetConfig({ selectedPet: fallback });
      if (current.enabled) this.reloadPetRenderer();
    }
    deleteInstalledPet(selector);
    return getDesktopPetSnapshot();
  }

  async resetPosition(): Promise<DesktopPetSnapshot> {
    return this.updateWindow({ x: undefined, y: undefined });
  }

  async moveWindowBy(delta: { dx?: unknown; dy?: unknown }): Promise<boolean> {
    if (!this.petWindow || this.petWindow.isDestroyed()) return false;
    const dx = typeof delta.dx === "number" && Number.isFinite(delta.dx) ? delta.dx : 0;
    const dy = typeof delta.dy === "number" && Number.isFinite(delta.dy) ? delta.dy : 0;
    if (dx === 0 && dy === 0) return true;

    const current = this.petWindow.getBounds();
    const snapshot = getDesktopPetSnapshot();
    const nextBounds = getMovedDesktopPetBounds(snapshot.config, current, { dx, dy });

    this.petWindow.setBounds(nextBounds);
    this.scheduleBoundsSave();
    return true;
  }

  /** 由 IPC 触发，在桌宠窗口位置弹出原生右键菜单 */
  showContextMenu(): void {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    this.options.onContextMenu?.(this.petWindow);
  }

  getLookDirection(): number | null {
    if (!this.petWindow || this.petWindow.isDestroyed()) return null;
    const cursor = screen.getCursorScreenPoint();
    const bounds = this.petWindow.getBounds();
    const dx = cursor.x - (bounds.x + bounds.width / 2);
    const dy = cursor.y - (bounds.y + bounds.height / 2);
    if (Math.hypot(dx, dy) < 24) return null;
    const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return ((Math.round(degrees / 22.5) % 16) + 16) % 16;
  }

  /**
   * 透明窗口点击穿透的核心：动态切换 setIgnoreMouseEvents。
   *
   * 背景：Electron transparent BrowserWindow 在 Windows/macOS 上，
   * 即便 CSS 把 body/#root 设成 pointer-events: none，OS 层级
   * 整个窗口 bounds 仍会拦截鼠标点击——表现就是"半屏被遮挡无法点击"。
   * 必须显式调 setIgnoreMouseEvents(true) 才能让点击真正穿透到底下 app。
   *
   * - ignore=true + forward=true：窗口忽略点击（穿透），但 mousemove
   *   仍转发给渲染层，渲染层据此检测鼠标何时进入桌宠可视区，再切回
   *   ignore=false 恢复交互。
   * - ignore=false：窗口正常接收事件，球可拖动 / 点击 / hover。
   *
   * 渲染层在 document 上监听 mousemove 做动态切换（见 DesktopPetApp.tsx）。
   */
  setIgnoreMouseEvents(ignore: boolean): boolean {
    if (!this.petWindow || this.petWindow.isDestroyed()) return false;
    // forward 仅在 ignore=true 时有意义；ignore=false 时窗口本就接收事件。
    this.petWindow.setIgnoreMouseEvents(ignore, { forward: true });
    return true;
  }

  prepareForAppQuit(): void {
    this.isAppQuitting = true;
    this.flushBoundsSave();
  }

  private async ensureWindow(snapshot: DesktopPetSnapshot): Promise<BrowserWindow> {
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      this.applyWindowConfig(snapshot.config);
      this.petWindow.show();
      return this.petWindow;
    }

    const bounds = getClampedDesktopPetBounds(snapshot.config);
    const initialWidth = DESKTOP_PET_WINDOW_SIZE.width;
    const initialHeight = DESKTOP_PET_WINDOW_SIZE.height;
    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: initialWidth,
      height: initialHeight,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: snapshot.config.window.alwaysOnTop,
      // 桌宠窗口不参与任务切换；不抢焦点影响其他窗口
      focusable: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      title: "Void desktop pet",
      webPreferences: {
        preload: this.options.preloadPath,
        sandbox: false,
        // 内存优化：禁用背景节流（桌宠窗口始终可见）
        backgroundThrottling: false,
      },
    });

    this.petWindow = win;

    win.on("ready-to-show", () => {
      if (!win.isDestroyed()) {
        // 在 not-focusable=false 时，show() 会自动抢焦点。
        // 桌宠场景下我们希望它只是"出现"，不夺焦点。
        // Electron 没有直接 API：使用 showInactive() 避免抢焦点。
        win.showInactive();
        win.webContents.setFrameRate(60);
        // 初始即让透明区域点击穿透。否则窗口刚显示时整个透明窗口
        // 会挡住底下 app（渲染层 mousemove 接管前有一段"全挡"空窗期）。
        // forward=true 保证 mousemove 仍转发，渲染层据此动态切换。
        win.setIgnoreMouseEvents(true, { forward: true });
      }
    });
    win.on("move", () => this.scheduleBoundsSave());
    win.on("closed", () => {
      this.petWindow = null;
      if (!this.closingFromApi && !this.isAppQuitting) {
        void setDesktopPetEnabled(false);
        this.options.syncTrayMenu?.();
      }
      this.closingFromApi = false;
    });

    await this.loadPetRenderer(win);
    return win;
  }

  private applyWindowConfig(config: DesktopPetConfig): void {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    const bounds = getClampedDesktopPetBounds(config);
    this.petWindow.setAlwaysOnTop(config.window.alwaysOnTop);
    // Window size is fixed; settings only synchronize position and always-on-top.
    this.petWindow.setBounds(bounds);
    this.petWindow.webContents.send("desktopPet:snapshotApplied", getDesktopPetSnapshot());
  }

  private closePetWindow(): void {
    if (this.saveBoundsTimer) {
      clearTimeout(this.saveBoundsTimer);
      this.saveBoundsTimer = null;
    }
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    this.closingFromApi = true;
    this.petWindow.close();
  }

  private scheduleBoundsSave(): void {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    if (this.saveBoundsTimer) clearTimeout(this.saveBoundsTimer);
    this.saveBoundsTimer = setTimeout(() => {
      this.saveBoundsTimer = null;
      this.flushBoundsSave();
    }, 250);
  }

  private flushBoundsSave(): void {
    if (this.saveBoundsTimer) {
      clearTimeout(this.saveBoundsTimer);
      this.saveBoundsTimer = null;
    }
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    const bounds = this.petWindow.getBounds();
    try {
      const current = getDesktopPetSnapshot().config.window;
      void updateDesktopPetConfig({
        window: {
          x: bounds.x,
          y: bounds.y,
          alwaysOnTop: current.alwaysOnTop,
        },
      });
    } catch (err) {
      console.error("[desktop-pet] failed to save bounds:", err);
    }
  }

  private async loadPetRenderer(win: BrowserWindow): Promise<void> {
    if (this.options.rendererDevUrl) {
      await win.loadURL(`${this.options.rendererDevUrl}?surface=pet`);
      return;
    }
    await win.loadFile(this.options.rendererFilePath, { query: { surface: "pet" } });
  }

  private reloadPetRenderer(): void {
    if (!this.petWindow || this.petWindow.isDestroyed()) return;
    void this.loadPetRenderer(this.petWindow);
  }
}

export function getClampedDesktopPetBounds(config: DesktopPetConfig): DesktopPetBounds {
  const displays = screen.getAllDisplays().map((display) => display.workArea);
  return clampDesktopPetBounds(config, displays, screen.getPrimaryDisplay().workArea);
}

export function getMovedDesktopPetBounds(
  config: DesktopPetConfig,
  current: DesktopPetBounds,
  delta: { dx: number; dy: number },
): DesktopPetBounds {
  const displays = screen.getAllDisplays().map((display) => display.workArea);
  return moveDesktopPetBounds(
    config,
    current,
    delta,
    displays,
    screen.getPrimaryDisplay().workArea,
  );
}
