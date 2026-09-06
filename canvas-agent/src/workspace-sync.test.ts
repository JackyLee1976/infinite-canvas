import assert from "node:assert/strict";
import test from "node:test";

import { resolveOneWorkProjectRoot, syncWorkspaceFromOneWork, type OneWorkWorkspaceDeps } from "./workspace-sync.js";

const config = { url: "http://127.0.0.1:17371", token: "test-token" };

const okJson = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

const deps = (overrides: Partial<OneWorkWorkspaceDeps>): OneWorkWorkspaceDeps => ({
    getCurrentWorkspacePath: () => "C:\\default-site",
    applyWorkspacePath: () => {},
    ...overrides,
});

test("resolveOneWorkProjectRoot 优先 projectRoot 再 taskDataDir", () => {
    assert.equal(resolveOneWorkProjectRoot({ projectRoot: "L:\\proj", taskDataDir: "L:\\task" }), "L:\\proj");
    assert.equal(resolveOneWorkProjectRoot({ taskDataDir: "L:\\task" }), "L:\\task");
    assert.equal(resolveOneWorkProjectRoot({}), "");
    assert.equal(resolveOneWorkProjectRoot(null), "");
    assert.equal(resolveOneWorkProjectRoot({ projectRoot: "  " }), "");
});

test("syncWorkspaceFromOneWork：桥返回新 projectRoot 时应用新工作区", async () => {
    let applied = "";
    const result = await syncWorkspaceFromOneWork(config as never, deps({
        fetchImpl: async () => okJson({ projectRoot: "L:\\proj-a", taskDataDir: "L:\\task" }),
        applyWorkspacePath: (p) => { applied = p; },
    }));
    assert.equal(applied, "L:\\proj-a");
    assert.equal(result, "L:\\proj-a");
});

test("syncWorkspaceFromOneWork：桥返回相同 projectRoot 时不更新", async () => {
    let applied = "";
    const result = await syncWorkspaceFromOneWork(config as never, deps({
        fetchImpl: async () => okJson({ projectRoot: "C:\\default-site" }),
        applyWorkspacePath: (p) => { applied = p; },
    }));
    assert.equal(applied, "");
    assert.equal(result, null);
});

test("syncWorkspaceFromOneWork：桥只有 taskDataDir 时用它", async () => {
    let applied = "";
    const result = await syncWorkspaceFromOneWork(config as never, deps({
        fetchImpl: async () => okJson({ taskDataDir: "L:\\task-dir" }),
        applyWorkspacePath: (p) => { applied = p; },
    }));
    assert.equal(applied, "L:\\task-dir");
    assert.equal(result, "L:\\task-dir");
});

test("syncWorkspaceFromOneWork：fetch 失败静默返回 null", async () => {
    const result = await syncWorkspaceFromOneWork(config as never, deps({
        fetchImpl: async () => { throw new Error("bridge down"); },
    }));
    assert.equal(result, null);
});

test("syncWorkspaceFromOneWork：鉴权失败（401）返回 null", async () => {
    const result = await syncWorkspaceFromOneWork(config as never, deps({
        fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) as unknown as Response,
    }));
    assert.equal(result, null);
});

test("syncWorkspaceFromOneWork：桥返回空快照返回 null 不更新", async () => {
    let applied = "";
    const result = await syncWorkspaceFromOneWork(config as never, deps({
        fetchImpl: async () => okJson({}),
        applyWorkspacePath: (p) => { applied = p; },
    }));
    assert.equal(applied, "");
    assert.equal(result, null);
});