"use client";

import Link from "next/link";
import { Add01Icon, Alert02Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { Alert, EmptyState, Button } from "@/components/ui";
import { KeyMintLoader } from "@/components/ui/keymint-loader";
import { Icon } from "@/components/icons";
import { CredentialRow } from "@/features/credentials/credential-row";
import { CategoryCard } from "@/features/categories/category-card";
import { useVaultStore } from "@/features/vault/store";
import { useSession } from "@/lib/auth-client";
import type { Credential } from "@/types/vault";
import { useVaultData } from "@/features/vault/data";

type Dashboard = {
  totalPasswords: number;
  totalCategories: number;
  lastAccessed: string;
  lastAccessedAt: string | null;
  recent: Credential[];
  favorites: Credential[];
};

function relativeTime(timestamp: string | null) {
  if (!timestamp) return "Not accessed yet";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function DashboardPage() {
  const setOpen = useVaultStore((state) => state.setCreateOpen);
  const session = useSession();
  const query = useVaultData();
  const credentials = query.data?.credentials ?? [];
  const recent = [...credentials].sort((a, b) =>
    Date.parse(b.lastViewed ?? b.updatedAt) - Date.parse(a.lastViewed ?? a.updatedAt),
  ).slice(0, 5);
  const pinnedCategories = (query.data?.categories ?? [])
    .filter((category) => category.pinned)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const last = recent.find((item) => item.lastViewed);
  const data: Dashboard | undefined = query.data ? {
    totalPasswords: credentials.length,
    totalCategories: query.data.categories.length,
    lastAccessed: last?.name ?? "None",
    lastAccessedAt: last?.lastViewed ?? null,
    recent,
    favorites: credentials.filter((item) => item.favorite).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 4),
  } : undefined;
  const displayName = session.data?.user.name?.trim();
  const stats = [
    {
      label: "Saved passwords",
      value: data?.totalPasswords ?? "—",
    },
    {
      label: "Folders",
      value: data?.totalCategories ?? "—",
    },
    {
      label: "Last accessed",
      value: data?.lastAccessed ?? "—",
      detail: data ? relativeTime(data.lastAccessedAt) : undefined,
    },
  ];

  return (
    <div className="page">
      <section
        className="grid min-w-0 gap-8 border-b border-[var(--border)] pb-8 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:items-center md:gap-0 md:pb-9"
        aria-labelledby="dashboard-welcome"
      >
        <div className="min-w-0 md:pr-8 lg:pr-12">
          <h1
            id="dashboard-welcome"
          className="m-0 text-[clamp(1.75rem,3vw,2.5rem)] font-[760] leading-[1.12] tracking-[-0.04em] text-[var(--text)]"
          >
            Welcome back
            {displayName ? (
              <>
                {", "}
                <span className="text-[var(--primary)]">{displayName}</span>
              </>
            ) : null}
          </h1>
          <p className="mt-3 max-w-[38rem] text-sm leading-6 text-[var(--muted)] sm:text-[0.9375rem]">
            Here’s a quick overview of your vault. Your passwords stay securely
            encrypted and ready when you need them.
          </p>
        </div>

        <div className="min-w-0 md:border-l md:border-[var(--border)] md:pl-8 lg:pl-12">
          <h2 className="m-0 text-sm font-[750] tracking-[-0.01em] text-[var(--text)] md:text-base">
            Overview
          </h2>
          <dl className="mt-4 grid min-w-0 grid-cols-3">
            {stats.map((stat, index) => (
              <div
                className={`min-w-0 ${
                  index === 0
                    ? "pr-3 sm:pr-4"
                    : "border-l border-[var(--border)] px-3 sm:px-4"
                }`}
                key={stat.label}
              >
                <dt className="text-[0.6875rem] font-bold leading-4 tracking-[0.02em] text-[var(--muted)] md:text-xs">
                  {stat.label}
                </dt>
                <dd className="mt-2 min-w-0 text-xl font-[760] leading-tight tracking-[-0.03em] text-[var(--text)] sm:text-2xl md:text-[1.625rem]">
                  <span className="block truncate" title={String(stat.value)}>
                    {stat.value}
                  </span>
                  {stat.detail ? (
                    <span className="mt-1 block truncate text-[0.6875rem] font-medium leading-4 tracking-normal text-[var(--subtle)] md:text-xs">
                      {stat.detail}
                    </span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section aria-busy={query.isFetching ? "true" : undefined}>
        <div className="section-heading">
          <h2>Recent passwords</h2>
          {query.isFetching && !query.isPending && (
            <KeyMintLoader
              size="sm"
              variant="inline"
              label="Refreshing dashboard"
              showLabel
            />
          )}
        </div>
        {query.isPending ? (
          <KeyMintLoader variant="section" label="Loading dashboard passwords" />
        ) : query.isError ? (
          <Alert variant="danger">
            <Icon icon={Alert02Icon} size={17} />
            Dashboard data could not be loaded. Refresh the page to try again.
          </Alert>
        ) : recent.length ? (
          <div className="card credential-list">
            {recent.map((item) => (
              <CredentialRow key={item.id} credential={item} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Icon icon={Search01Icon} size={29} />}
            title="Your vault is ready for its first password"
            action={
              <Button
                variant="primary"
                icon={<Icon icon={Add01Icon} size={17} />}
                onClick={() => setOpen(true)}
              >
                Add a password
              </Button>
            }
          >
            Add a credential and Keymint will keep it encrypted in this vault.
          </EmptyState>
        )}
      </section>

      {query.data ? (
        <section aria-label="Pinned categories">
          <div className="section-heading">
            <h2>Pinned categories</h2>
            <span>Quick access</span>
          </div>
          {pinnedCategories.length ? (
            <div className="category-grid">
              {pinnedCategories.map((category) => (
                <CategoryCard key={category.id} category={category} />
              ))}
            </div>
          ) : (
            <div className="card pinned-categories-empty">
              Pin folders you use often from the folder menu for faster access here.
              <Link href="/categories">Browse folders</Link>
            </div>
          )}
        </section>
      ) : null}

      {data?.favorites.length ? (
        <section>
          <div className="section-heading">
            <h2>Favorites</h2>
            <span>Quick access</span>
          </div>
          <div className="card credential-list">
            {data.favorites.map((item) => (
              <CredentialRow key={item.id} credential={item} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
