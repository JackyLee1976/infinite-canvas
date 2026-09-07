/**
 * OneWork 素材注入 hook（画布生态联动专项 刀2 P2-2）。
 *
 * 监听 iframe parent（OneWork 主窗口）的 postMessage「onework:canvas:insert-asset」，
 * 校验消息（isOwInsertAssetMessage）→ 归一化（normalizeOwInsertAsset）→
 * 通过回调注入画布节点（图片 → 图片节点；文本 → 文本节点；视频 → 视频节点）。
 *
 * 安全：仅信任严格契约的消息；dataUrl 仅 data:、url 仅 http(s)、
 * 桥拉取仅限 OneWork 桥 raw 端点（Bearer 鉴权）；校验失败静默丢弃并上报调试信息。
 */
import { useCallback, useEffect, useRef } from "react";

import type { MessageInstance } from "antd/es/message/interface";
import type { TFunction } from "i18next";

import { normalizeOwInsertAsset, OwBridgeError, OW_INSERT_ASSET_MESSAGE_TYPE, type OwBridgeAsset } from "@/services/bridge/ow-bridge";
import type { InsertAssetPayload } from "@/components/canvas/asset-picker-modal";

type OwBridgeParams = {
    /** 是否启用监听（画布页面加载完成后应为 true）。 */
    enabled: boolean;
    /** 图片注入回调（image → 图片节点）。 */
    insertImage: (image: { title: string; dataUrl: string; storageKey?: string; mimeType?: string }) => void;
    /** 文本注入回调（text → 文本节点）。 */
    insertText: (text: string, title?: string) => void;
    /** 视频注入回调（video → 视频节点）。 */
    insertVideo: (payload: Extract<InsertAssetPayload, { kind: "video" }>) => void;
    /** antd 消息实例（错误/成功反馈）。 */
    message: MessageInstance;
    /** i18n 翻译函数。 */
    t: TFunction;
};

/**
 * 把 OneWork 素材消息转发到画布节点注入。
 * @returns 是否本轮端到端成功（false = 校验/桥拉取/归一化失败，不产生节点）。
 */
export async function applyOwInsertAsset(data: unknown, callbacks: Pick<OwBridgeParams, "insertImage" | "insertText" | "insertVideo">): Promise<boolean> {
    let payload: Awaited<ReturnType<typeof normalizeOwInsertAsset>>;
    try {
        payload = await normalizeOwInsertAsset(data);
    } catch (error) {
        const code = error instanceof OwBridgeError ? error.code : "invalid";
        // eslint-disable-next-line no-console
        console.warn("[ow-bridge] 注入失败:", code, error);
        return false;
    }
    if (payload.kind === "image") {
        callbacks.insertImage({ title: payload.title, dataUrl: payload.dataUrl, mimeType: payload.mimeType });
    } else if (payload.kind === "text") {
        callbacks.insertText(payload.text, payload.title);
    } else if (payload.kind === "video") {
        callbacks.insertVideo({ kind: "video", url: payload.url, title: payload.title, storageKey: undefined });
    }
    return true;
}

export function useOwBridge(params: OwBridgeParams) {
    const { enabled, insertImage, insertText, insertVideo, message, t } = params;
    // 回调经 ref 取最新，事件监听只注册一次。
    const handlersRef = useRef({ insertImage, insertText, insertVideo, message, t });
    handlersRef.current = { insertImage, insertText, insertVideo, message, t };

    const handleMessage = useCallback(
        (event: MessageEvent) => {
            const data = event.data;
            if (typeof data !== "object" || data === null || data.type !== OW_INSERT_ASSET_MESSAGE_TYPE) return;
            // 来源校验（跨源修正，工作区隔离 P0 验收实测）：OneWork 主窗口与画布在 dev
            // （localhost:1420）与打包（tauri.localhost）形态下均跨源于画布 localhost:3000，
            // 原 event.origin 比对会把合法 parent 消息全部拒收。改为属主校验：sender 必须是
            // 本画布的直接父窗口（嵌入方）；独立浏览器打开时 parent===window，仅自消息。
            if (event.source !== window.parent) return;
            const h = handlersRef.current;
            void applyOwInsertAsset(data, h).then((ok) => {
                if (ok) {
                    h.message.success(h.t("canvas.owBridge.assetInserted"));
                } else {
                    h.message.error(h.t("canvas.owBridge.assetInsertFailed"));
                }
            });
        },
        [],
    );

    useEffect(() => {
        if (!enabled) return;
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [enabled, handleMessage]);
}

export type { OwBridgeAsset };