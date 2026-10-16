"use client";
import { useEffect } from "react";
import { startTransport } from "@/stores/room-store";
import { useProfileStore } from "@/stores/profile-store";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void useProfileStore.persist.rehydrate();
    const updateTheme = () => {
      document.documentElement.dataset.theme = useProfileStore.getState().theme === "violet" ? "violet" : "green";
    };
    updateTheme();
    const unsubscribe = useProfileStore.subscribe(updateTheme);
    const stop = startTransport();
    return () => { unsubscribe(); stop(); };
  }, []);
  return children;
}
