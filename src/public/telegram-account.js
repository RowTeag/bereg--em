(()=>{
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let state,dirty=false,inflight=false;
  async function api(suffix='',method='GET',body){
    const response=await fetch('/api/telegram-account'+suffix,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Не удалось выполнить действие.');return result;
  }
  const labels={preview:'Черновик',sent:'Отправлено',limited:'Лимит частоты',paused:'Пауза Telegram',uncertain:'Отправка не подтверждена',sending:'Отправляется'};
  function renderGroups(){
    $('accountGroups').innerHTML=state.dialogs.length?state.dialogs.map(d=>`<label class="growth-check"><input type="checkbox" name="chatId" value="${esc(d.id)}" ${state.settings.chatIds.includes(d.id)?'checked':''}>${esc(d.title)}</label>`).join(''):'Нет доступных групп. Подключите аккаунт и загрузите список.';
  }
  function render(){
    $('accountBusiness').textContent=`${state.business.name} · ${state.business.botUrl}`;
    $('accountConnection').textContent=state.connected?`Подключён: ${state.account.name}${state.account.username?' (@'+state.account.username+')':''}`:({code:'Код отправлен в Telegram.',password:'Введите пароль двухэтапной проверки.',connecting:'Подключение…'})[state.phase]||'Личный аккаунт ещё не подключён.';
    $('accountCredentials').hidden=state.connected;$('accountCredentials').open=!state.credentialsConfigured;
    $('accountLoginForm').hidden=state.connected;
    $('accountVerifyForm').hidden=!['code','password'].includes(state.phase);
    $('accountCodeLabel').hidden=state.phase!=='code';$('accountPasswordLabel').hidden=state.phase!=='password';
    $('accountDisconnect').hidden=!state.connected&&!['code','password'].includes(state.phase);
    if(!dirty){const f=$('accountSettingsForm');for(const k of ['mode','cooldownMinutes','dailyLimit','globalDailyLimit'])f.elements[k].value=state.settings[k];f.elements.enabled.checked=state.settings.enabled;renderGroups();}
    $('accountCheckStatus').textContent=state.lastError||(state.settings.enabled?`Мониторинг включён. ${state.lastChecked?'Последняя проверка: '+new Date(state.lastChecked).toLocaleString('ru-RU'):'Ожидание подключения.'}`:'Мониторинг выключен.');
    if(state.blockedUntil>Date.now())$('accountCheckStatus').textContent+=' Пауза до '+new Date(state.blockedUntil).toLocaleString('ru-RU');
    $('accountJournal').innerHTML=state.journal.length?state.journal.map(e=>`<article class="growth-lead"><div class="growth-lead-head"><strong>${esc(e.chatTitle)}</strong><span class="growth-lead-status">${esc(labels[e.status]||e.status)}</span></div><p>${esc(e.text)}</p><label>Ответ<textarea readonly rows="3">${esc(e.reply)}</textarea></label><small>${esc(new Date(e.at).toLocaleString('ru-RU'))}</small>${/^https:\/\/t\.me\//.test(e.url)?` · <a href="${esc(e.url)}" target="_blank" rel="noopener">Открыть вопрос ↗</a>`:''}</article>`).join(''):'<p>Подходящие вопросы появятся здесь после включения мониторинга.</p>';
    $('accountCandidates').innerHTML=state.candidates.map(c=>`<div><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)} ↗</a><p>${esc(c.note)}</p></div>`).join('');
  }
  async function load(){if(inflight)return;inflight=true;try{state=await api();render();}finally{inflight=false;}}
  const action=fn=>async event=>{event.preventDefault();const button=event.currentTarget.matches('form')?event.currentTarget.querySelector('button'):event.currentTarget;button.disabled=true;try{await fn(event);await load();}catch(error){$('accountActionStatus').textContent=error.message;}finally{button.disabled=false;}};
  $('accountSettingsForm').addEventListener('input',()=>{dirty=true;});
  $('accountCredentialsForm').onsubmit=action(async event=>{await api('/credentials','PUT',Object.fromEntries(new FormData(event.currentTarget)));event.currentTarget.reset();$('accountActionStatus').textContent='Данные подключения сохранены. Теперь введите номер телефона.';});
  $('accountLoginForm').onsubmit=action(async event=>{await api('/login','POST',Object.fromEntries(new FormData(event.currentTarget)));$('accountActionStatus').textContent='Введите код входа в форме ниже.';});
  $('accountVerifyForm').onsubmit=action(async event=>{const data=Object.fromEntries(new FormData(event.currentTarget));event.currentTarget.reset();const result=await api('/verify','POST',data);$('accountActionStatus').textContent=result.phase==='password'?'Требуется пароль двухэтапной проверки.':'Аккаунт подключён. Выберите группы и режим работы.';});
  $('accountDisconnect').onclick=action(async()=>{await api('/disconnect','POST');dirty=false;$('accountActionStatus').textContent='Аккаунт отключён, мониторинг остановлен.';});
  $('accountSettingsForm').onsubmit=action(async event=>{const f=event.currentTarget;await api('/settings','PUT',{enabled:f.elements.enabled.checked,mode:f.elements.mode.value,chatIds:[...f.querySelectorAll('[name="chatId"]:checked')].map(e=>e.value),cooldownMinutes:Number(f.elements.cooldownMinutes.value),dailyLimit:Number(f.elements.dailyLimit.value),globalDailyLimit:Number(f.elements.globalDailyLimit.value)});dirty=false;$('accountActionStatus').textContent='Настройки мониторинга сохранены.';});
  $('accountRefreshGroups').onclick=action(async()=>{const selected=[...$('accountGroups').querySelectorAll('input:checked')].map(e=>e.value);const result=await api('/dialogs');state.dialogs=result.dialogs;if(dirty)state.settings.chatIds=selected;renderGroups();});
  $('accountRefresh').onclick=action(async()=>{});
  load().catch(e=>{$('accountActionStatus').textContent=e.message;});
  setInterval(()=>{if(document.querySelector('[data-growth-pane="account"]').classList.contains('active')&&!document.hidden)load().catch(()=>{});},10000);
})();
