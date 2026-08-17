import { Menu, Tray } from "electron";
import icon from "../../../resources/icon.png?asset";
import type { TrayAction, TrayMenuLabels } from "../../shared/types";
import { createTrayMenuItems, type TrayMenuAction } from "./tray-menu";

export interface TrayController {
  setLabels: (labels: TrayMenuLabels) => void;
  destroy: () => void;
}

export function createTray(
  onAction: (action: TrayAction) => void,
  onQuit: () => void,
  initialLabels: TrayMenuLabels,
): TrayController {
  const tray = new Tray(icon);
  let labels = initialLabels;
  let destroyed = false;

  const rebuildContextMenu = (): void => {
    if (destroyed) return;
    const menu = Menu.buildFromTemplate(
      createTrayMenuItems(labels).map((item) => {
        if (item.type === "separator") return { type: "separator" as const };
        return {
          label: item.label,
          click: () => {
            const action: TrayMenuAction = item.action;
            if (action === "quit") onQuit();
            else onAction(action);
          },
        };
      }),
    );
    tray.setContextMenu(menu);
  };

  tray.setToolTip("Ayaka");
  tray.on("click", () => onAction("open-home"));
  rebuildContextMenu();

  return {
    setLabels(nextLabels) {
      labels = nextLabels;
      rebuildContextMenu();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      tray.destroy();
    },
  };
}
