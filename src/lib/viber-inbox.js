const crypto=require('node:crypto');
const express=require('express');
function createViberInbox({token=process.env.VIBER_BOT_TOKEN,fetchImpl=fetch}={}){
  let ingest;
  async function sendMessage(client,text){
    if(!token)throw Error('Viber не подключён.');
    const response=await fetchImpl('https://chatapi.viber.com/pa/send_message',{
      method:'POST',headers:{'X-Viber-Auth-Token':token,'Content-Type':'application/json'},
      body:JSON.stringify({receiver:client.externalId,type:'text',text,sender:{name:'BEREG'}}),signal:AbortSignal.timeout(20000)
    });
    if(!response.ok||(await response.json()).status!==0)throw Error('Viber не подтвердил отправку.');
  }
  function mountWebhook(app){
    app.post('/webhooks/viber',express.raw({type:'application/json',limit:'1mb'}),async(req,res)=>{
      if(!token||!Buffer.isBuffer(req.body))return res.sendStatus(403);
      const signature=req.get('X-Viber-Content-Signature')||'';
      if(!/^[0-9a-f]{64}$/i.test(signature)||!crypto.timingSafeEqual(Buffer.from(signature,'hex'),crypto.createHmac('sha256',token).update(req.body).digest()))return res.sendStatus(401);
      try{
        const event=JSON.parse(req.body.toString('utf8'));
        if(event.event!=='message')return res.sendStatus(200);
        if(!event.sender?.id||!event.message)return res.sendStatus(400);
        const attachments=[];
        if(event.message.media){
          const url=new URL(event.message.media);
          if(url.protocol==='https:')attachments.push({url:url.href,name:event.message.file_name||event.message.type});
        }
        const text=event.message.text||event.message.file_name||event.message.type;
        const sourceId=crypto.createHash('sha256').update(req.body).digest('hex');
        await ingest({provider:'viber',transport:'viber',externalId:event.sender.id,name:event.sender.name,language:event.sender.language,
          sourceId,text,attachments});res.sendStatus(200);
      }catch{res.sendStatus(503);}
    });
  }
  return {sendMessage,mountWebhook,setIngest:fn=>{ingest=fn;}};
}
module.exports={createViberInbox};
