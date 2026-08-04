import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker from './worker/index.js';

// --- D1-compatible shim over node:sqlite ---
const db = new DatabaseSync(':memory:');
// すべてのマイグレーションを番号順に適用（0001 だけだと nickname 等が欠ける）
for (const f of readdirSync('./migrations').filter(f=>f.endsWith('.sql')).sort()) {
  db.exec(readFileSync('./migrations/' + f, 'utf8'));
}

class Stmt {
  constructor(sql){ this.sql=sql; this.args=[]; }
  bind(...a){ this.args=a; return this; }
  _x(){ const flat=[]; const sql=this.sql.replace(/\?(\d+)/g,(_,n)=>{flat.push(this.args[Number(n)-1]); return '?';}); return {sql,flat}; }
  run(){ const {sql,flat}=this._x(); return {success:true, meta: db.prepare(sql).run(...flat)}; }
  first(){ const {sql,flat}=this._x(); const r=db.prepare(sql).get(...flat); return r===undefined?null:r; }
  all(){ const {sql,flat}=this._x(); return {results: db.prepare(sql).all(...flat)}; }
}
// env binds the year's D1 as DB_2026 (matches wrangler.jsonc)
const env = { DB_2026: { prepare:(s)=>new Stmt(s) }, ASSETS:{ fetch:(req)=>new Response('ASSET:'+new URL(req.url).pathname,{status:200}) } };

db.prepare("INSERT INTO judges (email,name,role) VALUES (?,?,?)").run('admin@x.com','運営','admin');
db.prepare("INSERT INTO judges (email,name,role) VALUES (?,?,?)").run('judge@x.com','審査員','judge');

let pass=0, fail=0;
function check(name, cond, extra=''){ if(cond){pass++; console.log('  ✓', name);} else {fail++; console.log('  ✗', name, extra);} }

async function call(method, path, {body, email}={}){
  const headers={'content-type':'application/json'};
  if(email) headers['Cf-Access-Authenticated-User-Email']=email;
  const req=new Request('https://agewec.com'+path,{method,headers, body: body?JSON.stringify(body):undefined, redirect:'manual'});
  const res=await worker.fetch(req, env);
  let data=null; const ct=res.headers.get('content-type')||'';
  if(ct.includes('json')) data=await res.json(); else data=await res.text();
  return {status:res.status, data, location:res.headers.get('location')};
}

const sub={
  title:'門司港の夜', author:'奥原', email:'okuhara@x.com', affiliation:'三重大', country:'JP',
  videoUrl:'https://youtu.be/abc12345', aiTools:'Gemma 4, FLUX, VOICEVOX, FFmpeg',
  workflow:'LLM→storyboard→FLUX→VOICEVOX→FFmpeg', description:'工場夜景の物語', license:'commercial_ok',
  c_rules:true,c_rights:true,c_url:true,c_license:true,c_thirdparty:true,c_privacy:true,c_pr:true,c_guardian:false
};

console.log('\n== routing ==');
let r = await call('GET','/');
check('/ serves portal (no redirect)', r.status===200 && r.data==='ASSET:/', r.status+' '+r.data);
r = await call('GET','/2026/');
check('/2026/ serves year homepage (public/2026/)', r.status===200 && r.data==='ASSET:/2026/', JSON.stringify(r.data));
r = await call('GET','/2026/submit/');
check('/2026/submit/ served from shared asset (year stripped)', r.status===200 && r.data==='ASSET:/submit/', JSON.stringify(r.data));
r = await call('GET','/styles.css');
check('/styles.css served as shared root asset', r.status===200 && r.data==='ASSET:/styles.css');
r = await call('GET','/2027/api/entries');
check('unsupported year /2027 -> 404', r.status===404);

console.log('\n== submit (year-scoped) ==');
r = await call('POST','/2026/api/submit',{body:sub});
check('valid submit -> ok', r.status===200 && r.data.ok, JSON.stringify(r.data));
const id = r.data.id;
r = await call('POST','/2026/api/submit',{body:{...sub,c_privacy:false}});
check('missing consent -> 400', r.status===400);

