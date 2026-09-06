/**
 * OneWork 桥素材注入 driver（画布生态联动专项 刀2 P2-2）。
 *
 * OneWork 侧「发送到画布」动作通过 iframe parent.postMessage 把素材描述投递给画布；
 * 本模块负责鉴权消息、解析源（dataURL / 桥 raw 引用 / 文本 / URL）、经 OneWork 桥
 * `GET /api/ow/artifacts/raw` 拉取受管素材字节，输出可注入图片节点/引用节点的载荷。
 *
 * 设计约束（与 ow-artifact.ts 同构）：
 * - 不依赖 React / i18n / antd / store（纯数据 + fetch），便于 node 测试与复用；
 * - 桥地址/鉴权/超时与生图/导出通道一致（OW_BRIDGE_BASE_URL + Bearer canvas-agent-token）；
 * - 错误以结构化 code 返回，文案由 UI 层按 i18n 映射（zh/en）。
 *
 * 消息契约（parent → iframe，window.postMessage 第二参数 targetOrigin="*"，
 * 画布侧仅信任 data.type 前缀 + 单元素数组 + 属主校验的载荷）：
 *   { type: "onework:canvas:insert-asset", asset: {
 *       kind: "image" | "video" | "text" | "file",
 *       title: string,
 *       dataUrl?: string,     // 图片 data: URI
 *       bridgePath?: string,  // {taskDataDir}/Assets 相对路径（经桥 raw 端点拉取）
 *       bridgeUrl?: string,   // 桥绝对 URL（http://127.0.0.1:3000/api/ow/artifacts/raw?path=...）
 *       url?: string,         // 直链 http(s)（video/file）
 *       text?: string,        // text 载荷
 *       mimeType?: string, width?: number, height?: number, bytes?: number
 *   } }
 */
import { readBridgeToken, OW_BRIDGE_BASE_URL } from "@/services/api/ow-artifact";

export type OwBridgeAssetKind = "image" | "video" | "text" | "file";

export type OwBridgeAsset = {
    kind: OwBridgeAssetKind;
    title: string;
    dataUrl?: string;
    bridgePath?: string;
    bridgeUrl?: string;
    url?: string;
    text?: string;
    mimeType?: string;
    width?: number;
    height?: number;
    bytes?: number;
};

export const OW_INSERT_ASSET_MESSAGE_TYPE = "onework:canvas:insert-asset";
export const OW_BRIDGE_RAW_TIMEOUT_MS = 30_000;

export type OwBridgeErrorCode = "unauthorized" | "timeout" | "http" | "network" | "unsupported" | "invalid";

export class OwBridgeError extends Error {
    code: OwBridgeErrorCode;
    httpStatus?: number;

    constructor(code: OwBridgeErrorCode, message: string, httpStatus?: number) {
        super(message);
        this.name = "OwBridgeError";
        this.code = code;
        this.httpStatus = httpStatus;
    }
}

