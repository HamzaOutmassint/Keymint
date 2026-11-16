import { assertVaultProtocolV2, handleApiError, ok, requireSession } from "@/server/http";
import { getVaultUnlockMaterial } from "@/server/v2-vault";

export async function GET(request: Request) {
  try {
    assertVaultProtocolV2(request);
    const session = await requireSession(request);
    return ok(await getVaultUnlockMaterial(session.user.id));
  } catch (error) {
    return handleApiError(error);
  }
}
