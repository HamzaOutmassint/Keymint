import { emailChangeRequestSchema } from "@/features/settings/schemas";
import { assertRateLimit } from "@/server/rate-limit";
import {
  assertSameOrigin,
  handleApiError,
  ok,
  parseJson,
  requireSession,
  ApiError,
} from "@/server/http";
import { verifyAccountPassword } from "@/server/security/reauthentication";
import {
  cancelEmailChange,
  getPendingEmailChange,
  startEmailChange,
} from "@/server/security/email-change";

export async function GET(request: Request) {
  try {
    const session = await requireSession(request);
    return ok(await getPendingEmailChange(session.user.id));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    const body = await parseJson(request, emailChangeRequestSchema, 1_024);
    await assertRateLimit(
      `email-change-start:${session.user.id}`,
      session.user.id,
      3,
      60 * 60,
    );
    await assertRateLimit(
      `security-password:${session.user.id}`,
      session.user.id,
      5,
      5 * 60,
    );
    if (!(await verifyAccountPassword(session.user.id, body.password))) {
      throw new ApiError(401, "The login password is incorrect");
    }
    return ok(
      await startEmailChange({
        request,
        user: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          emailVerified: session.user.emailVerified,
        },
        newEmail: body.newEmail,
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    await assertRateLimit(
      `email-change-cancel:${session.user.id}`,
      session.user.id,
      10,
      60 * 60,
    );
    return ok(await cancelEmailChange(request, session.user.id));
  } catch (error) {
    return handleApiError(error);
  }
}
