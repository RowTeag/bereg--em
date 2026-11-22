const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {mountSupport}=require('../lib/telegram-support');
test('test button sends through selected channel once and records provider acknowledgement',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bereg-test-send-'));
  try{
    const routes={},app={use(){},put(){},delete(){},get(p,fn){routes['get'+p]=fn;},post(p,fn){routes['post'+p]=fn;}};
    const deliveries=[];
    const support=mountSupport(app,{directory:dir,workerMode:true,api:async(bot,method,data)=>{deliveries.push([bot,method,data.chat_id]);return {message_id:1};},
      externalSender:async(client,text)=>deliveries.push([client.provider,client.externalId,text])});
    for(const [id,provider] of [['77','telegram'],['ext','whatsapp']]){
      support.state.clients[id]={id,provider,externalId:'contact',operatorId:null,history:[],language:'ru'};
      const req={panelUser:{id:'u',role:'admin'},params:{id},body:{id:crypto.randomUUID(),text:'Проверка'}};
      const res={status(){return this;},json(value){this.value=value;}};
      const send=routes['post/api/telegram/inbox/:id/test-send'];
      send(req,res);
      await new Promise(resolve=>setImmediate(resolve));
      send(req,res);
      assert.equal(res.value.delivery,'accepted');
    }
    assert.equal(deliveries.length,2);
    assert.deepEqual(deliveries[0],['client','sendMessage','77']);
    assert.deepEqual(deliveries[1],['whatsapp','contact','[BEREG · Тест] Проверка']);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
