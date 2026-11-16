import { assertRateLimit } from "@/server/rate-limit";
import {
  assertSameOrigin,
  handleApiError,
  ok,
  requireSession,
} from "@/server/http";
import { resendEmailChange } from "@/server/security/email-change";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    await assertRateLimit(
      `email-change-resend:${session.user.id}`,
      session.user.id,
      3,
      60 * 60,
    );
    return ok(await resendEmailChange(session.user.id));
  } catch (error) {
    return handleApiError(error);
  }
}
