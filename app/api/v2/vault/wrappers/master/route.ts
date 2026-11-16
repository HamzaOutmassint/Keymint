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
import { replaceMasterWrapper } from "@/server/v2-vault";

const schema = z.object({ masterWrapper: z.unknown() }).strict();

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    assertVaultProtocolV2(request);
    const session = await requireSession(request);
    assertFreshAccountAuthentication(session);
    const body = await parseJson(request, schema, 16_384);
    const masterWrapper = await replaceMasterWrapper(
      session.user.id,
      body.masterWrapper,
    );
    return ok({ masterWrapper });
  } catch (error) {
    return handleApiError(error);
  }
}
