/**
 * OneWork 工作区桥 · 全局监听 + 角标（工作区数据隔离专项 P0，基准 202609062300）。
 *
 * 挂在 UserLayout（全路由生效）：监听 OneWork 主窗口（iframe parent）的
 * 「onework:canvas:workspace-switched」消息并应用工作区上下文（use-ow-bridge.ts
 * 只覆盖项目详情页且只处理 insert-asset，工作区消息必须全局监听）。
 *
 * 角标：左下角显示当前 workspaceName，防止用户混淆「这是哪个工作区的画布」。
 */
import { useEffect } from "react";

import { LayoutGrid } from "lucide-react";

import { isOwWorkspaceSwitchedMessage } from "@/services/bridge/ow-bridge";
import { useOwWorkspaceStore } from "@/stores/ow-workspace-store";

export function OwWorkspaceBridge() {
    const workspaceName = useOwWorkspaceStore((state) => state.workspaceName);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const data: unknown = event.data;
            if (!isOwWorkspaceSwitchedMessage(data)) return;
            // 来源校验（跨源修正，P0 验收实测）：OneWork 主窗口与画布在 dev（localhost:1420）
            // 与打包（tauri.localhost）形态下均跨源于画布 localhost:3000，原 event.origin 比对
            // 会把合法 parent 消息全部拒收。改为属主校验：sender 必须是本画布的直接父窗口
            // （嵌入方）；独立浏览器打开时 parent===window，仅自消息，无副作用。
            if (event.source !== window.parent) return;
            useOwWorkspaceStore.getState().applyWorkspace(data.workspace);
        };
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    if (!workspaceName) return null;
    // 低调角标（2026-09-07 定稿）：左下角小字，防用户混淆当前工作区；内联样式保证
    // 不受 Tailwind 编译/画布自身 UI 层级影响（验收期横幅已实证链路，回调低调形态）。
    return (
        <div
            aria-label="OneWork workspace"
            style={{
                position: "fixed",
                bottom: 12,
                left: 12,
                zIndex: 60,
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 10px",
                borderRadius: 999,
                background: "rgba(120, 113, 108, 0.55)",
                color: "#fafaf9",
                fontSize: 11,
                lineHeight: "16px",
                backdropFilter: "blur(4px)",
                pointerEvents: "none",
            }}
        >
            <LayoutGrid className="size-3.5" />
            <span>{workspaceName}</span>
        </div>
    );
}
