// AGEWEC 2026 — Cloudflare Worker
// Handles /api/* against D1; everything else falls through to static assets.
//
// Auth model: /judge and /admin PATHS are protected by Cloudflare Access
// (configured in the dashboard, not here). Access injects the verified email
// in the `Cf-Access-Authenticated-User-Email` header. The Worker re-checks
// that email against the `judges` table for role, so the API is not trusted
// to the page alone.

const FORM_VERSION = "v0.2";
const RULES_VERSION = "v0.1";
const PRIVACY_VERSION = "v0.1";
const RUBRIC_VERSION = "v0.2";

const REQUIRED_TEXT = ["title", "author", "email", "video_url", "ai_tools", "workflow", "description"];
const REQUIRED_CONSENT = ["c_rules", "c_rights", "c_url", "c_license", "c_thirdparty", "c_privacy"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const text = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers });

function rid(prefix) {
  const a = crypto.getRandomValues(new Uint8Array(8));
  return prefix + Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function getUser(env, request) {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!email) return null;
  const row = await env.DB.prepare(
    "SELECT email, name, role, active FROM judges WHERE email = ?1"
  ).bind(email.toLowerCase()).first();
  if (!row || !row.active) return null;
  return row;
}

async function getSetting(env, key) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = ?1").bind(key).first();
  return r ? r.value : null;
}

// ---- Turnstile (optional) ----
async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true; // not configured → skip
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const out = await res.json();
  return !!out.success;
}

// ---- Email (scaffold) ----
// Cloudflare's free MailChannels route was discontinued; wire your provider here
// (Resend, SendGrid, Postmark, etc.) using a secret API key. Left as no-op so
// submission never fails because email is not configured yet.
async function sendConfirmationEmail(env, to, title) {
  // TODO: integrate an email provider via env.<PROVIDER>_API_KEY
  return;
}

// ---- /api/submit ----
async function handleSubmit(env, request) {
  if ((await getSetting(env, "submissions_open")) !== "1") {
    return json({ error: "closed" }, 403);
  }
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const ip = request.headers.get("CF-Connecting-IP");
  if (!(await verifyTurnstile(env, data["cf-turnstile-response"], ip))) {
    return json({ error: "turnstile" }, 403);
  }

  // Normalize incoming keys (form sends camelCase) to canonical snake_case.
  const pick = (...keys) => {
    for (const k of keys) if (data[k] != null && data[k] !== "") return data[k];
    return "";
  };
  const s = {
    title: pick("title"),
    author: pick("author"),
    email: pick("email"),
    affiliation: pick("affiliation"),
    country: pick("country"),
    video_url: pick("videoUrl", "video_url"),
    ai_tools: pick("aiTools", "ai_tools"),
    assets: pick("assets"),
    workflow: pick("workflow"),
    screenshot_url: pick("screenshot", "screenshot_url"),
    license_category: pick("license", "license_category"),
    description: pick("description"),
    repo_url: pick("repo", "repo_url"),
    sns: pick("sns"),
    local_env: pick("localenv", "local_env"),
  };

  for (const f of REQUIRED_TEXT) {
    if (!s[f] || String(s[f]).trim() === "") return json({ error: "missing:" + f }, 400);
  }
  for (const c of REQUIRED_CONSENT) {
    if (!data[c]) return json({ error: "consent:" + c }, 400);
  }

  const id = rid("sub_");
  const now = new Date().toISOString();
  const b = (v) => (v ? 1 : 0);

  await env.DB.prepare(
    `INSERT INTO submissions
      (id, created_at, title, author, email, affiliation, country,
       video_url, ai_tools, assets, workflow, screenshot_url, license_category,
       description, repo_url, sns, local_env,
       c_rules, c_rights, c_url, c_license, c_thirdparty, c_privacy, c_pr, c_guardian,
       form_version, rules_version, privacy_version, status)
     VALUES
      (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,
       ?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,'received')`
  ).bind(
    id, now,
    s.title, s.author, s.email, s.affiliation, s.country,
    s.video_url, s.ai_tools, s.assets,
    s.workflow, s.screenshot_url, s.license_category,
    s.description, s.repo_url, s.sns, s.local_env,
    b(data.c_rules), b(data.c_rights), b(data.c_url), b(data.c_license), b(data.c_thirdparty),
    b(data.c_privacy), b(data.c_pr), b(data.c_guardian),
    FORM_VERSION, RULES_VERSION, PRIVACY_VERSION
  ).run();

  await sendConfirmationEmail(env, data.email, data.title);
  return json({ ok: true, id });
}

