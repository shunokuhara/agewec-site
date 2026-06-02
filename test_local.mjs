import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from './worker/index.js';

// --- D1-compatible shim over node:sqlite ---
const db = new DatabaseSync(':memory:');
db.exec(readFileSync('./migrations/0001_init.sql', 'utf8'));

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
check('/2026/ serves edition homepage', r.status===200 && r.data==='ASSET:/editions/2026.html', JSON.stringify(r.data));
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

console.log('\n----------------------------------------');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
