import { prisma } from "@/lib/prisma";
import { profileSchema } from "@/features/settings/schemas";
import {
  assertSameOrigin,
  handleApiError,
  ok,
  parseJson,
  requireSession,
} from "@/server/http";

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(request);
    const body = await parseJson(request, profileSchema);
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        name: body.name,
        image: body.image || null,
      },
      select: { id: true, name: true, email: true, image: true },
    });
    return ok(user);
  } catch (error) {
    return handleApiError(error);
  }
}
