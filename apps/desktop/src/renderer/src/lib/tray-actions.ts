import type { TrayAction } from "@shared/types";

export interface TrayActionHandlers {
  openSettings: () => void;
  openHome: () => void;
  newChat: () => void;
}

export function handleTrayAction(action: TrayAction, handlers: TrayActionHandlers): void {
  if (action === "open-settings") {
    handlers.openSettings();
    return;
  }

  handlers.openHome();
  if (action === "new-chat") handlers.newChat();
}
