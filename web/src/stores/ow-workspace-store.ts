/**
 * OneWork 工作区上下文 store（工作区数据隔离专项 P0，基准 202609062300）。
 *
 * 画布端当前 OneWork 工作区（由 parent postMessage 投递，见 ow-bridge.ts 契约）。
 * - 非持久化：每次画布加载由 OneWork 侧 iframe 挂载补发当前工作区（幂等）。
 * - applyWorkspace 幂等：同一 workspaceId 重复投递无副作用。
 * - 首次得知工作区（null → wsId）：对存量未打标记录（legacy）做归属打标；
 *   打标等两个 persist store 水合完成后再执行（挂载补发可能早于 localforage 水合）。
 * - 真切换（wsId → 另一 wsId）：只切换可见上下文，不删除任何数据。
 */
import { create } from "zustand";

import { tagUntaggedRecords } from "@/lib/ow-workspace-isolation";

type OwWorkspaceState = {
    workspaceId: string | null;
    workspaceName: string | null;
    /** 应用工作区上下文（挂载补发与切换消息共用；幂等）。 */
    applyWorkspace: (ws: { workspaceId: string; workspaceName: string }) => void;
};

/** 存量打标重试上限（防 store 永不水合时空转；超时后 legacy 保持全可见降级）。 */
const TAG_RETRY_MAX = 50;
const TAG_RETRY_DELAY_MS = 400;

function scheduleLegacyTagging(workspaceId: string): void {
    void (async () => {
        const [{ useCanvasStore }, { useAssetStore }] = await Promise.all([
            import("@/stores/canvas/use-canvas-store"),
            import("@/stores/use-asset-store"),
        ]);
        let attempts = 0;
        const runTag = () => {
            attempts += 1;
            const canvasState = useCanvasStore.getState();
            const assetState = useAssetStore.getState();
            // 等水合完成再打标：挂载补发可能早于 localforage 持久化恢复。
            if (!canvasState.hydrated || !assetState.hydrated) {
                if (attempts < TAG_RETRY_MAX) window.setTimeout(runTag, TAG_RETRY_DELAY_MS);
                return;
            }
            const projects = tagUntaggedRecords(canvasState.projects, workspaceId);
            if (projects) useCanvasStore.setState({ projects });
            const assets = tagUntaggedRecords(assetState.assets, workspaceId);
            if (assets) useAssetStore.setState({ assets });
        };
        runTag();
    })().catch((error) => {
        // eslint-disable-next-line no-console
        console.warn("[ow-workspace] 存量归属打标失败:", error);
    });
}

export const useOwWorkspaceStore = create<OwWorkspaceState>((set, get) => ({
    workspaceId: null,
    workspaceName: null,
    applyWorkspace: (ws) => {
        if (typeof ws?.workspaceId !== "string" || !ws.workspaceId.trim()) return;
        const prev = get().workspaceId;
        if (prev === ws.workspaceId) return;
        if (!prev) {
            scheduleLegacyTagging(ws.workspaceId);
        } else {
            // 真切换：清空跨工作区残留的列表选中态（不可见项目不可批量删除/导出）。
            void import("@/stores/canvas/use-canvas-ui-store")
                .then(({ useCanvasUiStore }) => {
                    useCanvasUiStore.setState({ selectedProjectIds: [], deleteProjectIds: [] });
                })
                .catch(() => undefined);
        }
        set({ workspaceId: ws.workspaceId, workspaceName: ws.workspaceName });
    },
}));
