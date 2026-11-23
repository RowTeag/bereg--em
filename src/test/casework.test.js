const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {mountCasework}=require('../lib/casework');
test('payments, calendar imports, consent and deadlines survive retries',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'casework-'));
  try{
    const routes={},app={locals:{},get:(url,fn)=>routes[url]=fn,post:(url,fn)=>routes[url]=fn};
    const dialog={id:'17',provider:'telegram',history:[]};
    const support={state:{clients:{17:dialog},queue:[]},save(){},async flush(){}};
    const clients={list:()=>[{id:'c',dialogIds:['17']}]};
    const mount=()=>mountCasework(app,{directory,clients,support,worker:true});
    mount();
    function call(url,body,params={}){
      const res={code:200,status(n){this.code=n;return this;},json(v){this.data=v;}};
      routes[url]({panelUser:{role:'admin',id:'staff'},body,params},res);
      return res;
    }
    const input={id:crypto.randomUUID(),clientId:'c',amount:'42.09',currency:'EUR',method:'cash',date:'2026-11-20',service:'Перевод'};
    const add=(kind,row)=>call('/api/casework/:kind',row,{kind});
    assert.equal(add('payments',input).code,201);
    assert.equal(add('payments',input).code,200);
    assert.equal(add('payments',{...input,id:crypto.randomUUID(),amount:'-2'}).code,400);
    mount();
    assert.deepEqual(call('/api/casework').data.payments.map(p=>p.minor),[4209]);
    const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Budapest'}).format(new Date());
    const req={id:crypto.randomUUID(),clientId:'c',dialogId:'17',text:'Пришлите документ',due:today,remind:today};
    assert.equal(add('requests',{...req,dialogId:'unlinked'}).code,400);
    assert.equal(add('requests',req).code,201);
    app.locals.beregCaseworkTick();mount();app.locals.beregCaseworkTick();
    assert.equal(support.state.queue.length,2);
    assert.equal(new Set(dialog.history.map(x=>x.eventId)).size,2);
    const campaign={id:crypto.randomUUID(),clientIds:['c'],text:'Новости'};
    assert.equal(call('/api/casework/campaign',campaign).data.count,0);
    support.state.subscriptions={'17':{consent:true}};campaign.id=crypto.randomUUID();
    call('/api/casework/campaign',campaign);call('/api/casework/campaign',campaign);
    assert.equal(support.state.queue.filter(item=>item.campaignId).length,1);
    const ics='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:booking\r\nDTSTART:20261121T100000Z\r\nSUMMARY:Consultation\r\nEND:VEVENT\r\nEND:VCALENDAR';
    for(let i=0;i<2;i++)assert.equal(call('/api/casework/reservio/import',{ics}).data.count,1);
    assert.equal(call('/api/casework').data.bookings.length,1);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('Reservio CSV imports quoted fields and updates an existing booking on retry', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reservio-'));
  try {
    const routes = {};
    const register = (url, handler) => routes[url] = handler;
    mountCasework({locals: {}, get: register, post: register}, {directory, worker: true});
    const call = (url, body) => {
      const res = {code: 200, status(code) {this.code = code; return this;}, json(data) {this.data = data;}};
      routes[url]({body}, res);
      return res;
    };
    const csv = '\uFEFFBooking ID;Date;Start Time;Service;Client;Status\r\n' +
      '41;2026-11-24;09:00;"Consultation; follow-up";"Client ""A""";Confirmed\r\n';
    const endpoint = '/api/casework/reservio/import';
    assert.equal(call(endpoint, {csv}).data.count, 1);
    assert.equal(call(endpoint, {csv: csv.replace('Confirmed', 'Cancelled')}).code, 200);
    assert.equal(call(endpoint, {csv: 'Name,Email\nTest,test@example.invalid'}).code, 400);
    assert.equal(call(endpoint, {csv: csv + '42;;;;;'}).code, 400);
    const {bookings} = call('/api/casework').data;
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].title, 'Consultation; follow-up · Client "A"');
    assert.equal(bookings[0].start, '2026-11-24 09:00');
    assert.equal(bookings[0].status, 'Cancelled');
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('Reservio URL import rejects unrelated links and restricts access to the owner', async () => {
  const routes = {};
  const register = (url, handler) => routes[url] = handler;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reservio-link-'));
  try {
    mountCasework({locals: {}, get: register, post: register}, {directory, worker: true});
    const importLink = routes['/api/casework/reservio/import-link'];
    async function call(role, url) {
      const response = {code: 200, status(code) {this.code = code; return this;}, json() {}};
      await importLink({body: {url}, panelUser: {role}}, response);
      return response.code;
    }
    assert.equal(await call('admin', 'webcal://calendar.reservio.com/feed'), 403);
    assert.equal(await call('superadmin', 'https://reservio.com.example.invalid/feed'), 400);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('case tasks track deadlines, queue staff notices once and record the status response date', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'casework-tasks-'));
  try {
    const routes = {};
    const app = {locals:{}, get:(url, fn) => {routes[url] = fn;}, post:(url, fn) => {routes[url] = fn;}};
    const notices = [];
    const support = {
      state:{clients:{}, operators:[{id:'staff', enabled:true, chatId:'12345'}], staffEvents:{}},
      enqueueStaffNotice(id, chatId, text) {
        this.state.staffEvents[id] = true;
        notices.push({chatId, text});
      },
      async flush() {}
    };
    const clients = {list:() => [{id:'client', first:'Олена', last:'Тест'}]};
    const mount = () => mountCasework(app, {directory, clients, support, worker:true});
    const call = (url, body, params = {}, panelUser={role:'admin'}) => {
      const response = {code:200, status(code) {this.code = code; return this;}, json(data) {this.data = data;}, sendStatus(code) {this.code = code;}};
      routes[url]({body, params, panelUser}, response);
      return response;
    };
    mount();
    const task = {clientId:'client', assignee:'staff', date:'2020-11-23'};
    for (const kind of ['documents', 'translation', 'questionnaire', 'interview', 'status']) {
      const input = {...task, id:crypto.randomUUID(), kind};
      assert.equal(call('/api/casework/tasks', input).code, 201);
      assert.equal(call('/api/casework/tasks', input).code, 200);
    }
    const {tasks} = call('/api/casework').data;
    assert.deepEqual(tasks.map(row => row.remindOn), ['2020-11-09', '2020-11-19', '2020-11-19', '2020-11-16', '2020-11-23']);
    const statusId = tasks.at(-1).id;
    assert.equal(call('/api/casework/tasks/:id/complete', {date:'2020-11-22'}, {id:statusId}).code, 400);
    assert.equal(call('/api/casework/tasks/:id/complete', {date:'2020-11-25'}, {id:statusId}).code, 200);
    await app.locals.beregCaseworkTick();
    mount();
    await app.locals.beregCaseworkTick();
    assert.equal(call('/api/casework').data.tasks.at(-1).completedOn, '2020-11-25');
    assert.equal(notices.length, 4);
    assert(notices.every(notice => notice.chatId === '12345' && notice.text.includes('Тест Олена')));
    const staff = {role:'operator', operatorId:'staff'};
    const unrelated = {role:'operator', operatorId:'someone-else'};
    const mine = '/api/casework/my-tasks';
    assert.equal(call(mine, null, {}, staff).data.tasks.length, 4);
    assert.deepEqual(call(mine, null, {}, unrelated).data.tasks, []);
    assert.equal(call(mine, null, {}, staff).data.tasks[0].clientName, 'Тест Олена');
    const complete = '/api/casework/tasks/:id/complete';
    assert.equal(call(complete, {}, {id:tasks[0].id}, unrelated).code, 404);
    assert.equal(call(complete, {}, {id:statusId}, staff).code, 404);
    assert.equal(call(complete, {}, {id:tasks[0].id}, staff).code, 200);
    assert.equal(call(mine, null, {}, staff).data.tasks.length, 3);
  } finally {
    fs.rmSync(directory, {recursive:true, force:true});
  }
});
