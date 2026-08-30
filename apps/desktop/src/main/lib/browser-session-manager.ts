import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, session, WebContentsView, type DownloadItem } from "electron";
import {
  createBrowserTab,
  deleteBrowserTab,
  getConversationWorkspace,
  listBrowserTabs,
  setBrowserActiveTab,
  updateBrowserTab,
} from "./db";
import {
  getConversationWorkspaceInfo,
  prepareConversationWorkspace,
  resolveWorkspacePath,
} from "./conversation-workspace";
import type {
  BrowserCaptureResult,
  BrowserDownload,
  BrowserElementSnapshot,
  BrowserPageSnapshot,
  BrowserScreenshot,
  BrowserSessionSnapshot,
  BrowserSessionUpdate,
  BrowserTab,
} from "../../shared/types";

const MAX_PAGE_TEXT = 12_000;
const MAX_ELEMENTS = 200;
const MAX_ELEMENT_TEXT = 240;
const MAX_SCREENSHOT_BYTES = 12 * 1024 * 1024;
const MAX_READ_SCREENSHOT_BYTES = 20 * 1024 * 1024;
const MAX_DOWNLOADS = 20;
const BROWSER_SCREENSHOTS_DIR = "browser/screenshots";
const BROWSER_DOWNLOADS_DIR = "browser/downloads";
const DEFAULT_TAB_TITLE = "New tab";
const ALLOWED_INITIAL_URL = "about:blank";

interface BrowserTabHandle {
  meta: BrowserTab;
  view: WebContentsView;
  refs: Set<string>;
  snapshotId: string | null;
}

interface BrowserSessionHandle {
  conversationId: string;
  partition: string;
  browserSession: Electron.Session;
  tabs: Map<string, BrowserTabHandle>;
  activeTabId: string;
  attachedWindow: BrowserWindow | null;
  attachedTabId: string | null;
  latestScreenshot: BrowserScreenshot | null;
  downloads: BrowserDownload[];
}

const sessions = new Map<string, BrowserSessionHandle>();
const sessionPromises = new Map<string, Promise<BrowserSessionHandle>>();
const listeners = new Set<(event: BrowserSessionUpdate) => void>();
const focusListeners = new Set<(event: { conversationId: string; tabId: string }) => void>();

