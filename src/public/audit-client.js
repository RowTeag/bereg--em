(()=>{
 const sensitive=/password|passphrase|token|secret|authorization|cookie|csrf|hash|credential/i;
 const trim=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,160);
 const currentPage=()=>document.querySelector('.section-panel.active')?.id||document.querySelector('.mini-page.active')?.id||location.pathname;
 const send=(action,target='',page=currentPage(),details={},dialogId='')=>{
  const auth=window.__beregAuth;if(!auth?.csrf)return;
  fetch('/api/audit/events',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':auth.csrf},body:JSON.stringify({action,page,target,details,dialogId})}).catch(()=>{});
 };
 document.addEventListener('click',event=>{
  const element=event.target.closest('button,a,[role="button"],input[type="submit"]');if(!element||element.disabled||element.dataset.auditIgnore!==undefined)return;
  if(element.id==='mobileMenuBtn'||element.id==='refreshInbox'||element.id==='refreshClients'||element.id==='refreshAudit'||element.id==='crmRefresh'||element.id==='refreshUsers'||element.id==='calendarRefresh'||element.id==='enableInboxNotifications'||element.classList.contains('nav-group-toggle'))return;
  if(element.closest('form')&&element.tagName==='BUTTON'&&(!element.getAttribute('type')||element.type==='submit'))return;
  const target=trim(element.dataset.auditLabel||element.getAttribute('aria-label')||element.innerText||element.value||element.title);if(target){const nextPage=element.dataset.target||element.dataset.page,dialogId=element.closest('[data-audit-dialog]')?.dataset.auditDialog||'';send('click',target,nextPage||currentPage(),{},dialogId);}
 },true);
 document.addEventListener('submit',event=>{
  const form=event.target;if(!(form instanceof HTMLFormElement)||form.dataset.noAudit!==undefined)return;
  const values={};for(const [key,value] of new FormData(form).entries()){
   if(sensitive.test(key)||typeof value!=='string'||!value.trim())continue;
   values[key.slice(0,60)]=value.slice(0,1800);
   if(Object.keys(values).length>=24)break;
  }
  const target=trim(form.dataset.auditLabel||form.querySelector('button[type="submit"],button:not([type]),input[type="submit"]')?.innerText||form.id||'Форма'),dialogId=form.dataset.auditDialog||form.closest('[data-audit-dialog]')?.dataset.auditDialog||'';send('submit',target,currentPage(),values,dialogId);
 },true);
})();