/** 归一化图片 dataUrl：bridgeUrl 指向 raw 端点 → fetch bytes → data: URI（供节点渲染）。 */
export async function resolveBridgeImageSource(
    asset: OwBridgeAsset,
    hooks: {
        token?: string;
        fetchImpl?: typeof fetch;
        baseUrl?: string;
        blobToDataUrl?: (blob: Blob) => Promise<string>;
    } = {},
): Promise<{ dataUrl: string; mimeType: string; width?: number; height?: number; bytes: number }> {
    const fetchImpl = hooks.fetchImpl || (typeof fetch !== "undefined" ? fetch : undefined);
    const token = hooks.token !== undefined ? hooks.token : readBridgeToken();
    const baseUrl = hooks.baseUrl || OW_BRIDGE_BASE_URL;
    const toDataUrl = hooks.blobToDataUrl || blobToDataUrl;

    // 1) 直接 data: URI
    if (asset.dataUrl && asset.dataUrl.startsWith("data:")) {
        return {
            dataUrl: asset.dataUrl,
            mimeType: asset.mimeType || "image/png",
            width: asset.width,
            height: asset.height,
            bytes: asset.bytes ?? approximateDataUrlBytes(asset.dataUrl),
        };
    }

    // 2) 桥 raw 引用（bridgePath 或 bridgeUrl）→ 由桥读受管 Assets 字节
    let rawUrl = "";
    if (asset.bridgeUrl && asset.bridgeUrl.startsWith(`${baseUrl}/api/ow/artifacts/raw`)) {
        rawUrl = asset.bridgeUrl;
    } else if (asset.bridgePath) {
        rawUrl = `${baseUrl}/api/ow/artifacts/raw?path=${encodeURIComponent(asset.bridgePath)}`;
    }
    if (rawUrl) {
        if (!fetchImpl) throw new OwBridgeError("network", "ow-bridge: 当前环境无 fetch");
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        let resp: Response;
        try {
            resp = await fetchImpl(rawUrl, { headers, signal: AbortSignal.timeout(OW_BRIDGE_RAW_TIMEOUT_MS) });
        } catch (error) {
            if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
                throw new OwBridgeError("timeout", "ow-bridge: 桥读取素材超时");
            }
            throw new OwBridgeError("network", error instanceof Error ? error.message : String(error));
        }
        if (resp.status === 401 || resp.status === 403) {
            throw new OwBridgeError("unauthorized", `ow-bridge: 桥鉴权失败 (HTTP ${resp.status})`, resp.status);
        }
        if (!resp.ok) {
            throw new OwBridgeError("http", `ow-bridge: 桥返回 HTTP ${resp.status}`, resp.status);
        }
        const blob = await resp.blob();
        const mimeType = asset.mimeType || blob.type || "application/octet-stream";
        const dataUrl = await toDataUrl(blob);
        return { dataUrl, mimeType, width: asset.width, height: asset.height, bytes: blob.size };
    }

    // 3) 直链 http(s)（video/image）→ 画布节点可直用的 url（视频节点用 url；图片不支持跨源）
    if (asset.url && /^https?:\/\//i.test(asset.url)) {
        if ((asset.kind as string) === "video") {
            return { dataUrl: asset.url, mimeType: asset.mimeType || "video/mp4", width: asset.width, height: asset.height, bytes: asset.bytes ?? 0 };
        }
        // 图片 http 直链跨源无法直接 dataURL；尝试随源 fetch（同源/桥内）取字节转换。
        if (fetchImpl) {
            try {
                const resp = await fetchImpl(asset.url, { signal: AbortSignal.timeout(OW_BRIDGE_RAW_TIMEOUT_MS) });
                if (resp.ok) {
                    const blob = await resp.blob();
                    const mimeType = asset.mimeType || blob.type || "image/png";
                    return { dataUrl: await toDataUrl(blob), mimeType, width: asset.width, height: asset.height, bytes: blob.size };
                }
            } catch {
                // fallthrough: 视为无法读取
            }
        }
        throw new OwBridgeError("unsupported", "ow-bridge: 图片直链无法读取为 dataURL（请经桥 path 传递）");
    }

    // 4) text/file 文本载荷
    if (asset.kind === "text" && asset.text != null) {
        return { dataUrl: "", mimeType: "text/plain", bytes: new TextEncoder().encode(asset.text).length };
    }

    throw new OwBridgeError("invalid", "ow-bridge: 载荷缺少可注入内容（dataUrl/bridgePath/bridgeUrl/url/text）");
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new OwBridgeError("network", "ow-bridge: 读取 blob 失败"));
        reader.readAsDataURL(blob);
    });
}

export function approximateDataUrlBytes(dataUrl: string): number {
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return dataUrl.length * 2;
    return Math.floor((dataUrl.length - comma - 1) * 0.75);
}

