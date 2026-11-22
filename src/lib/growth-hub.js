const fs = require('./runtime-fs');
const path = require('path');
const crypto = require('crypto');

const defaultKeywords = [
  'внж', 'вид на жительство', 'пмж', 'гражданство', 'рабочая виза', 'виза в венгрию',
  'переводчик', 'перевод документов', 'нотариус', 'миграция', 'иммиграция', 'регистрация адреса',
  'открыть счет', 'открыть счёт', 'банк в венгрии', 'страховка', 'врач в венгрии', 'документы в венгрии',
  'посвідка на проживання', 'пмп', 'перекладач', 'переклад документів', 'нотаріус', 'рахунок у банку',
  'угорщина документи', 'угорщина віза', 'lakcím', 'tartózkodási engedély', 'állampolgárság', 'tolmács'
];

const platformDefaults = [
  { id:'youtube', name:'YouTube', programs:'Партнёрская программа, реклама, спонсорство, Super Thanks', status:'checking', url:'https://studio.youtube.com/channel/UC/monetization' },
  { id:'facebook', name:'Facebook', programs:'Монетизация контента, Stars, подписки, брендированные материалы', status:'checking', url:'https://www.facebook.com/business/tools/meta-business-suite' },
  { id:'instagram', name:'Instagram', programs:'Подписки, Gifts, партнёрские интеграции и продажи', status:'planned', url:'https://www.instagram.com/' },
  { id:'tiktok', name:'TikTok', programs:'Creator Rewards, LIVE Gifts, Series, TikTok One', status:'planned', url:'https://www.tiktok.com/creator-center/' },
  { id:'telegram', name:'Telegram', programs:'Реклама, Stars, платные подписки и партнёрские размещения', status:'planned', url:'https://telegram.org/blog/monetization-for-channels' }
];

function createGrowthHub({ directory, telegramToken }) {
  fs.mkdirSync(directory, { recursive:true, mode:0o700 });
  const file = path.join(directory, 'growth-hub.json');
  const defaults = {
    channel:{ name:'BEREG · Венгрия без сложностей', username:'', description:'Документы, переводы и сопровождение в Венгрии', connected:false, lastPublishedAt:null },
    tiktok:{ username:'', profileUrl:'', business:false, status:'planned', notes:'' },
    keywords:defaultKeywords,
    monetization:platformDefaults,
    leads:[]
  };
  let state = defaults;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    state = { ...defaults, ...saved, channel:{...defaults.channel,...saved.channel}, tiktok:{...defaults.tiktok,...saved.tiktok}, monetization:platformDefaults.map(item=>({...item,...(saved.monetization||[]).find(x=>x.id===item.id)})) };
  } catch {}
  const save = () => { fs.writeFileSync(file+'.tmp', JSON.stringify(state,null,2), {mode:0o600}); fs.renameSync(file+'.tmp',file); };
  const clean = value => String(value||'').trim();
  const normalize = value => clean(value).toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
  const analyze = text => {
    const normalized = normalize(text);
    const matched = state.keywords.filter(word=>normalized.includes(normalize(word)));
    const urgent = /срочно|терміново|urgent|как можно быстрее|сьогодні|сегодня/.test(normalized);
    const question = /\?|кто может|кто зна|подскаж|порадьте|шукаю|ищу|нужен|нужна|потрібн|как оформить|як оформити/.test(normalized);
    const score = Math.min(100, matched.length*22 + (urgent?18:0) + (question?18:0));
    const service = matched[0] || 'услуги в Венгрии';
    return {
      matched,
      score,
      service,
      suggestedReply: matched.length ? `Здравствуйте! BEREG помогает с услугой «${service}» в Венгрии. Можем уточнить вашу ситуацию и подсказать порядок действий. Напишите нам в @bereg_support_bot — ответит специалист.` : ''
    };
  };
  async function publishTelegram(text) {
    const username = clean(state.channel.username).replace(/^https?:\/\/t\.me\//,'').replace(/^@/,'');
    if (!telegramToken || !username) throw new Error('Укажите публичное имя канала и добавьте бота @bereg_support_bot администратором канала.');
    const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({chat_id:`@${username}`,text,disable_web_page_preview:false}), signal:AbortSignal.timeout(20000)
    });
    const payload = await response.json().catch(()=>null);
    if (!response.ok || !payload?.ok) throw new Error(payload?.description || 'Telegram не принял публикацию.');
    state.channel.connected=true; state.channel.lastPublishedAt=new Date().toISOString(); save();
    return { messageId:payload.result.message_id, url:`https://t.me/${username}/${payload.result.message_id}` };
  }
  return { state, save, analyze, publishTelegram };
}

