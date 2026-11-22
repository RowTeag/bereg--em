'use strict';
// Personal-account monitoring for the authenticated SMM Panel owner.
const fs = require('./runtime-fs');
const path = require('node:path');
const crypto = require('node:crypto');
const candidates = [
  {url:'https://t.me/studentshun',name:'Студенческий чат Венгрия',note:'Сотрудничество: @shuulyaa'},
  {url:'https://t.me/ukrainians_in_hungary_chat',name:'Українці в Угорщині',note:'Коммерческие вопросы: @tatiana_top_11'},
  {url:'https://t.me/hungarywoman',name:'Женский чат Венгрия',note:'Платная реклама: @mukhortova_k'},
  {url:'https://t.me/vengriya_chat',name:'Венгрия: объявления',note:'Одинаковый пост не чаще раза в 3 дня; уточните правила ответов.'},
  {url:'https://t.me/budapeshtchat',name:'Русский чат Будапешт',note:'Правила размещения нужно уточнить.'}
];
const normalize = text => String(text || '').toLowerCase().replace(/ё/g,'е');
function classify(message, keywords) {
  const text = normalize(message.text);
  if (!text || message.out || message.bot || !message.userSender || text.startsWith('/') || /https?:\/\/|t\.me\//.test(text)) return [];
  if (!/\?|подскаж|посовет|ищу|нужен|нужна|нужно|помогите|порад|шукаю|потріб|допомож|keresek|segíts|tud valaki|looking for|recommend|need help/.test(text)) return [];
  return keywords.filter(k => text.includes(normalize(k)));
}
function createMonitor({directory, getBusiness, getKeywords, onLead = () => {}, clock = Date.now, send}) {
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'monitor.json');
  const defaults={enabled:false,mode:'preview',chatIds:[],cooldownMinutes:180,dailyLimit:3,globalDailyLimit:15,checkpoints:{},limits:{},global:{},journal:[],blockedUntil:0};
  const state=fs.existsSync(file)?{...defaults,...JSON.parse(fs.readFileSync(file,'utf8'))}:defaults;
  const save=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(state,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);};
  let queue=Promise.resolve();
  const handle=message=>{
    const operation=queue.then(async()=>{
      const now=clock(), id=String(message.chatId);
      if (!state.enabled || !state.chatIds.includes(id) || !message.isGroup || !Number.isSafeInteger(message.id) || message.id<=Number(state.checkpoints[id]||0)) return;
      state.checkpoints[id]=message.id;save();
      if (!message.date || now-message.date*1000>300000 || message.date*1000>now+30000) return;
      const matched=classify(message,getKeywords());if(!matched.length)return;
      const business=getBusiness();
      const reply=`Hello! ${business.name} provides interpretation and personal assistance in Hungary, including support at government offices, banks, notaries and medical appointments. If you need help communicating in Hungarian, contact us here: ${business.botUrl}`;
      const entry={id:crypto.randomUUID(),chatId:id,chatTitle:message.chatTitle||id,messageId:message.id,text:message.text.slice(0,4000),reply,matched,at:new Date(now).toISOString(),status:'preview',url:message.url||''};
      const previous=state.limits[id], previousGlobal=state.global;
      const dayWindow=previous&&now-Number(previous.windowStart??previous.last)<24*60*60*1000;
      const globalWindow=previousGlobal&&now-Number(previousGlobal.windowStart??previousGlobal.last)<24*60*60*1000;
      if(state.blockedUntil>now)entry.status='paused';
      else if((previous && (now-previous.last<state.cooldownMinutes*60000 || (dayWindow && previous.count>=state.dailyLimit))) || (globalWindow && previousGlobal.count>=state.globalDailyLimit) || now-(previousGlobal.last||0)<60000)entry.status='limited';
      else if(state.mode==='auto'){
        // Persist reservation before network I/O. Never retry an ambiguous send.
        state.limits[id]={last:now,windowStart:dayWindow?Number(previous.windowStart??previous.last):now,count:(dayWindow?previous.count:0)+1};
        state.global={last:now,windowStart:globalWindow?Number(previousGlobal.windowStart??previousGlobal.last):now,count:(globalWindow?previousGlobal.count:0)+1};entry.status='sending';
      }
      state.journal.unshift(entry);state.journal=state.journal.slice(0,300);save();
      if(entry.status==='sending'){
        try{const result=await send(message,reply);entry.status='sent';entry.sentId=result?.id;}
        catch(error){
          entry.status='uncertain';
          if(/FLOOD|SLOWMODE|PEER_FLOOD/.test(error.errorMessage||'')){
            const seconds=Number(error.seconds)||3600;state.blockedUntil=now+Math.max(60,seconds)*1000;
            entry.status='paused';
          }
        }
        save();
      }
      onLead(entry);
      return entry;
    });
    queue=operation.catch(()=>{});return operation;
  };
  function configure(input, dialogs){
    if(!['preview','auto'].includes(input.mode)||typeof input.enabled!=='boolean'||!Array.isArray(input.chatIds)||input.chatIds.length>30)throw Error('Выберите режим и не более 30 групп.');
    const ids=[...new Set(input.chatIds.map(String))];
    if(ids.some(id=>!dialogs.some(d=>d.id===id)))throw Error('Обновите список групп и выберите доступные чаты.');
    for(const [key,min,max] of [['cooldownMinutes',1,10080],['dailyLimit',1,20],['globalDailyLimit',1,100]])if(!Number.isInteger(input[key])||input[key]<min||input[key]>max)throw Error('Проверьте ограничения частоты.');
    Object.assign(state,{enabled:input.enabled,mode:input.mode,chatIds:ids,cooldownMinutes:input.cooldownMinutes,dailyLimit:input.dailyLimit,globalDailyLimit:input.globalDailyLimit});save();
  }
  return {state,save,handle,configure};
}
function mountTelegramAccount(app, {directory,growth,getBusiness}) {
  const {TelegramClient,Api,utils}=require('teleproto');
  const {StringSession}=require('teleproto/sessions');
  const {NewMessage}=require('teleproto/events');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const credentialsFile=path.join(directory,'credentials.json'),sessionFile=path.join(directory,'account.session');
  let credentials=fs.existsSync(credentialsFile)?JSON.parse(fs.readFileSync(credentialsFile,'utf8')):{apiId:process.env.TELEGRAM_API_ID,apiHash:process.env.TELEGRAM_API_HASH};
  credentials.apiId=Number(credentials.apiId);
  let client=null,account=null,dialogs=[],login=null,phase='disconnected',busy=false,ticking=false,lastError='',lastChecked=null;
  const monitor=createMonitor({directory,getBusiness,getKeywords:()=>growth.state.keywords,
    send:async(message,text)=>{
      if(!client?.connected||!account)throw Error('DISCONNECTED');
      return client.sendMessage(message.peer,{message:text,replyTo:message.id,parseMode:false,linkPreview:false});
    },
    onLead:entry=>{
      growth.state.leads.unshift({id:crypto.randomUUID(),platform:'Telegram',author:entry.chatTitle,url:entry.url,text:entry.text,status:entry.status==='sent'?'replied':'new',createdAt:entry.at,matched:entry.matched,score:Math.min(100,entry.matched.length*22+18),suggestedReply:entry.reply,telegramDelivery:entry.status});
      growth.state.leads=growth.state.leads.slice(0,1000);growth.save();
    }
  });
  const safeError=error=>{
    const code=String(error?.errorMessage||'');
    if(/FLOOD|SLOWMODE/.test(code))return 'Telegram просит подождать. Повторите подключение позже.';
    if(/PHONE_CODE/.test(code))return 'Неверный или истёкший код. Запросите новый код.';
    if(/PASSWORD_HASH_INVALID/.test(code))return 'Неверный пароль двухэтапной проверки.';
    if(/API_ID_INVALID|API_ID_PUBLISHED_FLOOD/.test(code))return 'Проверьте API ID и API Hash.';
    if(/PHONE_NUMBER/.test(code))return 'Проверьте номер телефона.';
    return 'Не удалось подключиться к Telegram. Проверьте настройки и повторите вход.';
  };
  async function createClient(session=''){
    if(!Number.isSafeInteger(Number(credentials.apiId))||Number(credentials.apiId)<=0||!/^[a-f0-9]{32}$/i.test(credentials.apiHash||''))throw Error('Сохраните API ID и API Hash из my.telegram.org.');
    const c=new TelegramClient(new StringSession(session),Number(credentials.apiId),credentials.apiHash,{connectionRetries:3,requestRetries:3,autoReconnect:true,floodSleepThreshold:0});
    c.setLogLevel('none');c.onError=async()=>{lastError='Ошибка связи с Telegram.';};
    await c.connect();return c;
  }
  async function accept(){
    const me=await client.getMe();if(me.bot)throw Error('Используйте личный аккаунт.');
    account={id:String(me.id),name:[me.firstName,me.lastName].filter(Boolean).join(' '),username:me.username||''};
    fs.writeFileSync(sessionFile,client.session.save(),{mode:0o600});
    login=null;phase='connected';lastError='';
    client.addEventHandler(event=>processMessage(event.message).catch(()=>{lastError='Не удалось обработать сообщение.';}),new NewMessage({incoming:true}));
  }
  async function processMessage(m){
    if(!account||!monitor.state.enabled||!m?.peerId)return;
    const id=utils.getPeerId(m.peerId).toString();
    if(!monitor.state.chatIds.includes(id))return;
    const dialog=dialogs.find(d=>d.id===id);if(!dialog)return;
    if(m.out || !classify({text:m.message,userSender:true},growth.state.keywords).length)return;
    const sender=await m.getSender();
    return monitor.handle({chatId:id,isGroup:true,id:m.id,date:m.date,out:m.out,bot:!!sender?.bot,userSender:sender?.className==='User',text:m.message||'',chatTitle:dialog.title,peer:m.peerId,url:dialog.username?`https://t.me/${dialog.username}/${m.id}`:id.startsWith('-100')?`https://t.me/c/${id.slice(4)}/${m.id}`:''});
  }
  async function refreshDialogs(){
    if(!account||!client?.connected)throw Error('Сначала подключите личный аккаунт.');
    const found=await client.getDialogs({limit:300});
    dialogs=found.filter(d=>d.isGroup&&!d.entity?.left&&!d.entity?.deactivated).map(d=>({id:String(d.id),title:d.title,username:d.entity?.username||''}));return dialogs;
  }
  async function tick(){
    if(ticking||busy||!monitor.state.enabled)return;ticking=true;
    try{
      if(!client&&fs.existsSync(sessionFile)){client=await createClient(fs.readFileSync(sessionFile,'utf8'));if(await client.checkAuthorization()){await accept();await refreshDialogs();}else{await client.destroy();client=null;phase='disconnected';lastError='Сессия истекла. Войдите снова.';return;}}
      if(!account||!client?.connected)return;
      if(monitor.state.blockedUntil>Date.now())return;
      for(const id of monitor.state.chatIds){
        if(!monitor.state.enabled)break;
        if(!dialogs.some(d=>d.id===id))continue;
        const messages=await client.getMessages(id,{limit:100});
        for(const m of [...messages].reverse())await processMessage(m);
      }
      lastChecked=new Date().toISOString();lastError='';
    }catch(error){lastError='Проверка Telegram временно недоступна. Повтор через минуту.';if(error.seconds)monitor.state.blockedUntil=Date.now()+Number(error.seconds)*1000;monitor.save();}
    finally{ticking=false;}
  }
  const owner=(req,res,next)=>req.panelUser?.role==='superadmin'?next():res.status(403).json({error:'Личный Telegram доступен только владельцу панели.'});
  const route=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(400).json({error:error.publicMessage||safeError(error)});}};
  const publicError=message=>Object.assign(Error(message),{publicMessage:message});
  const status=()=>({phase,connected:!!account&&!!client?.connected,account,credentialsConfigured:!!credentials.apiId&&!!credentials.apiHash,lastError,lastChecked,candidates,candidatesCheckedAt:'2026-09-22',business:getBusiness(),settings:{enabled:monitor.state.enabled,mode:monitor.state.mode,chatIds:monitor.state.chatIds,cooldownMinutes:monitor.state.cooldownMinutes,dailyLimit:monitor.state.dailyLimit,globalDailyLimit:monitor.state.globalDailyLimit},blockedUntil:monitor.state.blockedUntil,journal:monitor.state.journal,dialogs});
  app.get('/api/telegram-account',owner,(req,res)=>res.json(status()));
  app.put('/api/telegram-account/credentials',owner,route(async(req,res)=>{
    if(busy||account||login)throw publicError('Сначала отключите текущий аккаунт.');
    const apiId=Number(req.body.apiId),apiHash=String(req.body.apiHash||'').trim();
    if(!Number.isSafeInteger(apiId)||apiId<=0||!/^[a-f0-9]{32}$/i.test(apiHash))throw publicError('Введите числовой API ID и API Hash из 32 символов.');
    credentials={apiId,apiHash};fs.writeFileSync(credentialsFile,JSON.stringify(credentials),{mode:0o600});res.json({ok:true});
  }));
  app.post('/api/telegram-account/login',owner,route(async(req,res)=>{
    if(busy||account)throw publicError('Подключение уже выполняется или аккаунт подключён.');
    if(!credentials.apiId||!credentials.apiHash)throw publicError('Сначала сохраните API ID и API Hash.');
    const phone=String(req.body.phone||'').trim();if(!/^\+[0-9]{8,15}$/.test(phone))throw publicError('Введите телефон с кодом страны, например +36…');
    busy=true;
    try{
      if(client)await client.destroy();login=null;client=null;phase='connecting';
      client=await createClient();const sent=await client.sendCode(credentials,phone);
      login={phone,hash:sent.phoneCodeHash,expires:Date.now()+300000};phase='code';res.json({phase});
    }catch(error){phase='disconnected';throw error;}finally{busy=false;}
  }));
  app.post('/api/telegram-account/verify',owner,route(async(req,res)=>{
    if(busy||!login||login.expires<Date.now()||!['code','password'].includes(phase))throw publicError('Запросите новый код входа.');
    busy=true;
    try{
      if(phase==='password'){
        const password=String(req.body.password||'');if(!password||password.length>256)throw publicError('Введите пароль двухэтапной проверки.');
        await client.signInWithPassword(credentials,{password:async()=>password,onError:async error=>{throw error;}});
      }else{
        const code=String(req.body.code||'').trim();if(!/^\d{4,8}$/.test(code))throw publicError('Введите код из Telegram.');
        try{const result=await client.invoke(new Api.auth.SignIn({phoneNumber:login.phone,phoneCodeHash:login.hash,phoneCode:code}));if(result.className==='auth.AuthorizationSignUpRequired')throw publicError('Нужен существующий аккаунт Telegram.');}
        catch(error){if(error.errorMessage==='SESSION_PASSWORD_NEEDED'){phase='password';res.json({phase});return;}throw error;}
      }
      await accept();await refreshDialogs();res.json({phase,account});
    }finally{busy=false;}
  }));
  app.post('/api/telegram-account/disconnect',owner,route(async(req,res)=>{
    if(busy)throw publicError('Дождитесь завершения текущего подключения.');
    busy=true;monitor.state.enabled=false;monitor.save();
    try{if(client)await client.destroy();}finally{client=null;account=null;login=null;dialogs=[];phase='disconnected';if(fs.existsSync(sessionFile))fs.unlinkSync(sessionFile);busy=false;}
    res.json({ok:true});
  }));
  app.get('/api/telegram-account/dialogs',owner,route(async(req,res)=>res.json({dialogs:await refreshDialogs()})));
  app.put('/api/telegram-account/settings',owner,route(async(req,res)=>{
    if(req.body.enabled&&!account)throw publicError('Сначала подключите аккаунт.');
    try{monitor.configure(req.body,dialogs);}catch(error){throw publicError(error.message);}
    res.json({ok:true});tick();
  }));
  // Start with the panel, restore only the session owned by this feature.
  const ready=(async()=>{if(!fs.existsSync(sessionFile))return;busy=true;try{client=await createClient(fs.readFileSync(sessionFile,'utf8'));if(await client.checkAuthorization()){await accept();await refreshDialogs();}else{await client.destroy();client=null;lastError='Войдите в Telegram повторно.';}}catch{if(client)await client.destroy().catch(()=>{});client=null;account=null;lastError='Не удалось восстановить подключение.';}finally{busy=false;}})();
  const timer=setInterval(()=>tick(),60000);timer.unref();ready.then(()=>tick());
  return {monitor,status,ready,close:async()=>{clearInterval(timer);if(client)await client.destroy();}};
}
module.exports={createMonitor,classify,mountTelegramAccount};
