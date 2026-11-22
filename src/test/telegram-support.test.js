const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {createSupport}=require('../lib/telegram-support');
test('client and team bots expose English-only commands, prompts and keyboards',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tg-english-'));const sent=[];
 const service=createSupport({directory,api:async(bot,method,payload)=>{sent.push({bot,method,...payload});return{message_id:1};}});
 const update=(id,text)=>({message:{message_id:1,chat:{id,type:'private'},from:{first_name:'Staff'},text}});
 try{
  await service.handle('client',update(1,'/start'));
  await service.handle('client',update(1,'/language'));
  await service.handle('operator',update(2,'/start'));
  const clientMenu=sent.find(item=>item.bot==='client'&&item.reply_markup?.keyboard);
  const clientLanguage=sent.find(item=>item.bot==='client'&&item.text==='This support bot is available in English.');
  const teamPrompt=sent.find(item=>item.bot==='operator');
  assert.deepEqual(clientMenu.reply_markup.keyboard.flat().map(button=>button.text),['💬 Message support','📋 Services','📍 Contacts']);
  assert.equal(clientLanguage.text,'This support bot is available in English.');
  assert.match(teamPrompt.text,/Sign in|login|password/i);
  assert(!JSON.stringify(sent).match(/Русский|Tiếng Việt|Изменить язык|Выберите язык/));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('personal login, balancing, isolated replies, queue and persistent state',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tg-support-'));
 const sent=[];let messageId=10; let reject=false;
 const api=async(bot,method,payload)=>{if(reject&&method==='sendMessage')throw Error('Unavailable');sent.push({bot,method,...payload});return {message_id:++messageId};};
 const service=createSupport({directory,api});
 const update=(id,text,reply)=>({message:{message_id:++messageId,chat:{id,type:'private'},from:{first_name:'Client'},text,reply_to_message:reply?{message_id:reply}:undefined}});
 try {
 const a=service.addOperator('Anna'),b=service.addOperator('Boris');
 assert(!fs.readFileSync(path.join(directory,'support.json'),'utf8').includes(a.password));
 assert.equal(service.getOperatorPassword(a.id),a.password);
 assert(!JSON.stringify(service.snapshot()).includes('passwordVault'));
 await service.handle('client',update(1,'Pending'));assert.equal(service.state.clients['1'].operatorId,null);
 await service.handle('operator',update(100,'/login '+a.password));
 await service.handle('operator',update(200,'/login '+b.password));
 await service.handle('operator',update(300,'/login '+a.password));assert.equal(service.state.operators[0].chatId,'100');
 await service.flush();assert.equal(service.state.clients['1'].operatorId,a.id);
 await service.handle('client',update(2,'Second'));assert.equal(service.state.clients['2'].operatorId,b.id);
 const msg=update(1,'Again');await service.handle('client',msg);await service.handle('client',msg);assert.equal(service.state.clients['1'].history.length,2);
 await service.flush();
 const key=Object.keys(service.state.replies).find(k=>k.startsWith('100:'));const reply=Number(key.split(':')[1]);
 await service.handle('operator',update(200,'Wrong answer',reply));assert.equal(service.state.queue.length,0);
 await service.handle('operator',update(100,'Correct answer',reply));await service.flush();assert(sent.some(m=>m.bot==='client'&&m.chat_id==='1'&&m.text==='Correct answer'));
 await service.handle('operator',update(100,'/pause'));await service.handle('client',update(3,'Third'));assert.equal(service.state.clients['3'].operatorId,b.id);
 await service.handle('operator',update(100,'/close',reply));assert.equal(service.state.clients['1'].status,'closed');
 reject=true;await service.flush();assert(service.state.queue.length>0);reject=false;
 const loaded=createSupport({directory,api});assert.equal(loaded.state.clients['2'].operatorId,b.id);
 loaded.disable(b.id);assert.equal(loaded.state.clients['2'].operatorId,null);
 assert(!JSON.stringify(loaded.snapshot()).includes('hash'));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('superadmin password operations rotate login and revoke the Telegram binding',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tg-password-'));
 const sent=[];let messageId=1;
 const api=async(bot,method,payload)=>{sent.push({bot,method,...payload});return {message_id:++messageId};};
 const service=createSupport({directory,api});
 const update=(id,text)=>({message:{message_id:++messageId,chat:{id,type:'private'},from:{first_name:'Operator'},text}});
 try{
  const operator=service.addOperator('Elena');
  await service.handle('operator',update(500,`/login ${operator.password}`));
  assert.equal(service.state.operators[0].chatId,'500');
  const replacement='Bereg-new-password-2026';
  assert.equal(service.setOperatorPassword(operator.id,replacement),replacement);
  assert.equal(service.getOperatorPassword(operator.id),replacement);
  assert.equal(service.state.operators[0].chatId,null);
  await service.handle('operator',update(500,`/login ${operator.password}`));
  assert.equal(service.state.operators[0].chatId,null);
  await service.handle('operator',update(500,`/login ${replacement}`));
  assert.equal(service.state.operators[0].chatId,'500');
  const persisted=fs.readFileSync(path.join(directory,'support.json'),'utf8');
  assert(!persisted.includes(replacement));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('external Facebook and WhatsApp clients are labelled and replies use the external sender',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tg-external-'));const deliveries=[];let messageId=1;
 const api=async(bot,method,payload)=>({message_id:++messageId});
 const service=createSupport({directory,api,externalSender:async(client,text)=>deliveries.push({provider:client.provider,to:client.externalId,text})});
 const update=(id,text,reply)=>({message:{message_id:++messageId,chat:{id,type:'private'},from:{first_name:'Operator'},text,reply_to_message:reply?{message_id:reply}:undefined}});
 try{
  const operator=service.addOperator('Anna');await service.handle('operator',update(100,`/login ${operator.password}`));
  const client=service.ingestExternal({provider:'whatsapp',externalId:'361234567',name:'Olga',contact:'+361234567',sourceUrl:'https://wa.me/361234567',text:'Нужен переводчик',sourceId:'wamid.1'});
  assert.equal(client.provider,'whatsapp');await service.flush();
  const replyId=Number(Object.keys(service.state.replies).find(key=>key.startsWith('100:')).split(':')[1]);
  await service.handle('operator',update(100,'Поможем',replyId));await service.flush();
  assert.deepEqual(deliveries,[{provider:'whatsapp',to:'361234567',text:'Поможем'}]);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
