import { api } from "@/components/ui";

export type ClientActivityAction =
  | "PASSWORD_VIEWED"
  | "PASSWORD_COPIED"
  | "PASSWORD_CREATED"
  | "PASSWORD_EDITED"
  | "PASSWORD_DELETED"
  | "CATEGORY_CREATED"
  | "CATEGORY_DELETED"
  | "SETTINGS_CHANGED"
  | "VAULT_EXPORTED"
  | "VAULT_IMPORTED";

/** Activity telemetry must never make the completed user action fail. */
export async function logClientActivity(action: ClientActivityAction) {
  await api("/api/logs/event", {
    method: "POST",
    body: JSON.stringify({ action }),
  }).catch(() => undefined);
}