export function onBrowserSessionUpdated(
  listener: (event: BrowserSessionUpdate) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function onBrowserFocusRequested(
  listener: (event: { conversationId: string; tabId: string }) => void,
): () => void {
  focusListeners.add(listener);
  return () => focusListeners.delete(listener);
}

export async function getBrowserSession(conversationId: string): Promise<BrowserSessionSnapshot> {
  return publicSession(await ensureSession(conversationId));
}

export async function focusBrowserSession(conversationId: string): Promise<BrowserSessionSnapshot> {
  const browser = await ensureSession(conversationId);
  if (browser.activeTabId) focusBrowserTab(browser, browser.activeTabId);
  return publicSession(browser);
}

export async function createBrowserSessionTab(
  conversationId: string,
  url = ALLOWED_INITIAL_URL,
): Promise<BrowserSessionSnapshot> {
  const browser = await ensureSession(conversationId);
  const tab = await createTabForSession(browser, normalizeBrowserUrl(url));
  await selectTabForSession(browser, tab.meta.id);
  focusBrowserTab(browser, tab.meta.id);
  emit(browser);
  return publicSession(browser);
}

export async function selectBrowserSessionTab(
  conversationId: string,
  tabId: string,
): Promise<BrowserSessionSnapshot> {
  const browser = await ensureSession(conversationId);
  await selectTabForSession(browser, tabId);
  focusBrowserTab(browser, tabId);
  emit(browser);
  return publicSession(browser);
}

export async function closeBrowserSessionTab(
  conversationId: string,
  tabId: string,
): Promise<BrowserSessionSnapshot> {
  const browser = await ensureSession(conversationId);
  const tab = requireTab(browser, tabId);
  if (browser.tabs.size === 1) {
    await navigateTab(tab, ALLOWED_INITIAL_URL);
    tab.meta.title = DEFAULT_TAB_TITLE;
    tab.meta.loading = 0;
    await persistTab(tab);
  } else {
    detachTabView(browser, tab);
    tab.view.webContents.close();
    browser.tabs.delete(tabId);
    await deleteBrowserTab(tabId, conversationId);
    if (browser.activeTabId === tabId) {
      const replacement = [...browser.tabs.values()].sort(
        (a, b) => a.meta.position - b.meta.position,
      )[0];
      if (!replacement) throw new Error("Browser has no remaining tabs.");
      await selectTabForSession(browser, replacement.meta.id);
    }
    await compactPositions(browser);
  }
  focusBrowserTab(browser, browser.activeTabId);
  emit(browser);
  return publicSession(browser);
}

export async function navigateBrowserTab(input: {
  conversationId: string;
  tabId?: string;
  url?: string;
  action?: "open" | "back" | "forward" | "reload";
}): Promise<BrowserSessionSnapshot> {
  const browser = await ensureSession(input.conversationId);
  const tab = requireTab(browser, input.tabId ?? browser.activeTabId);
  await selectTabForSession(browser, tab.meta.id);
  focusBrowserTab(browser, tab.meta.id);
  switch (input.action ?? "open") {
    case "back":
      if (tab.view.webContents.canGoBack()) tab.view.webContents.goBack();
      break;
    case "forward":
      if (tab.view.webContents.canGoForward()) tab.view.webContents.goForward();
      break;
    case "reload":
      tab.view.webContents.reload();
      break;
    case "open":
      if (!input.url) throw new Error("Browser URL is required.");
      await navigateTab(tab, normalizeBrowserUrl(input.url));
      break;
  }
  focusBrowserTab(browser, tab.meta.id);
  emit(browser);
  return publicSession(browser);
}

export async function snapshotBrowserPage(input: {
  conversationId: string;
  tabId?: string;
}): Promise<BrowserPageSnapshot> {
  const browser = await ensureSession(input.conversationId);
  const tab = requireTab(browser, input.tabId ?? browser.activeTabId);
  await selectTabForSession(browser, tab.meta.id);
  focusBrowserTab(browser, tab.meta.id);
  if (tab.meta.url === ALLOWED_INITIAL_URL) {
    return {
      tabId: tab.meta.id,
      url: tab.meta.url,
      title: tab.meta.title,
      text: "",
      elements: [],
      snapshotId: "blank",
    };
  }
  const snapshotId = randomUUID();
  const token = randomUUID();
  const result = (await tab.view.webContents.executeJavaScript(buildSnapshotScript(token))) as {
    url?: unknown;
    title?: unknown;
    text?: unknown;
    elements?: unknown;
  };
  const elements = normalizeElements(result.elements);
  tab.refs = new Set(elements.map((element) => element.ref));
  tab.snapshotId = snapshotId;
  const page: BrowserPageSnapshot = {
    tabId: tab.meta.id,
    url: normalizeText(result.url) || tab.view.webContents.getURL() || tab.meta.url,
    title: normalizeText(result.title) || tab.meta.title,
    text: truncate(normalizeText(result.text), MAX_PAGE_TEXT),
    elements,
    snapshotId,
  };
  tab.meta.url = page.url;
  tab.meta.title = page.title || DEFAULT_TAB_TITLE;
  await persistTab(tab);
  emit(browser);
  return page;
}

export async function clickBrowserElement(input: {
  conversationId: string;
  tabId?: string;
  ref: string;
}): Promise<BrowserSessionSnapshot> {
  const browser = await ensureSession(input.conversationId);
  const tab = requireTab(browser, input.tabId ?? browser.activeTabId);
  await selectTabForSession(browser, tab.meta.id);
  focusBrowserTab(browser, tab.meta.id);
  requireSnapshotRef(tab, input.ref);
  await tab.view.webContents.executeJavaScript(buildElementActionScript(input.ref, "click"));
  invalidateRefs(tab);
  await waitForPageSettled(tab, 3_000);
  await syncTabMetadata(tab);
  focusBrowserTab(browser, tab.meta.id);
  emit(browser);
  return publicSession(browser);
}

export async function typeBrowserText(input: {
  conversationId: string;
  tabId?: string;
  ref: string;
  text: string;
  submit?: boolean;
}): Promise<BrowserSessionSnapshot> {
  if (typeof input.text !== "string" || input.text.length > 20_000) {
    throw new Error("Browser input text must be a string of at most 20,000 characters.");
  }
  const browser = await ensureSession(input.conversationId);
  const tab = requireTab(browser, input.tabId ?? browser.activeTabId);
  await selectTabForSession(browser, tab.meta.id);
  requireSnapshotRef(tab, input.ref);
  await tab.view.webContents.executeJavaScript(
    buildTypeScript(input.ref, input.text, input.submit === true),
    true,
  );
  invalidateRefs(tab);
  await waitForPageSettled(tab, 3_000);
  await syncTabMetadata(tab);
  focusBrowserTab(browser, tab.meta.id);
  emit(browser);
  return publicSession(browser);
}

export async function pressBrowserKey(input: {
  conversationId: string;
  tabId?: string;
  key: string;
  modifiers?: string[];
}): Promise<BrowserSessionSnapshot> {
  const key = normalizeKey(input.key);
  const modifiers = normalizeModifiers(input.modifiers);
  const browser = await ensureSession(input.conversationId);
  const tab = requireTab(browser, input.tabId ?? browser.activeTabId);
  await selectTabForSession(browser, tab.meta.id);
  focusBrowserTab(browser, tab.meta.id);
  tab.view.webContents.focus();
  tab.view.webContents.sendInputEvent({ type: "rawKeyDown", keyCode: key, modifiers });
  tab.view.webContents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers });
  await waitForPageSettled(tab, 2_000);
  invalidateRefs(tab);
  await syncTabMetadata(tab);
  emit(browser);
  return publicSession(browser);
}

