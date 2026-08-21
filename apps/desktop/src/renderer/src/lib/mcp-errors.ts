import type { AppLanguage } from "@shared/types";
import { getErrorMessage } from "./errors";
import { translate } from "./i18n";

/** Keep MCP runtime failures actionable without exposing raw Node spawn errors. */
export function getMcpErrorMessage(error: unknown, locale: AppLanguage): string {
  const raw = unwrapIpcError(getErrorMessage(error, locale));
  const missingCommand = raw.match(/^MCP command "([^"]+)" was not found\.(.*)$/s);
  if (missingCommand) {
    const translated = translate(locale, "tools.mcp.error.commandNotFound", {
      command: missingCommand[1],
    });
    const detail = missingCommand[2].trim();
    return detail ? `${translated} ${detail}` : translated;
  }

  const connectionClosed = raw.match(/^Connection closed\b([\s\S]*)$/i);
  if (connectionClosed) {
    const translated = translate(locale, "tools.mcp.error.connectionClosed");
    const detail = connectionClosed[1].trim();
    return detail ? `${translated} ${detail}` : translated;
  }
  return raw;
}

function unwrapIpcError(message: string): string {
  const match = message.match(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?([\s\S]*)$/i);
  return match?.[1]?.trim() || message;
}
