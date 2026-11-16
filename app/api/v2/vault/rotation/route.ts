import { z } from "zod";
import {
  ApiError,
  assertFreshAccountAuthentication,
  assertSameOrigin,
  assertVaultProtocolV2,
  handleApiError,
  ok,
  parseJson,
  requireSession,
} from "@/server/http";
import {
  abortVaultKeyRotation,
  beginVaultKeyRotation,
  getVaultKeyRotation,
} from "@/server/vault-key-rotation";

const beginSchema = z.object({
  rotationId: z.uuid(),
  masterWrapper: z.unknown(),
  recoveryWrapper: z.unknown(),
}).strict();

export async function GET(request: Request) {
  try {
    assertVaultProtocolV2(request);
    const session = await requireSession(request);
    return ok(await getVaultKeyRotation(session.user.id));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertVaultProtocolV2(request);
    const session = await requireSession(request);
    assertFreshAccountAuthentication(session);
    const body = await parseJson(request, beginSchema, 32_768);
    return ok(await beginVaultKeyRotation({ userId: session.user.id, ...body }), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    assertVaultProtocolV2(request);
    const session = await requireSession(request);
    const rotationId = new URL(request.url).searchParams.get("rotationId");
    if (!rotationId || !z.uuid().safeParse(rotationId).success) throw new ApiError(400, "Invalid rotation ID");
    const current = await getVaultKeyRotation(session.user.id);
    if (current && current.rotationId !== rotationId) throw new ApiError(404, "Vault Key rotation was not found");
    return ok(await abortVaultKeyRotation(session.user.id));
  } catch (error) {
    return handleApiError(error);
  }
}
