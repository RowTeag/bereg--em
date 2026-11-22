const fs=require('./runtime-fs');
const path=require('path');
const crypto=require('crypto');
const { languages, languageCodes }=require('./languages');

function createMetaInbox({directory,graphVersion='v26.0',facebookAuth,env=process.env,fetchImpl=fetch}){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'config.json');
  const read=()=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {};}};
  let config={verifyToken:crypto.randomBytes(24).toString('base64url'),whatsapp:{phoneNumberId:'',businessAccountId:'',displayPhoneNumber:'',accessToken:''},welcomed:{facebook:{},whatsapp:{}},activity:{facebook:{},whatsapp:{}},...read()};
  config.whatsapp={phoneNumberId:'',businessAccountId:'',displayPhoneNumber:'',accessToken:'',...(config.whatsapp||{})};
  config.welcomed={facebook:{},whatsapp:{},...(config.welcomed||{})};
  config.activity={facebook:{},whatsapp:{},...(config.activity||{})};
  config.languages={facebook:{},whatsapp:{},...(config.languages||{})};
  const save=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(config,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);};
  if(config.languageSelectionVersion!==1){config.languages={facebook:{},whatsapp:{}};config.languageSelectionVersion=1;save();}
  if(!fs.existsSync(file))save();
  let ingest=async()=>{};
  let setCustomerLanguage=()=>{};
  const baseUrl=String(env.APP_BASE_URL||env.RAILWAY_PUBLIC_DOMAIN&&`https://${env.RAILWAY_PUBLIC_DOMAIN}`||env.BEREG_PUBLIC_URL||'').replace(/\/$/,'');
  const appSecret=()=>String(facebookAuth.appSecret?.()||env.FACEBOOK_APP_SECRET||'').trim();
  const page=()=>facebookAuth.peek();
  const waToken=()=>String(config.whatsapp.accessToken||env.WHATSAPP_ACCESS_TOKEN||'').trim();
  const waPhoneId=()=>String(config.whatsapp.phoneNumberId||env.WHATSAPP_PHONE_NUMBER_ID||'').trim();
  const waBusinessAccountId=()=>String(config.whatsapp.businessAccountId||env.WHATSAPP_BUSINESS_ACCOUNT_ID||'').trim();
  const waDisplayPhoneNumber=()=>String(config.whatsapp.displayPhoneNumber||env.WHATSAPP_DISPLAY_PHONE_NUMBER||'').trim();
  const words={
    en:{welcome:'BEREG OUTSOURCE GROUP\nYour assistant in Hungary 🇭🇺\n\nWe help with translation, immigration procedures and personal assistance.\n\nDescribe what you need and a support agent will help you here.',services:'How we can help\n\n▫️ Translation and interpreting\n▫️ Immigration procedures\n▫️ Legal and appointment assistance\n\nTell us what you need and which city. A support agent will follow up.',operator:'Tell us what you need help with. Include your city and preferred timing. A support agent will reply here.',contacts:'BEREG OUTSOURCE GROUP\n\n☎ +36 70 743 9706\nViber · Telegram · WhatsApp\n\n✉ ugyintezesmagyarorszagon@gmail.com\n📍 1117 Budapest, Budafoki út 60.\n\nSend a message here and our team will help.',receipt:'✓ Your message has been sent to our support team. A reply will arrive in this chat.',language:'Choose your language:',languageSaved:'Language set to English.',talk:'💬 Support',servicesButton:'📋 Services',contactsButton:'📍 Contacts',languageButton:'🌐 Language',header:'BEREG · Support',footer:'BEREG Outsource Group · Hungary'},
    ru:{welcome:'BEREG OUTSOURCE GROUP\nВаш помощник в Венгрии 🇭🇺\n\nПомогаем с переводами, миграционными процедурами и сопровождением.\n\nОпишите задачу, и оператор поможет вам здесь.',services:'Чем можем помочь\n\n▫️ Устный и письменный перевод\n▫️ Миграционные процедуры\n▫️ Юридические вопросы и сопровождение\n\nРасскажите, какая помощь нужна и в каком городе. Оператор свяжется с вами.',operator:'Напишите, какая помощь нужна. Укажите город и удобное время. Оператор ответит здесь.',contacts:'BEREG OUTSOURCE GROUP\n\n☎ +36 70 743 9706\nViber · Telegram · WhatsApp\n\n✉ ugyintezesmagyarorszagon@gmail.com\n📍 1117 Budapest, Budafoki út 60.\n\nНапишите сюда, и наша команда поможет вам.',receipt:'✓ Сообщение передано команде поддержки. Ответ придёт в этот чат.',language:'Выберите язык:',languageSaved:'Язык изменён на русский.',talk:'💬 Оператор',servicesButton:'📋 Услуги',contactsButton:'📍 Контакты',languageButton:'🌐 Язык',header:'BEREG · Поддержка',footer:'BEREG Outsource Group · Венгрия'},
    vi:{welcome:'BEREG OUTSOURCE GROUP\nTrợ lý của bạn tại Hungary 🇭🇺\n\nChúng tôi hỗ trợ phiên dịch, thủ tục nhập cư và các cuộc hẹn.\n\nHãy mô tả nhu cầu, nhân viên hỗ trợ sẽ giúp bạn tại đây.',services:'Chúng tôi có thể giúp gì\n\n▫️ Phiên dịch và dịch thuật\n▫️ Thủ tục nhập cư\n▫️ Hỗ trợ pháp lý và lịch hẹn\n\nHãy cho biết bạn cần gì và ở thành phố nào. Nhân viên sẽ liên hệ.',operator:'Hãy cho chúng tôi biết bạn cần hỗ trợ gì, thành phố và thời gian phù hợp. Nhân viên sẽ trả lời tại đây.',contacts:'BEREG OUTSOURCE GROUP\n\n☎ +36 70 743 9706\nViber · Telegram · WhatsApp\n\n✉ ugyintezesmagyarorszagon@gmail.com\n📍 1117 Budapest, Budafoki út 60.\n\nNhắn tin tại đây để nhóm hỗ trợ giúp bạn.',receipt:'✓ Tin nhắn đã được gửi cho nhóm hỗ trợ. Câu trả lời sẽ đến trong chat này.',language:'Chọn ngôn ngữ:',languageSaved:'Đã chuyển sang tiếng Việt.',talk:'💬 Hỗ trợ',servicesButton:'📋 Dịch vụ',contactsButton:'📍 Liên hệ',languageButton:'🌐 Ngôn ngữ',header:'BEREG · Hỗ trợ',footer:'BEREG Outsource Group · Hungary'},
    uk:{welcome:'BEREG OUTSOURCE GROUP\nВаш помічник в Угорщині 🇭🇺\n\nДопомагаємо з перекладом, міграційними процедурами та супроводом.\n\nОпишіть запит, і оператор допоможе вам тут.',services:'Чим можемо допомогти\n\n▫️ Усний і письмовий переклад\n▫️ Міграційні процедури\n▫️ Юридичні питання та супровід\n\nРозкажіть, яка допомога потрібна та в якому місті. Оператор зв’яжеться з вами.',operator:'Напишіть, яка допомога потрібна. Вкажіть місто та зручний час. Оператор відповість тут.',contacts:'Контакти BEREG OUTSOURCE GROUP\n\n☎ +36 70 743 9706\nViber · Telegram · WhatsApp\n\n✉ ugyintezesmagyarorszagon@gmail.com\n📍 1117 Budapest, Budafoki út 60.\n\nНапишіть сюди, і наша команда допоможе.',receipt:'✓ Повідомлення передано команді підтримки. Відповідь надійде в цей чат.',language:'Оберіть мову:',languageSaved:'Мову змінено на українську.',talk:'💬 Підтримка',servicesButton:'📋 Послуги',contactsButton:'📍 Контакти',languageButton:'🌐 Мова',header:'BEREG · Підтримка',footer:'BEREG Outsource Group · Угорщина'},
    hu:{welcome:'BEREG OUTSOURCE GROUP\nAz Ön magyarországi segítője 🇭🇺\n\nFordításban, bevándorlási ügyintézésben és személyes kísérésben segítünk.\n\nÍrja le, miben segíthetünk, és munkatársunk itt válaszol.',services:'Miben segíthetünk\n\n▫️ Szóbeli és írásbeli fordítás\n▫️ Bevándorlási ügyintézés\n▫️ Jogi ügyintézés és kísérés\n\nÍrja meg, milyen segítségre van szüksége és melyik városban. Munkatársunk felveszi Önnel a kapcsolatot.',operator:'Írja meg, milyen segítségre van szüksége, melyik városban és mikor. Munkatársunk itt válaszol.',contacts:'BEREG OUTSOURCE GROUP elérhetőségei\n\n☎ +36 70 743 9706\nViber · Telegram · WhatsApp\n\n✉ ugyintezesmagyarorszagon@gmail.com\n📍 1117 Budapest, Budafoki út 60.\n\nÍrjon nekünk itt, és csapatunk segít.',receipt:'✓ Üzenetét továbbítottuk ügyfélszolgálatunknak. A válasz ebben a chatben érkezik.',language:'Válasszon nyelvet:',languageSaved:'A nyelv magyarra van állítva.',talk:'💬 Ügyfélszolgálat',servicesButton:'📋 Szolgáltatások',contactsButton:'📍 Kapcsolat',languageButton:'🌐 Nyelv',header:'BEREG · Ügyfélszolgálat',footer:'BEREG Outsource Group · Magyarország'}
  };
  const languageLabels=Object.fromEntries(Object.entries(languages).map(([code,language])=>[code,language.label]));
  const languageFor=(provider,id)=>config.languages[provider]?.[id]||null;
  const wordsFor=(provider,id)=>words[languageFor(provider,id)||'en']||words.en;
  const facebookMenuVersion='client-v6',whatsappMenuVersion='client-v6';
  const waPublicUrl=()=>{const digits=waDisplayPhoneNumber().replace(/\D/g,'');return digits?`https://wa.me/${digits}`:'';};
  const facebookPublicUrl=()=>{const id=String(page().pageId||'').trim();return id?`https://m.me/${encodeURIComponent(id)}`:'';};
  async function graph(endpoint,{method='GET',token,body}={}){
    const url=`https://graph.facebook.com/${graphVersion}/${endpoint}`;
    const response=await fetchImpl(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
    const data=await response.json().catch(()=>null);if(!response.ok||data?.error)throw new Error(data?.error?.message||`Meta API: ${response.status}`);return data;
  }
  function signatureValid(req){
    const secret=appSecret();if(!secret)return true;
    const supplied=String(req.headers['x-hub-signature-256']||'');if(!supplied.startsWith('sha256='))return false;
    const expected='sha256='+crypto.createHmac('sha256',secret).update(req.rawBody||Buffer.alloc(0)).digest('hex');
    return supplied.length===expected.length&&crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected));
  }
  async function facebookName(psid){
    const token=page().accessToken;if(!token)return '';
    try{const data=await graph(`${encodeURIComponent(psid)}?fields=first_name,last_name&access_token=${encodeURIComponent(token)}`,{token});return [data.first_name,data.last_name].filter(Boolean).join(' ');}catch{return '';}
  }
  function rememberWelcome(provider,id){
    const bucket=config.welcomed[provider]||(config.welcomed[provider]={});
    const version=provider==='whatsapp'?whatsappMenuVersion:facebookMenuVersion;
    bucket[id]=`${version}:${new Date().toISOString()}`;
    const entries=Object.entries(bucket).sort((a,b)=>String(b[1]).localeCompare(String(a[1])));
    config.welcomed[provider]=Object.fromEntries(entries.slice(0,500));save();
  }
  async function sendWelcome(provider,recipient){
    const w=wordsFor(provider,recipient);
    if(!languageFor(provider,recipient)){await sendLanguageMenu(provider,recipient);return;}
    if(provider==='facebook'){
      const token=page().accessToken;if(!token)return;
      await graph(`${encodeURIComponent(page().pageId)}/messages`,{method:'POST',token,body:{recipient:{id:recipient},messaging_type:'RESPONSE',message:{text:w.welcome,quick_replies:[
        {content_type:'text',title:w.talk,payload:'BEREG_OPERATOR'},
        {content_type:'text',title:w.servicesButton,payload:'BEREG_SERVICES'},
        {content_type:'text',title:w.languageButton,payload:'BEREG_LANGUAGE'}
      ]}}});return;
    }
    if(provider==='whatsapp'){
      await sendWhatsappMenu(recipient,w.welcome,languageFor(provider,recipient));
    }
  }
  async function sendWhatsappMenu(recipient,text,language='en'){
    const token=waToken(),phoneId=waPhoneId();if(!token||!phoneId)return;
    const w=words[language]||words.en;
    await graph(`${encodeURIComponent(phoneId)}/messages`,{method:'POST',token,body:{messaging_product:'whatsapp',recipient_type:'individual',to:recipient,type:'interactive',interactive:{type:'button',header:{type:'text',text:w.header},body:{text},footer:{text:w.footer},action:{buttons:[
      {type:'reply',reply:{id:'bereg_operator',title:w.talk}},
      {type:'reply',reply:{id:'bereg_services',title:w.servicesButton}},
      {type:'reply',reply:{id:'bereg_language',title:w.languageButton}}
    ]}}}});
  }
  async function sendLanguageMenu(provider,recipient,pageIndex=0){
    const language=languageFor(provider,recipient)||'en';
    const w=words[language]||words.en;
    const pageSize=provider==='whatsapp'?9:12;
    const start=(Math.max(0,Number(pageIndex)||0)%Math.ceil(languageCodes.length/pageSize))*pageSize;
    const pageCodes=languageCodes.slice(start,start+pageSize);
    const more=start+pageSize<languageCodes.length;
    if(provider==='whatsapp'){
      const token=waToken(),phoneId=waPhoneId();if(!token||!phoneId)return;
      const rows=pageCodes.map(code=>({id:`bereg_lang_${code}`,title:languageLabels[code],description:words[code]?.languageSaved||`Use ${languages[code].name}`}));
      if(more)rows.push({id:`bereg_languages_more_${Math.floor(start/pageSize)+1}`,title:'➕ More languages',description:'Show more language options'});
      await graph(`${encodeURIComponent(phoneId)}/messages`,{method:'POST',token,body:{messaging_product:'whatsapp',recipient_type:'individual',to:recipient,type:'interactive',interactive:{type:'list',header:{type:'text',text:w.header},body:{text:w.language},footer:{text:w.footer},action:{button:w.language,sections:[{title:w.language,rows}]}}}});return;
    }
    const token=page().accessToken;if(!token)return;
    const quickReplies=pageCodes.map(code=>({content_type:'text',title:languageLabels[code],payload:`BEREG_LANG_${code.toUpperCase()}`}));
    if(more)quickReplies.push({content_type:'text',title:'➕ More languages',payload:`BEREG_LANGUAGES_MORE_${Math.floor(start/pageSize)+1}`});
    await graph(`${encodeURIComponent(page().pageId)}/messages`,{method:'POST',token,body:{recipient:{id:recipient},messaging_type:'RESPONSE',message:{text:w.language,quick_replies:quickReplies}}});
  }
  async function handleWhatsappMenu(recipient,id){
    const action=String(id||'').trim().toLowerCase();
    const w=wordsFor('whatsapp',recipient);
    const nextPage=action.match(/^bereg_languages_more_(\d+)$/)?.[1];if(nextPage){await sendLanguageMenu('whatsapp',recipient,Number(nextPage));return true;}
    const selected=action.match(new RegExp(`^bereg_lang_(${languageCodes.join('|')})$`))?.[1];
    if(selected){config.languages.whatsapp[recipient]=selected;save();await sendWelcome('whatsapp',recipient);return true;}
    if(['bereg_language','language','язык','мова','nyelv','ngôn ngữ'].includes(action)||action===w.languageButton.toLowerCase()){await sendLanguageMenu('whatsapp',recipient);return true;}
    if(['bereg_services','bereg_documents','bereg_translation','📋 услуги','📄 документы','🗣 перевод','услуги','документы','перевод','services','documents','translation'].includes(action)||action===w.servicesButton.toLowerCase()){await sendWhatsappMenu(recipient,w.services+'\n\n'+w.contacts,languageFor('whatsapp',recipient));return true;}
    if(['bereg_contacts','bereg_contact','📍 контакты','контакты','contacts'].includes(action)||action===w.contactsButton.toLowerCase()){await sendWhatsappMenu(recipient,w.contacts,languageFor('whatsapp',recipient));return true;}
    if(['bereg_operator','💬 оператор','💬 написать оператору','оператор','написать оператору','support'].includes(action)||action===w.talk.toLowerCase()){await sendWhatsappMenu(recipient,w.operator,languageFor('whatsapp',recipient));return true;}
    return false;
  }
  async function maybeWelcome(provider,recipient){
    const remembered=String(config.welcomed[provider]?.[recipient]||'');
    const version=provider==='whatsapp'?whatsappMenuVersion:facebookMenuVersion;
    if(remembered&&remembered.startsWith(`${version}:`))return;
    config.welcomed[provider][recipient]=`${version}:${new Date().toISOString()}`;save();
    await sendWelcome(provider,recipient).catch(error=>console.error(`Meta ${provider} welcome:`,error.message));
  }
  async function handle(payload){
    if(payload?.object==='page')for(const entry of payload.entry||[])for(const event of entry.messaging||[]){
      if(event.message?.is_echo)continue;const psid=String(event.sender?.id||'');if(!psid)continue;
      const payloadId=String(event.message?.quick_reply?.payload||event.postback?.payload||'').toUpperCase();
      const nextLanguagePage=payloadId.match(/^BEREG_LANGUAGES_MORE_(\d+)$/)?.[1];if(nextLanguagePage){await sendLanguageMenu('facebook',psid,Number(nextLanguagePage));continue;}
      const selectedLanguage=payloadId.match(new RegExp(`^BEREG_LANG_(${languageCodes.join('|').toUpperCase()})$`))?.[1]?.toLowerCase();
      if(selectedLanguage){config.languages.facebook[psid]=selectedLanguage;save();setCustomerLanguage('facebook',psid,selectedLanguage);await sendWelcome('facebook',psid);continue;}
      const w=wordsFor('facebook',psid);
      const rawText=event.message?.text||({BEREG_TRANSLATION:'translation',BEREG_DOCUMENTS:'documents',BEREG_SERVICES:'services',BEREG_OPERATOR:w.operator,BEREG_CONTACTS:'contacts',BEREG_LANGUAGE:'language'}[event.postback?.payload])||'';
      const normalized=rawText.trim().toLowerCase();
      if(payloadId==='BEREG_LANGUAGE'||['language','/language','язык','мова','nyelv','ngôn ngữ'].includes(normalized)||normalized===w.languageButton.toLowerCase()){await sendLanguageMenu('facebook',psid);continue;}
      if(['BEREG_SERVICES','BEREG_DOCUMENTS','BEREG_TRANSLATION'].includes(payloadId)||['services','documents','translation','услуги','документы','перевод','послуги','документи','переклад','szolgáltatások','fordítás'].includes(normalized)||normalized===w.servicesButton.toLowerCase()){
        await graph(`${encodeURIComponent(page().pageId)}/messages`,{method:'POST',token:page().accessToken,body:{recipient:{id:psid},messaging_type:'RESPONSE',message:{text:w.services+'\n\n'+w.contacts}}});continue;
      }
      const text=rawText.trim();if(!text)continue;
      const pageId=String(event.recipient?.id||page().pageId||'');
      await ingest({provider:'facebook',externalId:psid,name:await facebookName(psid)||'Клиент Facebook',contact:psid,sourceUrl:`https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(pageId)}&selected_item_id=${encodeURIComponent(psid)}`,text,sourceId:String(event.message?.mid||event.timestamp||''),language:languageFor('facebook',psid)});
      config.activity.facebook={lastInboundAt:new Date().toISOString(),lastSender:psid};save();
      await maybeWelcome('facebook',psid);
    }
    if(payload?.object==='whatsapp_business_account')for(const entry of payload.entry||[])for(const change of entry.changes||[]){
      if(change.field!=='messages')continue;const value=change.value||{};for(const message of value.messages||[]){
        const waId=String(message.from||'');if(!waId)continue;
        const actionId=String(message.interactive?.button_reply?.id||message.interactive?.list_reply?.id||'').toLowerCase();
        const nextLanguagePage=actionId.match(/^bereg_languages_more_(\d+)$/)?.[1];if(nextLanguagePage){await sendLanguageMenu('whatsapp',waId,Number(nextLanguagePage));continue;}
        const selectedLanguage=actionId.match(new RegExp(`^bereg_lang_(${languageCodes.join('|')})$`))?.[1];
        if(selectedLanguage){config.languages.whatsapp[waId]=selectedLanguage;save();setCustomerLanguage('whatsapp',waId,selectedLanguage);await sendWelcome('whatsapp',waId);continue;}
        const w=wordsFor('whatsapp',waId);
        const incoming=message.text?.body||message.button?.text||message.interactive?.button_reply?.title||message.interactive?.list_reply?.title||'';
        if(actionId==='bereg_language'||incoming.trim().toLowerCase()===w.languageButton.toLowerCase()||incoming.trim().toLowerCase()==='language'){await sendLanguageMenu('whatsapp',waId);continue;}
        if(actionId==='bereg_services'||actionId==='bereg_contacts'||incoming.trim().toLowerCase()===w.servicesButton.toLowerCase()||incoming.trim().toLowerCase()===w.contactsButton.toLowerCase()){
          await handleWhatsappMenu(waId,actionId||incoming);continue;
        }
        const text=actionId==='bereg_operator'?w.operator:incoming;if(!text.trim())continue;
        const contact=(value.contacts||[]).find(x=>String(x.wa_id)===waId);
        await ingest({provider:'whatsapp',externalId:waId,name:contact?.profile?.name||'Клиент WhatsApp',contact:`+${waId}`,sourceUrl:`https://wa.me/${waId.replace(/\D/g,'')}`,text,sourceId:String(message.id||''),language:languageFor('whatsapp',waId)});
        config.activity.whatsapp={lastInboundAt:new Date().toISOString(),lastSender:waId};save();
        await maybeWelcome('whatsapp',waId);
        const currentWords=wordsFor('whatsapp',waId);
        await graph(`${encodeURIComponent(waPhoneId())}/messages`,{method:'POST',token:waToken(),body:{messaging_product:'whatsapp',recipient_type:'individual',to:waId,type:'text',text:{preview_url:false,body:currentWords.receipt}}}).catch(error=>console.error('Meta whatsapp receipt:',error.message));
      }
    }
  }
  async function sendMessage(client,text){
    if(client.provider==='facebook'){
      const token=page().accessToken;if(!token)throw new Error('Facebook Page Access Token не подключён.');
      await graph(`${encodeURIComponent(page().pageId)}/messages`,{method:'POST',token,body:{recipient:{id:client.externalId},messaging_type:'RESPONSE',message:{text}}});config.activity.facebook={...(config.activity.facebook||{}),lastOutboundAt:new Date().toISOString()};save();return;
    }
    if(client.provider==='whatsapp'){
      const token=waToken(),phoneId=waPhoneId();if(!token||!phoneId)throw new Error('WhatsApp Cloud API ещё не подключён.');
      await graph(`${encodeURIComponent(phoneId)}/messages`,{method:'POST',token,body:{messaging_product:'whatsapp',recipient_type:'individual',to:client.externalId,type:'text',text:{preview_url:false,body:text}}});config.activity.whatsapp={...(config.activity.whatsapp||{}),lastOutboundAt:new Date().toISOString()};save();return;
    }
    throw new Error('Неизвестный внешний канал.');
  }
  async function diagnostics(){
    const result={facebook:{configured:Boolean(page().pageId&&page().accessToken),activity:config.activity.facebook||{}},whatsapp:{configured:Boolean(waToken()&&waPhoneId()&&waBusinessAccountId()),activity:config.activity.whatsapp||{}}};
    if(result.facebook.configured){
      try{const data=await graph(`${encodeURIComponent(page().pageId)}/subscribed_apps?fields=id,name,subscribed_fields`,{token:page().accessToken});result.facebook.api=true;result.facebook.subscribedFields=data.data?.[0]?.subscribed_fields||[];}catch(error){result.facebook.api=false;result.facebook.error=error.message;}
    }
    if(result.whatsapp.configured){
      try{
        const [phoneData,subscriptionData]=await Promise.all([
          graph(`${encodeURIComponent(waPhoneId())}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,platform_type`,{token:waToken()}),
          graph(`${encodeURIComponent(waBusinessAccountId())}/subscribed_apps`,{token:waToken()})
        ]);
        result.whatsapp.api=true;result.whatsapp.phone={displayPhoneNumber:phoneData.display_phone_number||waDisplayPhoneNumber(),verifiedName:phoneData.verified_name||'',qualityRating:phoneData.quality_rating||'',codeVerificationStatus:phoneData.code_verification_status||'',platformType:phoneData.platform_type||''};result.whatsapp.webhookSubscribed=Boolean(subscriptionData.data?.length);
      }catch(error){result.whatsapp.api=false;result.whatsapp.error=error.message;}
    }
    return result;
  }
  async function subscribeFacebook(){
    const token=page().accessToken,pageId=String(page().pageId||'').trim();
    if(!token||!pageId)throw new Error('Сначала подключите Facebook-страницу и Page Access Token.');
    await graph(`${encodeURIComponent(pageId)}/subscribed_apps?subscribed_fields=messages,messaging_postbacks`,{method:'POST',token});
    return diagnostics();
  }
  async function subscribeWhatsapp(){
    const token=waToken(),businessId=waBusinessAccountId();if(!token||!businessId)throw new Error('Сначала подключите WhatsApp Business Account и постоянный токен.');
    await graph(`${encodeURIComponent(businessId)}/subscribed_apps`,{method:'POST',token});
    return diagnostics();
  }
  function mountWebhook(app){
    app.get('/webhooks/meta',(req,res)=>{if(req.query['hub.mode']==='subscribe'&&req.query['hub.verify_token']===config.verifyToken)return res.status(200).send(String(req.query['hub.challenge']||''));res.sendStatus(403);});
    app.post('/webhooks/meta',require('express').json({limit:'2mb',verify:(req,res,buf)=>{req.rawBody=Buffer.from(buf);}}),async(req,res)=>{if(!signatureValid(req))return res.sendStatus(401);res.sendStatus(200);handle(req.body).catch(error=>console.error('Meta webhook:',error.message));});
  }
  function mountAdmin(app){
    const owner=(req,res,next)=>req.panelUser.role==='superadmin'?next():res.status(403).json({error:'Подключения Meta доступны только суперадминистратору.'});
    app.get('/api/meta-inbox/status',owner,(req,res)=>res.json({webhookUrl:`${baseUrl}/webhooks/meta`,verifyToken:config.verifyToken,facebook:{connected:Boolean(page().pageId&&page().accessToken),pageId:page().pageId,pageName:page().pageName,publicUrl:facebookPublicUrl(),activity:config.activity.facebook||{}},whatsapp:{connected:Boolean(waToken()&&waPhoneId()),phoneNumberId:waPhoneId(),businessAccountId:waBusinessAccountId(),displayPhoneNumber:waDisplayPhoneNumber(),publicUrl:waPublicUrl(),accessTokenConfigured:Boolean(waToken()),activity:config.activity.whatsapp||{}},signatureProtected:Boolean(appSecret())}));
    app.get('/api/meta-inbox/diagnostics',owner,async(req,res)=>{try{res.json(await diagnostics());}catch(error){res.status(502).json({error:error.message});}});
    app.post('/api/meta-inbox/facebook/subscribe',owner,async(req,res)=>{try{res.json(await subscribeFacebook());}catch(error){res.status(502).json({error:error.message});}});
    app.post('/api/meta-inbox/whatsapp/subscribe',owner,async(req,res)=>{try{res.json(await subscribeWhatsapp());}catch(error){res.status(502).json({error:error.message});}});
    app.put('/api/meta-inbox/whatsapp',owner,(req,res)=>{config.whatsapp={phoneNumberId:String(req.body.phoneNumberId||'').trim().slice(0,40),businessAccountId:String(req.body.businessAccountId||'').trim().slice(0,40),displayPhoneNumber:String(req.body.displayPhoneNumber||'').trim().slice(0,40),accessToken:String(req.body.accessToken||'').trim()||config.whatsapp.accessToken};save();res.json({ok:true});});
    app.post('/api/meta-inbox/test',owner,async(req,res)=>{try{await ingest({provider:req.body.provider==='whatsapp'?'whatsapp':'facebook',externalId:'demo-'+Date.now(),name:'Тестовый клиент',contact:req.body.provider==='whatsapp'?'+36 30 123 4567':'Facebook Messenger',sourceUrl:req.body.provider==='whatsapp'?'https://wa.me/36301234567':'https://business.facebook.com/latest/inbox/all',text:'Тестовое сообщение: нужна помощь с документами в Венгрии',sourceId:crypto.randomUUID(),demo:true});res.json({ok:true});}catch(error){res.status(500).json({error:error.message});}});
  }
  return{mountWebhook,mountAdmin,setIngest:(fn,setLanguage)=>{ingest=fn;if(setLanguage)setCustomerLanguage=setLanguage;},sendMessage,handle,diagnostics,subscribeFacebook,subscribeWhatsapp,status:()=>config};
}
module.exports={createMetaInbox};
