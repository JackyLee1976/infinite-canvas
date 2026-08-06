import { AGENT_PROMPT } from "../config.js";
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
            const resp = await chatOnce(messages, options.model || DEFAULT_MODEL, options.provider);
            if (resp.error?.message) throw new Error(resp.error.message);
            const choice = resp.choices?.[0];
            const msg = choice?.message || {};
            const content = typeof msg.content === "string" && msg.content.trim() ? msg.content : "";
            const toolCalls = (msg.tool_calls || []).filter(Boolean);
            if (content) {
                emit("chat_message", {
                    message: { id: `${turnId}:${round}`, itemId: "assistant", role: "assistant", text: content },
                });
            }
            if (!toolCalls.length) break;
            messages.push({ role: "assistant", content: content || null, tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: "function", function: tc.function })) });
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

async function chatOnce(messages: Array<Record<string, unknown>>, model: string, provider?: string): Promise<OpenAiChatResponse> {
    const body: Record<string, unknown> = {
        model,
        messages,
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
        resp = await fetch(ONE_WORK_BRIDGE_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
    } catch {
        throw new Error("OneWork 桥不可用：请确认 OneWork 应用正在运行（画布对话经 OneWork 本地桥转发）");
    }
    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`OneWork 桥请求失败 (${resp.status})：${text.slice(0, 300)}`);
    }
    return (await resp.json()) as OpenAiChatResponse;
}
