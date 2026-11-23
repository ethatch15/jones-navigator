// Jones Navigator API: a Cloudflare Worker that keeps the Claude API key secret.
// The public website (GitHub Pages) sends the chat history here. This Worker adds the
// Jones Navigator instructions and knowledge files, calls Claude, and returns the reply.

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./knowledge.js";

const MAX_MESSAGES = 20;          // conversation turns sent per request
const MAX_CHARS_PER_MESSAGE = 4000;
const MAX_TOTAL_CHARS = 40000;
const MAX_CONTINUATIONS = 3;      // resumes after a web-search pause_turn

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    ok,
    headers: {
      "Access-Control-Allow-Origin": ok ? origin : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    },
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function cleanMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  let msgs = raw.slice(-MAX_MESSAGES);
  // The conversation must start with a user turn.
  while (msgs.length && msgs[0].role !== "user") msgs = msgs.slice(1);
  if (!msgs.length) return null;
  let total = 0;
  for (const m of msgs) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return null;
    if (typeof m.content !== "string" || m.content.length === 0) return null;
    if (m.content.length > MAX_CHARS_PER_MESSAGE) return null;
    total += m.content.length;
  }
  if (total > MAX_TOTAL_CHARS) return null;
  if (msgs[msgs.length - 1].role !== "user") return null;
  return msgs.map((m) => ({ role: m.role, content: m.content }));
}

// Pull the reply text and any web-search citations out of a Claude response.
function readResponse(message) {
  let text = "";
  const sources = [];
  const seen = new Set();
  for (const block of message.content) {
    if (block.type !== "text") continue;
    text += block.text;
    for (const c of block.citations || []) {
      if (c.type === "web_search_result_location" && c.url && !seen.has(c.url)) {
        seen.add(c.url);
        sources.push({ url: c.url, title: c.title || "" });
      }
    }
  }
  return { text: text.trim(), sources: sources.slice(0, 6) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: cors.ok ? 204 : 403, headers: cors.headers });
    }
    if (url.pathname === "/" && request.method === "GET") {
      return json({ status: "Jones Navigator API is running" }, 200, cors.headers);
    }
    if (url.pathname !== "/chat" || request.method !== "POST") {
      return json({ error: "Not found" }, 404, cors.headers);
    }
    if (!cors.ok) {
      return json({ error: "This site isn't allowed to use the Jones Navigator API." }, 403, cors.headers);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "The request wasn't valid JSON." }, 400, cors.headers);
    }
    const messages = cleanMessages(body && body.messages);
    if (!messages) {
      return json({ error: `Messages must be under ${MAX_CHARS_PER_MESSAGE} characters each. Try a shorter question or start a new chat.` }, 400, cors.headers);
    }

    // Local testing without an API key: set MOCK = "1" in .dev.vars
    if (env.MOCK === "1") {
      const last = messages[messages.length - 1].content;
      return json({
        reply: `**Test mode.** The Worker received your message:\n\n> ${last}\n\n| Term | Focus |\n|---|---|\n| 1Y Fall | Explore and join clubs |\n| 1Y Spring | Land the internship |\n\nWhere to go: [Career Development Office](https://cdo.business.rice.edu)`,
        sources: [{ url: "https://business.rice.edu", title: "Rice Business" }],
      }, 200, cors.headers);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: "The server is missing its Claude API key." }, 500, cors.headers);
    }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const tools = env.WEB_SEARCH === "on"
      ? [{ type: "web_search_20260209", name: "web_search", max_uses: 3, allowed_domains: ["rice.edu"] }]
      : undefined;

    const convo = [...messages];
    let message;
    try {
      for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
        message = await client.beta.messages
          .stream({
            model: env.MODEL || "claude-opus-5-5",
            max_tokens: Number(env.MAX_TOKENS || 16000),
            // The instructions and knowledge files are identical on every request, so cache them.
            system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
            output_config: { effort: env.EFFORT || "low" },
            ...(tools ? { tools } : {}),
            // If Claude declines a request on policy grounds, let the API retry on a fallback model.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            messages: convo,
          })
          .finalMessage();
        if (message.stop_reason !== "pause_turn") break;
        // Web search paused mid-turn: send the partial turn back so the server resumes it.
        convo.push({ role: "assistant", content: message.content });
      }
    } catch (err) {
      const status = err && err.status;
      console.log("Claude API error", status, err && err.message);
      const msg = status === 429 || status === 529
        ? "Jones Navigator is busy right now. Try again in a minute."
        : status === 401
          ? "The server's Claude API key isn't valid."
          : status === 400 && /credit|billing/i.test((err && err.message) || "")
            ? "Jones Navigator has run out of API credit. Let the site owner know."
            : "The AI service returned an error. Try again in a moment.";
      return json({ error: msg }, 502, cors.headers);
    }

    if (message.stop_reason === "refusal") {
      return json({ error: "Jones Navigator can't help with that request. Try asking about Rice Business resources, clubs, alumni, or your MBA plan." }, 200, cors.headers);
    }

    const { text, sources } = readResponse(message);
    if (!text) {
      return json({ error: "The answer came back empty. Try a narrower question." }, 502, cors.headers);
    }
    return json({ reply: text, sources }, 200, cors.headers);
  },
};
