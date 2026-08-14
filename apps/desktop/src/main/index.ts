import { app, shell, BrowserWindow, ipcMain, protocol } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import { initDbWriter, closeDb } from "./lib/db";
import { scheduleMemoryFileConsolidation } from "./lib/agent-memory-files";
import { startMemoryWorker } from "./lib/agent-learning";
import { startServer, stopServer } from "./server";
import { migrateProviderApiKeysToModelKeys } from "./lib/providers";
import { registerAyakaMediaProtocol } from "./lib/media-assets";
import { registerIpcHandlers } from "./ipc";
import { startCronScheduler, stopCronScheduler } from "./lib/cron-scheduler";
import { ensureBuiltinCatalogSources } from "./lib/catalog-service";
import { agentLoopSessions } from "./lib/agent-loop-session";
import { sendUpdateState, updateManager } from "./lib/update-manager";
import { removeLegacyCompanionData } from "./lib/runtime-paths";

const WINDOWS_APP_ID = "com.zzzvoid.ai";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "ayaka-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

let mainWindowRef: BrowserWindow | null = null;
let isCleaningUpBeforeQuit = false;

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
    title: "Ayaka",
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

// 应用就绪后初始化所有子系统
void app.whenReady().then(async () => {
  process.env.AYAKA_USER_DATA_DIR ??= app.getPath("userData");
  process.env.AYAKA_APP_PATH ??= app.getAppPath();
  process.env.AYAKA_DEV = is.dev ? "1" : "0";
  electronApp.setAppUserModelId(WINDOWS_APP_ID);
  app.setName("Ayaka");
  removeLegacyCompanionData();

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

  registerAyakaMediaProtocol();

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
  if (process.platform !== "darwin") app.quit();
});

// 应用退出前清理资源
app.on("before-quit", (event) => {
  if (isCleaningUpBeforeQuit) return;
  event.preventDefault();
  isCleaningUpBeforeQuit = true;
  stopCronScheduler();
  stopServer();
  void agentLoopSessions
    .interruptAll()
    .then(() => closeDb())
    .finally(() => app.quit());
});

// 其余 main 进程代码可以拆分到独立文件并在此 require
