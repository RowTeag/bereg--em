const crypto=require('crypto');
const fs=require('./runtime-fs');
const path=require('path');
const express=require('express');
const hashPassword=(password,salt)=>crypto.scryptSync(password,salt,32).toString('hex');
function mountPanelAuth(app,{directory,onLogin=()=>{},onLogout=()=>{}}) {
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'panel-users.json');
  const save=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(users,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);};
  let users;
  if(fs.existsSync(file))users=JSON.parse(fs.readFileSync(file,'utf8'));
  else {
    const password=crypto.randomBytes(18).toString('base64url'),salt=crypto.randomBytes(16).toString('hex');
    users=[{id:crypto.randomUUID(),username:'owner',name:'Владелец BEREG',role:'superadmin',enabled:true,salt,hash:hashPassword(password,salt),operatorId:null}];save();
    fs.writeFileSync(path.join(directory,'panel-access.txt'),`BEREG · Вход владельца\nЛогин: owner\nПароль: ${password}\n`,{mode:0o600});
  }
  const sessionsFile=path.join(directory,'panel-sessions.json');
  const sessions=new Map(),attempts=new Map();
  try{const saved=JSON.parse(fs.readFileSync(sessionsFile,'utf8'));for(const [key,value] of Object.entries(saved))if(value&&typeof value.userId==='string'&&typeof value.csrf==='string'&&Number(value.expires)>Date.now())sessions.set(key,value);}catch(error){if(error.code!=='ENOENT')throw error;}
  const saveSessions=()=>{const persistent=Object.fromEntries([...sessions].filter(([,value])=>value.persistent));fs.writeFileSync(sessionsFile+'.tmp',JSON.stringify(persistent),{mode:0o600});fs.renameSync(sessionsFile+'.tmp',sessionsFile);};
  const safe=u=>({id:u.id,username:u.username,name:u.name,role:u.role,enabled:u.enabled,operatorId:u.operatorId});
  const tokenHash=t=>crypto.createHash('sha256').update(t).digest('hex');
  const revoke=id=>{let changed=false;for(const[k,v]of sessions)if(v.userId===id){sessions.delete(k);changed=true;}if(changed)saveSessions();};
  const publicPaths=new Set([
    '/login',
    '/login.html',
    '/login.css',
    '/login.js',
    '/privacy.html',
    '/data-deletion.html',
    '/crm-offer',
    '/crm-offer/privacy',
    '/crm-offer-admin',
    '/sales.css',
    '/sales.js',
    '/sales-admin.css',
    '/sales-admin.js',
    '/sales-privacy.html',
    '/api/sales-site/track',
    '/api/sales-site/leads',
    '/assets/telegram/client.png',
    '/api/tiktok/oauth/callback'
  ]);
  app.use((req,res,next)=>{
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin'});
    const externalWebhook=req.path==='/webhooks/meta'||req.path.startsWith('/webhooks/telegram/');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!externalWebhook) {
      let origin;try{origin=new URL(req.headers.origin);}catch{}
      const miniCrmOrigin='https://bereg-mini-crm.smm-panel.workers.dev';
      if(!origin || (origin.host!==req.headers.host&&origin.origin!==miniCrmOrigin) || !['http:','https:'].includes(origin.protocol))return res.status(403).json({error:'Откройте запрос из панели.'});
    }
    const raw=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('bereg_session='))?.slice(14);
    const session=raw && sessions.get(tokenHash(raw));
    const user=session && session.expires>Date.now() && users.find(u=>u.id===session.userId && u.enabled);
    if(user){req.panelAuthenticated=true;req.panelUser=safe(user);req.panelSession=session;}
    if(publicPaths.has(req.path)||req.path==='/api/auth/login'||externalWebhook)return next();
    if(!user){if(req.path.startsWith('/api/'))return res.status(401).json({error:'Войдите в панель.'});if(req.method==='GET'&&req.path==='/')return res.sendFile(path.join(process.cwd(),'public/login.html'));return res.redirect('/login');}
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers['x-csrf-token']!==session.csrf)return res.status(403).json({error:'Обновите страницу и повторите действие.'});
    if(req.path.startsWith('/api/users')&&user.role!=='superadmin')return res.status(403).json({error:'Управление доступом доступно только владельцу.'});
    if(user.role==='operator') {
      const method=req.method.toUpperCase();
      const inboxAccess=(method==='POST'&&/^\/api\/telegram\/inbox\/[^/]+\/test-send$/.test(req.path))||(method==='GET'&&/^\/api\/telegram\/inbox\/[^/]+\/test-send\/[^/]+$/.test(req.path))||(method==='GET'&&/^\/api\/telegram\/inbox\/[^/]+\/files\/[^/]+$/.test(req.path))||(method==='POST'&&/^\/api\/telegram\/inbox\/[^/]+\/files$/.test(req.path))||(method==='GET'&&req.path==='/api/telegram/inbox-team')||(method==='POST'&&/^\/api\/telegram\/inbox\/[^/]+\/manage$/.test(req.path))||req.path==='/api/clients-sync'||req.path==='/api/clients-sync/ack'||req.path==='/api/telegram/inbox'||(method==='GET'&&/^\/api\/telegram\/inbox\/[^/]+$/.test(req.path))||req.path==='/api/telegram/notifications'||/^\/api\/telegram\/inbox\/[^/]+\/(reply|close)$/.test(req.path)||(method==='PUT'&&req.path==='/api/telegram/operator-language')||(method==='POST'&&(/^\/api\/clients\/from-inbox\/[^/]+$/.test(req.path)||req.path==='/api/audit/events'));
      const publishingAccess=(method==='GET'&&[
        '/api/settings','/api/posts','/api/analytics','/api/facebook/status','/api/youtube/status','/api/health','/api/tiktok/status','/api/tiktok/creator'
      ].includes(req.path))
        ||(method==='GET'&&/^\/api\/tiktok\/publish\/[^/]+$/.test(req.path))
        ||(method==='GET'&&/^\/api\/youtube\/analytics$/.test(req.path))
        ||(method==='GET'&&req.path==='/api/growth')
        ||(method==='POST'&&['/api/posts','/api/youtube/videos','/api/ai/post','/api/growth/channel/publish','/api/tiktok/publish'].includes(req.path));
      const templateAccess=method==='GET'&&req.path==='/api/reply-templates';
      const contentPlanAccess=req.path.startsWith('/api/content-plan')&&['GET','POST','PUT','DELETE'].includes(req.method.toUpperCase());
      if(!(req.path.startsWith('/api/auth/')||inboxAccess||publishingAccess||contentPlanAccess||templateAccess||(!req.path.startsWith('/api/')&&!req.path.startsWith('/generated/'))))return res.status(403).json({error:'Этот раздел недоступен вашей роли.'});
    }
    if(user.role==='admin' && ((req.path==='/api/settings'&&req.method!=='GET') || req.path==='/api/youtube/connect' || req.path==='/api/youtube/oauth/callback' || req.path.startsWith('/api/facebook/config') || req.path==='/api/facebook/connect' || req.path==='/api/facebook/oauth/callback'))return res.status(403).json({error:'Настройки подключений доступны только владельцу.'});
    next();
  });
  app.get('/login',(req,res)=>req.panelUser?res.redirect('/'):res.sendFile(path.join(process.cwd(),'public/login.html')));
  app.post('/api/auth/login',express.json({limit:'4kb'}),async(req,res)=>{
    const ip=req.socket.remoteAddress;const record=attempts.get(ip);const now=Date.now();
    if(record?.until>now&&record.count>=8)return res.status(429).json({error:'Слишком много попыток. Повторите через 15 минут.'});
    const username=String(req.body.username||'').toLowerCase().trim(),password=String(req.body.password||'');
    const user=users.find(u=>u.username===username&&u.enabled);
    const salt=user?.salt || '00000000000000000000000000000000';
    if(password.length>256)return res.status(400).json({error:'Неверные данные входа.'});
    const hash=await new Promise((resolve,reject)=>crypto.scrypt(password,salt,32,(e,k)=>e?reject(e):resolve(k)));
    if(!user || !crypto.timingSafeEqual(hash,Buffer.from(user.hash,'hex'))){const r=record?.until>now?record:{count:0,until:now+900000};r.count++;attempts.set(ip,r);return res.status(401).json({error:'Неверный логин или пароль.'});}
    attempts.delete(ip);const token=crypto.randomBytes(32).toString('base64url');
    const persistent=req.body.remember===true,duration=persistent?30*24*3600000:12*3600000;
    sessions.set(tokenHash(token),{userId:user.id,csrf:crypto.randomBytes(24).toString('base64url'),expires:now+duration,persistent});
    if(persistent)saveSessions();
    res.cookie('bereg_session',token,{httpOnly:true,sameSite:'lax',secure:req.secure,maxAge:duration,path:'/'});try{onLogin(safe(user),{ip:String(req.headers['cf-connecting-ip']||req.ip||req.socket.remoteAddress||'').slice(0,80)});}catch{}res.json({user:safe(user)});
  });
  app.get('/api/auth/me',(req,res)=>res.json({user:req.panelUser,csrf:req.panelSession.csrf}));
  app.post('/api/auth/logout',(req,res)=>{try{onLogout(req.panelUser,{ip:String(req.headers['cf-connecting-ip']||req.ip||req.socket.remoteAddress||'').slice(0,80)});}catch{}revoke(req.panelUser.id);res.clearCookie('bereg_session',{path:'/'});res.json({ok:true});});
  app.get('/api/users',(req,res)=>res.json({users:users.map(safe)}));
  app.post('/api/users',express.json({limit:'4kb'}),(req,res)=>{
    const username=String(req.body.username||'').toLowerCase().trim(),name=String(req.body.name||'').trim(),role=req.body.role;
    if(!/^[a-z0-9_.-]{3,40}$/.test(username)||!name||name.length>70||!['admin','operator'].includes(role))return res.status(400).json({error:'Проверьте имя, логин (3–40 латинских символов) и роль.'});
    if(users.some(u=>u.username===username))return res.status(409).json({error:'Этот логин уже существует.'});
    const operatorId=role==='operator'?String(req.body.operatorId||''):null;
    if(role==='operator') {
      let operators=[];try{operators=JSON.parse(fs.readFileSync(path.join(directory,'telegram/support.json'))).operators;}catch{}
      if(!operators.some(o=>o.id===operatorId&&o.enabled)||users.some(u=>u.operatorId===operatorId&&u.enabled))return res.status(400).json({error:'Выберите активного Telegram-оператора без учётной записи панели.'});
    }
    const password=crypto.randomBytes(18).toString('base64url'),salt=crypto.randomBytes(16).toString('hex');
    const user={id:crypto.randomUUID(),username,name,role,operatorId,enabled:true,salt,hash:hashPassword(password,salt)};users.push(user);save();res.status(201).json({user:safe(user),password});
  });
  app.post('/api/users/:id/reset-password',(req,res)=>{
    const u=users.find(u=>u.id===req.params.id);if(!u)return res.sendStatus(404);
    const password=crypto.randomBytes(18).toString('base64url');u.salt=crypto.randomBytes(16).toString('hex');u.hash=hashPassword(password,u.salt);save();revoke(u.id);res.json({password});
  });
  app.post('/api/users/:id/toggle',(req,res)=>{
    const u=users.find(u=>u.id===req.params.id);if(!u)return res.sendStatus(404);
    if(u.role==='superadmin')return res.status(400).json({error:'Доступ владельца нельзя отключить.'});
    u.enabled=!u.enabled;save();revoke(u.id);res.json({user:safe(u)});
  });
  const timer=setInterval(()=>{const now=Date.now();let changed=false;for(const[k,v]of sessions)if(v.expires<now){sessions.delete(k);changed=true;}if(changed)saveSessions();for(const[k,v]of attempts)if(v.until<now)attempts.delete(k);},60000);timer.unref();
}
module.exports={mountPanelAuth};
