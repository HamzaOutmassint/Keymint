import { z } from "zod";
import { ApiError, assertSameOrigin, handleApiError, ok, parseJson, requireSession } from "@/server/http";
import { assertRateLimit } from "@/server/rate-limit";
import { revokeUserAccessAfterTwoFactorChange } from "@/server/security/auth-lifecycle";
import { verifyAccountPassword } from "@/server/security/reauthentication";
import { beginTotpEnrollment, completeTotpEnrollment } from "@/server/security/totp";
import { notifySecurityChange } from "@/server/security/security-notifications";

const startSchema = z.object({ password: z.string().min(1).max(128) });
const completeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    const { password } = await parseJson(request, startSchema, 1_024);
    await assertRateLimit(
      `security-password:${session.user.id}`,
      session.user.id,
      5,
      5 * 60,
    );
    if (!(await verifyAccountPassword(session.user.id, password))) {
      throw new ApiError(401, "The login password is incorrect");
    }
    return ok(await beginTotpEnrollment(session.user.id, session.user.email));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    const { code } = await parseJson(request, completeSchema, 1_024);
    const replacing = !!session.user.twoFactorEnabled;
    const status = await completeTotpEnrollment(session.user.id, code);
    if (status === "invalid") throw new ApiError(401, "Enter a valid authentication code");
    if (status === "expired") throw new ApiError(410, "This enrollment expired. Start again.");
    if (status !== "completed") throw new ApiError(409, "This enrollment was already completed or replaced");
    await revokeUserAccessAfterTwoFactorChange(
      session.user.id,
      session.session.token,
    );
    notifySecurityChange(session.user.id, replacing ? "totp-replaced" : "totp-enabled");
    return ok({ status: true });
  } catch (error) {
    return handleApiError(error);
  }
}
