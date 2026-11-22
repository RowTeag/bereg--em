const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMetaInbox}=require('../lib/meta-inbox');

test('Meta inbox normalizes Messenger and WhatsApp webhooks and sends replies',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'meta-inbox-'));const received=[],requests=[];
 const facebookAuth={peek:()=>({pageId:'page-1',pageName:'BEREG',accessToken:'page-token'}),appSecret:()=>''};
 const fetchImpl=async(url,options={})=>{requests.push({url:String(url),options});if(String(url).includes('psid-1?'))return Response.json({first_name:'Ivan',last_name:'Petrov'});return Response.json({messages:[{id:'sent'}]});};
 try{
  const inbox=createMetaInbox({directory,facebookAuth,env:{APP_BASE_URL:'https://panel.example',WHATSAPP_ACCESS_TOKEN:'wa-token',WHATSAPP_PHONE_NUMBER_ID:'phone-1'},fetchImpl});inbox.setIngest(event=>received.push(event));
  await inbox.handle({object:'page',entry:[{messaging:[{sender:{id:'psid-1'},recipient:{id:'page-1'},message:{mid:'m1',text:'Hello'}}]}]});
  await inbox.handle({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{contacts:[{wa_id:'3611',profile:{name:'Olga'}}],messages:[{id:'w1',from:'3611',text:{body:'Hi'}}]}}]}]});
  await inbox.handle({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{contacts:[{wa_id:'3611',profile:{name:'Olga'}}],messages:[{id:'w2',from:'3611',interactive:{button_reply:{id:'bereg_documents',title:'📄 Документы'}}}]}}]}]});
  await inbox.handle({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{contacts:[{wa_id:'3611',profile:{name:'Olga'}}],messages:[{id:'w3',from:'3611',text:{body:'Контакты'}}]}}]}]});
  await inbox.handle({object:'page',entry:[{messaging:[{sender:{id:'psid-1'},recipient:{id:'page-1'},timestamp:2,postback:{payload:'BEREG_DOCUMENTS'}}]}]});
  assert.equal(received[0].provider,'facebook');assert.equal(received[0].name,'Ivan Petrov');assert.equal(received[1].provider,'whatsapp');assert.equal(received[1].contact,'+3611');
  assert.equal(received[2].text,'📄 Документы');
  await inbox.sendMessage({provider:'facebook',externalId:'psid-1'},'Reply');
  assert(requests.some(item=>item.url.endsWith('/page-1/messages')));
  const messengerMenu=requests.map(item=>JSON.parse(item.options.body||'{}')).find(body=>body.message?.quick_replies);
  const whatsappMenu=requests.map(item=>JSON.parse(item.options.body||'{}')).find(body=>body.interactive?.action?.buttons);
  assert.deepEqual(messengerMenu.message.quick_replies.map(button=>button.title),['💬 Support','📋 Services']);
  assert.deepEqual(whatsappMenu.interactive.action.buttons.map(button=>button.reply.title),['💬 Support','📋 Services']);
  assert(requests.some(item=>JSON.parse(item.options.body||'{}').interactive?.body?.text?.startsWith('How we can help')));
  assert(requests.some(item=>JSON.parse(item.options.body||'{}').interactive?.body?.text?.startsWith('BEREG OUTSOURCE GROUP')));
  assert(requests.some(item=>JSON.parse(item.options.body||'{}').text?.body?.startsWith('✓ Your message has been sent')));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('Meta inbox exposes a normalized public WhatsApp link without exposing the token',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'meta-inbox-'));
 try{
  fs.writeFileSync(path.join(directory,'config.json'),JSON.stringify({verifyToken:'verify',whatsapp:{phoneNumberId:'1228349903705363',businessAccountId:'1991367714814441',displayPhoneNumber:'+36 30 435 4603',accessToken:'secret'}}));
  const inbox=createMetaInbox({directory,facebookAuth:{peek:()=>({}),appSecret:()=>''},env:{APP_BASE_URL:'https://panel.example'},fetchImpl:async()=>Response.json({})});
  const routes=[];inbox.mountAdmin({get:(route,middleware,handler)=>routes.push({route,middleware,handler}),put:()=>{},post:()=>{}});
  const status=routes.find(item=>item.route==='/api/meta-inbox/status');let body;
  status.handler({}, {json:value=>{body=value;}});
  assert.equal(body.whatsapp.publicUrl,'https://wa.me/36304354603');
  assert.equal(body.whatsapp.accessTokenConfigured,true);
  assert.equal('accessToken' in body.whatsapp,false);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('Meta inbox can read production WhatsApp identifiers from environment variables',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'meta-inbox-'));
 try{
  const inbox=createMetaInbox({directory,facebookAuth:{peek:()=>({}),appSecret:()=>''},env:{APP_BASE_URL:'https://panel.example',WHATSAPP_PHONE_NUMBER_ID:'phone-env',WHATSAPP_BUSINESS_ACCOUNT_ID:'waba-env',WHATSAPP_DISPLAY_PHONE_NUMBER:'+36 30 435 4603'},fetchImpl:async()=>Response.json({})});
  const routes=[];inbox.mountAdmin({get:(route,middleware,handler)=>routes.push({route,handler}),put:()=>{},post:()=>{}});
  let body;routes.find(item=>item.route==='/api/meta-inbox/status').handler({}, {json:value=>{body=value;}});
  assert.equal(body.whatsapp.phoneNumberId,'phone-env');
  assert.equal(body.whatsapp.businessAccountId,'waba-env');
  assert.equal(body.whatsapp.publicUrl,'https://wa.me/36304354603');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('Meta inbox verifies and repairs the official WhatsApp webhook subscription',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'meta-inbox-'));const requests=[];
 try{
  fs.writeFileSync(path.join(directory,'config.json'),JSON.stringify({verifyToken:'verify',whatsapp:{phoneNumberId:'phone-1',businessAccountId:'waba-1',displayPhoneNumber:'+36 30 435 4603',accessToken:'wa-token'}}));
  const fetchImpl=async(url,options={})=>{requests.push({url:String(url),method:options.method||'GET'});if(String(url).includes('/phone-1?'))return Response.json({display_phone_number:'+36 30 435 4603',verified_name:'BEREG',quality_rating:'GREEN'});if(String(url).includes('/waba-1/subscribed_apps'))return Response.json(options.method==='POST'?{success:true}:{data:[{id:'app-1'}]});return Response.json({data:[{id:'app-1',subscribed_fields:['messages']}]});};
  const inbox=createMetaInbox({directory,facebookAuth:{peek:()=>({pageId:'page-1',pageName:'BEREG',accessToken:'page-token'}),appSecret:()=>''},env:{APP_BASE_URL:'https://panel.example'},fetchImpl});
  const before=await inbox.diagnostics();assert.equal(before.whatsapp.api,true);assert.equal(before.whatsapp.webhookSubscribed,true);assert.deepEqual(before.facebook.subscribedFields,['messages']);
  const after=await inbox.subscribeWhatsapp();assert.equal(after.whatsapp.webhookSubscribed,true);assert(requests.some(item=>item.url.includes('/waba-1/subscribed_apps')&&item.method==='POST'));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
