/**
 * OneWork 上下文 → 分析报告 driver（画布生态联动专项 刀3 P3-3）。
 *
 * 在 P3-2 卡片基础上追加一张「OneWork 上下文分析报告」文本节点，
 * 报告正文为结构化分析骨架（从上下文快照提取项目/任务/文档要素），
 * 并以连线把每张卡片指向报告节点（引用块 + 连线形态）。
 *
 * 边界：本 driver 生成的是分析骨架，不拟 AI 分析。真正的 AI 深入分析
 * 由 Agent 后续在对话中调用既有 canvas_generate_text / canvas_update_node_text
 * 基于卡片与报告节点继续生成（画布节点能力内闭环，无需新引擎）。
 *
 * 设计约束：纯函数、不依赖 React/i18n/store，node 可测。
 */
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { buildOwContextCards, type OwContextCard, type OwContextCardsResult } from "./ow-context-cards";
export type OwAnalysisReportNode = {
    id: string;
    title: string;
    text: string;
};

export type OwAnalysisResult = {
    cards: OwContextCard[];
    reportNode: OwAnalysisReportNode;
    ops: CanvasAgentOp[];
};

const REPORT_WIDTH = 460;
const REPORT_HEIGHT = 200;
const CARD_VGAP = 220; // 报告放在卡片下方

function buildReportText(cards: OwContextCard[], generatedAt: string): string {
    const lines: string[] = [
        `OneWork 上下文分析（生成于 ${generatedAt}）`,
        "---",
    ];
    const kinds: Record<string, string> = { project: "项目", task: "任务", document: "文档" };
    for (const card of cards) {
        const label = kinds[card.kind] ?? card.kind;
        lines.push(`- ${label}：${card.title}`);
    }
    lines.push("---");
    lines.push("分析要点：");
    lines.push("1. 项目/任务/文档已从 OneWork 同步为画布引用卡片。");
    lines.push("2. 卡片间与报告已建立引用连线。");
    lines.push("3. 如需深入分析（风险/依赖/下一步），可让 AI 在本报告节点基础上继续生成。");
    return lines.join("\n");
}

/**
 * 从 OneWork 上下文快照生成卡片 + 分析报告节点 + 可应用的 ops。
 * 空快照（无项目/任务/文档）返回 { cards: [], reportNode: 空, ops: [] }（调用方提示）。
 */
export function buildOwContextAnalysis(
    snapshot: Record<string, unknown>,
    origin?: { x?: number; y?: number },
): OwAnalysisResult {
    const cardsResult: OwContextCardsResult = buildOwContextCards(snapshot, origin);
    const cards = cardsResult.cards;
    if (!cards.length) {
        return { cards: [], reportNode: { id: "", title: "", text: "" }, ops: [] };
    }

    const startX = typeof origin?.x === "number" ? origin.x : 0;
    const startY = typeof origin?.y === "number" ? origin.y : 0;
    const reportId = `owctx-report-${Date.now()}`;
    const reportNode: OwAnalysisReportNode = {
        id: reportId,
        title: "OneWork 上下文分析",
        text: buildReportText(cards, new Date().toISOString().slice(0, 19).replace("T", " ")),
    };

    const ops: CanvasAgentOp[] = [...cardsResult.ops];
    ops.push({
        type: "add_node",
        nodeType: "text",
        id: reportId,
        title: reportNode.title,
        position: { x: startX, y: startY + CARD_VGAP },
        width: REPORT_WIDTH,
        height: REPORT_HEIGHT,
        metadata: { content: reportNode.text, status: "success" },
    });
    // 每张卡片 → 报告 连线（引用块 + 连线形态）。卡片 id 在 buildOwContextCards 中为
    // `owctx-<kind>-<seed>-<index>`，此处按同样的 index 约定还原对应卡片节点 id。
    cards.forEach((card, index) => {
        const cardId = `${card.id}-${index}`;
        ops.push({ type: "connect_nodes", fromNodeId: cardId, toNodeId: reportId });
    });

    return { cards, reportNode, ops };
}