/**
 * OneWork 桥素材注入 driver 单测（mock 桥 raw：200/401/403/超时/网络/非法载荷）。
 * 运行：cd web && npx vitest run（或 npm test）。
 */
import { describe, expect, it, vi } from "vitest";

import { OW_BRIDGE_BASE_URL } from "../api/ow-artifact";
import {
    OwBridgeError,
    isOwInsertAssetMessage,
    normalizeOwInsertAsset,
    OW_INSERT_ASSET_MESSAGE_TYPE,
    resolveBridgeImageSource,
} from "./ow-bridge";

const RAW_URL = `${OW_BRIDGE_BASE_URL}/api/ow/artifacts/raw?path=image%2Fref.png`;

const okBytes = (bytes: Uint8Array, type = "image/png") =>
    new Response(new Blob([bytes as BlobPart], { type }), { status: 200, headers: { "Content-Type": type } });

describe("isOwInsertAssetMessage（消息校验）", () => {
    it("合法 image 消息：dataUrl 直通", () => {
        expect(isOwInsertAssetMessage({ type: OW_INSERT_ASSET_MESSAGE_TYPE, asset: { kind: "image", title: "图", dataUrl: "data:image/png;base64,AAA" } })).toBe(true);
    });

    it("合法 image 消息：bridgePath", () => {
        expect(isOwInsertAssetMessage({ type: OW_INSERT_ASSET_MESSAGE_TYPE, asset: { kind: "image", title: "t", bridgePath: "image/a.png" } })).toBe(true);
    });

    it("type 不匹配 / 非对象 / 数组 → false", () => {
        expect(isOwInsertAssetMessage({ type: "other", asset: {} })).toBe(false);
        expect(isOwInsertAssetMessage(null)).toBe(false);
        expect(isOwInsertAssetMessage([{ type: OW_INSERT_ASSET_MESSAGE_TYPE }])).toBe(false);
    });

    it("kind 非法 → false", () => {
        expect(isOwInsertAssetMessage({ type: OW_INSERT_ASSET_MESSAGE_TYPE, asset: { kind: "gif", title: "t", dataUrl: "data:x" } })).toBe(false);
    });

    it("dataUrl 非 data: 前缀 → false（拒绝任意内容注入）", () => {
        expect(isOwInsertAssetMessage({ type: OW_INSERT_ASSET_MESSAGE_TYPE, asset: { kind: "image", title: "t", dataUrl: "https://evil.example/a.png" } })).toBe(false);
    });

    it("url 非 http(s) → false", () => {
        expect(isOwInsertAssetMessage({ type: OW_INSERT_ASSET_MESSAGE_TYPE, asset: { kind: "video", title: "t", url: "file:///C:/x.mp4" } })).toBe(false);
    });

    it("image 无任何源 → false", () => {
        expect(isOwInsertAssetMessage({ type: OW_INSERT_ASSET_MESSAGE_TYPE, asset: { kind: "image", title: "t" } })).toBe(false);
    });

    it("text 缺 text 字段 → false", () => {
        expect(isOwInsertAssetMessage({ type: OW_INSERT_ASSET_MESSAGE_TYPE, asset: { kind: "text", title: "t" } })).toBe(false);
    });
});

