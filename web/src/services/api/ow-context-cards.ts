/**
 * OneWork 上下文 → 画布卡片 driver（画布生态联动专项 刀3 P3-2）。
 *
 * 把 `GET /api/ow/context/current`（或 fetchOwContext）返回的 OneWork 上下文快照
 * 渲染为一组文本节点卡片（复用既有 text 节点 + 连线体系，不另造卡片引擎）：
 * project → task → document 链式「引用块 + 连线」形态。
 *
 * 输出 `CanvasAgentOp[]`（add_node + connect_nodes），可直接经 applyCanvasAgentOps /
 * useAgentBridge.applyOps 应用到当前画布，与既有 canvas_apply_ops 同一种子。
 *
 * 设计约束：
 * - 纯函数、不依赖 React/i18n/store，可 node 单测；
 * - 空快照（无项目/任务/文档）返回空 cards+ops，由调用方提示；
 * - 节点 metadata 携带 `owContext` 标记（运行时保留，便于后续管理/删除）。
 */

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";

export type OwContextCardKind = "project" | "task" | "document";

export type OwContextCard = {
    id: string;
    kind: OwContextCardKind;
    title: string;
    text: string;
};

export type OwContextCardsResult = {
    cards: OwContextCard[];
    ops: CanvasAgentOp[];
};

type WorkContextLike = {
    project?: { projectId?: unknown; name?: unknown };
    task?: { taskId?: unknown; title?: unknown; done?: unknown; completedAt?: unknown; projectId?: unknown };
    document?: { path?: unknown; title?: unknown; projectId?: unknown; projectName?: unknown; projectPath?: unknown };
};

const CARD_WIDTH = 360;
const CARD_GAP = 40;
function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从快照主体（{ workContext: {...} }）中稳妥提取项目/任务/文档摘要，容错缺省。 */
function parseWorkContext(snapshot: Record<string, unknown>): WorkContextLike {
    const root = isObject(snapshot.workContext) ? snapshot.workContext : snapshot;
    const out: WorkContextLike = {};
    if (isObject(root.project) && typeof root.project.projectId === "string" && root.project.projectId) {
        const name = typeof root.project.name === "string" ? root.project.name : undefined;
        out.project = { projectId: root.project.projectId, name };
    }
    if (isObject(root.task) && typeof root.task.taskId === "string" && root.task.taskId) {
        out.task = {
            taskId: root.task.taskId,
            title: typeof root.task.title === "string" ? root.task.title : undefined,
            done: root.task.done === true,
            completedAt: typeof root.task.completedAt === "string" ? root.task.completedAt : undefined,
            projectId: typeof root.task.projectId === "string" ? root.task.projectId : undefined,
        };
    }
    if (isObject(root.document) && typeof root.document.path === "string" && root.document.path) {
        out.document = {
            path: root.document.path,
            title: typeof root.document.title === "string" ? root.document.title : undefined,
            projectId: typeof root.document.projectId === "string" ? root.document.projectId : undefined,
            projectName: typeof root.document.projectName === "string" ? root.document.projectName : undefined,
            projectPath: typeof root.document.projectPath === "string" ? root.document.projectPath : undefined,
        };
    }
    return out;
}

function buildCards(context: WorkContextLike): OwContextCard[] {
    const cards: OwContextCard[] = [];
    const stamp = (kind: OwContextCardKind, seed: string) => `owctx-${kind}-${seed.slice(0, 32).replace(/[^a-zA-Z0-9_-]/g, "-")}-${Date.now()}`;
    if (context.project && typeof context.project.projectId === "string") {
        const name = typeof context.project.name === "string" ? context.project.name : undefined;
        cards.push({
            id: stamp("project", context.project.projectId),
            kind: "project",
            title: name || context.project.projectId,
            text: `项目：${name || "（未命名）"} (${context.project.projectId})`,
        });
    }
    if (context.task && typeof context.task.taskId === "string") {
        const title = typeof context.task.title === "string" ? context.task.title : context.task.taskId;
        const status = context.task.done === true ? "已完成" : "未完成";
        const lines = [`任务：${title} (${context.task.taskId})`, `状态：${status}`];
        if (typeof context.task.completedAt === "string" && context.task.completedAt) lines.push(`完成时间：${context.task.completedAt}`);
        cards.push({ id: stamp("task", context.task.taskId), kind: "task", title: `任务：${title}`, text: lines.join("\n") });
    }
    if (context.document && typeof context.document.path === "string") {
        const title = typeof context.document.title === "string" ? context.document.title : context.document.path;
        cards.push({
            id: stamp("document", context.document.path),
            kind: "document",
            title,
            text: `文档：${title}\n路径：${context.document.path}`,
        });
    }
    return cards;
}

function buildOps(cards: OwContextCard[], origin?: { x?: number; y?: number }): CanvasAgentOp[] {
    if (!cards.length) return [];
    const startX = typeof origin?.x === "number" ? origin.x : 0;
    const startY = typeof origin?.y === "number" ? origin.y : 0;
    const ops: CanvasAgentOp[] = [];
    const ids: string[] = [];
    cards.forEach((card, index) => {
        const id = `${card.id}-${index}`;
        ids.push(id);
        ops.push({
            type: "add_node",
            nodeType: "text",
            id,
            title: card.title,
            position: { x: startX + index * (CARD_WIDTH + CARD_GAP), y: startY },
            width: CARD_WIDTH,
            height: 140,
            metadata: {
                content: card.text,
                status: "success",
            },
        });
    });
    for (let i = 0; i < ids.length - 1; i += 1) {
        ops.push({ type: "connect_nodes", fromNodeId: ids[i], toNodeId: ids[i + 1] });
    }
    return ops;
}

/**
 * 从 OneWork 上下文快照生成卡片 + 可应用的 ops。
 * 空快照（无项目/任务/文档）返回 { cards: [], ops: [] }（不抛错，由调用方提示）。
 */
export function buildOwContextCards(
    snapshot: Record<string, unknown>,
    origin?: { x?: number; y?: number },
): OwContextCardsResult {
    const context = parseWorkContext(snapshot);
    const cards = buildCards(context);
    const ops = buildOps(cards, origin);
    return { cards, ops };
}