function mountGrowthHub(app, options) {
  const hub = createGrowthHub(options);
  const ownerOnly = (req,res,next) => req.panelUser.role==='superadmin' ? next() : res.status(403).json({error:'Настройки подключений доступны только суперадминистратору.'});
  app.get('/api/growth',(req,res)=>{
    if(req.panelUser?.role==='operator')return res.json({channel:hub.state.channel});
    res.json({
      channel:hub.state.channel,tiktok:hub.state.tiktok,keywords:hub.state.keywords,monetization:hub.state.monetization,
      leads:hub.state.leads.slice().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)),
      stats:{new:hub.state.leads.filter(x=>x.status==='new').length,hot:hub.state.leads.filter(x=>x.score>=55&&x.status!=='ignored').length,total:hub.state.leads.length}
    });
  });
  app.put('/api/growth/channel', ownerOnly, (req,res)=>{
    hub.state.channel={...hub.state.channel,name:String(req.body.name||'').trim().slice(0,100),username:String(req.body.username||'').trim().replace(/^https?:\/\/t\.me\//,'').replace(/^@/,'').slice(0,64),description:String(req.body.description||'').trim().slice(0,255)};
    hub.save();res.json({channel:hub.state.channel});
  });
  app.post('/api/growth/channel/publish',(req,res)=>{
    const text=String(req.body.text||'').trim();if(!text||text.length>4096)return res.status(400).json({error:'Введите текст до 4096 символов.'});
    hub.publishTelegram(text).then(result=>res.json({ok:true,...result})).catch(error=>res.status(502).json({error:error.message}));
  });
  app.put('/api/growth/tiktok', ownerOnly, (req,res)=>{
    const username=String(req.body.username||'').trim().replace(/^@/,'').slice(0,64);
    hub.state.tiktok={...hub.state.tiktok,username,profileUrl:username?`https://www.tiktok.com/@${username}`:'',business:Boolean(req.body.business),status:['planned','checking','connected'].includes(req.body.status)?req.body.status:'planned',notes:String(req.body.notes||'').trim().slice(0,500)};
    hub.save();res.json({tiktok:hub.state.tiktok});
  });
  app.put('/api/growth/keywords',(req,res)=>{
    const words=Array.isArray(req.body.keywords)?req.body.keywords:[];
    hub.state.keywords=[...new Set(words.map(x=>String(x).trim().toLowerCase()).filter(x=>x.length>=2&&x.length<=80))].slice(0,200);
    hub.save();res.json({keywords:hub.state.keywords});
  });
  app.put('/api/growth/monetization/:id',(req,res)=>{
    const item=hub.state.monetization.find(x=>x.id===req.params.id);if(!item)return res.status(404).json({error:'Платформа не найдена.'});
    if(['planned','checking','eligible','connected','blocked'].includes(req.body.status))item.status=req.body.status;
    item.notes=String(req.body.notes||'').trim().slice(0,500);item.updatedAt=new Date().toISOString();hub.save();res.json({item});
  });
  app.post('/api/growth/leads',(req,res)=>{
    const text=String(req.body.text||'').trim();if(!text||text.length>10000)return res.status(400).json({error:'Вставьте текст публикации до 10 000 символов.'});
    const analysis=hub.analyze(text);
    const lead={id:crypto.randomUUID(),platform:String(req.body.platform||'Другое').slice(0,30),author:String(req.body.author||'').trim().slice(0,100),url:String(req.body.url||'').trim().slice(0,1000),text,status:'new',createdAt:new Date().toISOString(),...analysis};
    hub.state.leads.unshift(lead);hub.state.leads=hub.state.leads.slice(0,1000);hub.save();res.status(201).json({lead});
  });
  app.patch('/api/growth/leads/:id',(req,res)=>{
    const lead=hub.state.leads.find(x=>x.id===req.params.id);if(!lead)return res.status(404).json({error:'Обращение не найдено.'});
    if(['new','reviewed','replied','ignored'].includes(req.body.status))lead.status=req.body.status;
    if(req.body.suggestedReply!==undefined)lead.suggestedReply=String(req.body.suggestedReply||'').trim().slice(0,4000);
    lead.updatedAt=new Date().toISOString();hub.save();res.json({lead});
  });
  return hub;
}

module.exports={createGrowthHub,mountGrowthHub};
