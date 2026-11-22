(()=>{
  const formatDate=value=>value.toLocaleDateString('ru-RU');
  const tests={
    inbox(){
      const dialog={provider:'Telegram',history:[]};
      dialog.history.push({incoming:true,text:'Какие документы нужны?'});
      dialog.history.push({incoming:false,text:'Пришлите скан документа.'});
      return dialog.provider+' · Клиент: '+dialog.history[0].text+' Ответ: '+dialog.history[1].text;
    },
    documents(){
      const expiry=new Date();expiry.setDate(expiry.getDate()+30);
      return 'Пример: справка.pdf · действительна до '+formatDate(expiry)+' · до окончания менее трёх месяцев.';
    },
    payments(){
      const entries=[{method:'наличные',amount:5000},{method:'безналичные',amount:3000}];
      return 'Перевод · '+entries.map(p=>p.amount+' HUF ('+p.method+')').join(' + ')+' = '+entries.reduce((sum,p)=>sum+p.amount,0)+' HUF.';
    },
    deadlines(){
      const due=new Date(),remind=new Date();due.setDate(due.getDate()+7);remind.setDate(remind.getDate()+5);
      return 'Пример запроса: пришлите скан до '+formatDate(due)+'. Дата напоминания: '+formatDate(remind)+'.';
    }
  };
  const labels={queued:'В очереди',accepted:'Канал принял сообщение',unconfirmed:'Канал не подтвердил отправку'};
  async function api(url,options={}){
    const response=await fetch(url,options),result=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(result.error||'Не удалось выполнить запрос.');
    return result;
  }
  for(const button of document.querySelectorAll('[data-crm-test]')){
    const output=button.nextElementSibling;
    let built=false;
    button.addEventListener('click',async()=>{
      output.hidden=!output.hidden;button.setAttribute('aria-expanded',String(!output.hidden));
      if(output.hidden||built)return;
      button.disabled=true;
      try{
        const {clients}=await api('/api/telegram/inbox');
        const select=document.createElement('select'),message=document.createElement('textarea');
        const send=document.createElement('button'),status=document.createElement('span');
        select.setAttribute('aria-label','Тестовый клиент и канал');
        select.add(new Option('Выберите тестового клиента',''));
        for(const c of clients.filter(c=>!c.demo))select.add(new Option([c.name,c.provider||'Telegram',c.contact||c.id].join(' · '),c.id));
        message.value=tests[button.dataset.crmTest]();message.maxLength=1000;message.setAttribute('aria-label','Текст для отправки клиенту');
        send.type='button';send.className='crm-test-button';send.textContent='Отправить тест';
        output.replaceChildren(select,message,send,status);built=true;
        if(!select.options[1])status.textContent='Нет доступных диалогов с адресатом.';
        let operation;
        send.onclick=async()=>{
          if(!select.value||!message.value.trim()){status.textContent='Выберите клиента и введите текст.';return;}
          const endpoint='/api/telegram/inbox/'+encodeURIComponent(select.value)+'/test-send';
          const key=JSON.stringify([endpoint,message.value]);
          if(operation?.key!==key)operation={key,id:crypto.randomUUID()};
          const id=operation.id;send.disabled=select.disabled=message.disabled=true;
          try{
            let result=await api(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':window.__beregAuth.csrf},body:JSON.stringify({id,text:message.value})});
            status.textContent=labels[result.delivery];
            for(let i=0;i<15&&result.delivery==='queued';i++){
              await new Promise(resolve=>setTimeout(resolve,1000));
              result=await api(endpoint+'/'+id);status.textContent=labels[result.delivery];
            }
            if(result.delivery==='accepted'){operation=null;}
          }catch(error){status.textContent=error.message;}
          finally{send.disabled=select.disabled=message.disabled=false;}
        };
      }catch(error){output.textContent=error.message;}finally{button.disabled=false;}
    });
  }
})();
