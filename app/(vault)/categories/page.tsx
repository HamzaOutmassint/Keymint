"use client";

import { useState } from "react";
import {
  Add01Icon,
  Alert02Icon,
  FilterIcon,
  Folder01Icon,
  Sorting05Icon,
} from "@hugeicons/core-free-icons";
import { Alert, Button, EmptyState, SearchField } from "@/components/ui";
import { KeyMintLoader } from "@/components/ui/keymint-loader";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { CategoryModal } from "@/features/categories/category-modal";
import { CategoryCard } from "@/features/categories/category-card";
import { useVaultData } from "@/features/vault/data";

export default function CategoriesPage() {
  const [queryText, setQueryText] = useState("");
  const [open, setOpen] = useState(false);
  const [usedOnly, setUsedOnly] = useState(false);
  const [alphabetical, setAlphabetical] = useState(false);
  const query = useVaultData();
  const categories = [...(query.data?.categories ?? [])]
    .filter((item) => item.name.toLocaleLowerCase().includes(queryText.trim().toLocaleLowerCase()))
    .filter((item) => !usedOnly || item._count.credentials > 0)
    .sort((left, right) =>
      alphabetical ? left.name.localeCompare(right.name) : 0,
    );

  return (
    <div
      className="page categories-page"
      aria-busy={query.isFetching ? "true" : undefined}
    >
      <PageHeader
        title="Folders"
        description="Group credentials in a way that makes sense to you."
        actions={
          <div className="category-actions">
            {query.isFetching && !query.isPending && (
              <KeyMintLoader
                size="sm"
                variant="inline"
                label="Refreshing folders"
              />
            )}
            <SearchField
              placeholder="Filter folders"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
            />
            <Button
              variant={usedOnly ? "primary" : "default"}
              icon={<Icon icon={FilterIcon} size={16} />}
              onClick={() => setUsedOnly(!usedOnly)}
            >
              In use
            </Button>
            <Button
              variant={alphabetical ? "primary" : "default"}
              icon={<Icon icon={Sorting05Icon} size={16} />}
              onClick={() => setAlphabetical(!alphabetical)}
            >
              A–Z
            </Button>
          </div>
        }
      />
      {query.isPending ? (
        <KeyMintLoader variant="section" label="Loading folders" />
      ) : query.isError ? (
        <Alert variant="danger">
          <Icon icon={Alert02Icon} size={17} />
          Folders could not be loaded. Check your connection and try again.
        </Alert>
      ) : (
        <>
          <div className="category-grid mb-4">
            {categories.map((category) => (
              <CategoryCard key={category.id} category={category} />
            ))}
            <button
              className="create-category"
              type="button"
              onClick={() => setOpen(true)}
            >
              <div>
                <span>
                  <Icon icon={Add01Icon} size={20} />
                </span>
                <strong>Create folder</strong>
              </div>
            </button>
          </div>
          {categories.length === 0 && (
            <EmptyState
              icon={<Icon icon={Folder01Icon} size={29} />}
              title={
                queryText || usedOnly ? "No matching folders" : "No folders yet"
              }
              action={
                queryText || usedOnly ? (
                  <Button
                    onClick={() => {
                      setQueryText("");
                      setUsedOnly(false);
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => setOpen(true)}>
                    Create a folder
                  </Button>
                )
              }
            >
              {queryText || usedOnly
                ? "Try another search or clear the active filter."
                : "Create folders to keep related credentials together."}
            </EmptyState>
          )}
        </>
      )}
      <CategoryModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