/**
 * 校验 parent.postMessage 是否为 OneWork 素材注入消息。
 * 安全：仅接受 type 精确匹配 + 非数组 + 有 asset 对象且 kind 合法 + 载荷字段来源兼容
 * （bridgePath/bridgeUrl 仅接受 OneWork 桥语义；dataUrl 仅接受 data:，拒绝任意 http 注入任意内容）。
 */
export function isOwInsertAssetMessage(data: unknown): data is { type: string; asset: OwBridgeAsset } {
    if (typeof data !== "object" || data === null) return false;
    const candidate = data as { type?: unknown; asset?: unknown };
    if (candidate.type !== OW_INSERT_ASSET_MESSAGE_TYPE) return false;
    const asset = candidate.asset;
    if (typeof asset !== "object" || asset === null || Array.isArray(asset)) return false;
    const a = asset as OwBridgeAsset;
    if (!a || typeof a.title !== "string") return false;
    if (!["image", "video", "text", "file"].includes(a.kind)) return false;
    // 载荷字段类型校验
    if (a.dataUrl !== undefined && typeof a.dataUrl !== "string") return false;
    if (a.bridgePath !== undefined && typeof a.bridgePath !== "string") return false;
    if (a.bridgeUrl !== undefined && typeof a.bridgeUrl !== "string") return false;
    if (a.url !== undefined && typeof a.url !== "string") return false;
    if (a.text !== undefined && typeof a.text !== "string") return false;
    // dataUrl 仅接受 data:；url 仅接受 http(s)；避免注入任意内容/跨源探测
    if (a.dataUrl !== undefined && !a.dataUrl.startsWith("data:")) return false;
    if (a.url !== undefined && a.url && !/^https?:\/\//i.test(a.url)) return false;
    // kind × 载荷一致性
    if (a.kind === "image" && !a.dataUrl && !a.bridgePath && !a.bridgeUrl && !a.url) return false;
    if (a.kind === "video" && !a.url && !a.bridgeUrl && !a.bridgePath) return false;
    if (a.kind === "text" && a.text == null && !a.dataUrl) return false;
    return true;
}

/** 把 parent 消息统一归一为正则可注入的画布载荷。 */
export async function normalizeOwInsertAsset(data: unknown): Promise<
    | { kind: "image"; dataUrl: string; title: string; mimeType: string; width?: number; height?: number; bytes: number }
    | { kind: "video"; url: string; title: string; mimeType: string; width?: number; height?: number; bytes: number }
    | { kind: "text"; text: string; title: string }
> {
    if (!isOwInsertAssetMessage(data)) {
        throw new OwBridgeError("invalid", "ow-bridge: 非法消息格式");
    }
    const { asset } = data;
    const title = asset.title || asset.kind.toUpperCase();

    if (asset.kind === "text") {
        return { kind: "text", text: asset.text ?? "", title };
    }

    // video：保留直链 / 桥 raw 拉取（视频节点经 url 播放；桥 raw 拿到的 dataURL 不适合视频）
    if (asset.kind === "video") {
        if (asset.url && /^https?:\/\//i.test(asset.url)) {
            return { kind: "video", url: asset.url, title, mimeType: asset.mimeType || "video/mp4", width: asset.width, height: asset.height, bytes: asset.bytes ?? 0 };
        }
        if (asset.bridgePath || asset.bridgeUrl) {
            // 视频经桥拉取会拿到 dataURL，视频节点不支持 dataURL 播放 → 拒绝并提示用直链
            throw new OwBridgeError("unsupported", "ow-bridge: 视频素材请通过可直链 URL 注入");
        }
        throw new OwBridgeError("invalid", "ow-bridge: 视频载荷缺少 url");
    }

    // image（含 file → 尝试 dataUrl / 桥 raw）
    const resolved = await resolveBridgeImageSource(asset);
    return { kind: "image", dataUrl: resolved.dataUrl, title, mimeType: resolved.mimeType, width: resolved.width, height: resolved.height, bytes: resolved.bytes };
}