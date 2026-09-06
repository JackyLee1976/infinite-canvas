import assert from "node:assert/strict";
import test from "node:test";

import { fetchOneWorkDefaultChatModel, resolveOneWorkChatModel, resolveOneWorkProjectRoot, syncWorkspaceFromOneWork, type OneWorkWorkspaceDeps } from "./workspace-sync.js";

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

test("resolveOneWorkChatModel 提取 id/modelId/provider，缺失返回 null", () => {
    assert.deepEqual(resolveOneWorkChatModel({ chatModel: { id: "m1", modelId: "deepseek-chat", provider: "deepseek" } }), { id: "m1", modelId: "deepseek-chat", provider: "deepseek" });
    assert.equal(resolveOneWorkChatModel({}), null);
    assert.equal(resolveOneWorkChatModel({ chatModel: { id: "m1" } }), null);
    assert.equal(resolveOneWorkChatModel({ chatModel: { id: " ", modelId: "x" } }), null);
    assert.equal(resolveOneWorkChatModel(null), null);
});

test("fetchOneWorkDefaultChatModel 返回快照中的默认模型", async () => {
    const model = await fetchOneWorkDefaultChatModel(config as never, {
        fetchImpl: async () => okJson({ chatModel: { id: "m1", modelId: "deepseek-chat", provider: "deepseek" } }),
    });
    assert.deepEqual(model, { id: "m1", modelId: "deepseek-chat", provider: "deepseek" });
});

test("fetchOneWorkDefaultChatModel：快照无 chatModel / fetch 失败 / 401 均返回 null", async () => {
    assert.equal(await fetchOneWorkDefaultChatModel(config as never, { fetchImpl: async () => okJson({}) }), null);
    assert.equal(await fetchOneWorkDefaultChatModel(config as never, { fetchImpl: async () => { throw new Error("down"); } }), null);
    assert.equal(await fetchOneWorkDefaultChatModel(config as never, { fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) as unknown as Response }), null);
});