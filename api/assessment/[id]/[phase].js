// Vercel Serverless Function (Node.js runtime, ESM).
//
// Server-side proxy for the courseware-assessments backend so that:
//   * X-API-Key never reaches the browser (kept in Vercel env: ASSESSMENT_API_KEY).
//   * The optional signed link token (?t=...) is forwarded transparently.
//   * Per-request difficulty / num_questions are passed through.
//
// Public URL: https://<vercel-app>/api/assessment/<zoho_record_id>/<pre|post>
//
// Each call hits the backend FRESH (no cache here, no cache there) — pair this
// with the client-side sessionStorage hold in AssessmentApp.tsx for refresh
// safety per the plan.

const BACKEND_URL = process.env.ASSESSMENT_BACKEND_URL || "";
const API_KEY = process.env.ASSESSMENT_API_KEY || "";
// 110s — Vercel hobby plan caps Node functions at 10s, Pro at 60s, Enterprise
// 300s. The frontend client also enforces a 90s soft timeout. Tune via env.
const UPSTREAM_TIMEOUT_MS = Number(process.env.ASSESSMENT_UPSTREAM_TIMEOUT_MS || 110_000);

function jsonResponse(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.end(JSON.stringify(body));
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
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
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

  const { id, phase } = req.query || {};
  const recordId = String(id || "").trim();
  const phaseNorm = String(phase || "").toLowerCase() === "post" ? "post" : "pre";
  if (!recordId) {
    return jsonResponse(res, 400, { error: "Missing zoho_record_id." });
  }

  // Forward whitelisted query params only.
  const upstreamParams = new URLSearchParams();
  for (const key of ["difficulty", "num_questions", "t"]) {
    const v = req.query?.[key];
    if (typeof v === "string" && v.trim()) {
      upstreamParams.set(key, v.trim());
    }
  }
  const qs = upstreamParams.toString();
  const upstreamUrl =
    `${BACKEND_URL.replace(/\/$/, "")}/api/v1/courseware-assessments/` +
    `${encodeURIComponent(recordId)}/${phaseNorm}${qs ? `?${qs}` : ""}`;

  let upstreamRes;
  try {
    upstreamRes = await fetchWithTimeout(
      upstreamUrl,
      {
        method: req.method,
        headers: {
          "X-API-Key": API_KEY,
          Accept: "application/json",
          // Bypass ngrok free-tier browser warning interstitial. Harmless when
          // the backend is hosted elsewhere (non-ngrok hosts ignore it).
          "ngrok-skip-browser-warning": "true",
          // Identify ourselves as a non-browser client so ngrok / Cloudflare /
          // any reverse proxy forwards us straight through.
          "User-Agent": "lp-assessment-proxy/1.0 (+vercel)",
        },
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

  // Read once as text, then try JSON. This way, if the upstream returns HTML
  // (e.g. ngrok warning page, FastAPI 500 page, Cloudflare error), we can
  // surface the actual content-type + status + first bytes for debugging
  // instead of the opaque "non-JSON response" message.
  const contentType = upstreamRes.headers.get("content-type") || "";
  const rawText = await upstreamRes.text();
  let body;
  if (contentType.includes("application/json")) {
    try {
      body = JSON.parse(rawText);
    } catch {
      body = {
        error: "Backend returned malformed JSON.",
        upstream_status: upstreamRes.status,
        upstream_content_type: contentType,
        upstream_excerpt: rawText.slice(0, 500),
      };
    }
  } else {
    body = {
      error:
        "Backend returned a non-JSON response (likely an ngrok warning, gateway error, or HTML page).",
      upstream_status: upstreamRes.status,
      upstream_content_type: contentType || "(none)",
      upstream_excerpt: rawText.slice(0, 500),
    };
  }
  // Surface upstream rate-limit headers transparently so the client can show
  // a friendly message.
  const retryAfter = upstreamRes.headers.get("Retry-After");
  if (retryAfter) {
    res.setHeader("Retry-After", retryAfter);
  }
  // If the upstream was non-JSON, force a 502 so the client treats it as an
  // error and shows the Try-Again button rather than a "200 OK with no
  // questions" empty screen.
  const finalStatus =
    !contentType.includes("application/json") && upstreamRes.status === 200
      ? 502
      : upstreamRes.status;
  return jsonResponse(res, finalStatus, body);
}
