(async()=>{
  const originalFetch=window.fetch.bind(window);
  const authController=new AbortController(),authTimer=setTimeout(()=>authController.abort(),7000);
  let auth;try{auth=await originalFetch('/api/auth/me',{signal:authController.signal});}finally{clearTimeout(authTimer);}
  if(!auth.ok){location.replace('/login');return;}
  const {user,csrf}=await auth.json();
  window.fetch=async(input,options={})=>{const url=new URL(typeof input==='string'?input:input.url,location.href);const headers=new Headers(options.headers||{});if(url.origin===location.origin&&!['GET','HEAD'].includes((options.method||'GET').toUpperCase()))headers.set('X-CSRF-Token',csrf);const response=await originalFetch(input,{...options,headers});if(response.status===401&&url.origin===location.origin)location.replace('/login');return response;};
  window.__beregAuth={user,csrf};
  document.body.dataset.role=user.role;
  const loadModule=src=>new Promise((resolve,reject)=>{const script=document.createElement('script'),timer=setTimeout(()=>{script.remove();reject(new Error('Timed out loading '+src));},7000);script.src=src;script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);reject(new Error('Could not load '+src));};document.body.append(script);});
  const modules=user.role==='operator'?['/app.js?v=43']:['/app.js?v=43','/business.js?v=7'];
  const $=id=>document.getElementById(id),roles={superadmin:'Суперадминистратор',admin:'Администратор',operator:'Оператор'};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const safeExternalUrl=value=>{try{const url=new URL(String(value||''));return ['https:','http:'].includes(url.protocol)?url.href:'';}catch{return '';}};
  const api=async(url,options)=>{const r=await fetch(url,options);const d=await r.json();if(!r.ok)throw Error(d.error||'Не удалось выполнить действие');return d;};
  const post=(url,data={})=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  $('workspaceName').textContent=user.name;$('workspaceRole').textContent=roles[user.role];
  document.body.dataset.role=user.role;
  document.querySelectorAll('[data-super-only]').forEach(e=>e.hidden=user.role!=='superadmin');
  document.querySelectorAll('[data-admin-only]').forEach(e=>e.hidden=!['admin','superadmin'].includes(user.role));
  document.body.classList.remove('auth-loading');
  if(user.role==='admin')document.querySelector('[data-target="settings"]').hidden=true;
  const navGroups=[...document.querySelectorAll('.nav-group')];
  function syncSidebarGroups(target){
    let activeGroup=null;
    navGroups.forEach(group=>{
      const visibleItems=[...group.querySelectorAll('.nav-item')].filter(item=>!item.hidden);
      group.hidden=visibleItems.length===0;
      if(visibleItems.some(item=>item.dataset.target===target))activeGroup=group;
    });
    navGroups.forEach(group=>{const open=group===activeGroup&&!group.hidden;group.classList.toggle('open',open);group.querySelector('.nav-group-toggle').setAttribute('aria-expanded',String(open));});
  }
  window.syncSidebarGroups=syncSidebarGroups;
  navGroups.forEach(group=>group.querySelector('.nav-group-toggle').addEventListener('click',()=>{
    const next=!group.classList.contains('open');
    navGroups.forEach(item=>{item.classList.toggle('open',next&&item===group);item.querySelector('.nav-group-toggle').setAttribute('aria-expanded',String(next&&item===group));});
  }));
  if(user.role==='operator'){
    const operatorSections=new Set(['dashboard','inbox','content','calendar','youtube-publish','growth-center']);
    document.querySelectorAll('.nav-item').forEach(e=>e.hidden=!operatorSections.has(e.dataset.target));
    const facebookPublishLink=document.querySelector('[data-target="dashboard"] span:last-child');
    if(facebookPublishLink)facebookPublishLink.textContent='Facebook';
    const telegramPublishLink=document.querySelector('[data-target="growth-center"] span');
    if(telegramPublishLink)telegramPublishLink.textContent='Telegram';
    const youtubeConnect=document.querySelector('.youtube-connect-btn');if(youtubeConnect)youtubeConnect.hidden=true;
    document.querySelectorAll('[data-growth-tab]').forEach(button=>{const allowed=['channel','tiktok'].includes(button.dataset.growthTab);button.hidden=!allowed;button.classList.toggle('active',button.dataset.growthTab==='channel');});
    document.querySelectorAll('[data-growth-pane]').forEach(pane=>{const allowed=['channel','tiktok'].includes(pane.dataset.growthPane),active=pane.dataset.growthPane==='channel';pane.hidden=!allowed;pane.classList.toggle('active',active);});
    document.querySelector('#channelSettingsForm')?.closest('.growth-form-card')?.setAttribute('hidden','');
    document.querySelector('.video-box')?.setAttribute('hidden','');
    document.querySelector('.sidebar-card').hidden=true;
    $('inboxScope').textContent='Только ваши клиенты. Ответы из панели приходят в клиентский Telegram-бот.';
  }
  syncSidebarGroups(user.role==='operator'?'inbox':(document.querySelector('.section-panel.active')?.id||'dashboard'));
  $('logoutBtn').onclick=async()=>{await post('/api/auth/logout');location.replace('/login');};
  function navigate(target){document.querySelectorAll('.section-panel').forEach(e=>e.classList.toggle('active',e.id===target));document.querySelectorAll('.nav-item').forEach(e=>e.classList.toggle('active',e.dataset.target===target));syncSidebarGroups(target);if(target==='inbox'||target==='team-access'){$('pageTitle').textContent=target==='inbox'?'Обращения':'Команда и доступ';document.querySelector('.topbar-actions').hidden=true;}if(target==='content')$('pageTitle').textContent='Контент';if(target==='calendar')$('pageTitle').textContent='Календарь';if(target==='employees')$('pageTitle').textContent='Employees';document.body.classList.remove('mobile-menu-open');if(target==='clients'){loadCrm();$('pageTitle').textContent='Клиенты';document.querySelector('.topbar-actions').hidden=true;}placeCaseTaskPanel();if(target==='inbox'){if(user.role!=='operator'&&!crmRecords.length)void loadCrm();loadInbox();}if(target==='team-access')loadUsers();if(target==='content')loadContentPlan();if(target==='calendar')loadPublicationCalendar();}
  document.querySelectorAll('.nav-item').forEach(e=>e.addEventListener('click',()=>{if(!e.hidden)navigate(e.dataset.target);}));
  if(user.role==='operator')$('mobileMenuBtn').onclick=()=>{const on=document.body.classList.toggle('mobile-menu-open');$('mobileMenuBtn').setAttribute('aria-expanded',on);};
  let crmRecords=[],crmId=null,crmAcknowledgedApplications=new Set();
  const crmAcknowledgementKey='bereg_crm_acknowledged_'+user.id;
  try{const saved=JSON.parse(localStorage.getItem(crmAcknowledgementKey)||'[]');if(Array.isArray(saved))crmAcknowledgedApplications=new Set(saved);}catch{}
  const crmForm=$('crmForm');
  function renderCrmDocuments(client){const box=$('crmDocuments');$('officeUpload').hidden=!client;box.replaceChildren();const documents=client?.attachments||[];
    const dialogFiles=(client?.dialogs||[]).flatMap(d=>(d.files||[]).map(f=>({...f,provider:d.provider||'Telegram'})));
    if(!documents.length&&!dialogFiles.length)return;box.innerHTML='<h3>Документы</h3>'+documents.map(a=>`<p><a class="ghost-btn" href="/api/clients/${encodeURIComponent(client.id)}/documents/${encodeURIComponent(a.id)}" download>${esc(a.fileName||'PDF анкеты')} ↓</a> <small>${esc(new Date(a.createdAt).toLocaleString('ru-RU'))+(a.expiresOn?' · Действителен до '+esc(a.expiresOn):'')}</small></p>`).join('');
    for(const file of dialogFiles){
      const url=new URL(file.url,location.origin);if(!['http:','https:'].includes(url.protocol))continue;
      const a=document.createElement('a');a.className='ghost-btn';a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=file.provider+' · '+file.name;box.append(a);
    }
  }
  function acknowledgeCrmApplications(clientId){for(const c of crmRecords){if(clientId&&c.id!==clientId)continue;for(const a of c.attachments||[])crmAcknowledgedApplications.add(c.id+':'+a.id);}try{localStorage.setItem(crmAcknowledgementKey,JSON.stringify([...crmAcknowledgedApplications].slice(-1000)));}catch{}}
  function announceCrmApplications(applications){if(!applications.length)return;const notice=$('crmNewClientNotice'),first=applications[0].client;notice.replaceChildren();notice.append(document.createTextNode(applications.length===1?`Новая заявка добавлена в CRM: ${first.last} ${first.first}. PDF прикреплён к карточке.`:`В CRM добавлено новых заявок: ${applications.length}. PDF прикреплены к карточкам.`));const button=document.createElement('button');button.className='ghost-btn';button.type='button';button.textContent='Открыть клиента';button.onclick=()=>{acknowledgeCrmApplications(first.id);navigate('clients');openCrm(first.id);notice.hidden=true;};const dismiss=document.createElement('button');dismiss.className='ghost-btn';dismiss.type='button';dismiss.textContent='Закрыть';dismiss.onclick=()=>{acknowledgeCrmApplications();notice.hidden=true;};notice.append(document.createTextNode(' '),button,document.createTextNode(' '),dismiss);notice.hidden=false;}
  let visibleClientIds=[];
  function renderCrm(){const filters=Object.fromEntries(new FormData($('clientFilters')));
    const matches=c=>{
      for(const key of ['service','country','caseStatus','activeOrder','language'])if(filters[key]&&!String(c[key]||'').toLowerCase().includes(filters[key].toLowerCase()))return false;
      const day=(c.createdAt||'').slice(0,10);
      if((filters.from&&day<filters.from)||(filters.to&&day>filters.to))return false;
      if(filters.history){const paid=caseData.payments.some(p=>p.clientId===c.id);if(paid!==(filters.history==='paid'))return false;}
      if (filters.taskKind || filters.taskState) {
        const matchingTask = (caseData.tasks || []).some(task => task.clientId === c.id &&
          (!filters.taskKind || task.kind === filters.taskKind) &&
          (!filters.taskState || Boolean(task.completedOn) === (filters.taskState === 'completed')));
        if (!matchingTask) return false;
      }
      return true;
    };
    const q=$('crmSearch').value.toLowerCase();const filtered=crmRecords.filter(matches).filter(c=>[c.first,c.last,c.contact].join(' ').toLowerCase().includes(q));visibleClientIds=filtered.map(c=>c.id);$('crmList').innerHTML=filtered.map(c=>`<button class="inbox-item" data-crm="${esc(c.id)}"><span class="client-initial">${esc(c.first[0])}</span><span><strong>${esc(c.last)} ${esc(c.first)}</strong><small>${esc(c.contact)} · ${esc(clientLanguageLabel(c.language))}</small></span></button>`).join('')||'<div class="workspace-empty">Клиентов пока нет</div>';for(const b of $('crmList').querySelectorAll('[data-crm]'))b.onclick=()=>openCrm(b.dataset.crm);}
  let caseData={payments:[],requests:[]};
  $('clientFilters').oninput=()=>renderCrm();
  $('clientFilters').onsubmit=e=>e.preventDefault();
  $('clientFilters').onreset=()=>setTimeout(renderCrm,0);
  for (const filter of ['history','taskKind','taskState']) {
    $('clientFilters').elements[filter].onchange=()=>refreshCasework().catch(e=>{$('crmStatus').textContent=e.message;});
  }
  $('showFilteredClients').onclick=()=>{
    navigate('clients');
    $('clients').scrollIntoView({block:'start'});
  };
  $('campaignForm').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');
    const ids=[...visibleClientIds],text=form.elements.message.value.trim();
    if(!ids.length||!text)return;
    if(!window.confirm(window.crmTranslate('Отправить сообщение подписавшимся в Telegram из выбранной группы ('+ids.length+' карточек)?')))return;
    button.disabled=true;
    try{
      const key=JSON.stringify([ids,text]);
      if(form.dataset.key!==key){form.dataset.key=key;form.dataset.id=crypto.randomUUID();}
      const result=await post('/api/casework/campaign',{id:form.dataset.id,clientIds:ids,text});
      $('campaignStatus').textContent='Добавлено в очередь: '+result.count;form.reset();delete form.dataset.key;
    }catch(e){$('campaignStatus').textContent=e.message;}finally{button.disabled=false;}
  };
  function drawBookings(){
    const box=$('reservioBookings');box.replaceChildren();
    const entries=new Map([...(caseData.bookings||[]),...(caseData.syncedBookings||[])].map(b=>[b.id,b]));
    if(caseData.calendarError||caseData.calendarSync){
      $('reservioStatus').textContent=caseData.calendarError||'';
      if(!caseData.calendarError) appendStatus('reservioStatus','Синхронизировано',new Date(caseData.calendarSync).toLocaleString());
    }
    for(const event of [...entries.values()].sort((a,b)=>a.start.localeCompare(b.start))){
      const line=document.createElement('p');
      line.textContent=[event.start,event.zone,event.title,event.status].filter(Boolean).join(' · ');
      if(event.recurring){const label=document.createElement('span');label.textContent='Повторяющееся событие';line.append(' · ',label);}
      box.append(line);
    }
    if(!box.childElementCount)box.textContent='Записи ещё не импортированы.';
  }
  $('reservioCalendar').ontoggle=()=>{if($('reservioCalendar').open)refreshCasework().catch(e=>{$('reservioStatus').textContent=e.message;});};
  function appendStatus(id, label, value){
    const span=document.createElement('span');
    span.textContent=label;
    $(id).replaceChildren(span, ': ', String(value));
  }
  function handleReservioImport(id, importRecords){
    $(id).onsubmit=async event=>{
      event.preventDefault();
      const form=event.currentTarget,button=form.querySelector('button');
      button.disabled=true;
      $('reservioStatus').textContent='Импорт записей…';
      try{
        const result=await importRecords(form);
        form.reset();
        await refreshCasework();
        appendStatus('reservioStatus','Обработано записей',result.count);
      }catch(error){$('reservioStatus').textContent=error.message;}
      finally{button.disabled=false;}
    };
  }
  handleReservioImport('reservioImport',async form=>{
    const file=form.elements.file.files[0];
    if(!file || !/\.(csv|ics)$/i.test(file.name))throw Error('Выберите файл ICS или CSV.');
    if(file.size>2000000)throw Error('Выберите файл календаря до 2 МБ.');
    const format=file.name.toLowerCase().endsWith('.csv')?'csv':'ics';
    return post('/api/casework/reservio/import',{[format]:await file.text()});
  });
  handleReservioImport('reservioLinkImport',form=>post('/api/casework/reservio/import-link',{url:form.elements.url.value.trim()}));
  function drawCasework(){
    const client=crmRecords.find(c=>c.id===crmId);
    $('casework').hidden=!client;
    if(!client)return;
    const select=$('caseRequestForm').elements.dialogId, previous=select.value;
    select.replaceChildren(new Option('Выберите диалог',''));
    for(const d of client.dialogs||[])if(client.dialogIds?.includes(d.id))select.add(new Option((d.provider||'Telegram')+' · '+d.name,d.id));
    select.value=previous;
    drawCaseTasks();
    $('casePayments').replaceChildren();
    for(const p of caseData.payments.filter(p=>p.clientId===crmId)){
      const line=document.createElement('p');
      line.textContent=[p.date,p.service,(p.minor/100).toFixed(2),p.currency,p.method==='bank'?'Безналичные':'Наличные'].join(' · ');
      $('casePayments').append(line);
    }
    $('caseRequests').replaceChildren();
    for(const r of caseData.requests.filter(r=>r.clientId===crmId)){
      const line=document.createElement('p');
      line.textContent=r.text+' · до '+r.due+' · '+(r.done?window.crmTranslate('Получено'):window.crmTranslate('Напоминание')+' '+r.remind)+' ';
      if(!r.done){
        const done=document.createElement('button');done.type='button';done.textContent='Отметить полученным';
        done.onclick=async()=>{try{await post('/api/casework/requests/'+r.id+'/complete');await refreshCasework();}catch(e){$('crmStatus').textContent=e.message;}};
        line.append(done);
      }
      $('caseRequests').append(line);
    }
  }
  const taskForm = $('caseTaskForm');
  const taskLabels = Object.fromEntries([...taskForm.elements.kind.options].map(option => [option.value, option.textContent]));
  const taskStatus = $('caseTaskStatus');
  const caseTaskPanel = $('caseTaskDetails');
  const caseTaskHome = caseTaskPanel.parentElement;
  const inboxCaseTasks = $('inboxCaseTasks');
  let taskClientId = null;

  function placeCaseTaskPanel(dialogId = selected) {
    const inChat = user.role !== 'operator' && $('inbox').classList.contains('active') && Boolean(dialogId);
    const clientId = inChat
      ? crmRecords.find(client => client.dialogIds?.includes(dialogId))?.id
      : crmId;
    inboxCaseTasks.hidden = !inChat;
    $('inboxCaseTasksHint').hidden = !inChat || Boolean(clientId);
    const destination = inChat && clientId ? inboxCaseTasks : caseTaskHome;
    if (caseTaskPanel.parentElement !== destination) destination.prepend(caseTaskPanel);
    if ((clientId || null) === taskClientId) return;
    taskClientId = clientId || null;
    caseTaskPanel.open = false;
    taskForm.reset();
    updateTaskFields();
    delete taskForm.dataset.operation;
    taskStatus.textContent = '';
    drawCaseTasks();
  }

  let taskStaff = [];
  function updateTaskFields() {
    const isStatus = taskForm.elements.kind.value === 'status';
    $('caseTaskAssignee').hidden = isStatus;
    taskForm.elements.assignee.disabled = isStatus;
    $('caseTaskDateLabel').textContent = isStatus ? 'Дата запиту' : 'Строк виконання';
  }
  taskForm.elements.kind.onchange = updateTaskFields;
  $('caseTaskDetails').ontoggle = async () => {
    if (!$('caseTaskDetails').open) return;
    try {
      const [staff] = await Promise.all([api('/api/casework/staff'), refreshCasework()]);
      taskStaff = staff;
      const select = taskForm.elements.assignee;
      const previous = select.value;
      select.replaceChildren(new Option('Виберіть працівника', ''));
      for (const person of taskStaff.filter(person => person.enabled)) {
        select.add(new Option(person.name + (person.telegram ? '' : ' · Telegram не підключено'), person.id));
      }
      select.value = previous || '';
      drawCaseTasks();
    } catch (error) { taskStatus.textContent = error.message; }
  };
  taskForm.oninput = () => { delete taskForm.dataset.operation; };
  taskForm.onsubmit = async event => {
    event.preventDefault();
    const clientId = taskClientId;
    if (!clientId) return;
    const button = taskForm.querySelector('button');
    const fields = Object.fromEntries(new FormData(taskForm));
    taskForm.dataset.operation ||= crypto.randomUUID();
    button.disabled = true;
    try {
      await post('/api/casework/tasks', {...fields, id:taskForm.dataset.operation, clientId});
      if (taskClientId === clientId) {
        taskForm.reset();
        updateTaskFields();
        delete taskForm.dataset.operation;
        taskStatus.textContent = 'Завдання додано.';
      }
      await refreshCasework();
    } catch (error) {
      if (taskClientId === clientId) taskStatus.textContent = error.message;
    } finally { button.disabled = false; }
  };
  function drawCaseTasks() {
    renderCaseTasks($('caseTasks'), (caseData.tasks || []).filter(task => task.clientId === taskClientId));
  }
  function renderCaseTasks(container, rows, {refresh=refreshCasework, status=taskStatus}={}) {
    container.replaceChildren();
    if (!rows.length) {
      container.textContent = 'Завдань поки немає.';
      return;
    }
    for (const task of rows) {
      const article = document.createElement('article');
      const heading = document.createElement('strong');
      heading.textContent = [taskLabels[task.kind],task.clientName].filter(Boolean).join(' · ');
      const dates = document.createElement('p');
      const isStatus = task.kind === 'status';
      dates.textContent = isStatus ? 'Запит від ' + task.date : 'Строк ' + task.date + ' · нагадування ' + task.remindOn;
      if (task.completedOn) dates.textContent += (isStatus ? ' · відповідь ' : ' · завершено ') + task.completedOn;
      article.append(heading, dates);
      const assignee = taskStaff.find(person => person.id === task.assignee);
      if (assignee) {
        const assigned = document.createElement('p');
        assigned.textContent = 'Відповідальний працівник · ' + assignee.name;
        article.append(assigned);
      }
      if (task.note) {
        const note = document.createElement('p');
        note.textContent = task.note;
        article.append(note);
      }
      if (!task.completedOn) {
        const complete = document.createElement('form');
        let date;
        if (isStatus) {
          const label = document.createElement('label');
          label.textContent = 'Дата відповіді';
          date = document.createElement('input');
          date.type = 'date'; date.required = true; date.min = task.date;
          label.append(date);
          complete.append(label);
        }
        const button = document.createElement('button');
        button.className = 'ghost-btn';
        button.textContent = isStatus ? 'Записати відповідь' : 'Позначити завершеним';
        complete.append(button);
        complete.onsubmit = async event => {
          event.preventDefault();
          button.disabled = true;
          try {
            await post('/api/casework/tasks/' + task.id + '/complete', date ? {date:date.value} : {});
            await refresh();
          } catch (error) { status.textContent = error.message; }
          finally { button.disabled = false; }
        };
        article.append(complete);
      }
      container.append(article);
    }
  }
  async function loadStaffTasks() {
    const panel = $('staffTasksPanel'), status = $('staffTasksStatus');
    panel.hidden = false;
    try {
      const {tasks,today} = await api('/api/casework/my-tasks');
      const attention = tasks.filter(task => task.remindOn <= today).length;
      $('staffTasksSummary').textContent = 'Мої завдання · ' + tasks.length +
        (attention ? ' · потребують уваги: ' + attention : '');
      if (panel.open) renderCaseTasks($('staffTasksList'), tasks, {refresh:loadStaffTasks,status});
      status.textContent = '';
    } catch (error) { status.textContent = error.message; }
  }
  $('staffTasksPanel').ontoggle = () => {
    if ($('staffTasksPanel').open) loadStaffTasks();
  };
  function drawReport(){
    const totals=new Map(),from=$('reportFrom').value,to=$('reportTo').value;
    const box=$('caseTotals');box.replaceChildren();
    if(from&&to&&from>to){box.textContent='Проверьте диапазон дат.';return;}
    for(const p of caseData.payments){
      if((from&&p.date<from)||(to&&p.date>to))continue;
      const key=p.currency+' · '+p.service;
      totals.set(key,(totals.get(key)||0)+p.minor);
    }
    const rows=[...totals].sort(([a,x],[b,y])=>a.slice(0,3).localeCompare(b.slice(0,3))||y-x);
    for(const [key,minor] of rows){const line=document.createElement('p');line.textContent=key+' · '+(minor/100).toFixed(2);box.append(line);}
    if(!rows.length)box.textContent='За период нет записанных оплат.';
  }
  async function refreshCasework(){
    caseData=await api('/api/casework');drawCasework();drawReport();drawBookings();renderCrm();
  }
  $('caseReport').ontoggle=()=>{if($('caseReport').open)refreshCasework().catch(e=>{$('caseTotals').textContent=e.message;});};
  $('reportFrom').oninput=drawReport;$('reportTo').oninput=drawReport;
  for(const [formId,kind] of [['casePayForm','payments'],['caseRequestForm','requests']]){
    const form=$(formId);
    form.oninput=()=>{delete form.dataset.operation;};
    form.onsubmit=async event=>{
      event.preventDefault();const clientId=crmId,button=form.querySelector('button');button.disabled=true;
      try{
        form.dataset.operation ||= crypto.randomUUID();
        await post('/api/casework/'+kind,{...Object.fromEntries(new FormData(form)),id:form.dataset.operation,clientId});
        if(clientId===crmId){form.reset();delete form.dataset.operation;$('crmStatus').textContent=kind==='payments'?'Оплата записана.':'Запрос поставлен в очередь.';}
        await refreshCasework();
      }catch(e){$('crmStatus').textContent=e.message;}finally{button.disabled=false;}
    };
  }
  async function openCrm(id){
    if(crmId!==id){for(const name of ['casePayForm','caseRequestForm']){$(name).reset();delete $(name).dataset.operation;}}
    crmId=id;placeCaseTaskPanel();drawCasework();if(id)refreshCasework().catch(e=>{$('crmStatus').textContent=e.message;});$('officeUpload').reset();crmForm.reset();$('crmStatus').textContent='';const c=crmRecords.find(x=>x.id===id);$('crmTitle').textContent=c?c.last+' '+c.first:'Новый клиент';$('crmDialogs').replaceChildren();renderCrmDocuments(c);if(!c)return;for(const e of crmForm.elements)if(e.name)e.value=c[e.name]||'';
  $('crmDialogs').innerHTML=`<h3>Связаться с клиентом</h3><p>Ссылки открывают приложение. Наличие аккаунта по номеру не проверено.</p><div class="crm-contact-actions">${c.phone?`<a class="ghost-btn" href="https://wa.me/${encodeURIComponent(c.phone)}" target="_blank" rel="noopener">WhatsApp ↗</a> <a class="ghost-btn" href="https://t.me/+${encodeURIComponent(c.phone)}" target="_blank" rel="noopener">Telegram ↗</a> <a class="ghost-btn" href="tel:+${encodeURIComponent(c.phone)}">Позвонить</a>`:'<span>Телефон не указан в обращении</span>'}</div><p>Переписка в панели появляется после обращения клиента через подключённый канал.</p>`;
  for(const d of c.dialogs||[]){const b=document.createElement('button');b.className='ghost-btn';b.textContent='Диалог '+d.provider;b.onclick=()=>{selected=d.id;navigate('inbox');};$('crmDialogs').querySelector('.crm-contact-actions').append(b);}
  try{const result=await api('/api/telegram/inbox');if(crmId!==id)return;const select=document.createElement('select');select.className='ghost-btn';select.setAttribute('aria-label','Связать существующий диалог');select.add(new Option('Выберите существующий диалог',''));for(const d of result.clients)select.add(new Option((d.provider||'Telegram')+' · '+d.name+' · '+(d.contact||d.id),d.id));const button=document.createElement('button');button.className='ghost-btn';button.textContent='Связать с клиентом';button.onclick=async()=>{if(!select.value)return;try{await post('/api/clients/'+encodeURIComponent(id)+'/dialogs',{dialogId:select.value});await loadCrm();await openCrm(id);}catch(e){$('crmStatus').textContent=e.message;}};const linkForm=document.createElement('div');linkForm.className='crm-dialog-link';linkForm.append(select,button);$('crmDialogs').append(linkForm);}catch(e){$('crmStatus').textContent=e.message;}}

  function renderExpiryWarnings(){
    const box=$('expiryWarnings');
    box.replaceChildren();
    const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    for(const client of crmRecords){
      for(const doc of client.attachments||[]){
        if(!doc.expiresOn)continue;
        const [year,month,day]=doc.expiresOn.split('-').map(Number);
        const expiry=new Date(year,month-1,day);
        const lastDay=new Date(year,month-3,0).getDate();
        const start=new Date(year,month-4,Math.min(day,lastDay));
        if(today<start)continue;
        const button=document.createElement('button');
        button.type='button';button.className='ghost-btn';
        button.textContent=[client.last,client.first,'·',doc.fileName,'·',window.crmTranslate(today>expiry?'Срок истёк':'Истекает'),doc.expiresOn].join(' ');
        button.onclick=()=>openCrm(client.id);
        box.append(button);
      }
    }
  }
  const officeUploadForm=$('officeUpload');
  const officeUploadFilename=$('officeUploadFilename');
  const officeFileInput=officeUploadForm.elements.scan;
  officeFileInput.addEventListener('change',()=>{
    const file=officeFileInput.files[0];
    officeUploadFilename.textContent=file?.name||'';
    officeUploadFilename.hidden=!file;
  });
  officeUploadForm.addEventListener('reset',()=>{
    officeUploadFilename.textContent='';
    officeUploadFilename.hidden=true;
  });
  officeUploadForm.onsubmit=async event=>{
    event.preventDefault();
    const form=event.currentTarget, clientId=crmId, file=form.elements.scan.files[0];
    if(!clientId||!file)return;
    const status=$('crmStatus'),button=form.querySelector('button');
    button.disabled=true;
    try{
      if(file.size>5*1024*1024)throw Error('Максимальный размер — 5 МБ.');
      const expiresOn=form.elements.expiry.value;
      const base64=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result.split(',')[1]);
        reader.onerror=()=>reject(Error('Не удалось прочитать документ.'));
        reader.readAsDataURL(file);
      });
      await post('/api/clients/'+encodeURIComponent(clientId)+'/documents',{fileName:file.name,base64,expiresOn});
      await loadCrm();
      if(crmId===clientId){form.reset();status.textContent='Документ сохранён.';}
    }catch(error){if(crmId===clientId)status.textContent=error.message;}
    finally{button.disabled=false;}
  };
  async function loadCrm(){try{const d=await api('/api/clients');const applications=d.clients.flatMap(client=>(client.attachments||[]).filter(a=>a.source!=='office').map(attachment=>({key:client.id+':'+attachment.id,client,attachment})));announceCrmApplications(applications.filter(a=>!crmAcknowledgedApplications.has(a.key)));crmRecords=d.clients;placeCaseTaskPanel();renderExpiryWarnings();renderCrm();if(crmId)renderCrmDocuments(crmRecords.find(c=>c.id===crmId));const sync=await api('/api/clients-sync');if(sync.error)$('crmStatus').textContent='Синхронизация: '+sync.error;}catch(e){$('crmStatus').textContent=e.message;}}
  setInterval(()=>{if(!document.hidden)loadCrm();},15000);
  $('crmSearch').oninput=renderCrm;$('crmNew').onclick=()=>openCrm(null);$('crmRefresh').onclick=async()=>{try{await post('/api/clients-sync');await loadCrm();$('crmStatus').textContent='Заявки с сайта обновлены';}catch(e){$('crmStatus').textContent=e.message;}};
  crmForm.onsubmit=async e=>{e.preventDefault();const b=crmForm.querySelector('button');b.disabled=true;try{const d=await api('/api/clients'+(crmId?'/'+encodeURIComponent(crmId):''),{method:crmId?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(crmForm)))});await loadCrm();await openCrm(d.client.id);$('crmStatus').textContent='Анкета сохранена';}catch(e){$('crmStatus').textContent=e.message;}finally{b.disabled=false;}};

  let clients=[],selected=null,insertedTemplate=null;
  const seenInboundMessages=new Set();
  let inboxNotificationCursor=null,pollingInboxNotifications=false,audioContext=null,audioReady=false;
  const inboxToast=document.createElement('div');
  inboxToast.className='inbox-message-toast';inboxToast.setAttribute('role','status');inboxToast.setAttribute('aria-live','polite');inboxToast.hidden=true;document.body.append(inboxToast);
  let inboxToastTimer;
  const notificationButton=$('enableInboxNotifications');
  notificationButton.hidden=false;notificationButton.textContent='🔔 Тест уведомлений';
  async function unlockInboxAudio(){try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return false;if(!audioContext)audioContext=new Audio();if(audioContext.state!=='running')await audioContext.resume();audioReady=audioContext.state==='running';notificationButton.textContent=audioReady?'🔊 Тест уведомлений':'🔔 Тест уведомлений';notificationButton.classList.toggle('audio-ready',audioReady);return audioReady;}catch{return false;}}
  function playInboxSound(){if(!audioReady||!audioContext||audioContext.state!=='running')return;const now=audioContext.currentTime;[[740,0],[988,.19],[740,.43]].forEach(([frequency,offset])=>{const oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),start=now+offset;oscillator.type='sine';oscillator.frequency.setValueAtTime(frequency,start);gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.34,start+.025);gain.gain.exponentialRampToValueAtTime(.0001,start+.24);oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start(start);oscillator.stop(start+.25);});if(navigator.vibrate)navigator.vibrate([120,70,120]);}
  document.addEventListener('pointerdown',()=>{unlockInboxAudio();},{once:true});document.addEventListener('keydown',()=>{unlockInboxAudio();},{once:true});
  notificationButton.onclick=async()=>{const enabled=await unlockInboxAudio();if(typeof Notification!=='undefined'&&Notification.permission==='default')await Notification.requestPermission().catch(()=>{});if(enabled){playInboxSound();inboxToast.replaceChildren();const icon=document.createElement('div');icon.className='inbox-toast-icon';icon.textContent='✓';const copy=document.createElement('div');copy.className='inbox-toast-copy';const kicker=document.createElement('span');kicker.className='inbox-toast-kicker';kicker.textContent='ПРОВЕРКА УВЕДОМЛЕНИЙ';const title=document.createElement('strong');title.className='inbox-toast-title';title.textContent='Звук работает';const details=document.createElement('span');details.className='inbox-toast-details';details.textContent='Так будет выглядеть новое входящее сообщение.';copy.append(kicker,title,details);inboxToast.append(icon,copy);inboxToast.hidden=false;clearTimeout(inboxToastTimer);inboxToastTimer=setTimeout(()=>{inboxToast.hidden=true;},5000);if(typeof Notification!=='undefined'&&Notification.permission==='granted'){const testNotice=new Notification('Проверка уведомлений BEREG CRM',{body:'Звук и уведомления включены.'});setTimeout(()=>testNotice.close(),5000);}notificationButton.textContent='🔊 Тест уведомлений';$('inboxStatus').textContent='Тест завершён. Звук уведомлений включён.';}else $('inboxStatus').textContent='Не удалось включить звук. Проверьте настройки звука браузера и нажмите кнопку ещё раз.';};
  function announceNewInboxMessages(messages){
    if(!messages.length)return;
    const latest=messages[messages.length-1],client=latest.client,count=messages.length,clientCount=new Set(messages.map(item=>item.client.id)).size;
    inboxToast.replaceChildren();
    const icon=document.createElement('div');icon.className='inbox-toast-icon';icon.setAttribute('aria-hidden','true');icon.textContent='✦';
    const copy=document.createElement('div');copy.className='inbox-toast-copy';
    const kicker=document.createElement('span');kicker.className='inbox-toast-kicker';kicker.textContent='НОВОЕ ВХОДЯЩЕЕ';
    const title=document.createElement('strong');title.className='inbox-toast-title';title.textContent=count===1?'Новое сообщение':'Новых сообщений: '+count;
    const details=document.createElement('span');details.className='inbox-toast-details';details.textContent=count===1?`${client.name} · ${latest.message.text}`:`От ${clientCount} клиентов · последнее: ${client.name}: ${latest.message.text}`;
    const actions=document.createElement('div');actions.className='inbox-toast-actions';
    const open=document.createElement('button');open.type='button';open.className='inbox-toast-open';open.textContent='Открыть';open.onclick=()=>openInboxMessage(client);
    const close=document.createElement('button');close.type='button';close.className='inbox-toast-close';close.setAttribute('aria-label','Закрыть уведомление');close.textContent='×';close.onclick=()=>{inboxToast.hidden=true;};
    actions.append(open,close);copy.append(kicker,title,details);inboxToast.append(icon,copy,actions);inboxToast.hidden=false;clearTimeout(inboxToastTimer);inboxToastTimer=setTimeout(()=>{inboxToast.hidden=true;},18000);playInboxSound();
    if(typeof Notification!=='undefined'&&Notification.permission==='granted'&&document.hidden){
      const notification=new Notification(count===1?'Новое сообщение · BEREG CRM':`${count} новых сообщений · BEREG CRM`,{body:count===1?`${client.name}: ${latest.message.text}`:`От ${clientCount} клиентов. Последнее: ${client.name}: ${latest.message.text}`,tag:'bereg-inbox-'+client.id});
      notification.onclick=()=>{window.focus();notification.close();openInboxMessage(client);};
    }
  }
  function openInboxMessage(client){inboxToast.hidden=true;selected=client.id;navigate('inbox');}
  async function pollInboxNotifications(){if(pollingInboxNotifications)return;pollingInboxNotifications=true;try{const url='/api/telegram/notifications'+(inboxNotificationCursor===null?'':'?since='+encodeURIComponent(inboxNotificationCursor));const result=await api(url);
    const warnings=$('inboxOverdue');warnings.replaceChildren();
    for(const item of result.overdue||[]){
      const button=document.createElement('button');button.type='button';button.className='ghost-btn';
      button.textContent=item.name+' · без ответа '+Math.floor((Date.now()-Date.parse(item.since))/60000)+' мин';
      button.onclick=()=>openInboxMessage({id:item.id});warnings.append(button);
    }
    const fresh=[];if(inboxNotificationCursor!==null)for(const item of result.messages||[]){const key=`${item.client.id}:${item.message.sourceId??item.message.at??item.message.text}`;if(seenInboundMessages.has(key))continue;seenInboundMessages.add(key);fresh.push(item);}inboxNotificationCursor=Number(result.cursor)||Date.now();if(seenInboundMessages.size>5000){const latest=[...seenInboundMessages].slice(-2500);seenInboundMessages.clear();latest.forEach(key=>seenInboundMessages.add(key));}announceNewInboxMessages(fresh);if(fresh.length&&$('inbox').classList.contains('active')&&!$('inboxReply').value)await loadInbox();}catch{}finally{pollingInboxNotifications=false;}}
  const stateLabel=s=>({new:'Новое',in_progress:'В работе',closed:'Закрыто'})[s]||s;
  const providerName=c=>({telegram:'Telegram',facebook:'Facebook',whatsapp:'WhatsApp',instagram:'Instagram',email:'Email',chatwoot:'Chatwoot',viber:'Viber'})[c.provider||'telegram']||c.provider;
  const languageNames={en:'English',ru:'Русский',uk:'Українська',hu:'Magyar',vi:'Tiếng Việt',de:'Deutsch',es:'Español',fr:'Français',it:'Italiano',pl:'Polski',ro:'Română',tr:'Türkçe',ar:'العربية',zh:'中文',ja:'日本語',ko:'한국어',pt:'Português',nl:'Nederlands',cs:'Čeština',sk:'Slovenčina',bg:'Български',el:'Ελληνικά',sr:'Српски',hr:'Hrvatski',da:'Dansk',fi:'Suomi',sv:'Svenska',no:'Norsk',hi:'हिन्दी',id:'Bahasa Indonesia',th:'ไทย',fa:'فارسی',he:'עברית',ca:'Català'};
  const supportedReplyLanguages=Object.keys(languageNames);
  const crmClientLanguage=document.querySelector('#crmForm [name="language"]');
  supportedReplyLanguages.forEach(code=>{if(!crmClientLanguage.querySelector(`option[value="${code}"]`)){const option=document.createElement('option');option.value=code;option.textContent=languageNames[code];crmClientLanguage.append(option);}});
  const interfaceLanguage=()=>supportedReplyLanguages.includes(window.crmLanguage?.())?window.crmLanguage():'uk';
  let replyLanguage=interfaceLanguage();
  const clientLanguageLabel=code=>{const ui=window.crmLanguage?.()||'uk',label=languageNames[code]||({en:'Not selected',uk:'Не вибрано',vi:'Chưa chọn'})[ui]||'Не выбран';return `${({en:'Client language',uk:'Мова клієнта',vi:'Ngôn ngữ khách hàng'})[ui]||'Язык клиента'} · ${label}`;};
  function renderList(){const q=$('inboxSearch').value.toLowerCase(),filter=$('inboxFilter').value;const visible=clients.filter(c=>(filter==='all'||(filter==='closed'?c.status==='closed':c.status!=='closed'))&&[c.name,c.id,c.contact,...c.history.map(h=>h.text)].join(' ').toLowerCase().includes(q));$('inboxList').innerHTML=visible.length?visible.map(c=>`<button class="inbox-item ${selected===c.id?'selected':''}" data-client="${esc(c.id)}" data-audit-dialog="${esc(c.id)}"><span class="client-initial source-${esc(c.provider||'telegram')}">${esc(c.name.slice(0,1))}</span><span><strong>${esc(c.name)} <i class="source-pill source-${esc(c.provider||'telegram')}">${esc(providerName(c))}</i></strong><small>${esc(c.history[c.history.length-1]?.text||'Нет сообщений')}</small><em>${stateLabel(c.status)} · ${esc(c.operatorName)} · ${esc(clientLanguageLabel(c.language))}</em></span></button>`).join(''):'<div class="workspace-empty">Обращений пока нет<small>Новые сообщения появятся здесь.</small></div>';$('inboxList').querySelectorAll('[data-client]').forEach(b=>b.onclick=()=>{openInboxChat(b.dataset.client);});}
  const mobileInbox=matchMedia('(max-width: 760px)');
  let mobileChatOpen=false;
  const inboxDrafts=new Map();
  function openInboxChat(id){
    if(selected!==id){
      const reply=$('inboxReply');
      if(selected&&reply.value.trim())inboxDrafts.set(selected,{text:reply.value,template:insertedTemplate});
      const draft=inboxDrafts.get(id);
      reply.value=draft?.text||'';
      insertedTemplate=draft?.template||null;
      inboxDrafts.delete(id);
      $('inboxStatus').textContent='';
    }
    selected=id;
    mobileChatOpen=true;
    renderList();
    loadConversation(id);
    if(mobileInbox.matches)$('inboxBack').focus();
  }
  $('inboxBack').onclick=()=>{
    const previous=selected;
    mobileChatOpen=false;
    $('inbox').classList.remove('inbox-chat-open');
    const item=[...$('inboxList').querySelectorAll('[data-client]')].find(button=>button.dataset.client===previous);
    (item||$('inboxSearch')).focus();
  };
  let inboxTeam;
  function renderDialogTools(client){
    const host=$('inboxDialogTools');
    const tools=document.createElement('details'),summary=document.createElement('summary');
    const body=document.createElement('div');
    body.className='tool-body';
    tools.open=host.dataset.dialogId===client.id&&Boolean(host.firstElementChild?.open);
    host.dataset.dialogId=client.id;
    summary.textContent='Действия с диалогом и внутренние комментарии';
    tools.append(summary,body);
    function field(label,control,button){
      const row=document.createElement('div');
      row.className='inbox-tool-field';
      const caption=document.createElement('label');
      const text=document.createElement('span');
      text.textContent=label;
      caption.append(text,control);
      button.type='button';
      button.className='ghost-btn';
      row.append(caption,button);
      body.append(row);
    }
    for(const note of client.notes||[]){
      const line=document.createElement('p');line.textContent=note.by+' · '+new Date(note.at).toLocaleString(document.documentElement.lang)+' · '+note.text;body.append(line);
    }
    const note=document.createElement('textarea'),add=document.createElement('button'),select=document.createElement('select'),move=document.createElement('button');
    note.rows=2;note.maxLength=2000;add.textContent='Сохранить комментарий';move.textContent='Передать диалог';
    select.add(new Option('Выберите сотрудника',''));
    tools.ontoggle=async()=>{
      if(!tools.open||select.options.length>1)return;
      try{inboxTeam||=(await api('/api/telegram/inbox-team')).operators;
        for(const o of inboxTeam)select.add(new Option(o.name,o.id));
      }catch(e){$('inboxStatus').textContent=e.message;}
    };
    async function manage(body){
      try{await post('/api/telegram/inbox/'+encodeURIComponent(client.id)+'/manage',body);await loadInbox();}
      catch(e){$('inboxStatus').textContent=e.message;}
    }
    add.onclick=()=>{if(note.value.trim())manage({note:note.value});};
    move.onclick=()=>{if(select.value)manage({operatorId:select.value});};
    field('Внутренний комментарий',note,add);
    field('Ответственный сотрудник',select,move);
    if(!client.demo&&(client.transport==='chatwoot'||!client.provider||client.provider==='telegram')){
      const file=document.createElement('input'),send=document.createElement('button');
      file.type='file';send.textContent='Отправить файл клиенту';
      send.onclick=async()=>{
        const item=file.files[0];if(!item)return;
        try{if(item.size>5242880)throw Error('Максимальный размер — 5 МБ.');
          send.disabled=true;
          const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Ошибка чтения'));reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(item);});
          await post('/api/telegram/inbox/'+encodeURIComponent(client.id)+'/files',{name:item.name,base64});await loadInbox();
        }catch(error){$('inboxStatus').textContent=error.message;}finally{send.disabled=false;}
      };
      const picker=document.createElement('span');
      picker.className='inbox-file-picker';
      const filename=document.createElement('span');
      filename.textContent='Выбрать файл';
      file.onchange=()=>{
        filename.textContent=file.files[0]?.name||'Выбрать файл';
        send.disabled=!file.files.length;
      };
      send.disabled=true;
      picker.append(file,filename);
      field('Вложение до 5 МБ',picker,send);
    }
    host.replaceChildren(tools);
  }
  function renderConversation(){if(insertedTemplate&&insertedTemplate.dialogId!==selected){$('inboxReply').value='';insertedTemplate=null;}const c=clients.find(c=>c.id===selected);placeCaseTaskPanel(c?.id ?? null);$('inbox').classList.toggle('inbox-chat-open',Boolean(c)&&mobileChatOpen);$('inboxReplyForm').hidden=!c||Boolean(c.loading);$('inboxDialogTools').hidden=!c||Boolean(c.loading);$('replyTemplates').hidden=Boolean(c?.loading);if(!c){$('inboxDialogTools').replaceChildren();$('replyTemplates').open=false;$('inboxConversation').innerHTML='<div class="workspace-empty">Выберите обращение</div>';return;}if(c.loading){$('inboxConversation').innerHTML='<div class="workspace-empty">Загружаю переписку…</div>';return;}$('inboxConversation').dataset.auditDialog=c.id;$('inboxReplyForm').dataset.auditDialog=c.id;const sourceUrl=safeExternalUrl(c.sourceUrl);$('inboxConversation').innerHTML=`<div class="conversation-title"><div><h3>${esc(c.name)} <i class="source-pill source-${esc(c.provider||'telegram')}">${esc(providerName(c))}</i></h3>${c.contact?`<span>${esc(c.contact)}${sourceUrl?` · <a href="${esc(sourceUrl)}" target="_blank" rel="noopener">открыть диалог ↗</a>`:''}</span>`:''}<small class="client-language">${esc(clientLanguageLabel(c.language))}</small></div><span>${esc(c.operatorName)} · ${stateLabel(c.status)}</span></div><div class="message-list">${c.history.map(h=>`<div class="message ${h.direction==='out'?'outgoing':''}"><small>${h.direction==='out'?'Команда BEREG':providerName(c)}${h.direction==='in'&&h.sourceLanguage?` · ${esc(languageNames[h.sourceLanguage]||h.sourceLanguage)}`:''}</small><p>${esc(h.text)}</p>${h.originalText&&h.originalText!==h.text?`<details><summary>Исходное сообщение</summary><p>${esc(h.originalText)}</p></details>`:''}${(h.attachments||[]).map(f=>safeExternalUrl(f.url)?'<a href="'+esc(safeExternalUrl(f.url))+'" target="_blank" rel="noopener noreferrer">'+esc(f.name)+'</a>':'').join(' ')}${h.attachment?'<a download href="/api/telegram/inbox/'+encodeURIComponent(c.id)+'/files/'+encodeURIComponent(h.attachment.id)+'">'+esc(h.attachment.name)+'</a>':''}<time>${new Date(h.at).toLocaleString(document.documentElement.lang)}</time></div>`).join('')}</div>`;renderDialogTools(c);const title=$('inboxConversation').querySelector('.conversation-title');const addClient=document.createElement('button');addClient.type='button';addClient.className='ghost-btn';addClient.textContent='Добавить в клиентов';addClient.onclick=async()=>{addClient.disabled=true;try{const result=await post('/api/clients/from-inbox/'+encodeURIComponent(c.id));$('inboxStatus').textContent=result.existing?'Обращение уже связано с карточкой клиента.':'Клиент добавлен, обращение привязано к карточке.';if(user.role!=='operator'){await loadCrm();navigate('clients');await openCrm(result.client.id);}}catch(error){$('inboxStatus').textContent=error.message;}finally{addClient.disabled=false;}};title.append(addClient);const list=$('inboxConversation').querySelector('.message-list');list.scrollTop=list.scrollHeight;}
  async function loadConversation(id){const client=clients.find(item=>item.id===id);if(!client)return;client.loading=true;if(selected===id)renderConversation();try{const result=await api('/api/telegram/inbox/'+encodeURIComponent(id)+'?language='+encodeURIComponent(replyLanguage));const index=clients.findIndex(item=>item.id===id);if(index>=0)clients[index]=result.client;if(selected===id)renderConversation();}catch(error){client.loading=false;if(selected===id){$('inboxStatus').textContent=error.message;renderConversation();}}}
  let lastSyncedOperatorLanguage='';async function syncOperatorLanguage(){if(user.role!=='operator')return;const language=replyLanguage;if(!supportedReplyLanguages.includes(language)||language===lastSyncedOperatorLanguage)return;try{await api('/api/telegram/operator-language',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({language})});lastSyncedOperatorLanguage=language;}catch(error){$('inboxStatus').textContent=error.message;}}
  document.addEventListener('crm-language-change',()=>{replyLanguage=interfaceLanguage();lastSyncedOperatorLanguage='';renderCrm();renderList();renderConversation();syncOperatorLanguage();if($('inbox').classList.contains('active'))loadInbox();});
  async function loadInbox(){void loadStaffTasks();try{await syncOperatorLanguage();({clients}=await api('/api/telegram/inbox'));if(!clients.some(c=>c.id===selected))selected=null;renderList();if(selected)await loadConversation(selected);else renderConversation();}catch(e){$('inboxStatus').textContent=e.message;}}
  const templatePanel=$('replyTemplates'), templateEditor=$('replyTemplateEditor');
  const templateLanguage=$('replyTemplateLanguage'), templateSelect=$('replyTemplateSelect');
  const templateStatus=$('replyTemplateStatus');
  let replyTemplates=[], editingTemplateId=null;
  const currentTemplate=()=>replyTemplates.find(item=>item.id===templateSelect.value);
  const templateText=()=>[currentTemplate()?.text,currentTemplate()?.documents].filter(Boolean).join('\n\n');
  function previewTemplate(){
    $('replyTemplatePreview').textContent=templateText();
    for(const id of ['copyReplyTemplate','insertReplyTemplate','editReplyTemplate']) {
      $(id).disabled=!currentTemplate();
    }
  }
  function renderTemplates(selectedId){
    templateSelect.replaceChildren(new Option('Выберите шаблон',''));
    for(const item of replyTemplates.filter(item=>item.language===templateLanguage.value)) {
      templateSelect.add(new Option(item.title,item.id));
    }
    templateSelect.value=selectedId||'';
    previewTemplate();
  }
  async function loadTemplates(){
    try {
      ({templates:replyTemplates}=await api('/api/reply-templates'));
      renderTemplates(templateSelect.value);
    } catch(error) { templateStatus.textContent=error.message; }
  }
  templatePanel.ontoggle=()=>{if(templatePanel.open)loadTemplates();};
  templateLanguage.onchange=()=>{templateEditor.reset();renderTemplates();};
  templateSelect.onchange=previewTemplate;
  $('copyReplyTemplate').onclick=async()=>{
    try { await navigator.clipboard.writeText(templateText());templateStatus.textContent='Скопировано.'; }
    catch { templateStatus.textContent='Выделите текст шаблона и скопируйте его вручную.'; }
  };
  $('insertReplyTemplate').onclick=()=>{
    if(!selected){templateStatus.textContent='Выберите диалог.';return;}
    const reply=$('inboxReply');
    if(reply.value.trim()){templateStatus.textContent='Очистите поле ответа перед вставкой или скопируйте шаблон.';return;}
    reply.value=templateText();
    insertedTemplate={dialogId:selected,language:templateLanguage.value};
    templatePanel.open=false;
    reply.focus();
    $('inboxStatus').textContent='Текст вставлен. Проверьте его перед отправкой.';
  };
  $('editReplyTemplate').onclick=()=>{
    const item=currentTemplate();
    if(!item)return;
    editingTemplateId=item.id;
    for(const field of ['title','text','documents','event','match'])templateEditor.elements[field].value=item[field]||'';
  };
  templateEditor.onreset=()=>{editingTemplateId=null;};
  templateEditor.onsubmit=async event=>{
    event.preventDefault();
    const button=templateEditor.querySelector('[type="submit"]');
    button.disabled=true;
    try {
      const {template}=await post('/api/reply-templates',{
        ...Object.fromEntries(new FormData(templateEditor)),
        language:templateLanguage.value,id:editingTemplateId
      });
      templateEditor.reset();
      await loadTemplates();
      renderTemplates(template.id);
      templateStatus.textContent='Шаблон сохранён.';
    } catch(error) { templateStatus.textContent=error.message; }
    finally { button.disabled=false; }
  };
  $('inboxReply').addEventListener('input',()=>{if(!$('inboxReply').value.trim())insertedTemplate=null;});
  renderTemplates();
  $('refreshInbox').onclick=loadInbox;$('inboxSearch').oninput=renderList;$('inboxFilter').onchange=renderList;
  $('inboxReplyForm').onsubmit=async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;try{const d=await post('/api/telegram/inbox/'+encodeURIComponent(selected)+'/reply',{text:$('inboxReply').value,sourceLanguage:insertedTemplate?.dialogId===selected?insertedTemplate.language:replyLanguage});insertedTemplate=null;$('inboxReply').value='';$('inboxStatus').textContent=d.message;await loadInbox();}catch(e){$('inboxStatus').textContent=e.message;}finally{button.disabled=false;}};
  $('closeTicket').onclick=async()=>{try{await post('/api/telegram/inbox/'+encodeURIComponent(selected)+'/close');$('inboxStatus').textContent='Обращение закрыто.';await loadInbox();}catch(e){$('inboxStatus').textContent=e.message;}};
  let contentPlanItems=[];
  const planPlatforms={instagram:'Instagram',facebook:'Facebook',telegram:'Telegram',youtube:'YouTube',tiktok:'TikTok'},planFormats={post:'Пост',story:'История',video:'Видео',short:'Shorts',reel:'Reel'},planStatuses={draft:'Черновик',planned:'Запланировано',published:'Опубликовано'};
  const planDate=value=>value?new Date(value).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Без даты';
  function resetContentPlanForm(){const form=$('contentPlanForm');form.reset();form.elements.id.value='';$('contentPlanFormTitle').textContent='Новая публикация';$('contentPlanCancel').hidden=true;}
  function editContentPlanItem(item){const form=$('contentPlanForm');for(const [key,value] of Object.entries(item))if(form.elements[key])form.elements[key].value=value||'';$('contentPlanFormTitle').textContent='Изменить публикацию';$('contentPlanCancel').hidden=false;form.scrollIntoView({behavior:'smooth',block:'start'});}
  async function updateContentPlanItem(item,patch){await api('/api/content-plan/'+encodeURIComponent(item.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,...patch})});await loadContentPlan();}
  function renderContentPlan(){const filter=$('contentPlanFilter').value,items=contentPlanItems.filter(item=>filter==='all'||item.status===filter);$('contentPlanItems').innerHTML=items.length?items.map(item=>`<article class="content-plan-item"><div class="content-plan-item-head"><span class="content-plan-platform">${esc(planPlatforms[item.platform]||item.platform)} · ${esc(planFormats[item.format]||item.format)}</span><span class="content-plan-status status-${esc(item.status)}">${esc(planStatuses[item.status]||item.status)}</span></div><h4>${esc(item.title)}</h4><time>${esc(planDate(item.scheduledAt))}</time>${item.text?`<p>${esc(item.text)}</p>`:''}<div class="content-plan-item-actions"><button class="ghost-btn" type="button" data-plan-edit="${esc(item.id)}">Изменить</button>${item.status!=='published'?`<button class="ghost-btn" type="button" data-plan-publish="${esc(item.id)}">Опубликовано</button>`:''}<button class="ghost-btn" type="button" data-plan-delete="${esc(item.id)}">Удалить</button></div></article>`).join(''):'<div class="workspace-empty">В этом списке пока нет материалов.</div>';$('contentPlanItems').querySelectorAll('[data-plan-edit]').forEach(button=>button.onclick=()=>editContentPlanItem(contentPlanItems.find(item=>item.id===button.dataset.planEdit)));$('contentPlanItems').querySelectorAll('[data-plan-publish]').forEach(button=>button.onclick=()=>{const item=contentPlanItems.find(row=>row.id===button.dataset.planPublish);updateContentPlanItem(item,{status:'published'}).catch(error=>$('contentPlanStatus').textContent=error.message);});$('contentPlanItems').querySelectorAll('[data-plan-delete]').forEach(button=>button.onclick=async()=>{if(!confirm('Удалить материал из плана?'))return;try{await api('/api/content-plan/'+encodeURIComponent(button.dataset.planDelete),{method:'DELETE'});await loadContentPlan();}catch(error){$('contentPlanStatus').textContent=error.message;}});}
  async function loadContentPlan(){try{const result=await api('/api/content-plan');contentPlanItems=result.items||[];renderContentPlan();}catch(error){$('contentPlanStatus').textContent=error.message;}}
  function renderPublicationCalendar(){const root=$('publicationCalendar'),today=new Date();today.setHours(0,0,0,0);const days=Array.from({length:7},(_,index)=>{const date=new Date(today);date.setDate(date.getDate()+index);const key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;const items=contentPlanItems.filter(item=>item.status==='planned'&&item.scheduledAt?.slice(0,10)===key);return `<article class="day-card"><h4>${index===0?'Сегодня':index===1?'Завтра':date.toLocaleDateString('ru-RU',{weekday:'long'})}</h4><small>${date.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}</small>${items.length?items.map(item=>`<button type="button" class="calendar-plan-entry" data-calendar-edit="${esc(item.id)}"><strong>${esc(item.title)}</strong><span>${esc(planDate(item.scheduledAt))} · ${esc(planPlatforms[item.platform]||item.platform)}</span></button>`).join(''):'<p class="calendar-empty">Публикаций нет</p>'}</article>`;}).join('');root.innerHTML=days;root.querySelectorAll('[data-calendar-edit]').forEach(button=>button.onclick=()=>{const item=contentPlanItems.find(row=>row.id===button.dataset.calendarEdit);navigate('content');editContentPlanItem(item);});}
  async function loadPublicationCalendar(){try{const result=await api('/api/content-plan');contentPlanItems=result.items||[];renderPublicationCalendar();}catch(error){$('publicationCalendar').textContent=error.message;}}
  $('contentPlanForm').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');button.disabled=true;try{const data=Object.fromEntries(new FormData(form));const id=data.id;delete data.id;if(!id)data.status=data.scheduledAt?'planned':'draft';await api('/api/content-plan'+(id?'/'+encodeURIComponent(id):''),{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});$('contentPlanStatus').textContent='Материал сохранён в общем плане.';resetContentPlanForm();await loadContentPlan();}catch(error){$('contentPlanStatus').textContent=error.message;}finally{button.disabled=false;}};
  $('contentPlanCancel').onclick=resetContentPlanForm;$('contentPlanFilter').onchange=renderContentPlan;$('calendarRefresh').onclick=loadPublicationCalendar;
  async function loadUsers(){if(user.role!=='superadmin')return;try{const [u,t]=await Promise.all([api('/api/users'),api('/api/telegram/status')]);$('workspaceUsers').innerHTML=u.users.map(x=>`<div class="user-row"><div><strong>${esc(x.name)}</strong><small>${esc(x.username)} · ${roles[x.role]} · ${x.enabled?'Активен':'Отключён'}</small></div>${x.role==='superadmin'?'<span class="owner-pill">Владелец</span>':`<div><button class="ghost-btn" data-reset="${x.id}">Новый пароль</button><button class="ghost-btn" data-toggle="${x.id}">${x.enabled?'Отключить':'Включить'}</button></div>`}</div>`).join('');$('operatorLink').innerHTML='<option value="">Новый Telegram-оператор — создать автоматически</option>'+t.operators.filter(o=>o.enabled&&!u.users.some(x=>x.enabled&&x.operatorId===o.id)).map(o=>`<option value="${o.id}">${esc(o.name)}</option>`).join('');$('workspaceUsers').querySelectorAll('[data-toggle]').forEach(b=>b.onclick=async()=>{try{await post('/api/users/'+b.dataset.toggle+'/toggle');await loadUsers();}catch(e){$('newUserResult').textContent=e.message;}});$('workspaceUsers').querySelectorAll('[data-reset]').forEach(b=>b.onclick=async()=>{try{const d=await post('/api/users/'+b.dataset.reset+'/reset-password');$('newUserResult').textContent='Новый пароль: '+d.password+'. Предыдущие сеансы завершены. Сохраните пароль.';}catch(e){$('newUserResult').textContent=e.message;}});}catch(e){$('newUserResult').textContent=e.message;}}
  $('createUserForm').role.onchange=e=>{$('operatorLinkLabel').hidden=e.target.value!=='operator';$('operatorLink').required=false;};
  $('createUserForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;let createdTelegramOperator=null;try{const payload=Object.fromEntries(new FormData(f));if(payload.role==='operator'){const existing=await api('/api/users');if(existing.users.some(item=>item.username.toLowerCase()===payload.username.toLowerCase()))throw Error('Этот логин уже существует.');if(!payload.operatorId)createdTelegramOperator=await post('/api/telegram/operators',{name:payload.name});if(createdTelegramOperator)payload.operatorId=createdTelegramOperator.id;}const d=await post('/api/users',payload);$('newUserResult').textContent='Аккаунт CRM создан. Логин: '+d.user.username+' · пароль CRM: '+d.password+'. Сохраните его. '+(createdTelegramOperator?'Доступ в Telegram-бот: /login '+createdTelegramOperator.password+'. Передайте сотруднику оба пароля.':'');f.reset();$('operatorLinkLabel').hidden=true;$('operatorLink').required=false;await loadUsers();}catch(e){$('newUserResult').textContent=e.message+(createdTelegramOperator?' Telegram-оператор уже создан. Его вход: /login '+createdTelegramOperator.password+'. Выберите его в списке и повторите создание аккаунта.':'');await loadUsers();}finally{b.disabled=false;}};
  $('refreshUsers').onclick=loadUsers;
  document.body.classList.remove('auth-loading','feature-loading');
  await Promise.all(modules.map(loadModule));
  if(user.role==='operator')navigate('inbox');pollInboxNotifications();
  setInterval(()=>pollInboxNotifications(),10000);
})().catch(error=>{document.body.classList.remove('auth-loading','feature-loading');const message=document.createElement('div');message.setAttribute('role','alert');message.style.cssText='position:fixed;z-index:2000;top:12px;left:12px;right:12px;padding:14px 18px;border:1px solid #806b45;border-radius:12px;background:#191815;color:#f3e4bd;box-shadow:0 6px 24px #0008';const text=document.createElement('span');text.textContent=error.name==='AbortError'?'Sign-in is taking too long. Reload the page and try again.':`Workspace could not start: ${error.message||'reload the page and try again.'}`;const button=document.createElement('button');button.type='button';button.textContent='Reload';button.style.cssText='margin-left:12px;border:1px solid #9b7937;border-radius:8px;padding:7px 10px;background:#ffd269;color:#171511;cursor:pointer';button.onclick=()=>location.reload();message.append(text,button);document.querySelector('.main-panel')?.prepend(message);});
