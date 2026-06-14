import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "system" | "light" | "dark";

interface ThemeState {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  resolvedMode: () => "light" | "dark";
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: "system",
      setMode: (mode) => set({ mode }),
      resolvedMode: () => {
        const { mode } = get();
        if (mode !== "system") return mode;
        return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      },
    }),
    { name: "whisper-theme" },
  ),
);
