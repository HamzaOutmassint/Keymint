import { z } from "zod";
import { ApiError, assertVaultProtocolV2, handleApiError, ok, requireSession } from "@/server/http";
import { syncEncryptedRecords } from "@/server/vault-record-storage";

const cursorSchema = z.coerce.number().int().min(0).default(0);

export async function GET(request: Request) {
  try {
    assertVaultProtocolV2(request);
    const session = await requireSession(request);
    const parsed = cursorSchema.safeParse(new URL(request.url).searchParams.get("cursor") ?? "0");
    if (!parsed.success) throw new ApiError(400, "Invalid synchronization cursor");
    return ok(await syncEncryptedRecords(session.user.id, parsed.data));
  } catch (error) {
    return handleApiError(error);
  }
}
