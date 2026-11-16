"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Alert02Icon,
  Folder01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import {
  Alert,
  EmptyState,
  SearchField,
} from "@/components/ui";
import { KeyMintLoader } from "@/components/ui/keymint-loader";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { CredentialRow } from "@/features/credentials/credential-row";
import type { Category, Credential } from "@/types/vault";
import { searchVault, useVaultData } from "@/features/vault/data";

type Results = {
  credentials: Credential[];
  categories: Category[];
  recent: Credential[];
};
type SearchTab = "all" | "passwords" | "folders";

export default function SearchPage() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [tab, setTab] = useState<SearchTab>("all");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [search]);
  const query = useVaultData();
  const data: Results | undefined = useMemo(
    () => query.data && debounced ? searchVault(query.data, debounced) : undefined,
    [query.data, debounced],
  );
  const hasResults =
    !!data && (data.credentials.length > 0 || data.categories.length > 0);
  const hasVisibleResults =
    !!data &&
    (((tab === "all" || tab === "passwords") && data.credentials.length > 0) ||
      ((tab === "all" || tab === "folders") && data.categories.length > 0));

  return (
    <div
      className="page search-workspace"
      aria-busy={debounced && query.isFetching ? "true" : undefined}
    >
      <div>
        <PageHeader
          title="Search your vault"
          description="Find saved passwords, secure notes, websites, and folders."
        />
        <div className="search-input-wrap">
          <SearchField
            className="wide"
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, website, email, notes, or folder"
          />
        </div>
      </div>
      <div className="search-toolbar">
        <p className="section-label">
          {debounced ? `Results for “${debounced}”` : "Private search"}
        </p>
        {query.isFetching && !query.isPending && (
          <KeyMintLoader
            className="loading-status-inline"
            size="sm"
            variant="inline"
            label="Refreshing vault search"
            showLabel
          />
        )}
        <div
          className="tab-list"
          role="tablist"
          aria-label="Search result type"
        >
          {(["all", "passwords", "folders"] as SearchTab[]).map((item) => (
            <button
              key={item}
              id={`search-tab-${item}`}
              className="tab-button"
              type="button"
              role="tab"
              aria-selected={tab === item}
              aria-controls="search-results"
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      {!debounced ? (
        <EmptyState
          icon={<Icon icon={Search01Icon} size={29} />}
          title="Start with a name, website, or folder"
        >
          Search stays within your encrypted vault and only returns items you
          can access.
        </EmptyState>
      ) : query.isPending ? (
        <KeyMintLoader variant="section" label="Searching your vault" />
      ) : query.isError ? (
        <Alert variant="danger">
          <Icon icon={Alert02Icon} size={17} />
          Unable to search the vault right now. Check your connection and try
          again.
        </Alert>
      ) : !hasResults ? (
        <EmptyState
          icon={<Icon icon={Search01Icon} size={29} />}
          title="No matching results"
        >
          Try checking the spelling or searching for a broader term.
        </EmptyState>
      ) : !hasVisibleResults ? (
        <EmptyState
          icon={<Icon icon={Search01Icon} size={29} />}
          title={`No ${tab} found`}
        >
          Switch result type or try a broader search.
        </EmptyState>
      ) : (
        <div
          id="search-results"
          className="stack"
          role="tabpanel"
          aria-labelledby={`search-tab-${tab}`}
        >
          {(tab === "all" || tab === "passwords") &&
            !!data?.credentials.length && (
              <section>
                <div className="section-heading">
                  <h2>Passwords</h2>
                  <span>{data.credentials.length} found</span>
                </div>
                <div className="card credential-list">
                  {data.credentials.map((item) => (
                    <CredentialRow key={item.id} credential={item} />
                  ))}
                </div>
              </section>
            )}
          {(tab === "all" || tab === "folders") &&
            !!data?.categories.length && (
              <section>
                <div className="section-heading">
                  <h2>Folders</h2>
                  <span>{data.categories.length} found</span>
                </div>
                <div className="category-grid">
                  {data.categories.map((category) => (
                    <Link
                      key={category.id}
                      className="card category-result"
                      href={`/categories/${category.id}`}
                    >
                      <span
                        className="icon-tile"
                        style={{ color: category.color }}
                      >
                        <Icon icon={Folder01Icon} size={19} />
                      </span>
                      <div>
                        <strong>{category.name}</strong>
                        <span className="credential-user">
                          {category._count.credentials} credential
                          {category._count.credentials === 1 ? "" : "s"}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
        </div>
      )}
    </div>
  );
}
