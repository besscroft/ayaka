import { app, Menu, type MenuItemConstructorOptions, Tray, nativeImage } from "electron";
import { join } from "path";
import {
  isDesktopPetEnabled,
  setDesktopPetEnabledAsync as setDesktopPetEnabled,
  getDesktopPetSnapshot,
} from "./db";

export const DESKTOP_PET_TRAY_SET_ENABLED_CHANNEL = "desktopPet:tray:setEnabled";
export const DESKTOP_PET_TRAY_OPEN_SETTINGS_CHANNEL = "desktopPet:tray:openSettings";
export const DESKTOP_PET_TRAY_OPEN_ABOUT_CHANNEL = "desktopPet:tray:openAbout";

export const DESKTOP_PET_TRAY_PROFILE_ID = "interaction-pet";

interface DesktopPetTrayOptions {
  /** 用于托盘点击 "设置" 时调用主进程 IPC 打开主窗口设置面板 */
  openMainSettings: () => void;
  /** 用于托盘点击 "关于" 时调用主进程 IPC 打开关于对话框 */
  openAbout: () => void;
  /** 用于 "退出" 时真正退出应用（不走 window-all-closed 逻辑） */
  quitApp: () => void;
}

/**
 * 桌宠系统托盘控制器。
 *
 * - 始终存活，启用/隐藏桌宠时切换菜单项的勾选状态
 * - 托盘菜单：显示桌宠 / 隐藏桌宠 / 打开主窗口 / 桌宠设置 / 关于 / 退出
 * - macOS / Windows / Linux 三平台均创建托盘（macOS 上为菜单栏图标）
 */
export class DesktopPetTrayController {
  private tray: Tray | null = null;
  private disposed = false;

  constructor(private readonly options: DesktopPetTrayOptions) {}

  /** 应用启动后调用一次：构建托盘并注册菜单 */
  initialize(): void {
    if (this.disposed) return;
    if (this.tray) return;
    const image = this.loadTrayImage();
    try {
      this.tray = new Tray(image);
    } catch (err) {
      console.error("[desktop-pet-tray] failed to create tray:", err);
      return;
    }
    this.tray.setToolTip("Void · 智能体桌宠");
    this.tray.on("click", () => this.togglePetVisibility());
    this.tray.on("double-click", () => this.showPet());
    this.rebuildMenu();
  }

  /** 桌宠启用/隐藏状态变化时刷新菜单勾选状态 */
  syncMenu(): void {
    this.rebuildMenu();
  }

  dispose(): void {
    this.disposed = true;
    if (this.tray) {
      try {
        this.tray.destroy();
      } catch (err) {
        console.error("[desktop-pet-tray] failed to destroy tray:", err);
      }
      this.tray = null;
    }
  }

  private rebuildMenu(): void {
    if (!this.tray) return;
    const enabled = isDesktopPetEnabled();
    const profile = getDesktopPetSnapshot().profile;
    const label = profile?.label ?? "智能体桌宠";

    const items: MenuItemConstructorOptions[] = [
      {
        id: "pet-toggle",
        label: enabled ? `隐藏 ${label}` : `显示 ${label}`,
        type: "checkbox",
        checked: enabled,
        click: () => this.togglePetVisibility(),
      },
      { type: "separator" },
      {
        label: "打开主窗口",
        click: () => this.options.openMainSettings(),
      },
      {
        label: "桌宠设置…",
        click: () => this.options.openMainSettings(),
      },
      {
        label: "关于 Paimon",
        click: () => this.options.openAbout(),
      },
      { type: "separator" },
      {
        label: "退出 Paimon",
        click: () => this.options.quitApp(),
      },
    ];

    try {
      const contextMenu = Menu.buildFromTemplate(items);
      this.tray.setContextMenu(contextMenu);
    } catch (err) {
      console.error("[desktop-pet-tray] failed to set context menu:", err);
    }
  }

  private togglePetVisibility(): void {
    const next = !isDesktopPetEnabled();
    void setDesktopPetEnabled(next);
    // 立即同步菜单（其他窗口监听不到，需要自己重建）
    this.syncMenu();
  }

  private showPet(): void {
    if (!isDesktopPetEnabled()) {
      void setDesktopPetEnabled(true);
      this.syncMenu();
    }
  }

  private loadTrayImage(): Electron.NativeImage {
    // 优先使用应用图标；macOS 菜单栏会按系统规范缩小
    try {
      const iconPath = join(app.getAppPath(), "resources", "icon.png");
      const image = nativeImage.createFromPath(iconPath);
      if (!image.isEmpty()) return image;
    } catch (err) {
      console.warn("[desktop-pet-tray] failed to load icon, falling back to empty image", err);
    }
    return nativeImage.createEmpty();
  }
}
