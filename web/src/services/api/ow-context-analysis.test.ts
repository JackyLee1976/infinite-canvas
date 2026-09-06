import { describe, expect, it } from "vitest";

import { buildOwContextAnalysis } from "./ow-context-analysis";

const fullSnapshot = {
    workContext: {
        project: { projectId: "p1", name: "演示项目" },
        task: { taskId: "t1", title: "写文档", done: false, projectId: "p1", completedAt: null },
        document: { path: "L:\\demo\\README.md", title: "README", projectId: "p1", projectName: "演示项目", projectPath: "L:\\demo" },
        agentRun: null,
        updatedAt: "2026-09-06T08:00:00.000Z",
        lastEventId: "evt-1",
    },
};

describe("buildOwContextAnalysis", () => {
    it("builds cards + report node + card→report connections", () => {
        const { cards, reportNode, ops } = buildOwContextAnalysis(fullSnapshot);
        expect(cards).toHaveLength(3);
        expect(reportNode.id).toContain("owctx-report");
        expect(reportNode.title).toBe("OneWork 上下文分析");
        expect(reportNode.text).toContain("演示项目");
        expect(reportNode.text).toContain("写文档");
        expect(reportNode.text).toContain("README");

        const addNodes = ops.filter((op) => op.type === "add_node");
        const connects = ops.filter((op) => op.type === "connect_nodes");
        expect(addNodes).toHaveLength(4); // 3 cards + 1 report
        expect(connects.length).toBeGreaterThanOrEqual(5); // 2 chain + 3 card→report
        const cardToReport = connects.filter((op) => op.type === "connect_nodes" && op.toNodeId === reportNode.id);
        expect(cardToReport).toHaveLength(3);
        expect(cardToReport.every((op) => op.type === "connect_nodes" && typeof op.fromNodeId === "string" && op.fromNodeId.startsWith("owctx-"))).toBe(true);
    });

    it("report node is placed below the cards", () => {
        const { ops } = buildOwContextAnalysis(fullSnapshot, { x: 100, y: 200 });
        const addNodes = ops.filter((op) => op.type === "add_node");
        const reportOp = addNodes.find((op) => String(op.metadata?.content || "").includes("OneWork 上下文分析"));
        expect(reportOp?.position?.y).toBe(420);
    });

    it("returns empty result for empty context", () => {
        const { cards, reportNode, ops } = buildOwContextAnalysis({ workContext: { project: null, task: null, document: null } });
        expect(cards).toHaveLength(0);
        expect(reportNode.id).toBe("");
        expect(ops).toHaveLength(0);
    });

    it("works with workContext direct (no wrapper)", () => {
        const { cards } = buildOwContextAnalysis({ project: { projectId: "p-1", name: "直出" } });
        expect(cards).toHaveLength(1);
        expect(cards[0].kind).toBe("project");
    });
});