console.log('\n== entries / auth ==');
r = await call('GET','/2026/api/entries');
check('entries empty before publish', r.status===200 && r.data.entries.length===0);
r = await call('GET','/2026/api/judge/me');
check('judge/me no auth -> 401', r.status===401);
r = await call('GET','/2026/api/admin/submissions',{email:'judge@x.com'});
check('admin as judge -> 403', r.status===403);

console.log('\n== admin -> judging, judge scores ==');
r = await call('GET','/2026/api/admin/submissions',{email:'admin@x.com'});
check('admin sees 1 submission', r.status===200 && r.data.submissions.length===1);
r = await call('POST','/2026/api/admin/update',{email:'admin@x.com',body:{id, status:'judging'}});
check('set judging', r.status===200 && r.data.ok);
r = await call('GET','/2026/api/judge/assignments',{email:'judge@x.com'});
check('judge sees judging submission', r.status===200 && r.data.entries.length===1);
r = await call('POST','/2026/api/judge/score',{email:'judge@x.com',body:{submission_id:id,c1:3,c2:2,c3:2,c4:3,c5:2,c6:2,comment:'良い'}});
check('save score', r.status===200 && r.data.ok);
r = await call('POST','/2026/api/judge/score',{email:'judge@x.com',body:{submission_id:id,c1:5}});
check('out-of-range -> 400', r.status===400);

console.log('\n== averages, publish, csv, lock ==');
r = await call('GET','/2026/api/admin/submissions',{email:'admin@x.com'});
check('avg_total = 14', Math.round(r.data.submissions[0].avg_total)===14, 'got '+r.data.submissions[0].avg_total);
r = await call('POST','/2026/api/admin/update',{email:'admin@x.com',body:{id, is_public:1, award:'Grand Prize'}});
check('publish + award', r.status===200 && r.data.ok);
r = await call('GET','/2026/api/entries');
check('entry public with award, email hidden', r.data.entries.length===1 && r.data.entries[0].award==='Grand Prize' && !('email' in r.data.entries[0]));
r = await call('GET','/2026/api/admin/export.csv',{email:'admin@x.com'});
check('CSV header + row', typeof r.data==='string' && r.data.includes('id,created_at,title') && r.data.includes('門司港の夜'));
r = await call('POST','/2026/api/admin/lock',{email:'admin@x.com',body:{open:false}});
r = await call('POST','/2026/api/submit',{body:sub});
check('submit blocked when closed -> 403', r.status===403);

console.log('\n== 評価フォーム2系統（expert / audience）==');
r = await call('POST','/2026/api/admin/lock',{email:'admin@x.com',body:{open:true}});
r = await call('GET','/2026/api/admin/judges',{email:'admin@x.com'});
check('judges一覧が取れる', r.status===200 && r.data.judges.length===2, JSON.stringify(r.data));
check('既定は expert', r.data.judges.every(j=>j.rubric_type==='expert'));

// 一般アンケート用の評価者を追加
r = await call('POST','/2026/api/admin/judge',{email:'admin@x.com',
  body:{email:'Viewer@x.com', name:'一般視聴者', role:'judge', rubric_type:'audience', active:1}});
check('audience評価者を追加', r.status===200 && r.data.rubric_type==='audience', JSON.stringify(r.data));

r = await call('GET','/2026/api/judge/me',{email:'viewer@x.com'});
check('me が audience を返す', r.status===200 && r.data.rubric_type==='audience', JSON.stringify(r.data));

r = await call('GET','/2026/api/judge/assignments',{email:'viewer@x.com'});
const ent = r.data.entries[0];
check('assignments が audience を返す', r.data.rubric_type==='audience');
check('audience には制作情報を出さない', ent && !('ai_tools' in ent) && !('workflow' in ent), JSON.stringify(Object.keys(ent||{})));
check('audience にも動画URLは出す', !!(ent && ent.video_url));

// 点数レンジは評価者のフォームで決まる
r = await call('POST','/2026/api/judge/score',{email:'viewer@x.com',body:{submission_id:id,c1:0,c2:3,c3:3,c4:3,c5:3,c6:3}});
check('audience で 0 は範囲外 -> 400', r.status===400);
r = await call('POST','/2026/api/judge/score',{email:'viewer@x.com',body:{submission_id:id,c1:5,c2:4,c3:4,c4:5,c5:4,c6:5,comment:'また行きたい'}});
check('audience 1-5 で保存できる', r.status===200 && r.data.ok, JSON.stringify(r.data));
r = await call('POST','/2026/api/judge/score',{email:'judge@x.com',body:{submission_id:id,c1:5,c2:1,c3:1,c4:1,c5:1,c6:1}});
check('expert で 5 は範囲外 -> 400', r.status===400);

