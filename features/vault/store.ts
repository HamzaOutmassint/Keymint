"use client";
import { create } from "zustand";

type VaultState = {
  unlocked: boolean;
  grant: string | null;
  expiresAt: number | null;
  createOpen: boolean;
  setGrant: (grant: string, ttl: number) => void;
  setUnlocked: (unlocked: boolean) => void;
  lock: () => void;
  setCreateOpen: (open: boolean) => void;
};
export const useVaultStore = create<VaultState>((set) => ({
  unlocked: false,
  grant: null,
  expiresAt: null,
  createOpen: false,
  setGrant: (grant, ttl) => set({ grant, expiresAt: Date.now() + ttl * 1000 }),
  setUnlocked: (unlocked) => set({ unlocked }),
  lock: () => set({ unlocked: false, grant: null, expiresAt: null }),
  setCreateOpen: (createOpen) => set({ createOpen }),
}));
