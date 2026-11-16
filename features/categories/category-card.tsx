"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Folder01Icon,
  Key01Icon,
  MoreVerticalIcon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/icons";
import { Button, FormField, IconButton, Modal } from "@/components/ui";
import type { Category } from "@/types/vault";
import { useVaultData, useVaultMutations } from "@/features/vault/data";

function relative(value: string) {
  const seconds = Math.max(
    1,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000),
  );
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

export function CategoryCard({ category }: { category: Category }) {
  const [menu, setMenu] = useState(false);
  const [mode, setMode] = useState<null | "edit" | "delete">(null);
  const [name, setName] = useState(category.name);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const vault = useVaultData();
  const mutations = useVaultMutations();
  useEffect(() => {
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", closeMenu);
    return () => window.removeEventListener("keydown", closeMenu);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [menu]);
  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const trimmed = name.trim();
      if (vault.data?.categories.some((item) => item.id !== category.id && item.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
        throw new Error("A folder with this name already exists");
      }
      await mutations.saveCategory({ name: trimmed, color: category.color, icon: category.icon, pinned: category.pinned ?? false }, category.id);
      toast.success("Folder updated");
      setMode(null);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      await mutations.remove(category.id);
      toast.success("Folder deleted");
      setMode(null);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggleDashboardPin() {
    if (busy) return;
    setBusy(true);
    try {
      await mutations.saveCategory({
        name: category.name,
        color: category.color,
        icon: category.icon,
        pinned: !category.pinned,
      }, category.id);
      toast.success(category.pinned ? "Folder removed from dashboard" : "Folder added to dashboard");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="card category-card"
      style={{ "--accent": category.color } as React.CSSProperties}
    >
      <div className="category-top">
        <Link
          href={`/categories/${category.id}`}
          className="icon-tile"
          style={{ color: category.color }}
          aria-label={`Open ${category.name}`}
        >
          <Icon icon={Folder01Icon} size={19} />
        </Link>
        <div className="category-menu" ref={menuRef}>
          <IconButton
            label={`Manage ${category.name}`}
            onClick={() => setMenu((open) => !open)}
            aria-expanded={menu}
            aria-haspopup="menu"
          >
            <Icon icon={MoreVerticalIcon} size={19} />
          </IconButton>
          {menu && (
            <div className="menu-popover" role="menu">
              <button
                className="menu-item"
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  void toggleDashboardPin();
                  setMenu(false);
                }}
              >
                {category.pinned ? "Remove from dashboard" : "Add to dashboard"}
              </button>
              <button
                className="menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setMode("edit");
                  setMenu(false);
                }}
              >
                Rename folder
              </button>
              <button
                className="menu-item danger"
                type="button"
                role="menuitem"
                onClick={() => {
                  setMode("delete");
                  setMenu(false);
                }}
              >
                Delete folder
              </button>
            </div>
          )}
        </div>
      </div>
      <Link href={`/categories/${category.id}`} className="category-link">
        <h3>{category.name}</h3>
        <div className="category-count">
          <Icon icon={Key01Icon} size={14} />
          {category._count.credentials} credential
          {category._count.credentials === 1 ? "" : "s"}
        </div>
        <div className="category-footer">
          <span>Updated {relative(category.updatedAt)}</span>
          <span>{category._count.credentials} saved</span>
        </div>
      </Link>
      <Modal
        open={mode === "edit"}
        onClose={() => setMode(null)}
        title="Rename folder"
        description="Use a name you will recognize when saving a password."
        loading={busy}
        loadingLabel="Saving folder name"
        footer={
          <>
            <Button onClick={() => setMode(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={save}
              disabled={busy || !name.trim()}
            >
              Save name
            </Button>
          </>
        }
      >
        <FormField label="Folder name" htmlFor={`folder-name-${category.id}`}>
          <input
            id={`folder-name-${category.id}`}
            className="input"
            data-autofocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
      </Modal>
      <Modal
        open={mode === "delete"}
        onClose={() => setMode(null)}
        title="Delete this folder?"
        description="Passwords inside it will remain safely stored in your vault without a folder."
        loading={busy}
        loadingLabel="Deleting folder"
        footer={
          <>
            <Button onClick={() => setMode(null)}>Cancel</Button>
            <Button variant="danger" onClick={remove} disabled={busy}>
              Delete folder
            </Button>
          </>
        }
      >
        <p className="danger-copy">
          Delete “{category.name}”? This cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