describe("resolveBridgeImageSource（桥 raw 拉取）", () => {
    it("data: URI 直通（不触网）", async () => {
        const fetchImpl = vi.fn();
        const result = await resolveBridgeImageSource({ kind: "image", title: "t", dataUrl: "data:image/png;base64,AAA" }, { fetchImpl });
        expect(result.dataUrl).toBe("data:image/png;base64,AAA");
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("bridgePath → 拉桥 raw → dataURL + 字节数 + Bearer", async () => {
        const bytes = new Uint8Array([137, 80, 78, 71]);
        const fetchImpl = vi.fn(async () => okBytes(bytes));
        const blobToDataUrl = vi.fn(async () => "data:image/png;base64,UE5HDQ==");
        const result = await resolveBridgeImageSource({ kind: "image", title: "t", bridgePath: "image/ref.png" }, { fetchImpl, token: "tok", blobToDataUrl });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, init] = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit]);
        expect(url).toContain("/api/ow/artifacts/raw?path=image%2Fref.png");
        expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
        expect(result.bytes).toBe(4);
        expect(result.dataUrl).toBe("data:image/png;base64,UE5HDQ==");
    });

    it("bridgeUrl 仅接受 raw 端点同源（其它 URL 忽略）", async () => {
        const fetchImpl = vi.fn(async () => okBytes(new Uint8Array([1])));
        const blobToDataUrl = vi.fn(async () => "data:image/png;base64,AQ==");
        const result = await resolveBridgeImageSource({ kind: "image", title: "t", bridgeUrl: `${OW_BRIDGE_BASE_URL}/api/ow/artifacts/raw?path=x.png` }, { fetchImpl, blobToDataUrl });
        expect(result.bytes).toBe(1);
        // 非 raw 端点（如 /secret）不被当作素材源
        await expect(
            resolveBridgeImageSource({ kind: "image", title: "t", bridgeUrl: `${OW_BRIDGE_BASE_URL}/api/secret?x=1` }, { fetchImpl }),
        ).rejects.toThrow(OwBridgeError);
    });

    it("401/403 → unauthorized", async () => {
        const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
        await expect(resolveBridgeImageSource({ kind: "image", title: "t", bridgePath: "image/a.png" }, { fetchImpl, token: "bad" })).rejects.toMatchObject({ code: "unauthorized" });
    });

    it("500 → http", async () => {
        const fetchImpl = vi.fn(async () => new Response("err", { status: 500 }));
        await expect(resolveBridgeImageSource({ kind: "image", title: "t", bridgePath: "image/a.png" }, { fetchImpl })).rejects.toMatchObject({ code: "http", httpStatus: 500 });
    });

    it("AbortError/TimeoutError → timeout", async () => {
        const fetchImpl = vi.fn(async () => {
            throw new DOMException("timed out", "TimeoutError");
        });
        await expect(resolveBridgeImageSource({ kind: "image", title: "t", bridgePath: "image/a.png" }, { fetchImpl })).rejects.toMatchObject({ code: "timeout" });
    });

    it("网络错误 → network", async () => {
        const fetchImpl = vi.fn(async () => {
            throw new TypeError("Failed to fetch");
        });
        await expect(resolveBridgeImageSource({ kind: "image", title: "t", bridgePath: "image/a.png" }, { fetchImpl })).rejects.toMatchObject({ code: "network" });
    });

    it("无任何源 → invalid", async () => {
        await expect(resolveBridgeImageSource({ kind: "image", title: "t" }, {})).rejects.toMatchObject({ code: "invalid" });
    });
});

describe("normalizeOwInsertAsset（归一化注入载荷）", () => {
    it("image dataUrl → image 载荷", async () => {
        const result = await normalizeOwInsertAsset({ type: OW_INSERT_ASSET_MESSAGE_TYPE, asset: { kind: "image", title: "图", dataUrl: "data:image/png;base64,AAA", width: 100, height: 50 } });
        expect(result).toMatchObject({ kind: "image", title: "图", width: 100, height: 50 });
    });

    it("video 直链 → video 载荷", async () => {
        const result = await normalizeOwInsertAsset({ type: OW_INSERT_ASSET_MESSAGE_TYPE, asset: { kind: "video", title: "v", url: "https://example.com/a.mp4" } });
        expect(result).toMatchObject({ kind: "video", url: "https://example.com/a.mp4" });
    });

    it("video 经桥 → unsupported（视频节点不支持 dataURL 播放）", async () => {
        await expect(normalizeOwInsertAsset({ type: OW_INSERT_ASSET_MESSAGE_TYPE, asset: { kind: "video", title: "v", bridgePath: "video/a.mp4" } })).rejects.toMatchObject({ code: "unsupported" });
    });

    it("text → text 载荷", async () => {
        const result = await normalizeOwInsertAsset({ type: OW_INSERT_ASSET_MESSAGE_TYPE, asset: { kind: "text", title: "note", text: "你好 OneWork" } });
        expect(result).toMatchObject({ kind: "text", text: "你好 OneWork" });
    });

    it("非法消息 → invalid", async () => {
        await expect(normalizeOwInsertAsset({ type: "nope", asset: {} })).rejects.toMatchObject({ code: "invalid" });
    });
});