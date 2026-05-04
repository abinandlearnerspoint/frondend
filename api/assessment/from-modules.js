// Vercel serverless: POST JSON body → backend POST /api/v1/courseware-assessments/from-modules
// Keeps ASSESSMENT_API_KEY on the server (same env as other assessment proxy routes).

const BACKEND_URL = process.env.ASSESSMENT_BACKEND_URL || "";
const API_KEY = process.env.ASSESSMENT_API_KEY || "";
const UPSTREAM_TIMEOUT_MS = Number(process.env.ASSESSMENT_UPSTREAM_TIMEOUT_MS || 110_000);

function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("INVALID_JSON");
  }
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return jsonResponse(res, 405, { error: "Method not allowed." });
  }
  if (!BACKEND_URL) {
    return jsonResponse(res, 500, {
      error: "ASSESSMENT_BACKEND_URL is not configured on the Vercel project.",
    });
  }
  if (!API_KEY) {
    return jsonResponse(res, 500, {
      error: "ASSESSMENT_API_KEY is not configured on the Vercel project.",
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    if (e && e.message === "INVALID_JSON") {
      return jsonResponse(res, 400, { error: "Request body must be valid JSON." });
    }
    throw e;
  }

  const upstreamUrl = `${BACKEND_URL.replace(/\/$/, "")}/api/v1/courseware-assessments/from-modules`;

  let upstreamRes;
  try {
    upstreamRes = await fetchWithTimeout(
      upstreamUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-API-Key": API_KEY,
          "ngrok-skip-browser-warning": "true",
          "User-Agent": "lp-assessment-proxy/1.0 (+vercel)",
        },
        body: JSON.stringify(body),
      },
      UPSTREAM_TIMEOUT_MS,
    );
  } catch (err) {
    const aborted = err && err.name === "AbortError";
    return jsonResponse(res, aborted ? 504 : 502, {
      error: aborted
        ? "Question generation is taking longer than expected. Please try again."
        : "Could not reach the assessment backend.",
      detail: err && err.message ? String(err.message) : undefined,
    });
  }

  const contentType = upstreamRes.headers.get("content-type") || "";
  const rawText = await upstreamRes.text();
  let out;
  if (contentType.includes("application/json")) {
    try {
      out = JSON.parse(rawText);
    } catch {
      out = {
        error: "Backend returned malformed JSON.",
        upstream_status: upstreamRes.status,
        upstream_content_type: contentType,
        upstream_excerpt: rawText.slice(0, 500),
      };
    }
  } else {
    out = {
      error: "Backend returned a non-JSON response.",
      upstream_status: upstreamRes.status,
      upstream_content_type: contentType || "(none)",
      upstream_excerpt: rawText.slice(0, 500),
    };
  }
  const retryAfter = upstreamRes.headers.get("Retry-After");
  if (retryAfter) res.setHeader("Retry-After", retryAfter);
  const finalStatus =
    !contentType.includes("application/json") && upstreamRes.status === 200
      ? 502
      : upstreamRes.status;
  return jsonResponse(res, finalStatus, out);
}
