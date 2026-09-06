import { describe, expect, it } from "vitest";

import {
    filterRecordsByWorkspace,
    isRecordVisibleInWorkspace,
    tagUntaggedRecords,
} from "./ow-workspace-isolation";

type Rec = { id: string; owWorkspaceId?: string };
const rec = (id: string, owWorkspaceId?: string): Rec => (owWorkspaceId ? { id, owWorkspaceId } : { id });

describe("isRecordVisibleInWorkspace（可见性判定）", () => {
    it("无工作区上下文 → 全部可见（独立浏览器/未同步兜底）", () => {
        expect(isRecordVisibleInWorkspace(rec("a", "ws1"), null)).toBe(true);
        expect(isRecordVisibleInWorkspace(rec("a", "ws1"), undefined)).toBe(true);
        expect(isRecordVisibleInWorkspace(rec("a"), null)).toBe(true);
    });

    it("未打标（legacy 存量）→ 任何工作区可见（宁可多见不可错删）", () => {
        expect(isRecordVisibleInWorkspace(rec("a"), "ws1")).toBe(true);
        expect(isRecordVisibleInWorkspace(rec("a"), "ws2")).toBe(true);
    });

    it("已打标 → 仅匹配工作区可见", () => {
        expect(isRecordVisibleInWorkspace(rec("a", "ws1"), "ws1")).toBe(true);
        expect(isRecordVisibleInWorkspace(rec("a", "ws1"), "ws2")).toBe(false);
    });

    it("空记录 + 有上下文 → 不可见", () => {
        expect(isRecordVisibleInWorkspace(null, "ws1")).toBe(false);
    });
});

describe("filterRecordsByWorkspace（集合过滤）", () => {
    it("无上下文 → 返回同一引用", () => {
        const list = [rec("a"), rec("b", "ws1")];
        expect(filterRecordsByWorkspace(list, null)).toBe(list);
    });

    it("undefined → 空数组", () => {
        expect(filterRecordsByWorkspace(undefined, "ws1")).toEqual([]);
        expect(filterRecordsByWorkspace(undefined, null)).toEqual([]);
    });

    it("按 workspaceId 过滤（legacy 保留）", () => {
        const list = [rec("legacy"), rec("a", "ws1"), rec("b", "ws2")];
        expect(filterRecordsByWorkspace(list, "ws1").map((r) => r.id)).toEqual(["legacy", "a"]);
        expect(filterRecordsByWorkspace(list, "ws2").map((r) => r.id)).toEqual(["legacy", "b"]);
    });
});

describe("tagUntaggedRecords（存量归属打标）", () => {
    it("给未打标记录补 owWorkspaceId", () => {
        const list = [rec("legacy"), rec("a", "ws1")];
        const next = tagUntaggedRecords(list, "ws2");
        expect(next).not.toBeNull();
        expect(next![0]).toEqual({ id: "legacy", owWorkspaceId: "ws2" });
        expect(next![1]).toBe(list[1]); // 已打标记录保持原引用
    });

    it("全部已打标 → 返回 null（跳过 setState）", () => {
        const list = [rec("a", "ws1"), rec("b", "ws2")];
        expect(tagUntaggedRecords(list, "ws1")).toBeNull();
    });

    it("空集合 / 无 workspaceId → null", () => {
        expect(tagUntaggedRecords([], "ws1")).toBeNull();
        expect(tagUntaggedRecords(undefined, "ws1")).toBeNull();
        expect(tagUntaggedRecords([rec("a")], null)).toBeNull();
    });
});
