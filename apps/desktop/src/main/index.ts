import { app, shell, BrowserWindow, ipcMain, protocol } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import { initDbWriter, closeDb } from "./lib/db";
import { scheduleMemoryFileConsolidation } from "./lib/agent-memory-files";
import { startMemoryWorker } from "./lib/agent-learning";
import { startServer, stopServer } from "./server";
import {
  initializeBuiltinProviderCatalog,
  migrateProviderApiKeysToModelKeys,
  refreshBuiltinProviderCatalog,
} from "./lib/providers";
import { registerAyakaMediaProtocol } from "./lib/media-assets";
import { readSandboxArtifactResource } from "./lib/sandbox-artifact-manager";
import { closeAllSandboxPreviews } from "./lib/sandbox-preview-manager";
import { registerIpcHandlers } from "./ipc";
import { startCronScheduler, stopCronScheduler } from "./lib/cron-scheduler";
import { ensureBuiltinCatalogSources } from "./lib/catalog-service";
import { agentLoopSessions } from "./lib/agent-loop-session";
import { sendUpdateState, updateManager } from "./lib/update-manager";
import { removeLegacyCompanionData } from "./lib/runtime-paths";
import { closeAllMcpClients } from "./lib/mcp-manager";
import { recoverMcpDependencyInstallations } from "./lib/mcp-dependencies";
import {
  recoverMcpLifecycleStates,
  shutdownMcpLifecycle,
  startEnabledMcpServers,
} from "./lib/mcp-lifecycle-manager";
import { cancelAllMcpInputs } from "./lib/mcp-interaction-broker";
import { closeMcpOAuthLoopback } from "./lib/mcp-auth";
import { createTray, type TrayController } from "./lib/tray";
import { getDefaultTrayMenuLabels } from "./lib/tray-menu";
import {
  flushErrorLogs,
  initializeErrorLogger,
  installProcessErrorCapture,
  recordErrorLog,
} from "./lib/error-logger";
import type { TrayAction, TrayMenuLabels } from "../shared/types";

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
  {
    scheme: "ayaka-artifact",
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
let isQuitting = false;
let trayController: TrayController | null = null;
const pendingTrayActions: TrayAction[] = [];

installProcessErrorCapture();

function getPreloadPath(): string {
  return join(__dirname, "../preload/index.js");
}
function getRendererFilePath(): string {
  return join(__dirname, "../renderer/index.html");
}

function flushPendingTrayActions(): void {
  const mainWindow = mainWindowRef;
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoadingMainFrame())
    return;
  while (pendingTrayActions.length > 0) {
    const action = pendingTrayActions.shift();
    if (action) mainWindow.webContents.send("tray:action", action);
  }
}

function showMainWindow(): BrowserWindow | null {
  if (!app.isReady()) return null;
  if (!mainWindowRef || mainWindowRef.isDestroyed()) createWindow();
  const mainWindow = mainWindowRef;
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return mainWindow;
}

function dispatchTrayAction(action: TrayAction): void {
  const mainWindow = showMainWindow();
  if (!mainWindow) return;
  if (mainWindow.webContents.isLoadingMainFrame()) {
    pendingTrayActions.push(action);
    return;
  }
  mainWindow.webContents.send("tray:action", action);
}

function createWindow(): BrowserWindow {
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

  mainWindow.webContents.on("console-message", (_event, level, message, lineNumber, sourceId) => {
    const numericLevel = Number(level);
    if (numericLevel < 2) return;
    recordErrorLog({
      source: "renderer",
      level: numericLevel >= 3 ? "error" : "warning",
      origin: "console",
      message,
      details: { lineNumber, sourceId },
    });
  });

  mainWindow.on("close", (event) => {
    if (process.platform !== "win32" || isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.on("did-finish-load", flushPendingTrayActions);
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

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    void mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void mainWindow.loadFile(getRendererFilePath());
  }

  return mainWindow;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.exit(0);
} else {
  app.on("second-instance", () => {
    if (app.isReady()) void showMainWindow();
    else void app.whenReady().then(() => showMainWindow());
  });

  void app.whenReady().then(async () => {
    process.env.AYAKA_USER_DATA_DIR ??= app.getPath("userData");
    process.env.AYAKA_APP_PATH ??= app.getAppPath();
    process.env.AYAKA_DEV = is.dev ? "1" : "0";
    await initializeErrorLogger().catch(() => undefined);
    electronApp.setAppUserModelId(WINDOWS_APP_ID);
    app.setName("Ayaka");
    removeLegacyCompanionData();

    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    try {
      await initDbWriter();
      await recoverMcpLifecycleStates();
      await recoverMcpDependencyInstallations();
      void startEnabledMcpServers().catch((error) => {
        console.error("[mcp] failed to auto-start enabled servers:", error);
      });
      await migrateProviderApiKeysToModelKeys();
      await initializeBuiltinProviderCatalog();
      await ensureBuiltinCatalogSources();
      scheduleMemoryFileConsolidation();
      startMemoryWorker();
      console.log("[main] database initialized");
    } catch (err) {
      console.log("[main] database initialization failed:", err);
    }

    registerAyakaMediaProtocol();
    protocol.handle("ayaka-artifact", async (request) => {
      try {
        const url = new URL(request.url);
        const artifactId = decodeURIComponent(url.hostname);
        const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
        const resource = await readSandboxArtifactResource(artifactId, relativePath);
        return new Response(resource.body as unknown as BodyInit, {
          headers: {
            "Content-Type": resource.mimeType,
            "Content-Security-Policy":
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; " +
              "base-uri 'none'; form-action 'none'",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (error) {
        return new Response(
          error instanceof Error ? error.message : "Artifact resource unavailable",
          {
            status: 404,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          },
        );
      }
    });

    try {
      const port = await startServer();
      startCronScheduler();
      console.log(`[main] AI server port: ${port}`);
    } catch (err) {
      console.error("[main] AI server startup failed:", err);
    }

    registerIpcHandlers({
      onTrayLabelsChanged: (labels: TrayMenuLabels) => trayController?.setLabels(labels),
    });

    createWindow();
    void refreshBuiltinProviderCatalog().catch(() => undefined);
    if (process.platform === "win32") {
      trayController = createTray(
        dispatchTrayAction,
        () => app.quit(),
        getDefaultTrayMenuLabels(app.getLocale()),
      );
    }
    updateManager.setEmitter((state) => sendUpdateState(mainWindowRef, state));
    updateManager.setInstallGuard(() => !agentLoopSessions.hasActiveSessions());
    updateManager.start();

    ipcMain.on("ping", () => console.log("pong"));

    app.on("activate", () => {
      showMainWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && process.platform !== "win32") app.quit();
  });

  app.on("will-quit", () => {
    trayController?.destroy();
    trayController = null;
  });

  app.on("before-quit", (event) => {
    if (isCleaningUpBeforeQuit) return;
    isQuitting = true;
    event.preventDefault();
    isCleaningUpBeforeQuit = true;
    stopCronScheduler();
    void agentLoopSessions
      .interruptAll()
      .then(() => {
        cancelAllMcpInputs();
        return shutdownMcpLifecycle().then(() => closeAllMcpClients());
      })
      .then(() => closeMcpOAuthLoopback())
      .then(async () => {
        await closeAllSandboxPreviews();
        stopServer();
        await closeDb();
        await flushErrorLogs();
      })
      .finally(() => app.quit());
  });
}
