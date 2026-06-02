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
const env = { DB: { prepare:(s)=>new Stmt(s) }, ASSETS:{ fetch:()=>new Response('static',{status:200}) } };

// seed judges
db.prepare("INSERT INTO judges (email,name,role) VALUES (?,?,?)").run('admin@x.com','運営','admin');
db.prepare("INSERT INTO judges (email,name,role) VALUES (?,?,?)").run('judge@x.com','審査員','judge');

let pass=0, fail=0;
function check(name, cond, extra=''){ if(cond){pass++; console.log('  ✓', name);} else {fail++; console.log('  ✗', name, extra);} }

async function call(method, path, {body, email}={}){
  const headers={'content-type':'application/json'};
  if(email) headers['Cf-Access-Authenticated-User-Email']=email;
  const req=new Request('https://x.com'+path,{method,headers, body: body?JSON.stringify(body):undefined});
  const res=await worker.fetch(req, env);
  let data=null; const ct=res.headers.get('content-type')||'';
  if(ct.includes('json')) data=await res.json(); else data=await res.text();
  return {status:res.status, data};
}

const goodSubmission={
  title:'門司港の夜', author:'奥原', email:'okuhara@x.com', affiliation:'三重大', country:'JP',
  videoUrl:'https://youtu.be/abc12345', aiTools:'Gemma 4, FLUX, VOICEVOX, FFmpeg',
  workflow:'LLM→storyboard→FLUX→VOICEVOX→FFmpeg', description:'工場夜景の物語',
  license:'commercial_ok',
  c_rules:true,c_rights:true,c_url:true,c_license:true,c_thirdparty:true,c_privacy:true,c_pr:true,c_guardian:false
};

console.log('\n== submit ==');
let r = await call('POST','/api/submit',{body:goodSubmission});
check('valid submit → ok', r.status===200 && r.data.ok, JSON.stringify(r.data));
const subId = r.data.id;

r = await call('POST','/api/submit',{body:{...goodSubmission, c_privacy:false}});
check('missing consent → 400', r.status===400, JSON.stringify(r.data));

r = await call('POST','/api/submit',{body:{...goodSubmission, title:''}});
check('missing required → 400', r.status===400, JSON.stringify(r.data));

console.log('\n== entries (public, before publish) ==');
r = await call('GET','/api/entries');
check('entries empty before publish', r.status===200 && r.data.entries.length===0, JSON.stringify(r.data));

console.log('\n== auth ==');
r = await call('GET','/api/judge/me');
check('judge/me no auth → 401', r.status===401);
r = await call('GET','/api/admin/submissions',{email:'judge@x.com'});
check('admin endpoint as judge → 403', r.status===403);

console.log('\n== admin sees submission, set judging ==');
r = await call('GET','/api/admin/submissions',{email:'admin@x.com'});
check('admin sees 1 submission', r.status===200 && r.data.submissions.length===1, JSON.stringify(r.data).slice(0,120));
check('judge_count 0 initially', r.data.submissions[0].judge_count===0);
r = await call('POST','/api/admin/update',{email:'admin@x.com', body:{id:subId, status:'judging'}});
check('set status judging → ok', r.status===200 && r.data.ok);

console.log('\n== judge assignments + score ==');
r = await call('GET','/api/judge/assignments',{email:'judge@x.com'});
check('judge sees judging submission', r.status===200 && r.data.entries.length===1, JSON.stringify(r.data).slice(0,120));
check('judge name passed', r.data.judge==='審査員');
r = await call('POST','/api/judge/score',{email:'judge@x.com', body:{submission_id:subId, c1:3,c2:2,c3:2,c4:3,c5:2,c6:2, comment:'良い'}});
check('save score → ok', r.status===200 && r.data.ok, JSON.stringify(r.data));
r = await call('POST','/api/judge/score',{email:'judge@x.com', body:{submission_id:subId, c1:5}});
check('out-of-range score → 400', r.status===400);
r = await call('GET','/api/judge/assignments',{email:'judge@x.com'});
check('entry now marked scored', r.data.entries[0].scored===true);

console.log('\n== admin averages ==');
r = await call('GET','/api/admin/submissions',{email:'admin@x.com'});
const s0=r.data.submissions[0];
check('judge_count 1 after score', s0.judge_count===1, 'got '+s0.judge_count);
check('avg_total = 14', Math.round(s0.avg_total)===14, 'got '+s0.avg_total); // 3+2+2+3+2+2=14

console.log('\n== publish + entries ==');
r = await call('POST','/api/admin/update',{email:'admin@x.com', body:{id:subId, is_public:1, award:'Grand Prize'}});
check('publish + award → ok', r.status===200 && r.data.ok);
r = await call('GET','/api/entries');
check('entry now public with award', r.status===200 && r.data.entries.length===1 && r.data.entries[0].award==='Grand Prize', JSON.stringify(r.data));
check('entries hides email', r.status===200 && !('email' in r.data.entries[0]));

console.log('\n== CSV export ==');
r = await call('GET','/api/admin/export.csv',{email:'admin@x.com'});
check('CSV returns text with header', typeof r.data==='string' && r.data.includes('id,created_at,title'), (r.data||'').slice(0,60));
check('CSV includes submission', r.data.includes('門司港の夜'));

console.log('\n== deadline lock ==');
r = await call('POST','/api/admin/lock',{email:'admin@x.com', body:{open:false}});
check('lock close → ok', r.status===200);
r = await call('POST','/api/submit',{body:goodSubmission});
check('submit blocked when closed → 403', r.status===403, JSON.stringify(r.data));
r = await call('POST','/api/admin/lock',{email:'admin@x.com', body:{open:true}});
r = await call('POST','/api/submit',{body:goodSubmission});
check('submit works again when reopened', r.status===200 && r.data.ok);

console.log('\n----------------------------------------');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
