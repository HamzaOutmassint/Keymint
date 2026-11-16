import { prisma } from "../lib/prisma";
import { enforceOperationalRetention } from "../server/retention";

async function main() {
  const result = await enforceOperationalRetention();
  process.stdout.write(`${JSON.stringify({ event: "security-retention-complete", ...result })}\n`);
}

main()
  .catch(() => {
    process.stderr.write("Security retention failed\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
