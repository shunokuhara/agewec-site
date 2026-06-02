// AGEWEC — Cloudflare Worker (multi-year, path-based)
//
// URL model:
//   /                  -> 302 redirect to /{CURRENT_YEAR}/
//   /{year}/           -> event homepage (shared page, served from /public)
//   /{year}/submit/    -> shared page
//   /{year}/api/...    -> API for that year, using that year's D1 (env["DB_"+year])
//   /styles.css etc.   -> shared root assets (no year prefix)
//
// Add a new year: 1) wrangler d1 create agewec_2027
//                 2) add a DB_2027 binding in wrangler.jsonc
//                 3) add "2027" to SUPPORTED_YEARS below
//
// Auth: /judge and /admin PATHS are protected by Cloudflare Access (dashboard).
// Access injects Cf-Access-Authenticated-User-Email; the Worker re-checks it
// against that year's `judges` table.

const SUPPORTED_YEARS = ["2026"]; // add "2027", ... as each edition launches
const CURRENT_YEAR = "2026";

const FORM_VERSION = "v0.2";
const RULES_VERSION = "v0.1";
const PRIVACY_VERSION = "v0.1";
const RUBRIC_VERSION = "v0.2";

const REQUIRED_TEXT = ["title", "author", "email", "video_url", "ai_tools", "workflow", "description"];
const REQUIRED_CONSENT = ["c_rules", "c_rights", "c_url", "c_license", "c_thirdparty", "c_privacy"];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const text = (body, status = 200, headers = {}) => new Response(body, { status, headers });

function rid(prefix) {
  const a = crypto.getRandomValues(new Uint8Array(8));
  return prefix + Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function getUser(db, request) {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!email) return null;
  const row = await db.prepare("SELECT email, name, role, active FROM judges WHERE email = ?1")
    .bind(email.toLowerCase()).first();
  if (!row || !row.active) return null;
  return row;
}

async function getSetting(db, key) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = ?1").bind(key).first();
  return r ? r.value : null;
}

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const out = await res.json();
  return !!out.success;
}

async function sendConfirmationEmail(env, to, title) {
  // TODO: integrate an email provider (Resend/SendGrid/Postmark) via secret.
  return;
}

// ---------- API handlers (operate on a per-year `db`) ----------

async function handleSubmit(db, env, request) {
  if ((await getSetting(db, "submissions_open")) !== "1") return json({ error: "closed" }, 403);
  let data;
  try { data = await request.json(); } catch { return json({ error: "bad_json" }, 400); }

  const ip = request.headers.get("CF-Connecting-IP");
  if (!(await verifyTurnstile(env, data["cf-turnstile-response"], ip))) return json({ error: "turnstile" }, 403);

  const pick = (...keys) => { for (const k of keys) if (data[k] != null && data[k] !== "") return data[k]; return ""; };
  const s = {
    title: pick("title"), author: pick("author"), email: pick("email"),
    affiliation: pick("affiliation"), country: pick("country"),
    video_url: pick("videoUrl", "video_url"), ai_tools: pick("aiTools", "ai_tools"),
    assets: pick("assets"), workflow: pick("workflow"),
    screenshot_url: pick("screenshot", "screenshot_url"),
    license_category: pick("license", "license_category"),
    description: pick("description"), repo_url: pick("repo", "repo_url"),
    sns: pick("sns"), local_env: pick("localenv", "local_env"),
  };
  for (const f of REQUIRED_TEXT) if (!s[f] || String(s[f]).trim() === "") return json({ error: "missing:" + f }, 400);
  for (const c of REQUIRED_CONSENT) if (!data[c]) return json({ error: "consent:" + c }, 400);

  const id = rid("sub_");
  const now = new Date().toISOString();
  const b = (v) => (v ? 1 : 0);

  await db.prepare(
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
    id, now, s.title, s.author, s.email, s.affiliation, s.country,
    s.video_url, s.ai_tools, s.assets, s.workflow, s.screenshot_url, s.license_category,
    s.description, s.repo_url, s.sns, s.local_env,
    b(data.c_rules), b(data.c_rights), b(data.c_url), b(data.c_license), b(data.c_thirdparty),
    b(data.c_privacy), b(data.c_pr), b(data.c_guardian),
    FORM_VERSION, RULES_VERSION, PRIVACY_VERSION
  ).run();

  await sendConfirmationEmail(env, s.email, s.title);
  return json({ ok: true, id });
}

