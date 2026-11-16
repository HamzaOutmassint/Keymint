"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  DashboardSquare01Icon,
  Search01Icon,
  FolderLibraryIcon,
  Activity01Icon,
  Settings01Icon,
  Add01Icon,
  Logout01Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "./icons";
import { Logo } from "./logo";
import { Button, IconButton, api } from "./ui";
import { useVaultStore } from "@/features/vault/store";
import { CredentialFormModal } from "@/features/credentials/credential-form-modal";
import { CredentialSearchModal } from "@/features/credentials/credential-search-modal";
import { authClient } from "@/lib/auth-client";
import { useQueryClient } from "@tanstack/react-query";
import { clearSensitiveClientState } from "@/features/security/clear-sensitive-client-state";
import { VaultUnlockGate } from "@/features/vault/unlock-gate";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: DashboardSquare01Icon },
  { href: "/search", label: "Search", icon: Search01Icon },
  { href: "/categories", label: "Categories", icon: FolderLibraryIcon },
  { href: "/activity", label: "Activity Logs", icon: Activity01Icon },
  { href: "/settings", label: "Settings", icon: Settings01Icon },
];

export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: { name: string; email: string; image?: string | null };
}) {
  const path = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setCreateOpen, createOpen, unlocked } = useVaultStore();
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (
          useVaultStore.getState().unlocked &&
          !document.querySelector('[aria-modal="true"]')
        ) {
          setSearchOpen(true);
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  async function logout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    try {
      await api("/api/logs/event", {
        method: "POST",
        body: JSON.stringify({
          action: "LOGOUT",
        }),
      }).catch(() => undefined);
      await authClient.signOut();
    } finally {
      await clearSensitiveClientState(queryClient);
      router.push("/login");
      router.refresh();
      setLogoutBusy(false);
    }
  }
  const active = (href: string) =>
    path === href || (href !== "/dashboard" && path.startsWith(`${href}/`));
  const avatarStyle = user.image
    ? { backgroundImage: `url(${user.image})` }
    : undefined;
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Logo />
        <Button
          variant="primary"
          className="sidebar-add"
          icon={<Icon icon={Add01Icon} size={18} />}
          onClick={() => setCreateOpen(true)}
        >
          Add new password
        </Button>
        <nav className="nav-list" aria-label="Primary navigation">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active(item.href) ? "page" : undefined}
              className={`nav-link ${active(item.href) ? "active" : ""}`}
            >
              <Icon icon={item.icon} size={20} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <header className="app-header">
        <div className="app-header-content">
          <button
            type="button"
            className="btn header-search"
            aria-label="Search passwords"
            aria-haspopup="dialog"
            aria-expanded={searchOpen && unlocked}
            disabled={!unlocked}
            onClick={() => setSearchOpen(true)}
          >
            <Icon icon={Search01Icon} size={18} />
            <span>Search passwords…</span>
          </button>
          <div className="app-header-user">
            <span className="avatar" style={avatarStyle}>
              {user.image ? "" : user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="app-header-user-name">
              <span className="app-header-user-label" aria-hidden="true">
                Account
              </span>
              <strong title={user.name}>{user.name}</strong>
            </span>
            <IconButton
              label="Log out"
              aria-label="Log out"
              onClick={logout}
              loading={logoutBusy}
              loadingLabel="Logging out"
            >
              <Icon icon={Logout01Icon} size={19} />
            </IconButton>
          </div>
        </div>
      </header>
      <main className="main-area">
        <VaultUnlockGate>{children}</VaultUnlockGate>
      </main>
      <button
        className="mobile-create"
        type="button"
        aria-label="Add new password"
        onClick={() => setCreateOpen(true)}
      >
        <Icon icon={Add01Icon} size={22} />
      </button>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active(item.href) ? "page" : undefined}
            className={active(item.href) ? "active" : ""}
          >
            <Icon icon={item.icon} size={19} />
            <span>{item.label.replace(" Logs", "")}</span>
          </Link>
        ))}
      </nav>
      <CredentialFormModal
        open={createOpen && unlocked}
        onClose={() => setCreateOpen(false)}
      />
      {searchOpen && unlocked && <CredentialSearchModal onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
