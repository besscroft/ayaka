import { app, shell, BrowserWindow, ipcMain, protocol } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import { initDbWriter, closeDb } from "./lib/db";
import { scheduleMemoryFileConsolidation } from "./lib/agent-memory-files";
import { startMemoryWorker } from "./lib/agent-learning";
import { startServer, stopServer } from "./server";
import { migrateProviderApiKeysToModelKeys } from "./lib/providers";
import { registerVoidMediaProtocol } from "./lib/media-assets";
import { registerDesktopPetProtocol } from "./lib/desktop-pet-assets";
import { registerIpcHandlers } from "./ipc";
import { DesktopPetWindowController } from "./lib/desktop-pet-window";
import { DesktopPetTrayController } from "./lib/desktop-pet-tray";
import { showDesktopPetContextMenu } from "./lib/desktop-pet-context-menu";
import { startCronScheduler, stopCronScheduler } from "./lib/cron-scheduler";
import { ensureBuiltinCatalogSources } from "./lib/catalog-service";
import { agentLoopSessions } from "./lib/agent-loop-session";
import { sendUpdateState, updateManager } from "./lib/update-manager";

const WINDOWS_APP_ID = "com.zzzvoid.ai";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "void-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
  {
    scheme: "void-pet",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

let mainWindowRef: BrowserWindow | null = null;
let desktopPetControllerRef: DesktopPetWindowController | null = null;
let desktopPetTrayRef: DesktopPetTrayController | null = null;
let isCleaningUpBeforeQuit = false;
let isQuittingFromTray = false;

function getPreloadPath(): string {
  return join(__dirname, "../preload/index.js");
}

function getRendererFilePath(): string {
  return join(__dirname, "../renderer/index.html");
}

function createWindow(): BrowserWindow {
  // 创建浏览器窗口
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    title: "Paimon",
    ...(process.platform === "darwin" ? {} : { icon }),
    webPreferences: {
      preload: getPreloadPath(),
      sandbox: false,
    },
  });
  mainWindowRef = mainWindow;

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.on("closed", () => {
    if (mainWindowRef === mainWindow) mainWindowRef = null;
  });
  const sendMaximizedState = (): void => {
    if (!mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("window:maximized-changed", mainWindow.isMaximized());
    }
  };
  mainWindow.on("maximize", sendMaximizedState);
  mainWindow.on("unmaximize", sendMaximizedState);

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  // HMR for renderer based on electron-vite cli.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(getRendererFilePath());
  }

  return mainWindow;
}

function getOrCreateMainWindow(): BrowserWindow {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return createWindow();
  return mainWindowRef;
}

function showMainWindow(): BrowserWindow {
  const main = getOrCreateMainWindow();
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
  return main;
}

/** 通过主窗口 IPC 通知渲染层打开设置面板（settingsDialog 已经在 App.tsx 管理） */
function openMainSettings(): void {
  const main = showMainWindow();
  // 触发主窗口的 openSettings：复用已有的 desktopPet:openSettings channel 风格
  if (!main.webContents.isLoading()) {
    main.webContents.send("desktopPet:openSettings");
  } else {
    main.webContents.once("did-finish-load", () => {
      main.webContents.send("desktopPet:openSettings");
    });
  }
}

function openAbout(): void {
  const main = showMainWindow();
  if (!main.webContents.isLoading()) {
    main.webContents.send("desktopPet:openAbout");
  } else {
    main.webContents.once("did-finish-load", () => {
      main.webContents.send("desktopPet:openAbout");
    });
  }
}

function quitApp(): void {
  isQuittingFromTray = true;
  app.quit();
}