// ---- /api/entries (public) ----
async function handleEntries(env) {
  const { results } = await env.DB.prepare(
    `SELECT title, author, affiliation, description, video_url, ai_tools, award
       FROM submissions
      WHERE is_public = 1 AND disqualified = 0
      ORDER BY (award <> '') DESC, created_at ASC`
  ).all();
  return json({ entries: results || [] });
}

// ---- /api/judge/* ----
async function handleJudgeMe(user) {
  return json({ email: user.email, name: user.name, role: user.role });
}

async function handleJudgeAssignments(env, user) {
  // If this judge has explicit assignments, show those; else show all in 'judging'.
  const assigned = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM assignments WHERE judge_email = ?1"
  ).bind(user.email).first();

  let rows;
  if (assigned && assigned.n > 0) {
    rows = (await env.DB.prepare(
      `SELECT s.* FROM submissions s
         JOIN assignments a ON a.submission_id = s.id
        WHERE a.judge_email = ?1 AND s.disqualified = 0
        ORDER BY s.created_at ASC`
    ).bind(user.email).all()).results;
  } else {
    rows = (await env.DB.prepare(
      `SELECT * FROM submissions
        WHERE status IN ('judging','finalist') AND disqualified = 0
        ORDER BY created_at ASC`
    ).all()).results;
  }

  // attach this judge's own score (if any)
  const myScores = (await env.DB.prepare(
    "SELECT * FROM scores WHERE judge_email = ?1"
  ).bind(user.email).all()).results || [];
  const byId = {};
  for (const sc of myScores) byId[sc.submission_id] = sc;

  const entries = (rows || []).map((r) => ({
    ...r,
    myScore: byId[r.id] || null,
    scored: !!byId[r.id],
  }));
  return json({ judge: user.name || user.email, entries });
}

async function handleJudgeScore(env, user, request) {
  let d;
  try { d = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!d.submission_id) return json({ error: "missing:submission_id" }, 400);

  const clamp = (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 3) return null;
    return n;
  };
  const c = [d.c1, d.c2, d.c3, d.c4, d.c5, d.c6].map(clamp);
  if (c.some((x) => x === null)) return json({ error: "score_range" }, 400);

  await env.DB.prepare(
    `INSERT INTO scores (submission_id, judge_email, c1,c2,c3,c4,c5,c6, comment, rubric_version, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
     ON CONFLICT(submission_id, judge_email) DO UPDATE SET
       c1=?3,c2=?4,c3=?5,c4=?6,c5=?7,c6=?8, comment=?9, rubric_version=?10, updated_at=?11`
  ).bind(
    d.submission_id, user.email, c[0], c[1], c[2], c[3], c[4], c[5],
    d.comment || "", RUBRIC_VERSION, new Date().toISOString()
  ).run();

  return json({ ok: true });
}

// ---- /api/admin/* ----
async function handleAdminSubmissions(env) {
  const subs = (await env.DB.prepare("SELECT * FROM submissions ORDER BY created_at ASC").all()).results || [];
  const scores = (await env.DB.prepare("SELECT * FROM scores").all()).results || [];
  const grouped = {};
  for (const s of scores) {
    (grouped[s.submission_id] = grouped[s.submission_id] || []).push(s);
  }
  const out = subs.map((s) => {
    const sc = grouped[s.id] || [];
    const avg = (k) => sc.length ? sc.reduce((a, x) => a + (x[k] || 0), 0) / sc.length : null;
    const total = sc.length
      ? sc.reduce((a, x) => a + (x.c1 + x.c2 + x.c3 + x.c4 + x.c5 + x.c6), 0) / sc.length
      : null;
    return {
      ...s,
      judge_count: sc.length,
      avg_total: total,
      scores: sc.map((x) => ({
        judge_email: x.judge_email,
        c: [x.c1, x.c2, x.c3, x.c4, x.c5, x.c6],
        comment: x.comment,
      })),
    };
  });
  const open = (await getSetting(env, "submissions_open")) === "1";
  return json({ submissions: out, submissions_open: open });
}