async function handleEntries(db) {
  const { results } = await db.prepare(
    `SELECT title, author, affiliation, description, video_url, ai_tools, award
       FROM submissions WHERE is_public = 1 AND disqualified = 0
      ORDER BY (award <> '') DESC, created_at ASC`
  ).all();
  return json({ entries: results || [] });
}

async function handleJudgeAssignments(db, user) {
  const assigned = await db.prepare("SELECT COUNT(*) AS n FROM assignments WHERE judge_email = ?1")
    .bind(user.email).first();
  let rows;
  if (assigned && assigned.n > 0) {
    rows = (await db.prepare(
      `SELECT s.* FROM submissions s JOIN assignments a ON a.submission_id = s.id
        WHERE a.judge_email = ?1 AND s.disqualified = 0 ORDER BY s.created_at ASC`
    ).bind(user.email).all()).results;
  } else {
    rows = (await db.prepare(
      `SELECT * FROM submissions WHERE status IN ('judging','finalist') AND disqualified = 0 ORDER BY created_at ASC`
    ).all()).results;
  }
  const myScores = (await db.prepare("SELECT * FROM scores WHERE judge_email = ?1").bind(user.email).all()).results || [];
  const byId = {};
  for (const sc of myScores) byId[sc.submission_id] = sc;
  const entries = (rows || []).map((r) => ({ ...r, myScore: byId[r.id] || null, scored: !!byId[r.id] }));
  return json({ judge: user.name || user.email, entries });
}

async function handleJudgeScore(db, user, request) {
  let d;
  try { d = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!d.submission_id) return json({ error: "missing:submission_id" }, 400);
  const clamp = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 3 ? n : null; };
  const c = [d.c1, d.c2, d.c3, d.c4, d.c5, d.c6].map(clamp);
  if (c.some((x) => x === null)) return json({ error: "score_range" }, 400);
  await db.prepare(
    `INSERT INTO scores (submission_id, judge_email, c1,c2,c3,c4,c5,c6, comment, rubric_version, updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
     ON CONFLICT(submission_id, judge_email) DO UPDATE SET
       c1=?3,c2=?4,c3=?5,c4=?6,c5=?7,c6=?8, comment=?9, rubric_version=?10, updated_at=?11`
  ).bind(d.submission_id, user.email, c[0], c[1], c[2], c[3], c[4], c[5], d.comment || "", RUBRIC_VERSION, new Date().toISOString()).run();
  return json({ ok: true });
}

async function handleAdminSubmissions(db) {
  const subs = (await db.prepare("SELECT * FROM submissions ORDER BY created_at ASC").all()).results || [];
  const scores = (await db.prepare("SELECT * FROM scores").all()).results || [];
  const grouped = {};
  for (const s of scores) (grouped[s.submission_id] = grouped[s.submission_id] || []).push(s);
  const out = subs.map((s) => {
    const sc = grouped[s.id] || [];
    const total = sc.length ? sc.reduce((a, x) => a + (x.c1 + x.c2 + x.c3 + x.c4 + x.c5 + x.c6), 0) / sc.length : null;
    return { ...s, judge_count: sc.length, avg_total: total,
      scores: sc.map((x) => ({ judge_email: x.judge_email, c: [x.c1, x.c2, x.c3, x.c4, x.c5, x.c6], comment: x.comment })) };
  });
  const open = (await getSetting(db, "submissions_open")) === "1";
  return json({ submissions: out, submissions_open: open });
}

