import { z } from "zod";
import {
  assertFreshAccountAuthentication,
  assertSameOrigin,
  assertVaultProtocolV2,
  handleApiError,
  ok,
  parseJson,
  requireSession,
} from "@/server/http";
import { commitVaultKeyRotation } from "@/server/vault-key-rotation";

const schema = z.object({ rotationId: z.uuid() }).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertVaultProtocolV2(request);
    const session = await requireSession(request);
    assertFreshAccountAuthentication(session);
    const { rotationId } = await parseJson(request, schema, 1_024);
    return ok(await commitVaultKeyRotation(session.user.id, rotationId));
  } catch (error) {
    return handleApiError(error);
  }
}