// 应用就绪后初始化所有子系统
void app.whenReady().then(async () => {
  process.env.VOID_AI_USER_DATA_DIR ??= app.getPath("userData");
  process.env.VOID_AI_APP_PATH ??= app.getAppPath();
  process.env.VOID_AI_DEV = is.dev ? "1" : "0";
  electronApp.setAppUserModelId(WINDOWS_APP_ID);
  app.setName("Paimon");

  // 默认在开发环境用 F12 打开 DevTools，生产环境忽略 Cmd/Ctrl+R
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // 1. 初始化数据库（better-sqlite3 + drizzle-orm）
  //    迁移文件位于 apps/desktop/drizzle，生产环境从 process.resourcesPath/drizzle 读取
  try {
    await initDbWriter();
    await migrateProviderApiKeysToModelKeys();
    await ensureBuiltinCatalogSources();
    scheduleMemoryFileConsolidation();
    startMemoryWorker();
    console.log("[main] 数据库已初始化");
  } catch (err) {
    // 注意：electron-vite dev 下 stderr 偶发不刷新，改用 console.log 确保可见
    console.log("[main] 数据库初始化失败:", err);
  }

  registerVoidMediaProtocol();
  registerDesktopPetProtocol();

  // 2. 启动本地 HTTP 服务（用于 AI SDK 流式通信）
  try {
    const port = await startServer();
    startCronScheduler();
    console.log(`[main] AI 服务端口: ${port}`);
  } catch (err) {
    console.error("[main] AI 服务启动失败:", err);
  }

  // 3. 注册 IPC handlers
  createWindow();
  updateManager.setEmitter((state) => sendUpdateState(mainWindowRef, state));
  updateManager.setInstallGuard(() => !agentLoopSessions.hasActiveSessions());
  registerIpcHandlers();
  updateManager.start();

  const desktopPetController = new DesktopPetWindowController({
    preloadPath: getPreloadPath(),
    rendererFilePath: getRendererFilePath(),
    rendererDevUrl:
      is.dev && process.env["ELECTRON_RENDERER_URL"]
        ? process.env["ELECTRON_RENDERER_URL"]
        : undefined,
    onContextMenu: (win) => {
      showDesktopPetContextMenu(win, {
        onOpenMainWindow: showMainWindow,
        onOpenSettings: openMainSettings,
        onOpenAbout: openAbout,
        onHide: () => {
          void desktopPetController.hide();
        },
        onResetPosition: () => {
          void desktopPetController.resetPosition();
        },
        onQuit: quitApp,
      });
    },
  });
  desktopPetControllerRef = desktopPetController;
  desktopPetController.registerIpcHandlers();
  void desktopPetController
    .restoreIfEnabled()
    .catch((err) => console.error("[desktop-pet] restore failed:", err));

  // 托盘（系统托盘，跨平台；macOS 表现为菜单栏图标）
  const desktopPetTray = new DesktopPetTrayController({
    openMainSettings: openMainSettings,
    openAbout: openAbout,
    quitApp: quitApp,
  });
  desktopPetTrayRef = desktopPetTray;
  desktopPetTray.initialize();

  // IPC test（保留模板自带的 ping）
  ipcMain.on("ping", () => console.log("pong"));

  app.on("activate", function () {
    // macOS 上点击 dock 图标时若无窗口则重建
    if (!mainWindowRef || mainWindowRef.isDestroyed()) createWindow();
    else mainWindowRef.show();
  });
});

// 所有窗口关闭时退出（macOS 除外）
app.on("window-all-closed", () => {
  // 如果是用户从托盘点击"退出"，直接退出；
  // 否则在非 macOS 上也退出（桌宠被隐藏时主窗口可能还在，桌宠被关闭时主窗口也应该跟随）
  if (isQuittingFromTray || process.platform !== "darwin") {
    desktopPetTrayRef?.dispose();
    app.quit();
  }
});

// 应用退出前清理资源
app.on("before-quit", (event) => {
  if (isCleaningUpBeforeQuit) return;
  event.preventDefault();
  isCleaningUpBeforeQuit = true;
  desktopPetControllerRef?.prepareForAppQuit();
  desktopPetTrayRef?.dispose();
  stopCronScheduler();
  stopServer();
  void agentLoopSessions
    .interruptAll()
    .then(() => closeDb())
    .finally(() => app.quit());
});

// 其余 main 进程代码可以拆分到独立文件并在此 require
