import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";

export default async function VaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const data = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { vault: { select: { id: true } } },
  });
  if (!data?.vault) redirect("/master-password");
  return <AppShell user={session.user}>{children}</AppShell>;
}
