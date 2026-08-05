import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
};

// OneWork 内嵌模式：iframe URL 携带 owTheme 时，画布主题跟随 OneWork。
// 用 merge 而非 setTheme：rehydrate 完成后 owTheme 优先于 localStorage 旧偏好，
// 避免"闪一下新主题又被旧偏好覆盖"；且不写回 localStorage，不污染用户在独立浏览器的偏好。
function resolveOwThemeOverride(): ThemeName | null {
    const theme = new URLSearchParams(window.location.search).get("owTheme");
    return theme === "light" || theme === "dark" ? theme : null;
}

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: "dark",
            setTheme: (theme) => set({ theme }),
        }),
        {
            name: "infinite-canvas:theme_store",
            merge: (persistedState, currentState) => {
                const base = {
                    ...currentState,
                    ...(persistedState as Partial<ThemeStore>),
                };
                const owTheme = resolveOwThemeOverride();
                return owTheme ? { ...base, theme: owTheme } : base;
            },
        },
    ),
);