r = await call('GET','/2026/api/admin/submissions',{email:'admin@x.com'});
const s0 = r.data.submissions[0];
check('expert平均は 14/18 のまま', Math.round(s0.expert_avg)===14 && s0.expert_count===1, JSON.stringify([s0.expert_avg,s0.expert_count]));
check('audience平均は 27/30 で別集計', Math.round(s0.audience_avg)===27 && s0.audience_count===1, JSON.stringify([s0.audience_avg,s0.audience_count]));
check('2系統を混ぜていない', s0.avg_total===s0.expert_avg);
check('採点行に rubric_type が付く', s0.scores.some(x=>x.rubric_type==='audience') && s0.scores.some(x=>x.rubric_type==='expert'));

r = await call('GET','/2026/api/admin/export.csv',{email:'admin@x.com'});
check('CSVに2系統の列がある', r.data.includes('expert_count,expert_avg_18,audience_count,audience_avg_30'));

// 振り分けの変更が即座に効く
r = await call('POST','/2026/api/admin/judge',{email:'admin@x.com',body:{email:'viewer@x.com', name:'一般視聴者', role:'judge', rubric_type:'expert', active:1}});
r = await call('GET','/2026/api/judge/me',{email:'viewer@x.com'});
check('フォーム変更が反映される', r.data.rubric_type==='expert');
r = await call('POST','/2026/api/admin/judge',{email:'admin@x.com',body:{email:'judge@x.com', role:'judge', rubric_type:'audience', active:0}});
r = await call('GET','/2026/api/judge/me',{email:'judge@x.com'});
check('無効化した評価者は 401', r.status===401);
r = await call('POST','/2026/api/admin/judge',{email:'admin@x.com',body:{email:'bad-email', rubric_type:'audience'}});
check('不正メールは 400', r.status===400);

console.log('\n== 切り替え時の取り扱い / 保存の副作用 ==');
// judge@x.com は expert で 14点入力済み。audience に切り替えると旧点数は引き継がない
r = await call('POST','/2026/api/admin/judge',{email:'admin@x.com',body:{email:'judge@x.com', rubric_type:'audience', active:1}});
check('active:1 に戻せる', r.status===200);
r = await call('GET','/2026/api/judge/assignments',{email:'judge@x.com'});
check('尺度違いの旧点数は引き継がない', r.data.entries[0].myScore===null && r.data.entries[0].scored===false,
  JSON.stringify(r.data.entries[0].myScore));
// 部分更新で name が消えないこと
r = await call('GET','/2026/api/admin/judges',{email:'admin@x.com'});
const jrow = r.data.judges.find(j=>j.email==='judge@x.com');
check('省略した name は維持される', jrow.name==='審査員', JSON.stringify(jrow));
// 元に戻すと旧点数が復活する（scores行は消えていない）
r = await call('POST','/2026/api/admin/judge',{email:'admin@x.com',body:{email:'judge@x.com', rubric_type:'expert'}});
r = await call('GET','/2026/api/judge/assignments',{email:'judge@x.com'});
check('戻せば旧点数が見える（行は消えない）', r.data.entries[0].myScore && r.data.entries[0].myScore.c1===3);
// 自分の権限は外せない
r = await call('POST','/2026/api/admin/judge',{email:'admin@x.com',body:{email:'admin@x.com', role:'judge'}});
check('自分をjudgeに降格 -> 400', r.status===400 && r.data.error==='self_lockout', JSON.stringify(r.data));
r = await call('POST','/2026/api/admin/judge',{email:'admin@x.com',body:{email:'admin@x.com', active:0}});
check('自分を無効化 -> 400', r.status===400);
r = await call('GET','/2026/api/admin/submissions',{email:'admin@x.com'});
check('adminは管理画面に入れたまま', r.status===200);

console.log('\n----------------------------------------');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
