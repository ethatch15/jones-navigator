// Jones Navigator API: a Cloudflare Worker that keeps the OpenAI key secret.
// The public website (GitHub Pages) sends the chat history here. This Worker adds the
// Jones Navigator instructions and knowledge files, calls OpenAI, and returns the reply.

import { SYSTEM_PROMPT } from "./knowledge.js";

const MAX_MESSAGES = 20;          // conversation turns sent per request
const MAX_CHARS_PER_MESSAGE = 4000;
const MAX_TOTAL_CHARS = 40000;

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
  const msgs = raw.slice(-MAX_MESSAGES);
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

// Pull the reply text and any web citations out of an OpenAI Responses API result.
function readResponse(data) {
  let text = "";
  const sources = [];
  const seen = new Set();
  for (const item of data.output || []) {
    if (item.type !== "message") continue;
    for (const part of item.content || []) {
      if (part.type !== "output_text") continue;
      text += part.text;
      for (const a of part.annotations || []) {
        if (a.type === "url_citation" && a.url && !seen.has(a.url)) {
          seen.add(a.url);
          sources.push({ url: a.url, title: a.title || "" });
        }
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

    if (!env.OPENAI_API_KEY) {
      return json({ error: "The server is missing its OpenAI API key." }, 500, cors.headers);
    }

    const payload = {
      model: env.MODEL || "gpt-5-mini",
      instructions: SYSTEM_PROMPT,
      input: messages,
      max_output_tokens: Number(env.MAX_OUTPUT_TOKENS || 6000),
      store: false,
    };
    if (env.REASONING_EFFORT) payload.reasoning = { effort: env.REASONING_EFFORT };
    if (env.WEB_SEARCH === "on") payload.tools = [{ type: "web_search" }];

    let res;
    try {
      res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      return json({ error: "Couldn't reach OpenAI. Try again in a moment." }, 502, cors.headers);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log("OpenAI error", res.status, JSON.stringify(data.error || data));
      const msg = res.status === 429
        ? "Jones Navigator is busy or has reached its usage limit. Try again later."
        : "The AI service returned an error. Try again in a moment.";
      return json({ error: msg }, 502, cors.headers);
    }

    const { text, sources } = readResponse(data);
    if (!text) {
      return json({ error: "The answer came back empty, probably because it ran too long. Try a narrower question." }, 502, cors.headers);
    }
    return json({ reply: text, sources }, 200, cors.headers);
  },
};
