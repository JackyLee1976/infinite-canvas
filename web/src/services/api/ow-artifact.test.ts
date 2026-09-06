/**
 * OneWork 交付物导出 driver 单测（mock 桥：200/401/413/超时/网络）。
 * 运行：cd web && npx vitest run（或 npm test）。
 */
import { describe, expect, it, vi } from "vitest";

import {
    exportAssetToOneWork,
    OwArtifactError,
    postOwArtifact,
    resolveArtifactPayloadSource,
    type OwArtifactRequestBody,
    type OwExportableAsset,
} from "./ow-artifact";

const okJson = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } });

const dataPng = "data:image/png;base64,iVBORw0KGgo=";

describe("resolveArtifactPayloadSource（产物源组装）", () => {
    it("data: URI 直通 dataUrl", async () => {
        const source = await resolveArtifactPayloadSource({ kind: "image", title: "t", dataUrl: dataPng });
        expect(source).toEqual({ dataUrl: dataPng });
    });

    it("http(s) 图片 URL 走 url 字段（桥侧 SSRF 防护 + 下载）", async () => {
        const source = await resolveArtifactPayloadSource({ kind: "image", title: "t", dataUrl: "https://example.com/a.png" });
        expect(source).toEqual({ url: "https://example.com/a.png" });
    });

    it("video http URL 走 url 字段", async () => {
        const source = await resolveArtifactPayloadSource({ kind: "video", title: "v", url: "https://example.com/a.mp4" });
        expect(source).toEqual({ url: "https://example.com/a.mp4" });
    });

    it("storageKey 存在时经 readBlob 取真实字节转 dataUrl", async () => {
        const readBlob = vi.fn(async () => new Blob(["x"], { type: "image/png" }));
        const blobToDataUrl = vi.fn(async () => dataPng);
        const source = await resolveArtifactPayloadSource(
            { kind: "image", title: "t", dataUrl: "blob:http://127.0.0.1:3000/abc", storageKey: "image:k1", mimeType: "image/png" },
            { readBlob, blobToDataUrl },
        );
        expect(readBlob).toHaveBeenCalledWith("image:k1");
        expect(source).toEqual({ dataUrl: dataPng });
    });

    it("blob: object URL 无 storageKey 时经 fetch 取回再转 dataUrl", async () => {
        const fetchImpl = vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" })));
        const blobToDataUrl = vi.fn(async () => dataPng);
        const source = await resolveArtifactPayloadSource(
            { kind: "image", title: "t", dataUrl: "blob:http://127.0.0.1:3000/abc" },
            { fetchImpl, blobToDataUrl },
        );
        expect(fetchImpl).toHaveBeenCalledWith("blob:http://127.0.0.1:3000/abc");
        expect(source).toEqual({ dataUrl: dataPng });
    });

    it("无任何可用源抛 unsupported", async () => {
        await expect(resolveArtifactPayloadSource({ kind: "video", title: "v" })).rejects.toThrow(OwArtifactError);
    });
});

describe("postOwArtifact（桥 HTTP）", () => {
    const request: OwArtifactRequestBody = { kind: "image", title: "t", payload: { dataUrl: dataPng } };

    it("200 解析契约响应（registered/deliverableId）", async () => {
        const fetchImpl = vi.fn(async () =>
            okJson({ ok: true, deliverableId: "d-1", assetPath: "L:\\x\\Assets\\image\\t.png", registered: true, deduplicated: false }),
        );
        const result = await postOwArtifact(request, { fetchImpl, token: "tok" });
        expect(result.deliverableId).toBe("d-1");
        expect(result.registered).toBe(true);
        // 携带 Bearer token 与 JSON 头
        const call = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
        expect((call.headers as Record<string, string>).Authorization).toBe("Bearer tok");
        expect((call.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    });

    it("无 token 时不带 Authorization 头", async () => {
        const fetchImpl = vi.fn(async () => okJson({ ok: true, deliverableId: "d", registered: false }));
        await postOwArtifact(request, { fetchImpl, token: "" });
        const call = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
        expect((call.headers as Record<string, string>).Authorization).toBeUndefined();
    });

    it("401 → unauthorized（未连接/鉴权失败）", async () => {
        const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }));
        await expect(postOwArtifact(request, { fetchImpl, token: "bad" })).rejects.toMatchObject({ code: "unauthorized" });
    });

    it("403 → unauthorized", async () => {
        const fetchImpl = vi.fn(async () => new Response("no", { status: 403 }));
        await expect(postOwArtifact(request, { fetchImpl, token: "bad" })).rejects.toMatchObject({ code: "unauthorized" });
    });

    it("413 → too-large（文件超上限）", async () => {
        const fetchImpl = vi.fn(async () => new Response("too big", { status: 413 }));
        await expect(postOwArtifact(request, { fetchImpl, token: "tok" })).rejects.toMatchObject({ code: "too-large" });
    });

    it("请求超时（TimeoutError）→ timeout", async () => {
        const fetchImpl = vi.fn(async () => {
            const error = new Error("The operation was aborted due to timeout") as Error & { name: string };
            error.name = "TimeoutError";
            throw error;
        });
        await expect(postOwArtifact(request, { fetchImpl, token: "tok" })).rejects.toMatchObject({ code: "timeout" });
    });

    it("网络失败（TypeError，OneWork 未运行）→ network", async () => {
        const fetchImpl = vi.fn(async () => {
            throw new TypeError("fetch failed");
        });
        await expect(postOwArtifact(request, { fetchImpl, token: "tok" })).rejects.toMatchObject({ code: "network" });
    });

    it("500 → http（带状态）", async () => {
        const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
        await expect(postOwArtifact(request, { fetchImpl, token: "tok" })).rejects.toMatchObject({ code: "http", httpStatus: 500 });
    });
});

describe("exportAssetToOneWork（一站式 UI 入口）", () => {
    it("data: 资产直通提交并在 200 返回登记结果", async () => {
        const fetchImpl = vi.fn(async () =>
            okJson({ ok: true, deliverableId: "d-9", assetPath: "P:\\Assets\\image\\a.png", registered: true, deduplicated: false }),
        );
        const asset: OwExportableAsset = { kind: "image", title: "我的图", dataUrl: dataPng };
        const result = await exportAssetToOneWork(asset, { fetchImpl, token: "tok" });
        expect(result.registered).toBe(true);
        const call = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]!.body as string) as OwArtifactRequestBody;
        expect(call.kind).toBe("image");
        expect(call.title).toBe("我的图");
        expect(call.payload).toEqual({ dataUrl: dataPng });
    });
});
