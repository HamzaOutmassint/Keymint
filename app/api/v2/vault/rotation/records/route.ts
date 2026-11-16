import { z } from "zod";
import {
  assertSameOrigin,
  assertVaultProtocolV2,
  handleApiError,
  ok,
  parseJson,
  requireSession,
} from "@/server/http";
import { stageVaultKeyRotationRecords } from "@/server/vault-key-rotation";

const schema = z.object({
  rotationId: z.uuid(),
  records: z.array(z.object({
    expectedRevision: z.string().regex(/^[1-9][0-9]*$/),
    envelope: z.unknown(),
  }).strict()).min(1).max(100),
}).strict();

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    assertVaultProtocolV2(request);
    const session = await requireSession(request);
    const body = await parseJson(request, schema, 8 * 1024 * 1024);
    return ok(await stageVaultKeyRotationRecords({ userId: session.user.id, ...body }));
  } catch (error) {
    return handleApiError(error);
  }
}
