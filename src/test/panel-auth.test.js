const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express'),fs=require('fs'),os=require('os'),path=require('path');
const {mountPanelAuth}=require('../lib/panel-auth');const {mountSupport}=require('../lib/telegram-support');
test('external Telegram webhooks bypass browser Origin checks but require the bot secret',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bereg-webhook-'));const app=express();mountPanelAuth(app,{directory});
 const sent=[];mountSupport(app,{directory:path.join(directory,'telegram'),tokens:{client:'client-token',operator:'operator-token'},workerMode:true,webhookSecret:'trusted-secret',webhookBaseUrl:'https://panel.example',api:async(bot,method,payload)=>{sent.push({bot,method,payload});return{message_id:1};}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const update={update_id:7,message:{message_id:1,chat:{id:123,type:'private'},from:{first_name:'Visitor'},text:'/start'}};
  let response=await fetch(base+'/webhooks/telegram/client',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':'wrong'},body:JSON.stringify(update)});assert.equal(response.status,401);
  response=await fetch(base+'/webhooks/telegram/client',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':'trusted-secret'},body:JSON.stringify(update)});assert.equal(response.status,200);assert(sent.some(item=>item.method==='sendMessage'&&item.payload.text.includes('Your support team')));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});}
});
test('sessions, roles, own-client isolation, CSRF, revocation',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bereg-auth-'));const app=express();mountPanelAuth(app,{directory});app.use(express.json());const support=mountSupport(app,{directory:path.join(directory,'telegram')});app.get('/api/posts',(req,res)=>res.json({posts:[]}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const request=(url,{method='GET',data,cookie,csrf,origin=base}={})=>fetch(base+url,{method,headers:{Origin:origin,...(data?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},body:data?JSON.stringify(data):undefined,redirect:'manual'});
 const login=async(username,password)=>{const r=await request('/api/auth/login',{method:'POST',data:{username,password}});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];assert(r.headers.get('set-cookie').includes('HttpOnly'));const me=await(await request('/api/auth/me',{cookie})).json();return {cookie,csrf:me.csrf};};
 try{
 assert.equal((await request('/api/posts')).status,401);
 const pass=fs.readFileSync(path.join(directory,'panel-access.txt'),'utf8').match(/Пароль: (.+)/)[1];const owner=await login('owner',pass);
 const a=support.addOperator('A'),b=support.addOperator('B');
 support.state.clients={one:{id:'one',name:'One',operatorId:a.id,status:'new',history:[]},two:{id:'two',name:'Two',operatorId:b.id,status:'new',history:[]}};support.save();
 let r=await request('/api/users',{...owner,method:'POST',data:{username:'worker',name:'Worker',role:'operator',operatorId:a.id}});assert.equal(r.status,201);const worker=await r.json();const session=await login('worker',worker.password);
 const inbox=await(await request('/api/telegram/inbox',session)).json();assert.deepEqual(inbox.clients.map(c=>c.id),['one']);
 assert.equal((await request('/api/telegram/inbox/two/reply',{...session,method:'POST',data:{text:'bad'}})).status,404);
 assert.equal((await request('/api/users',session)).status,403);assert.equal((await request('/api/posts',session)).status,403);
 assert.equal((await request('/api/telegram/inbox/one/reply',{cookie:session.cookie,method:'POST',data:{text:'missing csrf'}})).status,403);
 assert.equal((await request('/api/telegram/inbox/one/reply',{...session,method:'POST',origin:'http://other.test',data:{text:'bad origin'}})).status,403);
 assert.equal((await request('/api/telegram/inbox/one/reply',{...session,method:'POST',data:{text:'hello'}})).status,200);assert.equal(support.state.queue.length,1);
 r=await request('/api/users',{...owner,method:'POST',data:{username:'manager',name:'Manager',role:'admin'}});const manager=await r.json();const admin=await login('manager',manager.password);
 assert.equal((await request('/api/posts',admin)).status,200);assert.equal((await request('/api/users',admin)).status,403);assert.equal((await request('/api/youtube/connect',admin)).status,403);
 assert.equal((await request('/api/telegram/operators/'+a.id+'/password',admin)).status,403);
 assert.equal((await request('/api/telegram/operators/'+a.id+'/password',{...admin,method:'PUT',data:{password:'manager-cannot-change'}})).status,403);
 r=await request('/api/telegram/operators/'+a.id+'/password',owner);assert.equal(r.status,200);assert.equal((await r.json()).password,a.password);
 r=await request('/api/telegram/operators/'+a.id+'/password',{...owner,method:'PUT',data:{password:'owner-can-change-2026'}});assert.equal(r.status,200);assert.equal(support.getOperatorPassword(a.id),'owner-can-change-2026');
 await request('/api/users/'+worker.user.id+'/toggle',{...owner,method:'POST',data:{}});assert.equal((await request('/api/telegram/inbox',session)).status,401);
 await request('/api/auth/logout',{...owner,method:'POST',data:{}});assert.equal((await request('/api/users',owner)).status,401);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});}
});
