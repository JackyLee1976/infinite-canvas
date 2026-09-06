/**
 * OneWork → canvas-agent 工作区同步（画布生态联动专项 刀4 P4-1）。
 *
 * 画布 Agent 的工作区目录 = OneWork 当前项目根目录：经桥只读端点
 * `GET /api/ow/context/current` 获取 `projectRoot`（或 `taskDataDir`），
 * 替换默认内部目录 `~/.infinite-canvas/codex-workspaces/site`，
 * 消除「目录硬编码外部项目」。OneWork 切换项目后快照（projectRoot 变化）
 * 会在下一次工具调用/工作区刷新时被本模块检测并同步。
 *
 * 设计约束：
 * - 决策与副作用分离：resolveOneWorkProjectRoot（纯函数）取路径；
 *   syncWorkspaceFromOneWork 负责比对并应用（deps 可注入，便于 node 测试）；
 * - 失败静默（桥未运行/未同步/鉴权失败均返回 null，不阻塞工具调用）。
 */
import { ensureSiteWorkspace, updateSiteWorkspace, type CanvasAgentConfig } from "./config.js";

export const ONE_WORK_CONTEXT_URL = "http://127.0.0.1:3000/api/ow/context/current";

export type OneWorkWorkspaceDeps = {
    fetchImpl?: typeof fetch;
    /** 返回当前工作区路径（测试注入）；缺省读 ensureSiteWorkspace。 */
    getCurrentWorkspacePath?: () => string;
    /** 应用新工作区路径（测试注入）；缺省走 updateSiteWorkspace。 */
    applyWorkspacePath?: (workspacePath: string) => void;
    timeoutMs?: number;
};

/** 从桥快照提取当前项目根目录（projectRoot → taskDataDir）。纯函数。 */
export function resolveOneWorkProjectRoot(snapshot: unknown): string {
    const raw = typeof snapshot === "object" && snapshot !== null ? (snapshot as Record<string, unknown>) : {};
    const projectRoot = typeof raw.projectRoot === "string" && raw.projectRoot.trim() ? raw.projectRoot.trim() : "";
    if (projectRoot) return projectRoot;
    return typeof raw.taskDataDir === "string" && raw.taskDataDir.trim() ? raw.taskDataDir.trim() : "";
}

/**
 * 拉取 OneWork 上下文并把当前项目根目录同步为画布 Agent 工作区。
 * 返回同步后的新工作区路径；未变化/失败返回 null（调用方静默处理）。
 */
export async function syncWorkspaceFromOneWork(config: CanvasAgentConfig, deps: OneWorkWorkspaceDeps = {}): Promise<string | null> {
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") return null;
    let resp: Response;
    try {
        resp = await fetchImpl(ONE_WORK_CONTEXT_URL, {
            headers: { authorization: `Bearer ${config.token}` },
            signal: AbortSignal.timeout(deps.timeoutMs ?? 3_000),
        });
    } catch {
        return null;
    }
    if (!resp.ok) return null;
    const body = (await resp.json().catch(() => null)) as unknown;
    const projectRoot = resolveOneWorkProjectRoot(body);
    if (!projectRoot) return null;

    const current = deps.getCurrentWorkspacePath ? deps.getCurrentWorkspacePath() : ensureSiteWorkspace(config).workspacePath;
    if (current === projectRoot) return null;
    if (deps.applyWorkspacePath) deps.applyWorkspacePath(projectRoot);
    else updateSiteWorkspace(config, { workspacePath: projectRoot });
    return projectRoot;
}