async function handleAdminUpdate(db, request) {
  let d;
  try { d = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  if (!d.id) return json({ error: "missing:id" }, 400);
  const allowed = ["status", "is_public", "finalist", "award", "incomplete", "disqualified"];
  const sets = [], vals = [];
  let i = 1;
  for (const k of allowed) if (k in d) { sets.push(`${k} = ?${i++}`); vals.push(d[k]); }
  if (!sets.length) return json({ error: "nothing" }, 400);
  vals.push(d.id);
  await db.prepare(`UPDATE submissions SET ${sets.join(", ")} WHERE id = ?${i}`).bind(...vals).run();
  return json({ ok: true });
}

async function handleAdminLock(db, request) {
  let d;
  try { d = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
  const v = d.open ? "1" : "0";
  await db.prepare("INSERT INTO settings (key,value) VALUES ('submissions_open',?1) ON CONFLICT(key) DO UPDATE SET value=?1").bind(v).run();
  return json({ ok: true, submissions_open: d.open });
}

function csvCell(v) { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

async function handleAdminExport(db) {
  const subs = (await db.prepare("SELECT * FROM submissions ORDER BY created_at ASC").all()).results || [];
  const scores = (await db.prepare("SELECT * FROM scores").all()).results || [];
  const grouped = {};
  for (const s of scores) (grouped[s.submission_id] = grouped[s.submission_id] || []).push(s);
  const cols = ["id","created_at","title","author","email","affiliation","country","video_url","ai_tools",
    "license_category","workflow","screenshot_url","c_rules","c_rights","c_url","c_license","c_thirdparty",
    "c_privacy","c_pr","c_guardian","status","is_public","finalist","award","incomplete","disqualified","judge_count","avg_total"];
  const lines = [cols.join(",")];
  for (const s of subs) {
    const sc = grouped[s.id] || [];
    const total = sc.length ? (sc.reduce((a, x) => a + (x.c1+x.c2+x.c3+x.c4+x.c5+x.c6), 0) / sc.length).toFixed(2) : "";
    lines.push(cols.map((c) => c === "judge_count" ? sc.length : c === "avg_total" ? total : csvCell(s[c])).join(","));
  }
  return text("\uFEFF" + lines.join("\n"), 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": 'attachment; filename="agewec_submissions.csv"',
  });
}

// ---------- API router (path is already stripped of the /{year} prefix) ----------
async function handleApi(apiPath, request, env, db, year) {
  const method = request.method;
  try {
    if (apiPath === "/api/submit" && method === "POST") return await handleSubmit(db, env, request);
    if (apiPath === "/api/entries" && method === "GET") return await handleEntries(db);

    const user = await getUser(db, request);
    if (!user) return json({ error: "unauthorized" }, 401);

    if (apiPath === "/api/judge/me" && method === "GET") return json({ email: user.email, name: user.name, role: user.role });
    if (apiPath === "/api/judge/assignments" && method === "GET") return await handleJudgeAssignments(db, user);
    if (apiPath === "/api/judge/score" && method === "POST") return await handleJudgeScore(db, user, request);

    if (apiPath.startsWith("/api/admin/")) {
      if (user.role !== "admin") return json({ error: "forbidden" }, 403);
      if (apiPath === "/api/admin/submissions" && method === "GET") return await handleAdminSubmissions(db);
      if (apiPath === "/api/admin/update" && method === "POST") return await handleAdminUpdate(db, request);
      if (apiPath === "/api/admin/lock" && method === "POST") return await handleAdminLock(db, request);
      if (apiPath === "/api/admin/export.csv" && method === "GET") return await handleAdminExport(db);
    }
    return json({ error: "not_found" }, 404);
  } catch (e) {
    return json({ error: "server", detail: String(e) }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // /{year}/...
    const m = path.match(/^\/(\d{4})(\/.*)?$/);
    if (m) {
      const year = m[1];
      const rest = m[2] || "/";
      if (!SUPPORTED_YEARS.includes(year)) return new Response("Unknown year", { status: 404 });
      const db = env["DB_" + year];
      if (rest.startsWith("/api/")) {
        if (!db) return json({ error: "no_db_for_year" }, 500);
        return handleApi(rest, request, env, db, year);
      }
      // Bare year root -> that year's homepage at public/{year}/index.html
      // (served at the clean URL /{year}/ with no "editions" indirection).
      if (rest === "/") {
        return env.ASSETS.fetch(new Request(url.origin + "/" + year + "/", request));
      }
      // Other paths under the year are shared pages: strip the year prefix.
      const assetUrl = new URL(url.origin + rest);
      assetUrl.search = url.search;
      return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
    }

    // No year prefix -> portal at "/" plus shared root assets (styles.css, script.js, assets/, …)
    return env.ASSETS.fetch(request);
  },
};
