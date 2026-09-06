/**
 * OneWork 交付物导出 driver（画布生态联动专项 刀1 P1-4）。
 *
 * 把画布资产（图片/视频）提交到 OneWork 本地桥 `POST /api/ow/artifacts`，
 * 由 OneWork 侧落盘 `{taskDataDir}\Assets\<kind>\` 并登记 storage=managed 交付物。
 *
 * 设计约束：
 * - 本模块不依赖 React / i18n / antd / store（纯数据 + fetch），便于 node 测试与复用；
 * - 错误以结构化 `OwArtifactError.code` 返回，文案由 UI 层按 i18n 映射；
 * - fetch / token / blob 转换均支持注入，mock 桥（200/401/413/超时/网络）在单测覆盖。
 *
 * 桥地址与鉴权对齐既有生图/对话通道（image.ts normalizeToDataUrls 同款）：
 * `http://127.0.0.1:3000` + `Authorization: Bearer <canvas-agent-token>`。
 */

export type OwExportKind = "image" | "video";

/** 可导出的画布资产最小描述（调用方从 asset store 取对应字段即可）。 */
export type OwExportableAsset = {
    kind: OwExportKind;
    title: string;
    /** 图片资产 dataUrl（data: 直用；blob:/http(s) 视情况转出）。 */
    dataUrl?: string;
    /** 视频（或 http(s) 图片）真实地址。 */
    url?: string;
    /** blob 存储键（存在时优先经 readBlob 取真实字节，最稳）。 */
    storageKey?: string;
    mimeType?: string;
};

/** 桥请求体（契约：kind/title/payload.dataUrl 或 payload.url 二选一）。 */
export type OwArtifactRequestBody = {
    kind: OwExportKind;
    title: string;
    payload: { dataUrl?: string; url?: string };
};

/** 桥 200 响应（契约）。 */
export type OwArtifactResponse = {
    ok: boolean;
    deliverableId?: string;
    assetPath?: string;
    registered?: boolean;
    deduplicated?: boolean;
};

export type OwArtifactErrorCode = "unauthorized" | "too-large" | "timeout" | "http" | "network" | "unsupported";

export class OwArtifactError extends Error {
    code: OwArtifactErrorCode;
    httpStatus?: number;

    constructor(code: OwArtifactErrorCode, message: string, httpStatus?: number) {
        super(message);
        this.name = "OwArtifactError";
        this.code = code;
        this.httpStatus = httpStatus;
    }
}

export const OW_BRIDGE_BASE_URL = "http://127.0.0.1:3000";
export const OW_ARTIFACT_TIMEOUT_MS = 60_000;

/** 桥 token 读取（localStorage `canvas-agent-token`，与生图/对话一致）。 */
export function readBridgeToken(): string {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("canvas-agent-token") || "";
}

export type BlobToDataUrl = (blob: Blob) => Promise<string>;

/** 浏览器 FileReader 实现：Blob → data: URI。 */
export const blobToDataUrlViaFileReader: BlobToDataUrl = (blob) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("ow-artifact: 读取 blob 失败"));
        reader.readAsDataURL(blob);
    });

export type OwExportHooks = {
    token?: string;
    fetchImpl?: typeof fetch;
    readBlob?: (storageKey: string) => Promise<Blob | null>;
    blobToDataUrl?: BlobToDataUrl;
    timeoutMs?: number;
    baseUrl?: string;
};

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);
const isDataUrl = (value: string) => /^data:[a-z0-9]+\//i.test(value);

/**
 * 解析产物源：优先取真实 blob（storageKey）转 data: URI；否则
 * data: 直通；http(s) 走 url 字段（桥侧 SSRF 防护 + 白名单下载）；
 * 其它（blob: object URL 等）经 fetch 取回 blob 后转 data: URI。
 * 纯逻辑 + 可注入转换，node 单测可覆盖。
 */
