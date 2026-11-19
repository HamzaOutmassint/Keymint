"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert02Icon,
  Download01Icon,
  Edit02Icon,
  FilterIcon,
  FolderAddIcon,
  Login03Icon,
  Shield01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import {
  Alert,
  Button,
  EmptyState,
  SearchField,
  api,
} from "@/components/ui";
import { KeyMintLoader } from "@/components/ui/keymint-loader";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import type { Activity } from "@/types/vault";

const iconFor: Record<string, typeof ViewIcon> = {
  PASSWORD_VIEWED: ViewIcon,
  PASSWORD_COPIED: ViewIcon,
  RECOVERY_CODES_VIEWED: ViewIcon,
  RECOVERY_CODE_COPIED: ViewIcon,
  LOGIN: Login03Icon,
  FAILED_LOGIN: Alert02Icon,
  FAILED_MASTER_VERIFICATION: Alert02Icon,
  PASSWORD_EDITED: Edit02Icon,
  CATEGORY_CREATED: FolderAddIcon,
};
function groupDate(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
function actionLabel(action: string) {
  return action
    .split("_")
    .map((word) => word[0] + word.slice(1).toLowerCase())
    .join(" ");
}

export default function ActivityPage() {
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [failedOnly, setFailedOnly] = useState(false);
  const query = useQuery({
    queryKey: ["logs", search],
    queryFn: () =>
      api<{ items: Activity[] }>(`/api/logs?q=${encodeURIComponent(search)}`),
    placeholderData: (previous) => previous,
  });
  const groups = useMemo(
    () =>
      query.data?.items
        .filter((item) => !failedOnly || item.action.includes("FAILED"))
        .reduce<Record<string, Activity[]>>((all, item) => {
          (all[groupDate(item.timestamp)] ??= []).push(item);
          return all;
        }, {}) ?? {},
    [query.data, failedOnly],
  );
  async function download() {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await fetch("/api/logs/export");
      if (!response.ok) throw new Error("Unable to export activity");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `keymint-activity-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <div
      className="page activity-page"
      aria-busy={
        exporting || query.isFetching ? "true" : undefined
      }
    >
      <PageHeader
        title="Activity"
        description="Review protected security events from your account and vault."
        actions={
          <div className="activity-actions">
            {query.isFetching && !query.isPending && (
              <KeyMintLoader
                size="sm"
                variant="inline"
                label="Refreshing activity log"
              />
            )}
            <SearchField
              placeholder="Search activity"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button
              variant={failedOnly ? "primary" : "default"}
              icon={<Icon icon={FilterIcon} size={16} />}
              onClick={() => setFailedOnly(!failedOnly)}
            >
              Failed only
            </Button>
            <Button
              icon={<Icon icon={Download01Icon} size={16} />}
              onClick={download}
              disabled={exporting}
              loading={exporting}
              loadingLabel="Exporting activity log"
            >
              Export
            </Button>
          </div>
        }
      />
      {query.isPending ? (
        <KeyMintLoader variant="section" label="Loading activity log" />
      ) : query.isError ? (
        <Alert variant="danger">
          <Icon icon={Alert02Icon} size={17} />
          Activity could not be loaded. Verify again or refresh the page.
        </Alert>
      ) : (
        Object.entries(groups).map(([label, items]) => (
          <section className="activity-group" key={label}>
            <p className="section-label">{label}</p>
            <div className="card activity-list">
              {items.map((item) => {
                const failed = item.action.includes("FAILED");
                const login = item.action === "LOGIN";
                return (
                  <div
                    key={item.id}
                    className={`activity-row ${failed ? "failure" : ""}`}
                  >
                    <span
                      className={`activity-icon ${failed ? "failure" : login ? "login" : ""}`}
                    >
                      <Icon
                        icon={iconFor[item.action] ?? Shield01Icon}
                        size={17}
                      />
                    </span>
                    <div>
                      <strong className="activity-title">
                        {actionLabel(item.action)}
                      </strong>
                      <span className="activity-description">
                        {item.description}
                      </span>
                      <span className="activity-meta">
                        {item.browser} on {item.os} · {item.ip}
                      </span>
                    </div>
                    <time dateTime={item.timestamp}>
                      {new Date(item.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
      {!query.isPending &&
        !query.isError &&
        Object.keys(groups).length === 0 && (
          <EmptyState
            icon={<Icon icon={Shield01Icon} size={29} />}
            title="No matching activity"
          >
            Security events will appear here as you use Keymint.
          </EmptyState>
        )}
    </div>
  );
}
