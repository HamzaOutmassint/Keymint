"use client";

import { useState } from "react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/icons";
import { Alert, EmptyState, Modal, SearchField } from "@/components/ui";
import { KeyMintLoader } from "@/components/ui/keymint-loader";
import { searchVault, useVaultData } from "@/features/vault/data";
import { CredentialRow } from "./credential-row";

export function CredentialSearchModal({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState("");
  const query = useVaultData();
  const term = search.trim();
  const results = query.data && term ? searchVault(query.data, term).credentials : [];

  return (
    <Modal
      open
      large
      onClose={onClose}
      title="Search passwords"
      description="Find a password, copy it, or save it to favorites."
    >
      <SearchField
        data-autofocus
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search by name, website, email, or folder"
        aria-label="Search saved passwords"
        autoComplete="off"
        spellCheck={false}
      />
      {query.isPending ? (
        <KeyMintLoader variant="section" label="Loading passwords" />
      ) : query.isError ? (
        <Alert variant="danger">Unable to search your vault. Check your connection and try again.</Alert>
      ) : !term ? (
        <EmptyState icon={<Icon icon={Search01Icon} size={29} />} title="Find a saved password">
          Start typing to search your vault.
        </EmptyState>
      ) : !results.length ? (
        <EmptyState icon={<Icon icon={Search01Icon} size={29} />} title="No matching passwords">
          Try another name, email, website, or folder.
        </EmptyState>
      ) : (
        <div className="stack-sm">
          <p className="section-label" role="status">
            {results.length === 20
              ? "Showing first 20 matches"
              : `${results.length} password${results.length === 1 ? "" : "s"} found`}
          </p>
          <div className="card credential-list">
            {results.map((credential) => (
              <CredentialRow key={credential.id} credential={credential} quickActions />
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