export async function scrollBrowserPage(input: {
  conversationId: string;
  tabId?: string;
  left?: number;
  top?: number;
}): Promise<BrowserSessionSnapshot> {
  const browser = await ensureSession(input.conversationId);
  const tab = requireTab(browser, input.tabId ?? browser.activeTabId);
  await selectTabForSession(browser, tab.meta.id);
  const left = clampNumber(input.left ?? 0, -100_000, 100_000);
  const top = clampNumber(input.top ?? 0, -100_000, 100_000);
  await tab.view.webContents.executeJavaScript(
    `window.scrollBy({ left: ${left}, top: ${top}, behavior: "instant" }); true;`,
    true,
  );
  invalidateRefs(tab);
  focusBrowserTab(browser, tab.meta.id);
  emit(browser);
  return publicSession(browser);
}

export async function waitForBrowserPage(input: {
  conversationId: string;
  tabId?: string;
  milliseconds?: number;
  urlIncludes?: string;
  textIncludes?: string;
  timeoutMs?: number;
}): Promise<BrowserPageSnapshot> {
  const browser = await ensureSession(input.conversationId);
  const tab = requireTab(browser, input.tabId ?? browser.activeTabId);
  await selectTabForSession(browser, tab.meta.id);
  focusBrowserTab(browser, tab.meta.id);
  const timeoutMs = clampNumber(input.timeoutMs ?? 10_000, 100, 30_000);
  const deadline = Date.now() + timeoutMs;
  if (input.milliseconds !== undefined) {
    await delay(clampNumber(input.milliseconds, 0, timeoutMs));
  }
  while (Date.now() < deadline) {
    if (!tab.view.webContents.isLoading()) {
      const url = tab.view.webContents.getURL() || tab.meta.url;
      if (input.urlIncludes && !url.includes(input.urlIncludes)) {
        await delay(100);
        continue;
      }
      if (input.textIncludes) {
        const text = (await tab.view.webContents.executeJavaScript(
          "document.body?.innerText || ''",
        )) as unknown;
        if (!normalizeText(text).includes(input.textIncludes)) {
          await delay(100);
          continue;
        }
      }
      return snapshotBrowserPage({ conversationId: input.conversationId, tabId: tab.meta.id });
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the browser page.");
}

export async function captureBrowserPage(input: {
  conversationId: string;
  tabId?: string;
}): Promise<BrowserCaptureResult> {
  const browser = await ensureSession(input.conversationId);
  const tab = requireTab(browser, input.tabId ?? browser.activeTabId);
  await selectTabForSession(browser, tab.meta.id);
  focusBrowserTab(browser, tab.meta.id);
  const image = await tab.view.webContents.capturePage();
  const data = image.toPNG();
  if (data.byteLength > MAX_SCREENSHOT_BYTES) throw new Error("Browser screenshot is too large.");
  const workspace = await prepareConversationWorkspace(input.conversationId);
  const directory = resolveWorkspacePath(
    workspaceRoot(workspace.conversationId),
    BROWSER_SCREENSHOTS_DIR,
  );
  await mkdir(directory, { recursive: true });
  const filename = `screenshot-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
  const relativePath = `${BROWSER_SCREENSHOTS_DIR}/${filename}`;
  await writeFile(
    resolveWorkspacePath(workspaceRoot(workspace.conversationId), relativePath),
    data,
  );
  const size = image.getSize();
  const screenshot: BrowserScreenshot = {
    id: randomUUID(),
    tabId: tab.meta.id,
    path: relativePath,
    filename,
    mediaType: "image/png",
    width: size.width,
    height: size.height,
    sizeBytes: data.byteLength,
    createdAt: Date.now(),
  };
  browser.latestScreenshot = screenshot;
  emit(browser);
  return { screenshot, data: toArrayBuffer(data) };
}

export async function readBrowserScreenshot(
  conversationId: string,
  relativePath: string,
): Promise<ArrayBuffer> {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  const pathParts = normalizedPath.split("/");
  if (
    !normalizedPath.startsWith(BROWSER_SCREENSHOTS_DIR + "/") ||
    pathParts.some((part) => part === ".." || part === "")
  ) {
    throw new Error("Browser screenshot path is invalid.");
  }
  const workspace = await getConversationWorkspaceInfo(conversationId);
  if (!workspace) throw new Error("Conversation workspace does not exist.");
  const filePath = resolveWorkspacePath(workspaceRoot(workspace.conversationId), relativePath);
  const info = await stat(filePath);
  if (!info.isFile() || info.size > MAX_READ_SCREENSHOT_BYTES) {
    throw new Error("Browser screenshot is unavailable.");
  }
  return toArrayBuffer(await readFile(filePath));
}

export function setBrowserBounds(
  conversationId: string,
  tabId: string,
  window: BrowserWindow,
  bounds: { x: number; y: number; width: number; height: number },
): void {
  const browser = sessions.get(conversationId);
  if (!browser) return;
  const tab = requireTab(browser, tabId);
  if (browser.attachedWindow !== window || browser.attachedTabId !== tabId) {
    if (browser.attachedWindow && browser.attachedTabId) {
      const previous = browser.tabs.get(browser.attachedTabId);
      if (previous) detachTabView(browser, previous);
    }
    window.contentView.addChildView(tab.view);
    browser.attachedWindow = window;
    browser.attachedTabId = tabId;
  }
  tab.view.setBounds({
    x: clampNumber(bounds.x, 0, 100_000),
    y: clampNumber(bounds.y, 0, 100_000),
    width: clampNumber(bounds.width, 1, 100_000),
    height: clampNumber(bounds.height, 1, 100_000),
  });
}

export function setBrowserVisible(conversationId: string, tabId: string, visible: boolean): void {
  const browser = sessions.get(conversationId);
  if (!browser) return;
  const tab = requireTab(browser, tabId);
  tab.view.setVisible(visible && browser.activeTabId === tabId);
}

export async function closeAllBrowserSessions(): Promise<void> {
  await Promise.allSettled(sessionPromises.values());
  for (const browser of sessions.values()) closeBrowserHandle(browser);
  sessions.clear();
  sessionPromises.clear();
}

export async function closeBrowserSession(conversationId: string): Promise<void> {
  const pending = sessionPromises.get(conversationId);
  if (pending) await pending.catch(() => undefined);
  const browser = sessions.get(conversationId);
  if (!browser) return;
  closeBrowserHandle(browser);
  sessions.delete(conversationId);
  sessionPromises.delete(conversationId);
}

export async function deleteBrowserSession(conversationId: string): Promise<void> {
  await closeBrowserSession(conversationId);
  const browserSession = session.fromPartition(browserPartition(conversationId));
  await Promise.all([browserSession.clearStorageData(), browserSession.clearCache()]);
}

async function ensureSession(conversationId: string): Promise<BrowserSessionHandle> {
  if (!conversationId || typeof conversationId !== "string") {
    throw new Error("conversationId is required.");
  }
  const existing = sessions.get(conversationId);
  if (existing) return existing;
  const pending = sessionPromises.get(conversationId);
  if (pending) return pending;
  const promise = createSession(conversationId);
  sessionPromises.set(conversationId, promise);
  try {
    const created = await promise;
    sessions.set(conversationId, created);
    return created;
  } finally {
    sessionPromises.delete(conversationId);
  }
}

async function createSession(conversationId: string): Promise<BrowserSessionHandle> {
  await prepareConversationWorkspace(conversationId);
  const stored = listBrowserTabs(conversationId);
  const storedActiveTabId = stored.find((tab) => tab.active !== 0)?.id ?? null;
  const browser: BrowserSessionHandle = {
    conversationId,
    partition: browserPartition(conversationId),
    browserSession: session.fromPartition(browserPartition(conversationId), { cache: true }),
    tabs: new Map(),
    activeTabId: storedActiveTabId ?? stored[0]?.id ?? "",
    attachedWindow: null,
    attachedTabId: null,
    latestScreenshot: null,
    downloads: [],
  };
  configureBrowserSession(browser);
  if (stored.length === 0) {
    const tab = await createTabForSession(browser, ALLOWED_INITIAL_URL);
    await selectTabForSession(browser, tab.meta.id);
  } else {
    for (const meta of stored) browser.tabs.set(meta.id, createTabHandle(browser, meta));
    if (!storedActiveTabId || !browser.tabs.has(browser.activeTabId)) {
      browser.activeTabId = [...browser.tabs.keys()][0] ?? "";
      if (browser.activeTabId) await setBrowserActiveTab(conversationId, browser.activeTabId);
    }
  }
  return browser;
}

function browserPartition(conversationId: string): string {
  return `persist:ayaka-browser-${createHash("sha256").update(conversationId).digest("hex").slice(0, 24)}`;
}

async function createTabForSession(
  browser: BrowserSessionHandle,
  url: string,
): Promise<BrowserTabHandle> {
  const now = Date.now();
  const meta = await createBrowserTab({
    id: randomUUID(),
    conversation_id: browser.conversationId,
    url,
    title: DEFAULT_TAB_TITLE,
    favicon_url: null,
    position: browser.tabs.size,
    active: 0,
    loading: url !== ALLOWED_INITIAL_URL ? 1 : 0,
    can_go_back: 0,
    can_go_forward: 0,
    updated_at: now,
  });
  const tab = createTabHandle(browser, meta);
  browser.tabs.set(meta.id, tab);
  if (!browser.activeTabId) browser.activeTabId = meta.id;
  return tab;
}

function createTabHandle(browser: BrowserSessionHandle, meta: BrowserTab): BrowserTabHandle {
  const safeUrl =
    meta.url === ALLOWED_INITIAL_URL || isAllowedBrowserUrl(meta.url)
      ? meta.url
      : ALLOWED_INITIAL_URL;
  const view = new WebContentsView({
    webPreferences: {
      partition: browser.partition,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  const tab: BrowserTabHandle = {
    meta: { ...meta, url: safeUrl },
    view,
    refs: new Set(),
    snapshotId: null,
  };
  configureBrowserView(browser, tab);
  void view.webContents.loadURL(safeUrl).catch((error) => {
    tab.meta.loading = 0;
    tab.meta.title = error instanceof Error ? "Navigation failed" : DEFAULT_TAB_TITLE;
    void persistTab(tab);
    emit(browser);
  });
  return tab;
}

function configureBrowserSession(browser: BrowserSessionHandle): void {
  browser.browserSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  browser.browserSession.on("will-download", (_event, item, webContents) => {
    const tab = [...browser.tabs.values()].find(
      (candidate) => candidate.view.webContents === webContents,
    );
    if (!tab) return;
    void prepareDownload(browser, tab, item);
  });
}

function configureBrowserView(browser: BrowserSessionHandle, tab: BrowserTabHandle): void {
  const contents = tab.view.webContents;
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedBrowserUrl(url)) void createBrowserSessionTab(browser.conversationId, url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (!isAllowedBrowserUrl(url)) event.preventDefault();
    else tab.meta.loading = 1;
    invalidateRefs(tab);
    emit(browser);
  });
  contents.on("will-redirect", (event, url) => {
    if (!isAllowedBrowserUrl(url)) event.preventDefault();
  });
  contents.on("did-start-loading", () => {
    tab.meta.loading = 1;
    invalidateRefs(tab);
    emit(browser);
  });
  contents.on("did-stop-loading", () => {
    tab.meta.loading = 0;
    void syncTabMetadata(tab).then(() => emit(browser));
  });
  contents.on("did-navigate", (_event, url) => {
    if (isAllowedBrowserUrl(url)) {
      tab.meta.url = url;
      invalidateRefs(tab);
      void persistTab(tab);
      emit(browser);
    }
  });
  contents.on("did-navigate-in-page", (_event, url) => {
    if (isAllowedBrowserUrl(url)) {
      tab.meta.url = url;
      invalidateRefs(tab);
      void persistTab(tab);
      emit(browser);
    }
  });
  contents.on("page-title-updated", (event, title) => {
    event.preventDefault();
    tab.meta.title = truncate(title, 160) || DEFAULT_TAB_TITLE;
    void persistTab(tab);
    emit(browser);
  });
  contents.on("page-favicon-updated", (_event, favicons) => {
    tab.meta.favicon_url = favicons.find((url) => isAllowedBrowserUrl(url)) ?? null;
    void persistTab(tab);
    emit(browser);
  });
  contents.on(
    "did-fail-load",
    (_event, _errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      tab.meta.loading = 0;
      tab.meta.title = truncate(errorDescription, 160) || "Navigation failed";
      invalidateRefs(tab);
      void persistTab(tab);
      emit(browser);
    },
  );
}

async function selectTabForSession(browser: BrowserSessionHandle, tabId: string): Promise<void> {
  const tab = requireTab(browser, tabId);
  browser.activeTabId = tabId;
  for (const candidate of browser.tabs.values()) candidate.meta.active = candidate === tab ? 1 : 0;
  await setBrowserActiveTab(browser.conversationId, tabId);
  for (const candidate of browser.tabs.values()) {
    candidate.view.setVisible(candidate.meta.id === tabId && browser.attachedTabId === tabId);
  }
}

function focusBrowserTab(browser: BrowserSessionHandle, tabId: string): void {
  browser.activeTabId = tabId;
  for (const listener of focusListeners)
    listener({ conversationId: browser.conversationId, tabId });
}

function requireTab(browser: BrowserSessionHandle, tabId: string): BrowserTabHandle {
  const tab = browser.tabs.get(tabId);
  if (!tab) throw new Error("Browser tab was not found.");
  return tab;
}

function requireSnapshotRef(tab: BrowserTabHandle, ref: string): void {
  if (!/^e\d+$/.test(ref) || !tab.refs.has(ref)) {
    throw new Error("Browser element reference is stale. Take a fresh browser_snapshot first.");
  }
}

function invalidateRefs(tab: BrowserTabHandle): void {
  tab.refs.clear();
  tab.snapshotId = null;
}

async function syncTabMetadata(tab: BrowserTabHandle): Promise<void> {
  if (tab.view.webContents.isDestroyed()) return;
  tab.meta.url = tab.view.webContents.getURL() || tab.meta.url;
  tab.meta.title =
    truncate(tab.view.webContents.getTitle(), 160) || tab.meta.title || DEFAULT_TAB_TITLE;
  tab.meta.loading = tab.view.webContents.isLoading() ? 1 : 0;
  tab.meta.can_go_back = tab.view.webContents.canGoBack() ? 1 : 0;
  tab.meta.can_go_forward = tab.view.webContents.canGoForward() ? 1 : 0;
  await persistTab(tab);
}

async function persistTab(tab: BrowserTabHandle): Promise<void> {
  tab.meta.updated_at = Date.now();
  await updateBrowserTab(tab.meta.id, {
    url: tab.meta.url,
    title: tab.meta.title,
    favicon_url: tab.meta.favicon_url,
    position: tab.meta.position,
    active: tab.meta.active,
    loading: tab.meta.loading,
    can_go_back: tab.meta.can_go_back,
    can_go_forward: tab.meta.can_go_forward,
    updated_at: tab.meta.updated_at,
  }).catch(() => undefined);
}

async function compactPositions(browser: BrowserSessionHandle): Promise<void> {
  const tabs = [...browser.tabs.values()].sort((a, b) => a.meta.position - b.meta.position);
  await Promise.all(
    tabs.map((tab, index) => {
      tab.meta.position = index;
      return persistTab(tab);
    }),
  );
}

function detachTabView(browser: BrowserSessionHandle, tab: BrowserTabHandle): void {
  if (
    browser.attachedWindow &&
    browser.attachedTabId === tab.meta.id &&
    !browser.attachedWindow.isDestroyed()
  ) {
    browser.attachedWindow.contentView.removeChildView(tab.view);
    browser.attachedWindow = null;
    browser.attachedTabId = null;
  }
  tab.view.setVisible(false);
}

function closeBrowserHandle(browser: BrowserSessionHandle): void {
  for (const tab of browser.tabs.values()) {
    detachTabView(browser, tab);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  }
}

async function navigateTab(tab: BrowserTabHandle, url: string): Promise<void> {
  invalidateRefs(tab);
  tab.meta.loading = 1;
  tab.meta.url = url;
  await tab.view.webContents.loadURL(url);
  await syncTabMetadata(tab);
}

async function waitForPageSettled(tab: BrowserTabHandle, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (tab.view.webContents.isLoading() && Date.now() < deadline) await delay(50);
}

async function prepareDownload(
  browser: BrowserSessionHandle,
  tab: BrowserTabHandle,
  item: DownloadItem,
): Promise<void> {
  try {
    const workspace = await prepareConversationWorkspace(browser.conversationId);
    const root = workspaceRoot(workspace.conversationId);
    const directory = resolveWorkspacePath(root, BROWSER_DOWNLOADS_DIR);
    await mkdir(directory, { recursive: true });
    const filename = uniqueDownloadFilename(directory, item.getFilename() || "download");
    const relativePath = `${BROWSER_DOWNLOADS_DIR}/${filename}`;
    item.setSavePath(resolveWorkspacePath(root, relativePath));
    const download: BrowserDownload = {
      id: randomUUID(),
      tabId: tab.meta.id,
      filename,
      path: relativePath,
      url: item.getURL(),
      sizeBytes: item.getTotalBytes() > 0 ? item.getTotalBytes() : null,
      status: "progressing",
      createdAt: Date.now(),
    };
    browser.downloads = [download, ...browser.downloads].slice(0, MAX_DOWNLOADS);
    emit(browser);
    item.on("updated", () => {
      download.sizeBytes = item.getTotalBytes() > 0 ? item.getTotalBytes() : download.sizeBytes;
      download.status = item.getState() as BrowserDownload["status"];
      emit(browser);
    });
    item.once("done", (_event, state) => {
      download.sizeBytes =
        item.getReceivedBytes() > 0 ? item.getReceivedBytes() : download.sizeBytes;
      download.status = state as BrowserDownload["status"];
      emit(browser);
    });
  } catch {
    item.cancel();
  }
}

function publicSession(browser: BrowserSessionHandle): BrowserSessionSnapshot {
  const tabs = [...browser.tabs.values()]
    .sort((a, b) => a.meta.position - b.meta.position)
    .map((tab) => ({ ...tab.meta, active: tab.meta.id === browser.activeTabId ? 1 : 0 }));
  return {
    conversationId: browser.conversationId,
    tabs,
    activeTabId: browser.activeTabId || null,
    latestScreenshot: browser.latestScreenshot ? { ...browser.latestScreenshot } : null,
    downloads: browser.downloads.map((download) => ({ ...download })),
  };
}

function emit(browser: BrowserSessionHandle): void {
  const event = { conversationId: browser.conversationId, session: publicSession(browser) };
  for (const listener of listeners) listener(event);
}

function buildSnapshotScript(token: string): string {
  return `(() => {
    const token = ${JSON.stringify(token)};
    const max = ${MAX_ELEMENTS};
    const trim = (value, length) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, length);
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const candidates = [...document.querySelectorAll('a,button,input,textarea,select,summary,[role="button"],[role="link"],[contenteditable="true"],[tabindex]')];
    const elements = [];
    let index = 0;
    for (const element of candidates) {
      if (index >= max || !visible(element)) continue;
      const ref = 'e' + (++index);
      element.setAttribute('data-ayaka-browser-ref', ref);
      const label = element.getAttribute('aria-label') || element.getAttribute('name') || element.getAttribute('placeholder') || '';
      const text = trim(element.innerText || element.textContent || '', ${MAX_ELEMENT_TEXT});
      elements.push({
        ref,
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role') || undefined,
        name: trim(label, ${MAX_ELEMENT_TEXT}) || undefined,
        text: text || undefined,
        value: 'value' in element && !(element instanceof HTMLInputElement && element.type === 'password')
          ? trim(element.value, ${MAX_ELEMENT_TEXT})
          : undefined,
        placeholder: trim(element.getAttribute('placeholder'), ${MAX_ELEMENT_TEXT}) || undefined,
        href: element instanceof HTMLAnchorElement ? element.href : undefined,
        type: element instanceof HTMLInputElement ? element.type : undefined,
        checked: element instanceof HTMLInputElement ? element.checked : undefined,
        disabled: 'disabled' in element ? Boolean(element.disabled) : undefined,
      });
    }
    return {
      url: location.href,
      title: document.title,
      text: trim(document.body?.innerText || '', ${MAX_PAGE_TEXT}),
      elements,
      token,
    };
  })()`;
}

function buildElementActionScript(ref: string, action: "click"): string {
  return `(() => {
    const element = document.querySelector('[data-ayaka-browser-ref=' + ${JSON.stringify(JSON.stringify(ref))} + ']');
    if (!element) throw new Error('Browser element reference is no longer available.');
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus();
    if (${JSON.stringify(action)} === 'click') element.click();
    return true;
  })()`;
}

function buildTypeScript(ref: string, text: string, submit: boolean): string {
  return `(() => {
    const element = document.querySelector('[data-ayaka-browser-ref=' + ${JSON.stringify(JSON.stringify(ref))} + ']');
    if (!element) throw new Error('Browser element reference is no longer available.');
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus();
    const value = ${JSON.stringify(text)};
    if (element.isContentEditable) {
      element.textContent = value;
    } else {
      const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (!setter) throw new Error('Element does not accept text input.');
      setter.call(element, value);
    }
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    if (${submit ? "true" : "false"}) {
      const form = element.closest('form');
      if (form instanceof HTMLFormElement) form.requestSubmit();
    }
    return true;
  })()`;
}

function normalizeElements(value: unknown): BrowserElementSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_ELEMENTS)
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      ref: normalizeText(item.ref),
      tag: normalizeText(item.tag),
      ...(normalizeText(item.role) ? { role: normalizeText(item.role) } : {}),
      ...(normalizeText(item.name)
        ? { name: truncate(normalizeText(item.name), MAX_ELEMENT_TEXT) }
        : {}),
      ...(normalizeText(item.text)
        ? { text: truncate(normalizeText(item.text), MAX_ELEMENT_TEXT) }
        : {}),
      ...(normalizeText(item.value)
        ? { value: truncate(normalizeText(item.value), MAX_ELEMENT_TEXT) }
        : {}),
      ...(normalizeText(item.placeholder)
        ? { placeholder: truncate(normalizeText(item.placeholder), MAX_ELEMENT_TEXT) }
        : {}),
      ...(normalizeText(item.href) && isAllowedBrowserUrl(normalizeText(item.href))
        ? { href: normalizeText(item.href) }
        : {}),
      ...(normalizeText(item.type) ? { type: normalizeText(item.type) } : {}),
      ...(typeof item.checked === "boolean" ? { checked: item.checked } : {}),
      ...(typeof item.disabled === "boolean" ? { disabled: item.disabled } : {}),
    }))
    .filter((item) => /^e\d+$/.test(item.ref) && item.tag.length > 0);
}

function normalizeBrowserUrl(value: string): string {
  const url = String(value || "").trim();
  if (url === ALLOWED_INITIAL_URL) return url;
  if (!isAllowedBrowserUrl(url)) throw new Error("Browser navigation only supports HTTP(S) URLs.");
  return url;
}

function isAllowedBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function workspaceRoot(conversationId: string): string {
  const workspace = getConversationWorkspace(conversationId);
  if (!workspace) throw new Error("Conversation workspace does not exist.");
  return workspace.root_path;
}

function uniqueDownloadFilename(directory: string, rawFilename: string): string {
  let basename =
    [...path.basename(rawFilename)]
      .map((character) =>
        character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? "_" : character,
      )
      .join("")
      .trim() || "download";
  if (basename === "." || basename === "..") basename = "download";
  const extension = path.extname(basename);
  const stem = path.basename(basename, extension);
  let candidate = basename;
  let index = 1;
  while (fileExists(path.join(directory, candidate))) candidate = `${stem}-${index++}${extension}`;
  return candidate;
}

function fileExists(value: string): boolean {
  return existsSync(value);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : value.slice(0, Math.max(0, length - 3)) + "...";
}

function clampNumber(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : 0;
}

function normalizeKey(value: string): string {
  const key = String(value || "").trim();
  if (!/^[A-Za-z0-9 _\-+.]+$/.test(key) || key.length > 40)
    throw new Error("Browser key is invalid.");
  return key.toUpperCase();
}

function normalizeModifiers(
  value: string[] | undefined,
): Array<"shift" | "control" | "alt" | "meta"> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((modifier): Array<"shift" | "control" | "alt" | "meta"> => {
    switch (modifier.toLowerCase()) {
      case "shift":
        return ["shift"];
      case "control":
      case "ctrl":
        return ["control"];
      case "alt":
        return ["alt"];
      case "meta":
      case "command":
      case "cmd":
        return ["meta"];
      default:
        return [];
    }
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}
