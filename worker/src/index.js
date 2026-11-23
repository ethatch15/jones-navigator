// Jones Navigator API: a Cloudflare Worker that keeps the Claude API key secret.
// The public website (GitHub Pages) sends the chat history here. This Worker adds the
// Jones Navigator instructions and knowledge files, calls Claude, and returns the reply.

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./knowledge.js";

const MAX_MESSAGES = 20;          // conversation turns sent per request
const MAX_CHARS_PER_MESSAGE = 4000;
const MAX_TOTAL_CHARS = 40000;
const MAX_ROUNDS = 5;             // model calls per question (web-search pauses + schedule edits)

const TERMS = { "1yf": "1Y Fall", "1ys": "1Y Spring", "2yf": "2Y Fall", "2ys": "2Y Spring" };
const DAYS = ["M", "T", "W", "Th", "F"];
const MAX_COURSES = 12;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Client tool: Claude replaces one term's course list in the student's Class schedule tab.
// The Worker validates the edit and returns it to the browser, which applies it.
const SCHEDULE_TOOL = {
  name: "update_schedule",
  description:
    "Replace the full course list for one term in the student's Class schedule tab. Use this only when the student asks you to add, remove, rename, or retime courses in their schedule. Send the complete list for that term (keep every course that should stay, unchanged), not just the changes. Times are 24-hour HH:MM, or empty strings when the meeting time is unknown. Never invent section times; leave days and times empty unless the student gave them.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["term", "courses"],
    properties: {
      term: { type: "string", enum: Object.keys(TERMS), description: "1yf = 1Y Fall, 1ys = 1Y Spring, 2yf = 2Y Fall, 2ys = 2Y Spring" },
      courses: {
        type: "array",
        description: "Every course for this term after the change, in display order.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "days", "start", "end"],
          properties: {
            name: { type: "string", description: "Course name, e.g. 'Corporate Finance'" },
            days: { type: "array", items: { type: "string", enum: DAYS }, description: "Meeting days; empty if unknown" },
            start: { type: "string", description: "Start time as 24-hour HH:MM, or empty string" },
            end: { type: "string", description: "End time as 24-hour HH:MM, or empty string" },
          },
        },
      },
    },
  },
};

// Returns a cleaned {term, courses} or an error string.
function validateScheduleEdit(input) {
  if (!input || typeof input !== "object") return "Input must be an object.";
  if (!TERMS[input.term]) return "term must be one of 1yf, 1ys, 2yf, 2ys.";
  if (!Array.isArray(input.courses)) return "courses must be an array.";
  if (input.courses.length > MAX_COURSES) return `A term can hold at most ${MAX_COURSES} courses.`;
  const courses = [];
  for (const c of input.courses) {
    if (!c || typeof c.name !== "string" || !c.name.trim() || c.name.length > 80) return "Each course needs a name under 80 characters.";
    if (!Array.isArray(c.days) || c.days.some((d) => !DAYS.includes(d))) return "days may only contain M, T, W, Th, F.";
    const start = typeof c.start === "string" ? c.start : "";
    const end = typeof c.end === "string" ? c.end : "";
    if ((start && !TIME_RE.test(start)) || (end && !TIME_RE.test(end))) return "Times must be 24-hour HH:MM or empty.";
    if (start && end && end <= start) return `"${c.name}" ends before it starts.`;
    courses.push({ name: c.name.trim(), days: DAYS.filter((d) => c.days.includes(d)), start, end });
  }
  return { term: input.term, courses };
}

// Accepts the browser's copy of the schedule; returns readable text for Claude, or "" if missing/invalid.
function describeSchedule(raw) {
  if (!Array.isArray(raw)) return "";
  const lines = [];
  for (const t of raw.slice(0, 4)) {
    if (!t || !TERMS[t.term] || !Array.isArray(t.courses)) continue;
    lines.push(`${TERMS[t.term]} (${t.term}):`);
    if (!t.courses.length) lines.push("  (no courses)");
    for (const c of t.courses.slice(0, MAX_COURSES)) {
      const name = String((c && c.name) || "Untitled").slice(0, 80).replace(/[<>]/g, "");
      const days = Array.isArray(c.days) ? c.days.filter((d) => DAYS.includes(d)).join("/") : "";
      const time = TIME_RE.test(c.start || "") && TIME_RE.test(c.end || "") ? ` ${c.start}-${c.end}` : "";
      lines.push(`  - ${name}${days || time ? ` (${days || "no days"}${time})` : " (no time set)"}`);
    }
  }
  return lines.join("\n");
}

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

