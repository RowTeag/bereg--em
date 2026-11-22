const fs = require('./runtime-fs');
const path = require('node:path');

function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw Error('Укажите действительную дату.');
  }
  return value;
}

function localDay(now) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Budapest', day: '2-digit', month: '2-digit', year: 'numeric'
  }).formatToParts(now);
  const part = name => parts.find(item => item.type === name).value;
  return [part('year'), part('month'), part('day')].join('-');
}

function mountCasework(app, {directory, clients, support, worker}) {
  const file = path.join(directory, 'casework.json');
  let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : {payments:[], requests:[]};
  function commit(next) {
    fs.writeFileSync(file+'.tmp', JSON.stringify(next), {mode:0o600});
    fs.renameSync(file+'.tmp',file);
    state=next;
  }
  function enqueue(request, kind) {
    const dialog = support.state.clients[request.dialogId];
    if (!dialog || dialog.demo) return;
    const eventId=request.id+'-'+kind;
    if (dialog.history.some(message=>message.eventId===eventId)) return;
    const text = (kind==='reminder'?'Напоминание. ':'')+request.text+'\nСрок: '+request.due;
    dialog.history.push({direction:'out', text, eventId, at:new Date().toISOString()});
    support.state.queue.push({bot:dialog.transport==='chatwoot'||dialog.provider&&dialog.provider!=='telegram'?'external':'client',
      clientId:dialog.id,text,eventId});
    try {support.save();} catch(error) {dialog.history.pop();support.state.queue.pop();throw error;}
  }
  function tick(now=new Date()) {
    const today=localDay(now);
    for(const item of state.requests) {
      if(item.done)continue;
      enqueue(item,'request');
      if(item.remind<=today)enqueue(item,'reminder');
    }
  }
  let calendarPending=false,nextSync=0;
  async function syncCalendar(){
    if(calendarPending||Date.now()<nextSync||!process.env.RESERVIO_CALENDAR_URL)return;
    calendarPending=true;nextSync=Date.now()+15*60000;
    try{
      const url=new URL(process.env.RESERVIO_CALENDAR_URL.replace(/^webcal:/,'https:'));
      if(url.protocol!=='https:'||!/(^|\.)reservio\.com$/i.test(url.hostname)||url.username||url.password)throw Error('Недопустимый адрес календаря.');
      const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('Ошибка календаря '+response.status);
      const reader=response.body.getReader(),chunks=[];let size=0;
      while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;
        if(size>2000000){await reader.cancel();throw Error('Календарь слишком большой.');}chunks.push(value);}
      const bookings=require('./reservio-calendar').readBookings(Buffer.concat(chunks).toString('utf8'));
      commit({...state,syncedBookings:bookings,calendarSync:new Date().toISOString(),calendarError:''});
    }catch{commit({...state,calendarError:'Не удалось обновить календарь Reservio.'});}
    finally{calendarPending=false;}
  }
  async function runTick(){try{tick();await syncCalendar();}catch(error){console.error('CRM reminders:',error.message);}}
  app.locals.beregCaseworkTick=runTick;
  if(!worker)setInterval(runTick,30000).unref();

  app.post('/api/casework/campaign',(req,res)=>{
    const {id,clientIds,text}=req.body||{};
    if(!/^[a-f0-9-]{36}$/i.test(id||'')||!Array.isArray(clientIds)||clientIds.length>5000||
        typeof text!=='string'||!text.trim()||text.length>3200)return res.status(400).json({error:'Проверьте сообщение и группу (до 5000 карточек).'});
    const previous=support.state.campaigns?.[id];
    if(previous)return res.json(previous);
    const selected=new Set(clientIds),dialogs=new Set();
    for(const client of clients.list())if(selected.has(client.id))for(const dialogId of client.dialogIds||[])dialogs.add(dialogId);
    let count=0;
    for(const dialogId of dialogs){
      const d=support.state.clients[dialogId];
      if(!d||d.demo||d.transport==='chatwoot'||(d.provider&&d.provider!=='telegram')||!support.state.subscriptions?.[dialogId]?.consent)continue;
      d.history.push({campaignId:id,direction:'out',at:new Date().toISOString(),text,panelUserId:req.panelUser.id});
      support.state.queue.push({bot:'client',clientId:dialogId,text,campaignId:id});count++;
    }
    support.state.campaigns||={};support.state.campaigns[id]={count};
    support.save();support.flush().catch(()=>{});res.json({count});
  });
  app.post('/api/casework/reservio/import',(req,res)=>{
    try{
      const incoming=require('./reservio-calendar').readBookings(req.body.ics);
      const entries=new Map((state.bookings||[]).map(b=>[b.id,b]));
      for(const event of incoming)entries.set(event.id,event);
      commit({...state,bookings:[...entries.values()]});
      res.json({count:incoming.length});
    }catch(error){res.status(400).json({error:error.message});}
  });
  app.get('/api/casework',(req,res)=>res.json(state));
  app.post('/api/casework/:kind',(req,res)=>{
    try {
      const input=req.body||{}, kind=req.params.kind;
      if(!['payments','requests'].includes(kind))return res.sendStatus(404);
      const client=clients.list().find(c=>c.id===input.clientId);
      if(!client)throw Error('Клиент не найден.');
      if(!/^[a-f0-9-]{36}$/i.test(input.id||''))throw Error('Некорректный идентификатор.');
      const existing=state[kind].find(x=>x.id===input.id);
      if(existing)return res.status(existing.clientId===client.id?200:409).json({id:existing.id});
      const row={id:input.id,clientId:client.id,actor:req.panelUser.id};
      if(kind==='payments'){
        const service=String(input.service||'').trim();
        if(!service||service.length>120||!['cash','bank'].includes(input.method)||
            !['HUF','EUR','UAH','USD'].includes(input.currency)||!/^\d{1,10}(\.\d{1,2})?$/.test(input.amount))throw Error('Проверьте сумму, валюту, услугу и способ оплаты.');
        const [whole,fraction='']=String(input.amount).split('.');
        const minor=Number(whole)*100+Number(fraction.padEnd(2,'0'));
        if(minor<=0)throw Error('Сумма должна быть положительной.');
        Object.assign(row,{service,minor,currency:input.currency,method:input.method,date:date(input.date)});
      }else{
        const dialog=support.state.clients[input.dialogId],text=String(input.text||'').trim();
        if(!client.dialogIds?.includes(input.dialogId)||!dialog||dialog.demo)throw Error('Выберите привязанный рабочий диалог клиента.');
        if(!text||text.length>3200)throw Error('Введите запрос до 3200 символов.');
        const remind=date(input.remind),due=date(input.due);
        if(remind>due||remind<localDay(new Date()))throw Error('Напоминание должно быть между сегодняшней датой и сроком подачи.');
        Object.assign(row,{dialogId:dialog.id,text,remind,due,done:false});
      }
      commit({...state,[kind]:[...state[kind],row]});
      if(kind==='requests'){tick();support.flush().catch(()=>{});}
      res.status(201).json({id:row.id});
    }catch(error){res.status(400).json({error:error.message});}
  });
  app.post('/api/casework/requests/:id/complete',(req,res)=>{
    if(!state.requests.some(r=>r.id===req.params.id))return res.sendStatus(404);
    commit({...state,requests:state.requests.map(r=>r.id===req.params.id?{...r,done:true}:r)});
    res.json({ok:true});
  });
}
module.exports={mountCasework};
