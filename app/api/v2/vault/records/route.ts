import { z } from "zod";
import {
  assertSameOrigin,
  assertVaultProtocolV2,
  handleApiError,
  ok,
  parseJson,
  requireSession,
} from "@/server/http";
import { applyEncryptedRecordMutation } from "@/server/vault-record-storage";

const createSchema = z.object({ mutationId: z.uuid(), envelope: z.unknown() }).strict();

/** Stores one browser-encrypted active record. No vault plaintext is accepted. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertVaultProtocolV2(request);
    const session = await requireSession(request);
    const body = await parseJson(request, createSchema, 128 * 1024);
    return ok(await applyEncryptedRecordMutation({
      userId: session.user.id,
      mutationId: body.mutationId,
      records: [{ expectedRevision: null, envelope: body.envelope }],
      mode: "create",
    }), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
