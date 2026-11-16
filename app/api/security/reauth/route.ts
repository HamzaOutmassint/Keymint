import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiError, assertSameOrigin, handleApiError, ok, parseJson, requireSession } from "@/server/http";
import { assertRateLimit } from "@/server/rate-limit";
import { verifyAccountPassword } from "@/server/security/reauthentication";

const schema = z.object({ password: z.string().min(1).max(128) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    const { password } = await parseJson(request, schema, 1_024);
    await assertRateLimit(
      `security-password:${session.user.id}`,
      session.user.id,
      5,
      5 * 60,
    );
    if (!(await verifyAccountPassword(session.user.id, password))) {
      throw new ApiError(401, "The login password is incorrect");
    }
    await prisma.session.update({
      where: { token: session.session.token },
      data: { createdAt: new Date() },
    });
    return ok({ reauthenticated: true });
  } catch (error) {
    return handleApiError(error);
  }
}
