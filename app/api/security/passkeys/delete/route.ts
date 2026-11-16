import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  ApiError,
  assertSameOrigin,
  handleApiError,
  ok,
  parseJson,
  requireSession,
} from "@/server/http";
import { assertRateLimit } from "@/server/rate-limit";
import { verifyAccountPassword } from "@/server/security/reauthentication";
import { notifySecurityChange } from "@/server/security/security-notifications";

const schema = z.object({
  id: z.string().min(1).max(128),
  password: z.string().min(1).max(128),
}).strict();

/** Removes an owned passkey only after password confirmation. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    const body = await parseJson(request, schema, 2_048);
    await assertRateLimit(
      `security-password:${session.user.id}`,
      session.user.id,
      5,
      5 * 60,
    );
    if (!(await verifyAccountPassword(session.user.id, body.password))) {
      throw new ApiError(401, "The login password is incorrect");
    }

    await prisma.$transaction(async (transaction) => {
      const deleted = await transaction.passkey.deleteMany({
        where: { id: body.id, userId: session.user.id },
      });
      if (deleted.count !== 1) throw new ApiError(404, "Passkey not found");
      await transaction.session.deleteMany({
        where: {
          userId: session.user.id,
          token: { not: session.session.token },
        },
      });
      await transaction.verification.deleteMany({
        where: { value: session.user.id },
      });
    });

    notifySecurityChange(session.user.id, "passkey-removed");
    return ok({ removed: true });
  } catch (error) {
    return handleApiError(error);
  }
}
