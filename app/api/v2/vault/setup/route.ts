import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  ApiError,
  assertSameOrigin,
  assertVaultProtocolV2,
  handleApiError,
  ok,
  parseJson,
  requireSession,
} from "@/server/http";
import { validateSubmittedWrapper, wrapperCreateData } from "@/server/v2-vault";

const setupSchema = z
  .object({ masterWrapper: z.unknown(), recoveryWrapper: z.unknown() })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertVaultProtocolV2(request);
    const session = await requireSession(request);
    if (await prisma.vault.findUnique({ where: { userId: session.user.id }, select: { id: true } })) {
      throw new ApiError(409, "Vault is already configured");
    }
    const body = await parseJson(request, setupSchema, 16_384);
    const master = validateSubmittedWrapper(body.masterWrapper, session.user.id, "master");
    const recovery = validateSubmittedWrapper(
      body.recoveryWrapper,
      session.user.id,
      "recovery",
      master.protected.vaultId,
    );
    await prisma.$transaction([
      prisma.vault.create({
        data: {
          id: master.protected.vaultId,
          userId: session.user.id,
          protocolVersion: 2,
          currentKeyVersion: 1,
        },
      }),
      prisma.vaultKeyEnvelope.createMany({
        data: [wrapperCreateData(master), wrapperCreateData(recovery)],
      }),
    ]);
    return ok({ configured: true, protocolVersion: 2 }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
