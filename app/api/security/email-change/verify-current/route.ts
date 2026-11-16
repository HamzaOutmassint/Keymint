import { emailChangeTokenSchema } from "@/features/settings/schemas";
import {
  assertSameOrigin,
  handleApiError,
  ok,
  parseJson,
} from "@/server/http";
import { verifyCurrentEmailChange } from "@/server/security/email-change";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { token } = await parseJson(request, emailChangeTokenSchema, 1_024);
    return ok(await verifyCurrentEmailChange(token));
  } catch (error) {
    return handleApiError(error);
  }
}
