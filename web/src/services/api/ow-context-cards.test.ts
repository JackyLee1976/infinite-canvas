import { describe, expect, it } from "vitest";

import { buildOwContextCards } from "./ow-context-cards";

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

describe("buildOwContextCards", () => {
    it("builds project → task → document cards with chain connections", () => {
        const { cards, ops } = buildOwContextCards(fullSnapshot);
        expect(cards.map((c) => c.kind)).toEqual(["project", "task", "document"]);
        expect(cards[0].title).toBe("演示项目");
        expect(cards[0].text).toContain("p1");
        expect(cards[1].text).toContain("写文档");
        expect(cards[2].text).toContain("README.md");

        const addNodes = ops.filter((op) => op.type === "add_node");
        const connects = ops.filter((op) => op.type === "connect_nodes");
        expect(addNodes).toHaveLength(3);
        expect(connects).toHaveLength(2);
        expect(addNodes.every((op) => op.type === "add_node" && op.nodeType === "text")).toBe(true);
        expect(addNodes[0].metadata?.status).toBe("success");
    });

    it("creates only project card when task/document are absent", () => {
        const { cards, ops } = buildOwContextCards({
            workContext: {
                project: { projectId: "p1", name: "单项目" },
                task: null,
                document: null,
            },
        });
        expect(cards.map((c) => c.kind)).toEqual(["project"]);
        expect(ops).toHaveLength(1); // 单卡片无连线
    });

    it("falls back to ids when names are missing", () => {
        const { cards } = buildOwContextCards({
            workContext: {
                project: { projectId: "p-9" },
                task: { taskId: "task-42", done: true },
                document: { path: "C:\\x\\y.md" },
            },
        });
        expect(cards[0].title).toBe("p-9");
        expect(cards[1].text).toContain("已完成");
        expect(cards[2].title).toBe("C:\\x\\y.md");
    });

    it("returns empty result for empty context", () => {
        const { cards, ops } = buildOwContextCards({ workContext: { project: null, task: null, document: null } });
        expect(cards).toHaveLength(0);
        expect(ops).toHaveLength(0);
    });

    it("applies origin to card positions", () => {
        const { ops } = buildOwContextCards(fullSnapshot, { x: 100, y: 200 });
        const addNodes = ops.filter((op) => op.type === "add_node");
        expect(addNodes[0].position).toEqual({ x: 100, y: 200 });
        if (!addNodes[1]?.position) throw new Error("expected second add_node op");
        expect(addNodes[1].position.x).toBeGreaterThan(400);
        expect(addNodes[1].position.y).toBe(200);
    });

    it("tolerates workContext directly (no wrapper) for robustness", () => {
        const { cards } = buildOwContextCards({ project: { projectId: "p-1", name: "直出" } });
        expect(cards).toHaveLength(1);
        expect(cards[0].kind).toBe("project");
    });
});