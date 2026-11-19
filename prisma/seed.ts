import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../server/security/password-hashing";
import { assertDemoSeedAllowed } from "../lib/demo-seed-policy";
import { VaultCryptoRuntime } from "../features/vault/crypto-runtime";
import { recordCreateData, wrapperCreateData } from "../server/v2-vault";

// Development-only demo credentials. They are public; never reuse them anywhere.
const DEMO_EMAIL = "demo@example.com";
const DEMO_NAME = "Demo User";
const LOGIN_PASSWORD = "DemoLoginPass!2026";
const MASTER_PASSWORD = "DemoMasterPass!2026";

async function main() {
  assertDemoSeedAllowed();
  const now = new Date();
  const nowIso = now.toISOString();

  const { id: userId } = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    create: {
      id: "keymint-demo-user",
      name: DEMO_NAME,
      email: DEMO_EMAIL,
      emailVerified: true,
    },
    update: { emailVerified: true, name: DEMO_NAME },
  });
  const password = await hashPassword(LOGIN_PASSWORD);
  await prisma.account.upsert({
    where: {
      providerId_accountId: { providerId: "credential", accountId: userId },
    },
    create: {
      id: randomUUID(),
      providerId: "credential",
      accountId: userId,
      userId,
      password,
    },
    update: { password },
  });

  const runtime = new VaultCryptoRuntime();
  const vaultId = randomUUID();
  try {
    const pending = await runtime.beginSetup({
      ownerId: userId,
      vaultId,
      masterPassword: MASTER_PASSWORD,
    });
    const wrappers = await runtime.confirmSetup(pending.recoveryKey);
    const categories = [
      { id: randomUUID(), name: "Personal", color: "#FF8A00" },
      { id: randomUUID(), name: "Work", color: "#3B82F6" },
      { id: randomUUID(), name: "Shopping", color: "#A855F7" },
      { id: randomUUID(), name: "Banking", color: "#0D8B53" },
    ];
    const categoryIds = new Map(categories.map((item) => [item.name, item.id]));
    const records = [];
    for (const category of categories) {
      records.push((await runtime.encryptRecord({
        id: category.id,
        type: "category",
        now: nowIso,
        value: { name: category.name, color: category.color, icon: "folder", pinned: false },
      })).envelope);
    }
    const credentials = [
      {
        name: "Personal Email",
        username: "demo@example.com",
        website: "https://mail.example.com",
        password: "M4il-Demo!9384",
        category: "Personal",
        favorite: true,
      },
      {
        name: "Slack Workspace",
        username: "dev-team",
        website: "https://slack.com",
        password: "Sl4ck-Demo!881",
        category: "Work",
        favorite: true,
        recoveryCodes: ["demo1-a1b2c", "demo2-d3e4f", "demo3-g5h6i", "demo4-j7k8l", "demo5-m9n0p"],
      },
      {
        name: "Bank Portal",
        username: "user_id_908",
        website: "https://example-bank.test",
        password: "B4nk-Demo!572",
        category: "Banking",
        favorite: false,
      },
    ];
    for (const [index, credential] of credentials.entries()) {
      records.push((await runtime.encryptRecord({
        type: "credential",
        now: nowIso,
        value: {
          categoryId: categoryIds.get(credential.category) ?? null,
          email: "",
          favorite: credential.favorite,
          lastViewedAt: new Date(now.getTime() - index * 3_600_000).toISOString(),
          name: credential.name,
          notes: "",
          password: credential.password,
          passwordUpdatedAt: nowIso,
          username: credential.username,
          website: credential.website,
          ...(credential.recoveryCodes
            ? { recoveryCodes: { codes: credential.recoveryCodes.map((code) => ({ code, usedAt: null })), updatedAt: nowIso } }
            : {}),
        },
      })).envelope);
    }

    await prisma.$transaction([
      prisma.vault.deleteMany({ where: { userId } }),
      prisma.vault.create({
        data: { id: vaultId, userId, protocolVersion: 2, currentKeyVersion: 1, syncSequence: 1 },
      }),
      prisma.vaultKeyEnvelope.createMany({
        data: [
          wrapperCreateData(wrappers.masterWrapper),
          wrapperCreateData(wrappers.recoveryWrapper),
        ],
      }),
      prisma.vaultRecord.createMany({
        data: records.map((record) => ({ ...recordCreateData(record), syncSequence: 1 })),
      }),
    ]);
  } finally {
    runtime.lock();
  }

  if (!(await prisma.activityLog.count({ where: { userId } }))) {
    await prisma.activityLog.createMany({
      data: [
        {
          userId,
          action: "LOGIN",
          description: "Signed in to Keymint.",
          device: "Desktop",
          browser: "Chrome",
          os: "Windows",
          ip: "Unavailable",
        },
        {
          userId,
          action: "PASSWORD_VIEWED",
          description: "Viewed a vault credential.",
          device: "Desktop",
          browser: "Chrome",
          os: "Windows",
          ip: "Unavailable",
        },
        {
          userId,
          action: "CATEGORY_CREATED",
          description: "Created a vault category.",
          device: "Desktop",
          browser: "Chrome",
          os: "Windows",
          ip: "Unavailable",
        },
      ],
    });
  }
  console.log("Development-only V2 demo data seeded");
}

main().finally(() => prisma.$disconnect());
