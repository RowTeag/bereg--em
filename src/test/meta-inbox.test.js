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

test('direct Meta media uses multipart upload and sends the returned WhatsApp media ID', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-media-'));
  try {
    const calls = [];
    const inbox = createMetaInbox({
      directory,
      facebookAuth:{peek:() => ({pageId:'123', accessToken:'test-facebook'})},
      env:{WHATSAPP_PHONE_NUMBER_ID:'456', WHATSAPP_ACCESS_TOKEN:'test-whatsapp'},
      async fetchImpl(url, options) {
        calls.push({url, ...options});
        return Response.json({id:'987'});
      }
    });
    const file = {name:'scan.pdf'};
    const bytes = Buffer.from('test file');
    assert.equal(inbox.acceptsFile({provider:'whatsapp'}, 'scan.pdf'), true);
    assert.equal(inbox.acceptsFile({provider:'whatsapp'}, 'scan.exe'), false);
    await inbox.sendFile({provider:'whatsapp', externalId:'44'}, file, bytes);
    await inbox.sendFile({provider:'facebook', externalId:'55'}, file, bytes);
    assert(calls[0].url.endsWith('/456/media'));
    assert.equal(calls[0].body.get('file').name, 'scan.pdf');
    assert.deepEqual(JSON.parse(calls[1].body).document, {id:'987', filename:'scan.pdf'});
    assert.equal(JSON.parse(calls[2].body.get('message')).attachment.type, 'file');
    assert.equal(calls[2].body.get('filedata').name, 'scan.pdf');
  } finally {
    fs.rmSync(directory, {recursive:true, force:true});
  }
});

test('WhatsApp media webhooks store attachments and keep the client caption', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-inbound-media-'));
  try {
    const received = [];
    const inbox = createMetaInbox({
      directory,
      env: {WHATSAPP_PHONE_NUMBER_ID:'456', WHATSAPP_ACCESS_TOKEN:'test-whatsapp'},
      async fetchImpl(url, options) {
        const address = String(url);
        if (address.endsWith('/789')) return Response.json({
          url:'https://lookaside.fbsbx.com/attachment', mime_type:'application/pdf', file_size:4
        });
        if (address === 'https://lookaside.fbsbx.com/attachment') {
          assert.equal(options.headers.Authorization, 'Bearer test-whatsapp');
          return new Response('file');
        }
        return Response.json({id:'outgoing'});
      }
    });
    inbox.setIngest(event => received.push(event), undefined, async (response, name) => {
      assert.equal(await response.text(), 'file');
      return {id:'stored', name};
    });
    await inbox.handle({object:'whatsapp_business_account', entry:[{changes:[{field:'messages', value:{
      messages:[{from:'44', id:'incoming', type:'document', document:{id:'789', filename:'scan.pdf', caption:'Документ'}}]
    }}]}]});
    assert.equal(received[0].text, 'Документ');
    assert.deepEqual(received[0].attachment, {id:'stored', name:'scan.pdf'});
  } finally {
    fs.rmSync(directory, {recursive:true, force:true});
  }
});
