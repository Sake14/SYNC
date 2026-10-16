"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type ProfileState = { displayName: string; setDisplayName: (name: string) => void; theme: "green" | "violet"; setTheme: (theme: "green" | "violet") => void };
export const useProfileStore = create<ProfileState>()(persist(
  (set) => ({ displayName: "", setDisplayName: (displayName) => set({ displayName }), theme: "green", setTheme: theme => set({ theme }) }),
  { name: "listen-together-profile", skipHydration: true, partialize: ({ displayName, theme }) => ({ displayName, theme }) },
));