async function handleAdminUpdate(env, request) {
  let d;
  try { d = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!d.id) return json({ error: "missing:id" }, 400);
  const allowed = ["status", "is_public", "finalist", "award", "incomplete", "disqualified"];
  const sets = [];
  const vals = [];
  let i = 1;
  for (const k of allowed) {
    if (k in d) { sets.push(`${k} = ?${i++}`); vals.push(d[k]); }
  }
  if (!sets.length) return json({ error: "nothing" }, 400);
  vals.push(d.id);
  await env.DB.prepare(`UPDATE submissions SET ${sets.join(", ")} WHERE id = ?${i}`).bind(...vals).run();
  return json({ ok: true });
}

async function handleAdminLock(env, request) {
  let d;
  try { d = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const v = d.open ? "1" : "0";
  await env.DB.prepare(
    "INSERT INTO settings (key,value) VALUES ('submissions_open',?1) ON CONFLICT(key) DO UPDATE SET value=?1"
  ).bind(v).run();
  return json({ ok: true, submissions_open: d.open });
}

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function handleAdminExport(env) {
  const subs = (await env.DB.prepare("SELECT * FROM submissions ORDER BY created_at ASC").all()).results || [];
  const scores = (await env.DB.prepare("SELECT * FROM scores").all()).results || [];
  const grouped = {};
  for (const s of scores) (grouped[s.submission_id] = grouped[s.submission_id] || []).push(s);

  const cols = [
    "id","created_at","title","author","email","affiliation","country",
    "video_url","ai_tools","license_category","workflow","screenshot_url",
    "c_rules","c_rights","c_url","c_license","c_thirdparty","c_privacy","c_pr","c_guardian",
    "status","is_public","finalist","award","incomplete","disqualified",
    "judge_count","avg_total"
  ];
  const lines = [cols.join(",")];
  for (const s of subs) {
    const sc = grouped[s.id] || [];
    const total = sc.length
      ? (sc.reduce((a, x) => a + (x.c1+x.c2+x.c3+x.c4+x.c5+x.c6), 0) / sc.length).toFixed(2)
      : "";
    const row = cols.map((c) => {
      if (c === "judge_count") return sc.length;
      if (c === "avg_total") return total;
      return csvCell(s[c]);
    });
    lines.push(row.join(","));
  }
  return text("\uFEFF" + lines.join("\n"), 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": 'attachment; filename="agewec_submissions.csv"',
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path.startsWith("/api/")) {
      try {
        // Public endpoints
        if (path === "/api/submit" && method === "POST") return await handleSubmit(env, request);
        if (path === "/api/entries" && method === "GET") return await handleEntries(env);

        // Authenticated endpoints (Access + role check)
        const user = await getUser(env, request);
        if (!user) return json({ error: "unauthorized" }, 401);

        if (path === "/api/judge/me" && method === "GET") return await handleJudgeMe(user);
        if (path === "/api/judge/assignments" && method === "GET") return await handleJudgeAssignments(env, user);
        if (path === "/api/judge/score" && method === "POST") return await handleJudgeScore(env, user, request);

        // Admin-only
        if (path.startsWith("/api/admin/")) {
          if (user.role !== "admin") return json({ error: "forbidden" }, 403);
          if (path === "/api/admin/submissions" && method === "GET") return await handleAdminSubmissions(env);
          if (path === "/api/admin/update" && method === "POST") return await handleAdminUpdate(env, request);
          if (path === "/api/admin/lock" && method === "POST") return await handleAdminLock(env, request);
          if (path === "/api/admin/export.csv" && method === "GET") return await handleAdminExport(env);
        }

        return json({ error: "not_found" }, 404);
      } catch (e) {
        return json({ error: "server", detail: String(e) }, 500);
      }
    }

    // Everything else → static assets in ./public
    return env.ASSETS.fetch(request);
  },
};
