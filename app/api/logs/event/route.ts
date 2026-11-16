import { z } from "zod";
import { logActivity } from "@/server/activity";
import { assertRateLimit } from "@/server/rate-limit";
import {
  assertSameOrigin,
  handleApiError,
  ok,
  parseJson,
  requireSession,
} from "@/server/http";

const eventSchema = z.object({
  action: z.enum([
    "LOGIN", "LOGOUT", "PASSWORD_VIEWED", "PASSWORD_COPIED",
    "PASSWORD_CREATED", "PASSWORD_EDITED", "PASSWORD_DELETED",
    "CATEGORY_CREATED", "CATEGORY_DELETED", "SETTINGS_CHANGED",
    "VAULT_EXPORTED", "VAULT_IMPORTED",
  ]),
}).strict();
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    await assertRateLimit(`activity-event:${session.user.id}`, session.user.id, 10, 60);
    const body = await parseJson(request, eventSchema);
    await logActivity(request, session.user.id, body.action);
    return ok({ logged: true });
  } catch (error) {
    return handleApiError(error);
  }
}
