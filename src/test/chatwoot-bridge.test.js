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
