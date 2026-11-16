"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  Alert02Icon,
  ArrowLeft01Icon,
  Folder01Icon,
} from "@hugeicons/core-free-icons";
import { Alert, Button, EmptyState } from "@/components/ui";
import { KeyMintLoader } from "@/components/ui/keymint-loader";
import { Icon } from "@/components/icons";
import { CredentialRow } from "@/features/credentials/credential-row";
import type { Category } from "@/types/vault";
import { useVaultData } from "@/features/vault/data";

export default function CategoryDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState(1);
  const vault = useVaultData();
  const category = { ...vault, data: vault.data?.categories.find((item) => item.id === id) as Category | undefined };
  const matching = vault.data?.credentials.filter((item) => item.categoryId === id) ?? [];
  const credentials = {
    ...vault,
    data: { items: matching.slice((page - 1) * 10, page * 10), pages: Math.ceil(matching.length / 10) },
  };
  return (
    <div
      className="page"
      aria-busy={
        category.isFetching || credentials.isFetching ? "true" : undefined
      }
    >
      <Link href="/categories" className="link flex gap-1 items-center">
        <Icon icon={ArrowLeft01Icon} size={16} /> Back to folders
      </Link>
      <header className="page-header category-page-header">
        <div className="category-summary">
          <span className="icon-tile" style={{ color: category.data?.color }}>
            <Icon icon={Folder01Icon} size={22} />
          </span>
          <div>
            <div className="loading-status-inline">
              <h1 className="page-title">{category.data?.name ?? "Folder"}</h1>
              {(category.isFetching || credentials.isFetching) &&
                !credentials.isPending && (
                  <KeyMintLoader
                    size="sm"
                    variant="inline"
                    label="Refreshing folder contents"
                  />
                )}
            </div>
            <p className="page-subtitle">
              {category.data?._count.credentials ?? 0} saved credential
              {category.data?._count.credentials === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </header>
      {category.isError || credentials.isError ? (
        <Alert variant="danger">
          <Icon icon={Alert02Icon} size={17} />
          This folder could not be loaded. Return to folders and try again.
        </Alert>
      ) : category.isPending || credentials.isPending ? (
        <KeyMintLoader variant="section" label="Loading folder passwords" />
      ) : credentials.data?.items.length ? (
        <>
          <div className="card credential-list">
            {credentials.data.items.map((item) => (
              <CredentialRow key={item.id} credential={item} />
            ))}
          </div>
          {(credentials.data.pages ?? 1) > 1 && (
            <div className="pagination">
              <Button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1 || credentials.isFetching}
              >
                Previous
              </Button>
              <span>
                Page {page} of {credentials.data.pages}
              </span>
              <Button
                onClick={() =>
                  setPage(Math.min(credentials.data.pages, page + 1))
                }
                disabled={page === credentials.data.pages || credentials.isFetching}
              >
                Next
              </Button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={<Icon icon={Folder01Icon} size={29} />}
          title="This folder is empty"
        >
          Add a password and assign it to {category.data?.name ?? "this folder"}
          .
        </EmptyState>
      )}
    </div>
  );
}