export async function resolveArtifactPayloadSource(
    asset: OwExportableAsset,
    hooks: OwExportHooks = {},
): Promise<OwArtifactRequestBody["payload"]> {
    const blobToDataUrl = hooks.blobToDataUrl || blobToDataUrlViaFileReader;
    const fetchImpl = hooks.fetchImpl || (typeof fetch !== "undefined" ? fetch : undefined);
    const readBlob = hooks.readBlob;

    if (asset.kind === "image" && asset.dataUrl) {
        if (isDataUrl(asset.dataUrl)) return { dataUrl: asset.dataUrl };
        if (isHttpUrl(asset.dataUrl)) return { url: asset.dataUrl };
    }
    if (asset.kind === "video" && asset.url) {
        if (isHttpUrl(asset.url)) return { url: asset.url };
        if (isDataUrl(asset.url)) return { dataUrl: asset.url };
    }

    // 有 storageKey → 直接读受管 blob（对齐 asset-transfer.ts 取物路径）。
    let blob: Blob | null = null;
    if (readBlob && asset.storageKey) {
        try {
            blob = await readBlob(asset.storageKey);
        } catch {
            blob = null;
        }
    }
    // blob: object URL → 同源 fetch 取回。
    if (!blob && fetchImpl) {
        const candidate = asset.kind === "image" ? asset.dataUrl : asset.url;
        if (candidate && candidate.startsWith("blob:")) {
            try {
                const resp = await fetchImpl(candidate);
                if (resp.ok) blob = await resp.blob();
            } catch {
                blob = null;
            }
        }
    }
    if (blob) return { dataUrl: await blobToDataUrl(blob) };

    // 兜底：以当前可用地址直传（data: 或 http(s)）。
    const fallback = asset.kind === "image" ? asset.dataUrl : asset.url;
    if (fallback) {
        if (isDataUrl(fallback)) return { dataUrl: fallback };
        if (isHttpUrl(fallback)) return { url: fallback };
    }
    throw new OwArtifactError("unsupported", "ow-artifact: 无可用产物源（dataUrl/url/blob）");
}

/**
 * 提交到桥（纯 HTTP）。返回契约响应。
 * 错误统一抛 OwArtifactError：401/403→unauthorized ｜ 413→too-large
 * ｜ AbortError→timeout ｜ 其它非 2xx→http ｜ 网络层失败→network。
 */
export async function postOwArtifact(
    request: OwArtifactRequestBody,
    hooks: OwExportHooks = {},
): Promise<OwArtifactResponse> {
    const fetchImpl = hooks.fetchImpl || (typeof fetch !== "undefined" ? fetch : undefined);
    if (!fetchImpl) throw new OwArtifactError("network", "ow-artifact: 当前环境无 fetch");

    const token = hooks.token !== undefined ? hooks.token : readBridgeToken();
    const baseUrl = hooks.baseUrl || OW_BRIDGE_BASE_URL;
    const timeoutMs = hooks.timeoutMs || OW_ARTIFACT_TIMEOUT_MS;

    let resp: Response;
    try {
        resp = await fetchImpl(`${baseUrl}/api/ow/artifacts`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
            throw new OwArtifactError("timeout", error.message);
        }
        if (error instanceof Error && error.name === "AbortError") {
            throw new OwArtifactError("timeout", "ow-artifact: 请求超时");
        }
        throw new OwArtifactError("network", error instanceof Error ? error.message : String(error));
    }

    if (resp.status === 401 || resp.status === 403) {
        throw new OwArtifactError("unauthorized", `ow-artifact: 桥鉴权失败 (HTTP ${resp.status})`, resp.status);
    }
    if (resp.status === 413) {
        throw new OwArtifactError("too-large", `ow-artifact: 产物超过桥接收上限 (HTTP 413)`, resp.status);
    }
    if (!resp.ok) {
        throw new OwArtifactError("http", `ow-artifact: 桥返回 HTTP ${resp.status}`, resp.status);
    }

    const body = (await resp.json().catch(() => null)) as OwArtifactResponse | null;
    if (!body || body.ok !== true) {
        throw new OwArtifactError("http", "ow-artifact: 桥返回未知响应结构", resp.status);
    }
    return body;
}

/** 一站式导出（UI 用）：组装请求 + 提交。 */
export async function exportAssetToOneWork(
    asset: OwExportableAsset,
    hooks: OwExportHooks = {},
): Promise<OwArtifactResponse> {
    const payload = await resolveArtifactPayloadSource(asset, hooks);
    return postOwArtifact({ kind: asset.kind, title: asset.title || "untitled", payload }, hooks);
}
