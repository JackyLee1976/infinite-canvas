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
            // 与 use-ow-bridge 同一来源校验：非本域/空 origin（OneWork 本地窗口）之外一律拒绝。
            if (event.origin !== "" && event.origin !== window.location.origin) return;
            useOwWorkspaceStore.getState().applyWorkspace(data.workspace);
        };
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    if (!workspaceName) return null;
    return (
        <div
            aria-label="OneWork workspace"
            className="pointer-events-none fixed bottom-3 left-3 z-50 flex items-center gap-1.5 rounded-full border border-stone-200/70 bg-stone-100/85 px-3 py-1 text-xs text-stone-500 shadow-sm backdrop-blur-sm dark:border-stone-700/70 dark:bg-stone-900/85 dark:text-stone-400"
        >
            <LayoutGrid className="size-3.5" />
            <span>{workspaceName}</span>
        </div>
    );
}
