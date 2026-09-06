/**
 * OneWork 工作区可见性订阅 hooks（工作区数据隔离专项 P0，基准 202609062300）。
 *
 * 消费侧统一入口：项目/素材列表只展示当前 OneWork 工作区的记录。
 * - workspaceId 为 null（独立浏览器 / 消息未同步）→ 全量可见（现状行为）。
 * - 过滤为内存级（存储层全量保留），旧工作区数据不删除。
 */
import { useMemo } from "react";

import { filterRecordsByWorkspace } from "@/lib/ow-workspace-isolation";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useOwWorkspaceStore } from "@/stores/ow-workspace-store";

/** 当前工作区下可见的画布项目。 */
export function useVisibleProjects(): CanvasProject[] {
    const projects = useCanvasStore((state) => state.projects);
    const workspaceId = useOwWorkspaceStore((state) => state.workspaceId);
    return useMemo(() => filterRecordsByWorkspace(projects, workspaceId), [projects, workspaceId]);
}

/** 当前工作区下可见的素材。 */
export function useVisibleAssets(): Asset[] {
    const assets = useAssetStore((state) => state.assets);
    const workspaceId = useOwWorkspaceStore((state) => state.workspaceId);
    return useMemo(() => filterRecordsByWorkspace(assets, workspaceId), [assets, workspaceId]);
}
