import { z } from "zod";
import {
  assertSameOrigin,
  ApiError,
  assertVaultProtocolV2,
  handleApiError,
  ok,
  parseJson,
  requireSession,
} from "@/server/http";
import { applyEncryptedRecordMutation, fetchEncryptedRecord } from "@/server/vault-record-storage";

type Context = { params: Promise<{ id: string }> };
const recordIdSchema = z.string().min(1).max(128);
const mutationSchema = z.object({
  mutationId: z.uuid(),
  expectedRevision: z.string().regex(/^[1-9][0-9]*$/),
  envelope: z.unknown(),
}).strict();

async function pathRecordId(params: Context["params"]) {
  const parsed = recordIdSchema.safeParse((await params).id);
  if (!parsed.success) throw new ApiError(400, "Invalid encrypted record ID");
  return parsed.data;
}

/** Fetches one complete opaque envelope for browser-side decryption. */
export async function GET(request: Request, { params }: Context) {
  try {
    assertVaultProtocolV2(request);
    const session = await requireSession(request);
    const recordId = await pathRecordId(params);
    return ok(await fetchEncryptedRecord(session.user.id, recordId));
  } catch (error) {
    return handleApiError(error);
  }
}

/** Replaces one envelope after the browser decrypts, edits, and re-encrypts it. */
export async function PUT(request: Request, { params }: Context) {
  try {
    assertSameOrigin(request);
    assertVaultProtocolV2(request);
    const session = await requireSession(request);
    const recordId = await pathRecordId(params);
    const body = await parseJson(request, mutationSchema, 128 * 1024);
    return ok(await applyEncryptedRecordMutation({
      userId: session.user.id,
      mutationId: body.mutationId,
      records: [{ expectedRevision: body.expectedRevision, envelope: body.envelope }],
      mode: "update",
      pathRecordId: recordId,
    }));
  } catch (error) {
    return handleApiError(error);
  }
}

/** Stores a browser-created encrypted tombstone; the server never constructs deletion plaintext. */
export async function DELETE(request: Request, { params }: Context) {
  try {
    assertSameOrigin(request);
    assertVaultProtocolV2(request);
    const session = await requireSession(request);
    const recordId = await pathRecordId(params);
    const body = await parseJson(request, mutationSchema, 128 * 1024);
    return ok(await applyEncryptedRecordMutation({
      userId: session.user.id,
      mutationId: body.mutationId,
      records: [{ expectedRevision: body.expectedRevision, envelope: body.envelope }],
      mode: "delete",
      pathRecordId: recordId,
    }));
  } catch (error) {
    return handleApiError(error);
  }
}
