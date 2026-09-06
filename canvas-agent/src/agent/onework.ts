import { AGENT_PROMPT, loadConfig } from "../config.js";
import { errorMessage } from "../utils/value.js";
import type { AgentEmit } from "./types.js";
import { toolDescriptions, toolNames } from "../canvas/schemas.js";

/**
 * OneWork AI 对话驱动（Phase 2）：把画布 Agent 的"大脑"从 Codex CLI 换成
 * OneWork 本地桥（POST http://127.0.0.1:3000/api/ai/chat，由 OneWork 进程提供，
 * 密钥在 OneWork 侧管理，AGPL 隔离不变）。
 *
 * 工具循环：chat → tool_calls → options.callTool（http.ts 注入 session.callTool，
 * 内部经 SSE 把画布写入工具发给前端执行并等待结果）→ 结果回传 → 继续。
 *
 * 事件与 Codex 前端协议对齐：chat_message / agent_error / agent_done。
 */
export type OneWorkRunOptions = {
    model?: string;
    /** 上游真实模型名（可选）：model 传 OneWork 模型配置 id（密钥查找键）时，
     * 上游 API 的 model 参数由 upstreamModel 指定（桥侧 resolve_upstream_chat_model）。 */
    upstreamModel?: string;
    provider?: string;
    callTool?: (name: string, input: unknown) => Promise<unknown>;
    onStart?: () => void;
    onFinish?: () => void;
};

const ONE_WORK_BRIDGE_URL = "http://127.0.0.1:3000/api/ai/chat";
const MAX_TOOL_ROUNDS = 8;
const DEFAULT_MODEL = "deepseek-chat";

type OpenAiToolCall = {
    id: string;
    function: { name: string; arguments: string };
};

type OpenAiChatResponse = {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: OpenAiToolCall[] | null } }>;
    error?: { message?: string };
};

export async function runOneWorkTurn(prompt: string, emit: AgentEmit, options: OneWorkRunOptions = {}) {
    options.onStart?.();
    try {
        const messages: Array<Record<string, unknown>> = [
            { role: "system", content: AGENT_PROMPT },
            { role: "user", content: prompt },
        ];
        const turnId = `onework-${Date.now()}`;
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            // 流式：chatOnce 解析 SSE，content 增量经 emit 实时上屏（前端按 id upsert 打字机）
            const resp = await chatOnce(messages, options.model || DEFAULT_MODEL, options.provider, emit, turnId, round, options.upstreamModel);
            if (resp.error?.message) throw new Error(resp.error.message);
            const choice = resp.choices?.[0];
            const msg = choice?.message || {};
            const toolCalls = (msg.tool_calls || []).filter(Boolean);
            if (!toolCalls.length) break;
            messages.push({ role: "assistant", content: (typeof msg.content === "string" && msg.content.trim() ? msg.content : null), tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: "function", function: tc.function })) });
            for (const tc of toolCalls) {
                let result: unknown;
                try {
                    const input = JSON.parse(tc.function.arguments || "{}");
                    result = options.callTool ? await options.callTool(tc.function.name, input) : { error: "工具执行器未注入" };
                } catch (error) {
                    result = { error: errorMessage(error) };
                }
                messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
            }
        }
        emit("agent_done", { agent: "onework" });
    } catch (error) {
        emit("agent_error", { message: errorMessage(error) });
    } finally {
        options.onFinish?.();
    }
}

async function chatOnce(
    messages: Array<Record<string, unknown>>,
    model: string,
    provider: string | undefined,
    emit: AgentEmit,
    turnId: string,
    round: number,
    upstreamModel?: string,
): Promise<OpenAiChatResponse> {
    const body: Record<string, unknown> = {
        model,
        upstreamModel: upstreamModel?.trim() || undefined,
        messages,
        stream: true,
        tools: toolNames.map((name) => ({
            type: "function",
            function: {
                name,
                description: toolDescriptions[name] || "",
                // 宽松参数约束（zod v3.25 无 toJSONSchema；参数由 session.callTool 的 zod schema 严格校验兜底）
                parameters: { type: "object", properties: {}, additionalProperties: true },
            },
        })),
    };
    if (provider) body.provider = provider;
    let resp: Response;
    try {
        // 桥鉴权：携带与 canvas-agent 同一的 token（OneWork canvas_host 按该 token 校验）
        const config = loadConfig();
        resp = await fetch(ONE_WORK_BRIDGE_URL, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
            body: JSON.stringify(body),
        });
    } catch {
        throw new Error("OneWork 桥不可用：请确认 OneWork 应用正在运行（画布对话经 OneWork 本地桥转发）");
    }
    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`OneWork 桥请求失败 (${resp.status})：${text.slice(0, 300)}`);
    }
    if (!resp.body) throw new Error("OneWork 桥响应缺少 body");
    // 解析 SSE（data: 行）：content 增量实时 emit（前端按同 id upsert → 打字机），
    // tool_calls 按 index 合并分片（OpenAI 流式函数参数分片累积）。
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let lastEmitted = "";
    const toolCalls: Array<{ index: number; id?: string; name?: string; arguments: string }> = [];
    const emitIncrement = () => {
        if (content && content !== lastEmitted) {
            lastEmitted = content;
            emit("chat_message", {
                message: { id: `${turnId}:${round}`, itemId: "assistant", role: "assistant", text: content },
            });
        }
    };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let chunk: unknown;
            try {
                chunk = JSON.parse(data);
            } catch {
                continue;
            }
            const parsed = chunk as {
                choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }>;
                error?: { message?: string };
            };
            if (parsed.error?.message) throw new Error(parsed.error.message);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
                content += delta.content;
                emitIncrement();
            }
            if (Array.isArray(delta?.tool_calls)) {
                for (const tc of delta.tool_calls) {
                    const index = tc.index ?? 0;
                    const entry = toolCalls[index] ?? { index, arguments: "" };
                    if (tc.id) entry.id = tc.id;
                    if (tc.function?.name) entry.name = tc.function.name;
                    if (tc.function?.arguments) entry.arguments += tc.function.arguments;
                    toolCalls[index] = entry;
                }
            }
        }
    }
    // 确保最后一段增量上屏（含 tool_calls 轮的无文本场景由 runOneWorkTurn 处理）
    emitIncrement();
    const mergedToolCalls = toolCalls
        .filter((call) => Boolean(call.name || call.id))
        .map((call) => ({
            id: call.id ?? `call_${call.index}`,
            function: { name: call.name ?? "", arguments: call.arguments || "{}" },
        }));
    return {
        choices: [
            {
                message: {
                    content: content || null,
                    tool_calls: mergedToolCalls.length ? mergedToolCalls : null,
                },
            },
        ],
    };
}
