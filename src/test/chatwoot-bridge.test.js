const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createChatwootBridge}=require('../lib/chatwoot-bridge');

test('Chatwoot bridge normalizes Messenger webhooks and sends replies',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chatwoot-'));const received=[],requests=[];
 try{
  fs.writeFileSync(path.join(directory,'config.json'),JSON.stringify({baseUrl:'https://app.chatwoot.com',accountId:'7',inboxId:'9',apiToken:'token',webhookSecret:'secret',activity:{}}));
  const fetchImpl=async(url,options={})=>{requests.push({url:String(url),options});return Response.json({id:44});};
  const bridge=createChatwootBridge({directory,env:{APP_BASE_URL:'https://panel.example'},fetchImpl});bridge.setIngest(event=>received.push(event));
  await bridge.handle({event:'message_created',message_type:'incoming',id:33,content:'Нужна помощь',sender:{name:'Anna',identifier:'fb-1'},inbox:{id:9},conversation:{id:21,inbox_id:9}});
  assert.equal(received[0].provider,'facebook');assert.equal(received[0].transport,'chatwoot');assert.equal(received[0].externalId,'21');
  await bridge.sendMessage({externalId:'21'},'Ответ оператора');
  assert(requests.some(item=>item.url.endsWith('/api/v1/accounts/7/conversations/21/messages')&&JSON.parse(item.options.body).message_type==='outgoing'));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('Instagram, email and TikTok share the CRM inbox and replies use their original Chatwoot conversation', async t=>{
 const {createSupport}=require('../lib/telegram-support');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chatwoot-channels-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 fs.writeFileSync(path.join(directory,'config.json'),JSON.stringify({
   accountId:'7',apiToken:'test-token',webhookSecret:'test-secret'
 }));
 const sent=[];
 const bridge=createChatwootBridge({directory,env:{BEREG_PUBLIC_URL:'https://crm.example'},fetchImpl:async(url,options)=>{
   sent.push({url,body:JSON.parse(options.body)});
   return Response.json({id:1});
 }});
 const support=createSupport({directory,externalSender:bridge.sendMessage});
 bridge.setIngest(support.ingestExternal);

 const legacyId='cw:chatwoot:103';
 support.state.clients[legacyId]={
   id:legacyId,externalId:'103',transport:'chatwoot',provider:'chatwoot',language:'en',
   name:'Existing contact',status:'new',history:[{direction:'in',text:'Earlier message'}]
 };
 for(const [channel,provider,id] of [['Instagram','instagram',101],['Email','email',102],['Tiktok','tiktok',103]]){
   const payload={
     event:'message_created',message_type:'incoming',id,content:'Help please',account:{id:7},
     inbox:{id},conversation:{id,inbox_id:id,channel:'Channel::'+channel}
   };
   await bridge.handle(payload);
   await bridge.handle(payload);
   const key=provider==='tiktok'?legacyId:'cw:'+provider+':'+id;
   const client=support.state.clients[key];
   assert.equal(client.provider,provider);
   assert.equal(client.history.filter(message=>message.sourceId===String(id)).length,1);
   if(provider==='tiktok')assert.equal(client.history[0].text,'Earlier message');
   support.state.queue.push({bot:'external',clientId:key,text:'Reply',literalTemplate:true});
   await support.flush();
   assert.equal(sent.at(-1).url,'https://app.chatwoot.com/api/v1/accounts/7/conversations/'+id+'/messages');
   assert.equal(sent.at(-1).body.content,'Reply');
   assert.equal(sent.at(-1).body.private,false);
 }
 assert.equal(Object.keys(support.state.clients).length,3);
 assert.ok(bridge.status().activity.lastInboundAt);
 assert.ok(bridge.status().activity.lastOutboundAt);
});
