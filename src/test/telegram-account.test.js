const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const express=require('express');
const {createMonitor,mountTelegramAccount}=require('../lib/telegram-account');
function fixture(t,send=async()=>({id:900})){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tg-account-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 let now=Date.now();const leads=[];
 const options={directory,getBusiness:()=>({name:'BEREG',botUrl:'https://t.me/bereg_support_bot'}),getKeywords:()=>['переводчик','нотариус'],clock:()=>now,send,onLead:e=>leads.push(e)};
 const monitor=createMonitor(options);
 monitor.configure({enabled:true,mode:'auto',chatIds:['-1001'],cooldownMinutes:180,dailyLimit:3,globalDailyLimit:15},[{id:'-1001'}]);
 const message={chatId:'-1001',isGroup:true,id:1,date:Math.floor(now/1000),text:'Подскажите, нужен переводчик к нотариусу?',userSender:true};
 return {monitor,message,leads,options,advance:ms=>now+=ms};
}
test('sends once, persists checkpoint across restart and links actual BEREG bot',async t=>{
 const calls=[];const f=fixture(t,async(m,text)=>{calls.push(text);return{id:12};});
 await Promise.all([f.monitor.handle(f.message),f.monitor.handle(f.message)]);
 assert.equal(calls.length,1);assert.match(calls[0],/https:\/\/t.me\/bereg_support_bot/);
 assert.equal(f.leads[0].status,'sent');
 await createMonitor(f.options).handle(f.message);assert.equal(calls.length,1);
});
test('preview produces lead without sending; filters unrelated and unselected traffic',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;});f.monitor.state.mode='preview';
 assert.equal((await f.monitor.handle(f.message)).status,'preview');
 for(const change of [{chatId:'-2'},{isGroup:false},{out:true},{bot:true},{userSender:false},{text:'Ищу квартиру?'},{text:'Нужен переводчик? https://spam.test'},{date:1}])await f.monitor.handle({...f.message,id:++f.message.id,...change});
 assert.equal(calls,0);assert.equal(f.leads.length,1);
});
test('cooldown and daily cap prevent sending, even after restart',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;});f.monitor.state.dailyLimit=1;
 await f.monitor.handle(f.message);
 assert.equal((await f.monitor.handle({...f.message,id:2})).status,'limited');
 f.advance(181*60000);
 assert.equal((await createMonitor(f.options).handle({...f.message,id:3,date:f.message.date+181*60})).status,'limited');
 assert.equal(calls,1);
});
test('uncertain sends are not replayed and flood waits pause all groups',async t=>{
 const f=fixture(t,async()=>{throw {errorMessage:'FLOOD_WAIT_900',seconds:900};});
 assert.equal((await f.monitor.handle(f.message)).status,'paused');
 assert(f.monitor.state.blockedUntil>Date.now());
 assert.equal(await createMonitor(f.options).handle(f.message),undefined);
 assert.equal((await f.monitor.handle({...f.message,id:2})).status,'paused');
});
test('rejects invalid settings and unknown group IDs',t=>{
 const f=fixture(t);assert.throws(()=>f.monitor.configure({...f.monitor.state,chatIds:['-999']},[{id:'-1001'}]));
 assert.throws(()=>f.monitor.configure({...f.monitor.state,cooldownMinutes:NaN},[{id:'-1001'}]));
});
test('personal account endpoints are owner-only and never expose API secrets',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tg-account-api-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.panelUser={role:req.headers['x-test-role']||'admin'};next();});
 const service=mountTelegramAccount(app,{directory,growth:{state:{keywords:[],leads:[]},save(){}},getBusiness:()=>({name:'BEREG'})});
 await service.ready;t.after(()=>service.close());const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}/api/telegram-account`;
 assert.equal((await fetch(url)).status,403);
 const headers={'Content-Type':'application/json','x-test-role':'superadmin'};
 assert.equal((await fetch(url+'/credentials',{method:'PUT',headers,body:JSON.stringify({apiId:1234,apiHash:'a'.repeat(32)})})).status,200);
 const snapshot=await(await fetch(url,{headers})).text();assert(!snapshot.includes('a'.repeat(32)));assert(!snapshot.includes('apiHash'));
 assert.equal(JSON.parse(snapshot).credentialsConfigured,true);
 assert.equal((await fetch(url+'/settings',{method:'PUT',headers,body:JSON.stringify({enabled:true})})).status,400);
});
