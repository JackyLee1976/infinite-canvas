import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@/components/layout/app-providers";
import { initAnalytics } from "@/lib/analytics";
import { router } from "@/router";
import { useThemeStore } from "@/stores/use-theme-store";

initAnalytics();

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

// OneWork 内嵌模式：iframe 传入 owTheme / owFontScale 时，让画布 UI 跟随 OneWork 的
// 主题（深/浅）与全局缩放（默认 1.1，根字号 = 16px × scale），保证配色与字号一致。
// 注意：owTheme 不在此处 setTheme——主题覆盖放在 useThemeStore 的 persist merge 里，
// 避免被 localStorage 旧偏好异步 rehydrate 覆盖（"闪一下又变回旧界面"）以及污染用户偏好。
const owFontScale = new URLSearchParams(window.location.search).get("owFontScale");
const owScale = owFontScale ? Number.parseFloat(owFontScale) : Number.NaN;
if (Number.isFinite(owScale) && owScale > 0) {
    document.documentElement.style.fontSize = `${16 * owScale}px`;
}

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
