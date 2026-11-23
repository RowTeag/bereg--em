const fs=require('./runtime-fs');
const path=require('node:path');
const crypto=require('node:crypto');
const maxSize=5*1024*1024;
function createDialogFiles(directory,token){
  const folder=path.join(directory,'dialog-files');
  function persist(bytes,name){
    if(!bytes.length||bytes.length>maxSize)throw Error('Максимальный размер файла — 5 МБ.');
    fs.mkdirSync(folder,{recursive:true,mode:0o700});
    const id=crypto.randomUUID();
    const filename=String(name||'document').replace(/[\\/\x00-\x1f\x7f]/g,'_').slice(0,150);
    fs.writeFileSync(path.join(folder,id),bytes,{mode:0o600});
    return {id,name:filename,size:bytes.length};
  }
  async function receiveResponse(response, name) {
    if (!response.ok || !response.body) throw Error('Не вдалося отримати файл.');
    if (Number(response.headers.get('content-length')) > maxSize) return null;
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxSize) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    return size ? persist(Buffer.concat(chunks), name) : null;
  }
  async function receive(media,name,api){
    if(media.file_size>maxSize)return null;
    const file=await api('client','getFile',{file_id:media.file_id});
    if(!file.file_path||file.file_size>maxSize)return null;
    const url='https://api.telegram.org/file/bot'+token+'/'+file.file_path.split('/').map(encodeURIComponent).join('/');
    const response=await fetch(url,{signal:AbortSignal.timeout(30000),redirect:'error'});
    return receiveResponse(response, name);
  }
  function bytes(id){return fs.readFileSync(path.join(folder,id));}
  async function send(chatId,attachment){
    const form=new FormData();form.set('chat_id',chatId);
    const extension=path.extname(attachment.name).toLowerCase();
    const [field,method]=({'.ogg':['voice','sendVoice'],'.mp4':['video','sendVideo'],'.jpg':['photo','sendPhoto'],'.jpeg':['photo','sendPhoto'],'.png':['photo','sendPhoto']})[extension]||['document','sendDocument'];
    form.set(field,new Blob([bytes(attachment.id)]),attachment.name);
    const response=await fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',body:form,signal:AbortSignal.timeout(45000)});
    if(!response.ok)throw Error('Telegram отклонил отправку документа ('+response.status+').');
  }
  return {receive,receiveResponse,persist,bytes,send};
}
module.exports={createDialogFiles,maxSize};