// Normalize a URL for comparison: no protocol, no country subdomain, no query or trailing slash.
function normUrl(u) {
  try {
    const x = new URL(u);
    const host = x.hostname.toLowerCase().replace(/^([a-z]{2}|www)\./, "");
    return host + decodeURIComponent(x.pathname).toLowerCase().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

// Every URL that web search actually returned in this message.
function collectSearchUrls(message, into) {
  for (const block of message.content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (r && r.url) into.add(normUrl(r.url));
    }
    if (block.type === "text") {
      for (const c of block.citations || []) if (c.url) into.add(normUrl(c.url));
    }
  }
}

// Remove links to individual LinkedIn profiles that didn't come from a search result,
// so the bot can't hand students a made-up profile URL.
function dropUnverifiedProfileLinks(text, seen) {
  let removed = 0;
  const out = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]*linkedin\.com\/in\/[^)\s]*)\)/gi, (all, label, url) => {
    if (seen.has(normUrl(url))) return all;
    removed++;
    return `${label} (LinkedIn link not verified)`;
  }).replace(/(^|[\s(<])(https?:\/\/[^\s)>]*linkedin\.com\/in\/[^\s)>]*)/gi, (all, pre, url) => {
    if (seen.has(normUrl(url))) return all;
    removed++;
    return `${pre}(LinkedIn link not verified)`;
  });
  return { text: out, removed };
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
    const tools = [SCHEDULE_TOOL];
    if (env.WEB_SEARCH === "on") {
      // Open web: rice.edu for Rice facts, plus LinkedIn and other public pages for finding alumni.
      tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 10 });
    }

    // Attach the student's current Class schedule to their latest message so Claude can read and edit it.
    const convo = [...messages];
    const schedText = describeSchedule(body.schedule);
    if (schedText) {
      const last = convo[convo.length - 1];
      convo[convo.length - 1] = {
        role: "user",
        content: [
          { type: "text", text: last.content },
          { type: "text", text: `<current_class_schedule>\n${schedText}\n</current_class_schedule>` },
        ],
      };
    }

    const scheduleUpdates = [];
    const searchUrls = new Set();
    let message;
    try {
      for (let i = 0; i < MAX_ROUNDS; i++) {
        message = await client.beta.messages
          .stream({
            model: env.MODEL || "claude-opus-5-5",
            max_tokens: Number(env.MAX_TOKENS || 16000),
            // The instructions and knowledge files are identical on every request, so cache them.
            system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
            output_config: { effort: env.EFFORT || "low" },
            tools,
            // If Claude declines a request on policy grounds, let the API retry on a fallback model.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            messages: convo,
          })
          .finalMessage();
        collectSearchUrls(message, searchUrls);
        if (message.stop_reason === "pause_turn") {
          // Web search paused mid-turn: send the partial turn back so the server resumes it.
          convo.push({ role: "assistant", content: message.content });
          continue;
        }
        if (message.stop_reason !== "tool_use") break;

        // Claude asked to edit the schedule: validate each edit, record it for the browser,
        // and tell Claude whether it was saved.
        convo.push({ role: "assistant", content: message.content });
        const results = [];
        for (const block of message.content) {
          if (block.type !== "tool_use") continue;
          if (block.name !== SCHEDULE_TOOL.name) {
            results.push({ type: "tool_result", tool_use_id: block.id, content: "Unknown tool.", is_error: true });
            continue;
          }
          const edit = validateScheduleEdit(block.input);
          if (typeof edit === "string") {
            results.push({ type: "tool_result", tool_use_id: block.id, content: `Not saved: ${edit}`, is_error: true });
          } else {
            scheduleUpdates.push(edit);
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: `Saved. The student's ${TERMS[edit.term]} schedule now has ${edit.courses.length} course(s). Tell them what changed and that they can review or undo it in the Class schedule tab.`,
            });
          }
        }
        convo.push({ role: "user", content: results });
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

    const read = readResponse(message);
    const sources = read.sources;
    const checked = dropUnverifiedProfileLinks(read.text, searchUrls);
    if (checked.removed) console.log("Removed unverified LinkedIn links:", checked.removed);
    const text = checked.text;
    if (!text && !scheduleUpdates.length) {
      return json({ error: "The answer came back empty. Try a narrower question." }, 502, cors.headers);
    }
    return json({ reply: text || "I updated your schedule.", sources, scheduleUpdates }, 200, cors.headers);
  },
};
