import type { TrayAction, TrayMenuLabels } from "../../shared/types";

export type TrayMenuAction = TrayAction | "quit";

export type TrayMenuItem =
  | { type: "command"; label: string; action: TrayMenuAction }
  | { type: "separator" };

const ZH_TRAY_MENU_LABELS: TrayMenuLabels = {
  settings: "设置",
  openHome: "打开 Ayaka",
  chat: "与 Ayaka 聊天",
  quit: "退出",
};

const EN_TRAY_MENU_LABELS: TrayMenuLabels = {
  settings: "Settings",
  openHome: "Open Ayaka",
  chat: "Chat with Ayaka",
  quit: "Quit",
};

export function getDefaultTrayMenuLabels(locale: string | null | undefined): TrayMenuLabels {
  return (locale ?? "").toLowerCase().startsWith("zh")
    ? { ...ZH_TRAY_MENU_LABELS }
    : { ...EN_TRAY_MENU_LABELS };
}

export function createTrayMenuItems(labels: TrayMenuLabels): TrayMenuItem[] {
  return [
    { type: "command", label: labels.settings, action: "open-settings" },
    { type: "command", label: labels.openHome, action: "open-home" },
    { type: "command", label: labels.chat, action: "new-chat" },
    { type: "separator" },
    { type: "command", label: labels.quit, action: "quit" },
  ];
}
