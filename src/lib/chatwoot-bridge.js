const fs=require('./runtime-fs');
const path=require('path');
const crypto=require('crypto');
const express=require('express');

function createChatwootBridge({directory,env=process.env,fetchImpl=fetch}){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'config.json');
  const read=()=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {};}};
  let config={baseUrl:'https://app.chatwoot.com',accountId:'',inboxId:'',apiToken:'',webhookSecret:'',activity:{},...read()};
  const save=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(config,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);};
  if(!fs.existsSync(file))save();
  let ingest=async()=>{};
  const panelBaseUrl=String(env.APP_BASE_URL||env.RAILWAY_PUBLIC_DOMAIN&&`https://${env.RAILWAY_PUBLIC_DOMAIN}`||env.BEREG_PUBLIC_URL||'').replace(/\/$/,'');
  const cleanBase=value=>{const url=new URL(String(value||'https://app.chatwoot.com'));if(url.protocol!=='https:')throw new Error('Chatwoot должен использовать HTTPS.');return url.origin;};
  const configured=()=>Boolean(config.accountId&&config.apiToken&&config.webhookSecret);
  async function api(endpoint,{method='GET',body}={}){
    if(!config.accountId||!config.apiToken)throw new Error('Chatwoot ещё не подключён.');
    const response=await fetchImpl(`${cleanBase(config.baseUrl)}${endpoint}`,{method,headers:{'api_access_token':config.apiToken,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
    const data=await response.json().catch(()=>null);if(!response.ok)throw new Error(data?.message||data?.error||`Chatwoot API: ${response.status}`);return data;
  }
  function signatureValid(req){
    if(!config.webhookSecret)return false;
    const timestamp=String(req.headers['x-chatwoot-timestamp']||''),supplied=String(req.headers['x-chatwoot-signature']||'');
    if(!/^\d{10,13}$/.test(timestamp)||!supplied.startsWith('sha256='))return false;
    const seconds=Number(timestamp)>1e12?Number(timestamp)/1000:Number(timestamp);if(Math.abs(Date.now()/1000-seconds)>300)return false;
    const expected='sha256='+crypto.createHmac('sha256',config.webhookSecret).update(`${timestamp}.`).update(req.rawBody||Buffer.alloc(0)).digest('hex');
    return supplied.length===expected.length&&crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected));
  }
  async function handle(payload){
    if(payload?.event!=='message_created'||payload.private===true||!['incoming',0,'0'].includes(payload.message_type))return;
    const conversationId=String(payload.conversation?.id||payload.conversation?.display_id||payload.conversation_id||'');if(!conversationId)return;
    const inboxId=String(payload.inbox?.id||payload.conversation?.inbox_id||'');if(config.inboxId&&inboxId!==String(config.inboxId))return;
    if(payload.account?.id&&String(payload.account.id)!==String(config.accountId))return;
    const attachments=[];
    for(const item of (Array.isArray(payload.attachments)?payload.attachments:[]).slice(0,10)){
      try{
        const url=new URL(item.data_url);
        if(url.protocol==='https:'&&url.origin===cleanBase(config.baseUrl)&&!url.username&&!url.password)
          attachments.push({url:url.href,name:String(item.file_name||item.file_type||'Файл').slice(0,150)});
      }catch{}
    }
    const text=String(payload.content||payload.processed_message_content||attachments.map(a=>a.name).join(', ')).trim();if(!text)return;
    const sender=payload.sender||payload.conversation?.meta?.sender||{};
    const channel=String(payload.conversation?.channel||payload.inbox?.channel_type||'').replace(/^Channel::/i,'').toLowerCase();
    const provider=({facebookpage:'facebook',facebook:'facebook',whatsapp:'whatsapp',instagram:'instagram',email:'email',tiktok:'tiktok',telegram:'telegram',line:'chatwoot',api:'chatwoot',viber:'viber'})[channel]||(channel?'chatwoot':config.inboxId?'facebook':'chatwoot');
    const name=sender.name||sender.available_name||'Клиент';
    const contact=sender.identifier||sender.email||sender.phone_number||provider;
    await ingest({provider,attachments,transport:'chatwoot',externalId:conversationId,name,contact,sourceUrl:`${cleanBase(config.baseUrl)}/app/accounts/${encodeURIComponent(config.accountId)}/conversations/${encodeURIComponent(conversationId)}`,text,sourceId:String(payload.id||payload.source_id||'')});
    config.activity={...config.activity,lastInboundAt:new Date().toISOString(),lastConversationId:conversationId};save();
  }
  async function sendMessage(client,text){
    const conversationId=String(client.externalId||'');if(!/^\d+$/.test(conversationId))throw new Error('Некорректный диалог Chatwoot.');
    await api(`/api/v1/accounts/${encodeURIComponent(config.accountId)}/conversations/${encodeURIComponent(conversationId)}/messages`,{method:'POST',body:{content:String(text).slice(0,3500),message_type:'outgoing',private:false,content_type:'text'}});
    config.activity={...config.activity,lastOutboundAt:new Date().toISOString(),lastConversationId:conversationId};save();
  }
  async function sendFile(client,attachment,bytes){
    if(!/^\d+$/.test(client.externalId))throw Error('Некорректный диалог Chatwoot.');
    const form=new FormData();form.set('message_type','outgoing');form.set('private','false');
    form.append('attachments[]',new Blob([bytes]),attachment.name);
    await api('/api/v1/accounts/'+encodeURIComponent(config.accountId)+'/conversations/'+encodeURIComponent(client.externalId)+'/messages',{method:'POST',body:form});
  }
  async function diagnostics(){
    const result={configured:configured(),activity:config.activity||{}};if(!config.accountId||!config.apiToken)return result;
    try{const data=await api(`/api/v1/accounts/${encodeURIComponent(config.accountId)}/inboxes`);const list=Array.isArray(data?.payload)?data.payload:Array.isArray(data)?data:[];result.api=true;result.inboxes=list.map(item=>({id:String(item.id),name:item.name||'',channelType:item.channel_type||item.channel?.type||''}));result.selectedInboxFound=!config.inboxId||result.inboxes.some(item=>item.id===String(config.inboxId));}catch(error){result.api=false;result.error=error.message;}return result;
  }
  function mountWebhook(app){
    app.post('/webhooks/chatwoot',express.json({limit:'2mb',verify:(req,res,buf)=>{req.rawBody=Buffer.from(buf);}}),async(req,res)=>{if(!signatureValid(req))return res.sendStatus(401);try{await handle(req.body);res.sendStatus(200);}catch{res.sendStatus(503);}});
  }
  function mountAdmin(app){
    const owner=(req,res,next)=>req.panelUser.role==='superadmin'?next():res.status(403).json({error:'Подключение Chatwoot доступно только суперадминистратору.'});
    app.get('/api/chatwoot/status',owner,(req,res)=>res.json({configured:configured(),baseUrl:config.baseUrl,accountId:config.accountId,inboxId:config.inboxId,apiTokenConfigured:Boolean(config.apiToken),webhookSecretConfigured:Boolean(config.webhookSecret),webhookUrl:`${panelBaseUrl}/webhooks/chatwoot`,activity:config.activity||{}}));
    app.get('/api/chatwoot/diagnostics',owner,async(req,res)=>{try{res.json(await diagnostics());}catch(error){res.status(502).json({error:error.message});}});
    app.put('/api/chatwoot/config',owner,(req,res)=>{try{config={...config,baseUrl:cleanBase(req.body.baseUrl||config.baseUrl),accountId:String(req.body.accountId||'').trim().slice(0,30),inboxId:String(req.body.inboxId||'').trim().slice(0,30),apiToken:String(req.body.apiToken||'').trim()||config.apiToken,webhookSecret:String(req.body.webhookSecret||'').trim()||config.webhookSecret};if(!/^\d+$/.test(config.accountId)||config.inboxId&&!/^\d+$/.test(config.inboxId))throw new Error('Укажите числовые Account ID и Inbox ID.');save();res.json({ok:true});}catch(error){res.status(400).json({error:error.message});}});
  }
  return{mountWebhook,mountAdmin,setIngest:fn=>{ingest=fn;},sendMessage,sendFile,handle,diagnostics,status:()=>config};
}
module.exports={createChatwootBridge};
