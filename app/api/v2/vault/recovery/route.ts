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
import {
  getVaultRecoveryMaterial,
  replaceRecoveryWrappers,
} from "@/server/v2-vault";

const recoverySchema = z
  .object({ masterWrapper: z.unknown(), recoveryWrapper: z.unknown() })
  .strict();

export async function GET(request: Request) {
  try {
    assertVaultProtocolV2(request);
    const session = await requireSession(request);
    return ok(await getVaultRecoveryMaterial(session.user.id));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    assertVaultProtocolV2(request);
    const session = await requireSession(request);
    assertFreshAccountAuthentication(session);
    const body = await parseJson(request, recoverySchema, 32_768);
    return ok(await replaceRecoveryWrappers(
      session.user.id,
      body.masterWrapper,
      body.recoveryWrapper,
    ));
  } catch (error) {
    return handleApiError(error);
  }
}
