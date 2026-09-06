/**
 * OneWork 只读上下文 driver（画布生态联动专项 刀3 P3-1）。
 *
 * 画布 Agent 的 `ow_context_get` site 工具经本模块读取 OneWork 桥
 * `GET /api/ow/context/current`（OneWork 主侧同步的当前项目/任务/文档摘要快照）。
 *
 * 设计约束：
 * - 纯数据 + fetch，不依赖 React / i18n / store，便于 node 单测；
 * - 错误以结构化 `OwContextError.code` 返回，文案由 UI 层按 i18n 映射；
 * - 桥地址与鉴权对齐 ow-artifact 通道（复用其 base/token 常量）。
 */

import { OW_BRIDGE_BASE_URL, readBridgeToken } from "./ow-artifact";

export type OwContextErrorCode = "unauthorized" | "not-synced" | "timeout" | "http" | "network";

export class OwContextError extends Error {
    code: OwContextErrorCode;
    httpStatus?: number;

    constructor(code: OwContextErrorCode, message: string, httpStatus?: number) {
        super(message);
        this.name = "OwContextError";
        this.code = code;
        this.httpStatus = httpStatus;
    }
}

export const OW_CONTEXT_TIMEOUT_MS = 10_000;

export type OwContextHooks = {
    token?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    baseUrl?: string;
};

/**
 * 读取 OneWork 上下文快照（只读）。
 * 错误统一抛 OwContextError：401/403→unauthorized ｜ 503→not-synced
 * ｜ AbortError→timeout ｜ 其它非 2xx→http ｜ 网络层失败→network。
 */
export async function fetchOwContext(hooks: OwContextHooks = {}): Promise<Record<string, unknown>> {
    const fetchImpl = hooks.fetchImpl || (typeof fetch !== "undefined" ? fetch : undefined);
    if (!fetchImpl) throw new OwContextError("network", "ow-context: 当前环境无 fetch");

    const token = hooks.token !== undefined ? hooks.token : readBridgeToken();
    const baseUrl = hooks.baseUrl || OW_BRIDGE_BASE_URL;
    const timeoutMs = hooks.timeoutMs || OW_CONTEXT_TIMEOUT_MS;

    let resp: Response;
    try {
        resp = await fetchImpl(`${baseUrl}/api/ow/context/current`, {
            method: "GET",
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
            throw new OwContextError("timeout", "ow-context: 请求超时");
        }
        throw new OwContextError("network", error instanceof Error ? error.message : String(error));
    }

    if (resp.status === 401 || resp.status === 403) {
        throw new OwContextError("unauthorized", `ow-context: 桥鉴权失败 (HTTP ${resp.status})`, resp.status);
    }
    if (resp.status === 503) {
        throw new OwContextError("not-synced", "ow-context: OneWork 上下文未同步（请先在 OneWork 打开画布面板）", resp.status);
    }
    if (!resp.ok) {
        throw new OwContextError("http", `ow-context: 桥返回 HTTP ${resp.status}`, resp.status);
    }

    const body = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
        throw new OwContextError("http", "ow-context: 桥返回未知响应结构", resp.status);
    }
    return body;
}
