const fs=require('./runtime-fs');
const path=require('node:path');
const crypto=require('node:crypto');
const { languageCodes }=require('./languages');
const limits={last:70,first:70,status:100,papers:150,departure:10,contact:90,details:300};
const questions=['housing','funding','consultation','documents'];
function normalize(input){
 const data={};
 for(const [key,max] of Object.entries(limits)){const value=input[key]??'';if(typeof value!=='string'||value.length>max)throw Error('Проверьте поле '+key);data[key]=value.trim();}
 for(const [key,max] of Object.entries({service:120,country:80,caseStatus:80,activeOrder:3})){
  if(input[key]===undefined)continue;
  if(typeof input[key]!=='string'||input[key].length>max||(key==='activeOrder'&&!['','yes','no'].includes(input[key])))throw Error('Проверьте поле '+key);
  data[key]=input[key].trim();
 }
 const digits=data.contact.replace(/\D/g,'');
 if(!data.first||!data.last||(data.contact&&(!/^\+?[0-9(). -]+$/.test(data.contact)||digits.length<7||digits.length>15)))throw Error('Укажите имя, фамилию и корректный телефон с кодом страны.');
 data.phone=digits?(digits.startsWith('00')?digits.slice(2):digits):'';
 const language=String(input.language||input.lang||'').toLowerCase();if(languageCodes.includes(language))data.language=language;
 if(data.departure&&(!/^\d{4}-\d{2}-\d{2}$/.test(data.departure)||Number.isNaN(Date.parse(data.departure))))throw Error('Проверьте дату выезда.');
 for(const key of questions){if(!['','yes','no',undefined].includes(input[key]))throw Error('Проверьте ответы анкеты.');data[key]=input[key]||'';}
 return data;
}
function createClients(directory){
 fs.mkdirSync(directory,{recursive:true,mode:0o700});const file=path.join(directory,'clients.json');
 let records=[];try{records=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(records))throw Error('Invalid clients store');}catch(e){if(e.code!=='ENOENT')throw e;}
 const save=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(records,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);};
 return {
  list:()=>records,
  link(id,dialogId){const item=records.find(c=>c.id===id);if(!item)throw Error('Клиент не найден');item.dialogIds=[...new Set([...(item.dialogIds||[]),dialogId])];save();},
  put(input,id){const data=normalize(input);let item=id?records.find(c=>c.id===id):(data.phone?records.find(c=>c.phone===data.phone):null);if(id&&!item)throw Error('Клиент не найден.');if(data.phone&&records.some(c=>c.phone===data.phone&&c!==item))throw Error('Этот номер уже есть в базе.');const now=new Date().toISOString();if(!item){item={id:crypto.randomUUID(),createdAt:now};records.push(item);}Object.assign(item,data,{updatedAt:now});save();return item;},
  attachPdf(clientId,{sourceId,filename,mimeType,base64}){
   if(!/^[a-z0-9-]{36}$/i.test(sourceId||'')||filename!=='bereg-anketa.pdf'||mimeType!=='application/pdf'||typeof base64!=='string'||base64.length>Math.ceil(2*1024*1024/3)*4||base64.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))throw Error('Некорректный PDF из заявки.');
   const bytes=Buffer.from(base64,'base64');if(!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||bytes.length>2*1024*1024)throw Error('Некорректный PDF из заявки.');
   const item=records.find(c=>c.id===clientId);if(!item)throw Error('Клиент не найден.');
   const docDir=path.join(directory,'documents');fs.mkdirSync(docDir,{recursive:true,mode:0o700});
   const pdfPath=path.join(docDir,sourceId+'.pdf');
   if(!fs.existsSync(pdfPath)){const temp=pdfPath+'.tmp';fs.writeFileSync(temp,bytes,{mode:0o600});fs.renameSync(temp,pdfPath);}
   const attachment={id:sourceId,fileName:filename,mimeType,createdAt:new Date().toISOString()};
   item.attachments=[...(item.attachments||[]).filter(a=>a.id!==sourceId),attachment];save();return attachment;
  },
  attachOffice(clientId,input){
   const client=records.find(item=>item.id===clientId);
   if(!client)throw Error('Клиент не найден.');
   return require('./office-documents').attachOfficeFile(directory,client,input,save);
  },
  document(clientId,documentId){
   if(!/^[a-z0-9-]{36}$/i.test(documentId||''))return null;
   const item=records.find(c=>c.id===clientId);const attachment=item?.attachments?.find(a=>a.id===documentId);if(!attachment)return null;
   const pdfPath=path.join(directory,'documents',documentId+'.'+(attachment.extension||'pdf'));if(!fs.existsSync(pdfPath))return null;
   return {path:pdfPath,fileName:attachment.fileName};
  }
 };
}
function mountClients(app,{directory,support,workerMode=false}){
 const store=createClients(directory);
 const dialogs=c=>Object.values(support.state.clients).filter(d=>(c.dialogIds||[]).includes(d.id)||(c.phone&&d.provider==='whatsapp'&&String(d.contact||d.externalId||'').replace(/\D/g,'')===c.phone)).map(d=>({id:d.id,name:d.name,provider:d.provider,files:(d.history||[]).flatMap(h=>[
  ...(h.attachment?[{name:h.attachment.name,url:'/api/telegram/inbox/'+encodeURIComponent(d.id)+'/files/'+encodeURIComponent(h.attachment.id)}]:[]),
  ...(h.attachments||[])
 ])}));
 app.post('/api/clients/:id/dialogs',(req,res)=>{if(!support.state.clients[req.body.dialogId])return res.status(404).json({error:'Диалог не найден'});try{store.link(req.params.id,req.body.dialogId);res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}});
 app.post('/api/clients/from-inbox/:dialogId',(req,res)=>{const dialog=support.state.clients[req.params.dialogId];if(!dialog||(req.panelUser.role==='operator'&&!support.state.operators.some(o=>o.id===req.panelUser.operatorId&&o.enabled&&dialog.operatorId===o.id)))return res.status(404).json({error:'Обращение не найдено.'});try{let client=store.list().find(item=>(item.dialogIds||[]).includes(dialog.id));if(client)return res.json({client,linked:true,existing:true});const name=String(dialog.name||'Клиент').trim().split(/\s+/);const first=name.shift()||'Клиент';const last=name.join(' ')||'Не указана';const contact=String(dialog.contact||'');const digits=contact.replace(/\D/g,'');const phone=digits.length>=7&&digits.length<=15&&/^\+?[0-9(). -]+$/.test(contact)?contact:'';client=store.put({first,last,contact:phone,language:dialog.language||'',details:'Добавлен из обращения '+(dialog.provider||'Telegram')+'.'});store.link(client.id,dialog.id);res.json({client,linked:true,existing:false});}catch(e){res.status(400).json({error:e.message});}});
 app.post('/api/clients/:id/documents',(req,res)=>{
  try{res.status(201).json({document:store.attachOffice(req.params.id,req.body)});}
  catch(error){res.status(400).json({error:error.message});}
 });
 app.get('/api/clients/:id/documents/:documentId',(req,res)=>{const document=store.document(req.params.id,req.params.documentId);if(!document)return res.sendStatus(404);res.download(document.path,document.fileName,error=>{if(error&&!res.headersSent)res.status(error.statusCode||500).end();});});
 app.get('/api/clients',(req,res)=>res.json({clients:store.list().map(c=>({...c,dialogs:dialogs(c)}))}));
 app.post('/api/clients',(req,res)=>{try{res.json({client:store.put(req.body)});}catch(e){res.status(400).json({error:e.message});}});
 app.put('/api/clients/:id',(req,res)=>{try{
  const previous=store.list().find(c=>c.id===req.params.id)?.caseStatus;
  const client=store.put(req.body,req.params.id);
  if(client.caseStatus&&previous!==client.caseStatus&&client.dialogIds?.length===1){
    const dialog=support.state.clients[client.dialogIds[0]];
    if(dialog){require('./reply-templates').autoReply(directory,dialog,'status',client.caseStatus,support.state.queue);support.save();support.flush().catch(()=>{});}
  }
  res.json({client});}catch(e){res.status(400).json({error:e.message});}});
 
 const syncFile=path.join(directory,'imported.json');let imported=[];try{imported=JSON.parse(fs.readFileSync(syncFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 let running=false,lastSync=null,syncError=null;
 const notificationsFile=path.join(directory,'notifications.json');
 let notificationState={applications:[],acknowledged:{}};
 try{notificationState=JSON.parse(fs.readFileSync(notificationsFile,'utf8'));if(!Array.isArray(notificationState.applications)||!notificationState.acknowledged)throw Error('Invalid notification state');}catch(e){if(e.code!=='ENOENT')throw e;}
 const saveNotifications=()=>{fs.writeFileSync(notificationsFile+'.tmp',JSON.stringify(notificationState),{mode:0o600});fs.renameSync(notificationsFile+'.tmp',notificationsFile);};
 async function sync(){if(running)return;running=true;try{const config=JSON.parse(fs.readFileSync(path.join(directory,'..','crm-site.json'),'utf8'));let cursor;do{const url=new URL('/api/crm/applications',config.url);if(cursor)url.searchParams.set('cursor',cursor);const r=await fetch(url,{headers:{Authorization:'Bearer '+config.token},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Сайт недоступен: '+r.status);const page=await r.json();for(const lead of page.leads){if(imported.includes(lead.id))continue;const client=store.put(lead);if(lead.pdf){const attachment=store.attachPdf(client.id,{sourceId:lead.id,filename:lead.pdf.filename,mimeType:lead.pdf.mimeType,base64:lead.pdf.base64});try{const operator=support.state.operators.find(item=>item.enabled&&item.name==='Главный оператор'&&item.chatId);if(operator)await support.sendApplicationDocument(operator.chatId,path.join(directory,'documents',lead.id+'.pdf'),support.translate(operator.language||'en','newApplication'),'https://t.me/'+(process.env.TELEGRAM_CLIENT_BOT_USERNAME||'bereg_support_bot'));}catch(error){syncError='Не удалось отправить PDF оператору Telegram';}}
 imported.push(lead.id);notificationState.applications.push({id:lead.id,at:new Date().toISOString()});saveNotifications();fs.writeFileSync(syncFile+'.tmp',JSON.stringify(imported),{mode:0o600});fs.renameSync(syncFile+'.tmp',syncFile);}cursor=page.cursor;}while(cursor);lastSync=new Date().toISOString();if(!syncError)syncError=null;}catch(e){syncError=e.code==='ENOENT'?'Подключение сайта не настроено':e.message;}finally{running=false;}}
 app.get('/api/clients-sync',(req,res)=>{const seen=new Set(notificationState.acknowledged[req.panelUser.id]||[]);res.json({lastSync,error:syncError,running,newApplications:notificationState.applications.filter(item=>!seen.has(item.id)).length});});
 app.post('/api/clients-sync/ack',(req,res)=>{notificationState.acknowledged[req.panelUser.id]=notificationState.applications.map(item=>item.id);saveNotifications();res.json({ok:true});});
 app.post('/api/clients-sync',async(req,res)=>{await sync();res.status(syncError?502:200).json({lastSync,error:syncError});});
 store.sync=sync;
 sync();if(!workerMode)setInterval(sync,30000).unref();
 return store;
}
module.exports={normalize,createClients,mountClients};
