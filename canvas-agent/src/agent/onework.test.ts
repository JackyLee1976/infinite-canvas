import assert from "node:assert/strict";
import test from "node:test";

import { runOneWorkTurn } from "./onework.js";

type RecordedEvent = { type: string; payload: unknown };

/** 构造一个模拟 OneWork 桥 SSE 响应的 Response（chunks 按序输出）。 */
function sseResponse(chunks: string[], status = 200): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
    });
    return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** 临时替换 globalThis.fetch，返回恢复函数。 */
function withFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): () => void {
    const original = globalThis.fetch;
    globalThis.fetch = impl as unknown as typeof fetch;
    return () => {
        globalThis.fetch = original;
    };
}

function chatMessages(events: RecordedEvent[]): string[] {
    return events
        .filter((event) => event.type === "chat_message")
        .map((event) => (event.payload as { message: { text: string } }).message.text);
}

test("onework 流式 content 增量 emit（打字机）", async () => {
    const events: RecordedEvent[] = [];
    const restore = withFetch(async () =>
        sseResponse([
            'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
            'data: [DONE]\n\n',
        ]),
    );
    try {
        await runOneWorkTurn("hi", (type, payload) => events.push({ type, payload }));
    } finally {
        restore();
    }
    const messages = chatMessages(events);
    assert.equal(messages.length, 2, "应增量 emit 两次（同 id，前端 upsert 打字机）");
    assert.equal(messages[0], "你");
    assert.equal(messages[1], "你好");
    assert.equal(events.at(-1)?.type, "agent_done");
});

test("onework 流式 tool_calls 分片合并并回传工具结果", async () => {
    const events: RecordedEvent[] = [];
    const calledTools: Array<{ name: string; input: unknown }> = [];
    let fetchCalls = 0;
    const restore = withFetch(async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
            // 首轮：tool_calls 分片（id + name + arguments 前半 / arguments 后半）
            return sseResponse([
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"add_node","arguments":"{\\"kind\\":\\"text\\","}}]}}]}\n\n',
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"title\\":\\"hi\\"}"}}]}}]}\n\n',
                'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
                'data: [DONE]\n\n',
            ]);
        }
        // 后续轮：收到 tool 结果后模型正常回复，结束
        return sseResponse([
            'data: {"choices":[{"delta":{"content":"done"}}]}\n\n',
            'data: [DONE]\n\n',
        ]);
    });
    try {
        await runOneWorkTurn("add a node", (type, payload) => events.push({ type, payload }), {
            model: "deepseek-chat",
            callTool: async (name, input) => {
                calledTools.push({ name, input });
                return { ok: true, id: "node-1" };
            },
        });
    } finally {
        restore();
    }
    // 工具被调用且参数分片已合并为完整 JSON；工具结果回传后进入下一轮对话
    assert.equal(calledTools.length, 1);
    assert.equal(calledTools[0].name, "add_node");
    assert.deepEqual(calledTools[0].input, { kind: "text", title: "hi" });
    assert.ok(fetchCalls >= 2, "工具结果应回传并继续对话，fetchCalls=" + fetchCalls);
    // 完成后 agent_done
    assert.equal(events.at(-1)?.type, "agent_done");
});

test("onework 桥不可用时给出友好错误", async () => {
    const events: RecordedEvent[] = [];
    const restore = withFetch(async () => {
        throw new TypeError("fetch failed");
    });
    try {
        await runOneWorkTurn("hi", (type, payload) => events.push({ type, payload }));
    } finally {
        restore();
    }
    const error = events.find((event) => event.type === "agent_error");
    assert.ok(error, "应 emit agent_error");
    const message = String((error?.payload as { message?: unknown }).message ?? "");
    assert.match(message, /OneWork 桥不可用/);
});

test("onework 桥返回非 2xx 时报告状态与响应", async () => {
    const events: RecordedEvent[] = [];
    const restore = withFetch(async () => jsonResponse({ error: { message: "unauthorized" } }, 401));
    try {
        await runOneWorkTurn("hi", (type, payload) => events.push({ type, payload }));
    } finally {
        restore();
    }
    const error = events.find((event) => event.type === "agent_error");
    assert.ok(error, "应 emit agent_error");
    const message = String((error?.payload as { message?: unknown }).message ?? "");
    assert.match(message, /OneWork 桥请求失败 \(401\)/);
});

test("onework 桥 SSE 内嵌 error 事件时抛出", async () => {
    const events: RecordedEvent[] = [];
    const restore = withFetch(async () =>
        sseResponse([
            'data: {"choices":[{"delta":{"content":"前"}}]}\n\n',
            'data: {"error":{"message":"模型暂时繁忙"}}\n\n',
        ]),
    );
    try {
        await runOneWorkTurn("hi", (type, payload) => events.push({ type, payload }));
    } finally {
        restore();
    }
    const error = events.find((event) => event.type === "agent_error");
    assert.ok(error, "应 emit agent_error");
    const message = String((error?.payload as { message?: unknown }).message ?? "");
    assert.match(message, /模型暂时繁忙/);
});
