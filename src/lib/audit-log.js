const fs=require('./runtime-fs');
const path=require('node:path');
const crypto=require('node:crypto');
const SENSITIVE=/(password|passphrase|token|secret|authorization|cookie|csrf|hash|credential)/i;

function clean(value,depth=0){
 if(depth>2)return undefined;
 if(typeof value==='string')return value.slice(0,1800);
 if(typeof value==='number'||typeof value==='boolean'||value===null)return value;
 if(Array.isArray(value))return value.slice(0,30).map(item=>clean(item,depth+1)).filter(item=>item!==undefined);
 if(value&&typeof value==='object'){
  const out={};for(const [key,item] of Object.entries(value).slice(0,40)){if(SENSITIVE.test(key))continue;const safe=clean(item,depth+1);if(safe!==undefined)out[String(key).slice(0,80)]=safe;}return out;
 }
 return undefined;
}
function createAuditLog(directory){
 fs.mkdirSync(directory,{recursive:true,mode:0o700});const file=path.join(directory,'events.json');let events=[];
 try{events=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(events))events=[];}catch(error){if(error.code!=='ENOENT')throw error;}
 const save=()=>{const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(events),{mode:0o600});fs.renameSync(temporary,file);};
 const record=event=>{const row={id:crypto.randomUUID(),at:new Date().toISOString(),...clean(event)};events.push(row);if(events.length>5000)events=events.slice(-5000);save();return row;};
 const mount=app=>{
  app.post('/api/audit/events',(req,res)=>{
   const body=req.body||{},action=String(body.action||'').slice(0,40);
   if(!/^(click|submit|navigate|login|logout)$/.test(action))return res.status(400).json({error:'Некорректный тип события.'});
   const details=clean(body.details||{});
   record({actorId:req.panelUser.id,username:req.panelUser.username,name:req.panelUser.name,role:req.panelUser.role,ip:String(req.headers['cf-connecting-ip']||req.ip||req.socket.remoteAddress||'').slice(0,80),action,page:String(body.page||'').slice(0,120),target:String(body.target||'').slice(0,160),dialogId:String(body.dialogId||'').slice(0,80),details});
   res.status(202).json({ok:true});
  });
  app.get('/api/audit/events',(req,res)=>{
   if(req.panelUser.role!=='superadmin')return res.status(403).json({error:'Журнал доступен только владельцу.'});
   const limit=Math.min(1000,Math.max(1,Number.parseInt(req.query.limit,10)||300));res.json({events:events.slice(-limit).reverse()});
  });
 };
 return {record,mount};
}
module.exports={createAuditLog};
