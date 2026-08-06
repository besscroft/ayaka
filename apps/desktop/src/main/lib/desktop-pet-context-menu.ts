import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";

/**
 * 桌宠窗口的原生右键菜单。
 *
 * 由于桌宠窗口是 transparent + frame: false 的轻量窗体，
 * 没有自己的标题栏，因此用系统原生菜单承载 "设置 / 关于 / 隐藏 / 退出"。
 *
 * 所有菜单项的点击都通过 IPC 转发到主进程逻辑，
 * 保持单一数据源（不在渲染端重复实现）。
 */
export function showDesktopPetContextMenu(
  win: BrowserWindow,
  options: {
    onOpenMainWindow: () => void;
    onOpenSettings: () => void;
    onOpenAbout: () => void;
    onHide: () => void;
    onQuit: () => void;
    onResetPosition: () => void;
  },
): void {
  const isMac = process.platform === "darwin";
  const items: MenuItemConstructorOptions[] = [
    {
      label: "打开主窗口",
      click: () => options.onOpenMainWindow(),
    },
    {
      label: "设置…",
      click: () => options.onOpenSettings(),
    },
    {
      label: "重置位置",
      click: () => options.onResetPosition(),
    },
    { type: "separator" },
    {
      label: "关于 Paimon",
      click: () => options.onOpenAbout(),
    },
    { type: "separator" },
    {
      label: "隐藏桌宠",
      click: () => options.onHide(),
    },
    // macOS 在应用菜单中有标准的 Quit，这里只在非 macOS 显式提供
    ...(isMac
      ? []
      : [
          {
            label: "退出 Paimon",
            click: () => options.onQuit(),
          },
        ]),
  ];

  try {
    const menu = Menu.buildFromTemplate(items);
    menu.popup({ window: win });
  } catch (err) {
    console.error("[desktop-pet] failed to show context menu:", err);
  }
}
