import { z } from "zod";
import { assertSameOrigin, assertVaultProtocolV2, handleApiError, ok, parseJson, requireSession } from "@/server/http";
import { applyEncryptedRecordMutation } from "@/server/vault-record-storage";

const schema = z.object({
  mutationId: z.uuid(),
  records: z.array(z.object({ expectedRevision: z.string().regex(/^(0|[1-9][0-9]*)$/).nullable(), envelope: z.unknown() }).strict()).min(1).max(100),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertVaultProtocolV2(request);
    const session = await requireSession(request);
    const body = await parseJson(request, schema, 8 * 1024 * 1024);
    const stored = await applyEncryptedRecordMutation({
      userId: session.user.id,
      mutationId: body.mutationId,
      records: body.records,
      mode: "batch",
    });
    return ok(stored);
  } catch (error) {
    return handleApiError(error);
  }
}
