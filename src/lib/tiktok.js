'use strict';

const fs=require('./runtime-fs');
const path=require('path');
const crypto=require('crypto');
const express=require('express');
const multer=require('multer');

const API='https://open.tiktokapis.com/v2';
const MIB=1024*1024;
const MAX_VIDEO=90*MIB;

function createTikTok({appRoot, directory, env=process.env, fetchImpl=fetch}){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'config.json');
  const read=()=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {};}};
  let config={clientKey:'',clientSecret:'',accessToken:'',refreshToken:'',openId:'',scope:'',accessExpiresAt:0,refreshExpiresAt:0,creator:null,states:{},jobs:[],...read()};
  config.states ||= {};config.jobs ||= [];
  const save=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(config,null,2),{mode:0o600});fs.renameSync(file+'.tmp',file);};
  if(!fs.existsSync(file))save();
  const redirectUri=()=>String(env.TIKTOK_REDIRECT_URI||`${String(env.BEREG_PUBLIC_URL||env.APP_BASE_URL||'https://bereg-crm.smm-panel.workers.dev').replace(/\/$/,'')}/api/tiktok/oauth/callback`);
  const owner=(req,res,next)=>req.panelUser?.role==='superadmin'?next():res.status(403).json({error:'Настройки TikTok доступны только суперадминистратору.'});
  const authorized=()=>Boolean(config.clientKey&&config.clientSecret&&config.accessToken&&config.refreshToken);
  const configured=()=>Boolean(config.clientKey&&config.clientSecret);
  const safeJob=job=>({publishId:job.publishId,mode:job.mode,title:job.title,createdAt:job.createdAt,status:job.status||'SUBMITTED',failReason:job.failReason||''});
  function status(){return{appConfigured:configured(),clientKey:config.clientKey||'',connected:authorized(),redirectUri:redirectUri(),username:config.creator?.creator_username||'',nickname:config.creator?.creator_nickname||'',avatarUrl:config.creator?.creator_avatar_url||'',scope:config.scope,accessExpiresAt:config.accessExpiresAt||null,refreshExpiresAt:config.refreshExpiresAt||null,jobs:config.jobs.slice(0,20).map(safeJob)};}
  async function api(pathname,{method='POST',token,body,headers={}}={}){
    const response=await fetchImpl(`${API}${pathname}`,{method,headers:{'Content-Type':'application/json; charset=UTF-8',...(token?{Authorization:`Bearer ${token}`}:{ }),...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
    const data=await response.json().catch(()=>null);
    if(!response.ok||data?.error?.code&&data.error.code!=='ok')throw new Error(data?.error?.message||data?.error_description||`TikTok API вернул HTTP ${response.status}${data?.error?.code?` (${data.error.code})`:''}.`);
    return data;
  }
  async function exchange(form){
    const response=await fetchImpl('https://open.tiktokapis.com/v2/oauth/token/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(form),signal:AbortSignal.timeout(30000)});
    const data=await response.json().catch(()=>null);
    if(!response.ok||data?.error)throw new Error(data?.error_description||data?.error||`TikTok OAuth вернул HTTP ${response.status}.`);
    return data;
  }
  async function refreshIfNeeded(force=false){
    if(!authorized())throw new Error('Сначала подключите TikTok в разделе настроек.');
    if(!force&&Date.now()<Number(config.accessExpiresAt||0)-5*60*1000)return config.accessToken;
    if(Date.now()>=Number(config.refreshExpiresAt||0))throw new Error('Срок подключения TikTok истёк. Подключите аккаунт заново.');
    const result=await exchange({client_key:config.clientKey,client_secret:config.clientSecret,grant_type:'refresh_token',refresh_token:config.refreshToken});
    config={...config,accessToken:result.access_token,refreshToken:result.refresh_token||config.refreshToken,openId:result.open_id||config.openId,scope:result.scope||config.scope,accessExpiresAt:Date.now()+Number(result.expires_in||0)*1000,refreshExpiresAt:Date.now()+Number(result.refresh_expires_in||0)*1000};
    save();return config.accessToken;
  }
  async function creatorInfo(){
    const token=await refreshIfNeeded();
    const result=await api('/post/publish/creator_info/query/',{token});
    config.creator=result.data||{};save();return config.creator;
  }
  function mimeFor(file){
    const ext=path.extname(file.originalname||'').toLowerCase();
    const map={'.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm'};
    return map[ext]||'';
  }
  async function uploadFile(uploadUrl,buffer,mime){
    let parsed;try{parsed=new URL(uploadUrl);}catch{throw new Error('TikTok вернул некорректный адрес загрузки.');}
    if(parsed.protocol!=='https:'||parsed.hostname!=='open-upload.tiktokapis.com')throw new Error('TikTok вернул недоверенный адрес загрузки.');
    const chunkSize=Math.min(64*MIB,buffer.length);
    const chunks=Math.ceil(buffer.length/chunkSize);
    for(let index=0;index<chunks;index++){
      const start=index*chunkSize,end=Math.min(start+chunkSize,buffer.length)-1;
      const chunk=buffer.subarray(start,end+1);
      const response=await fetchImpl(uploadUrl,{method:'PUT',headers:{'Content-Type':mime,'Content-Range':`bytes ${start}-${end}/${buffer.length}`},body:chunk,signal:AbortSignal.timeout(5*60*1000)});
      if(!response.ok)throw new Error(`Не удалось передать видео в TikTok (HTTP ${response.status}).`);
    }
    return{chunkSize,chunks};
  }
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_VIDEO,files:1},fileFilter:(req,file,done)=>mimeFor(file)?done(null,true):done(new Error('Поддерживаются только видео MP4, MOV и WEBM.'))});
  function mount(app){
    app.get('/api/tiktok/status',(req,res)=>res.json(status()));
    app.get('/api/tiktok/creator',async(req,res)=>{try{res.json({creator:await creatorInfo()});}catch(error){res.status(502).json({error:error.message});}});
    app.put('/api/tiktok/config',owner,(req,res)=>{
      const clientKey=String(req.body.clientKey||'').trim();
      const clientSecret=String(req.body.clientSecret||'').trim();
      if(clientKey.length<5||clientKey.length>200) return res.status(400).json({error:'Проверьте Client Key TikTok.'});
      if(clientSecret&&clientSecret.length>300)return res.status(400).json({error:'Проверьте Client Secret TikTok.'});
      const nextSecret=clientSecret||config.clientSecret;
      const credentialsChanged=clientKey!==config.clientKey||nextSecret!==config.clientSecret;
      config.clientKey=clientKey;config.clientSecret=nextSecret;
      if(!config.clientSecret)return res.status(400).json({error:'Укажите Client Secret из TikTok for Developers.'});
      if(credentialsChanged){config.accessToken='';config.refreshToken='';config.openId='';config.scope='';config.accessExpiresAt=0;config.refreshExpiresAt=0;config.creator=null;}
      save();res.json({ok:true,status:status()});
    });
    app.get('/api/tiktok/connect',owner,(req,res)=>{
      if(!configured())return res.status(400).send('Сначала сохраните Client Key и Client Secret в настройках TikTok CRM.');
      const state=crypto.randomBytes(32).toString('base64url');
      config.states[state]=Date.now()+10*60*1000;for(const [key,expires] of Object.entries(config.states))if(expires<Date.now())delete config.states[key];save();
      const url=new URL('https://www.tiktok.com/v2/auth/authorize/');
      url.searchParams.set('client_key',config.clientKey);url.searchParams.set('response_type','code');url.searchParams.set('scope','user.info.basic,video.publish,video.upload');url.searchParams.set('redirect_uri',redirectUri());url.searchParams.set('state',state);
      res.redirect(url.toString());
    });
    app.get('/api/tiktok/oauth/callback',async(req,res)=>{
      const state=String(req.query.state||''),expires=config.states[state];delete config.states[state];save();
      if(!state||!expires||expires<Date.now())return res.status(400).send('Запрос подключения TikTok истёк. Вернитесь в CRM и начните подключение заново.');
      if(req.query.error)return res.status(400).send(`TikTok не разрешил подключение: ${String(req.query.error_description||req.query.error).slice(0,300)}`);
      try{
        const token=await exchange({client_key:config.clientKey,client_secret:config.clientSecret,code:String(req.query.code||''),grant_type:'authorization_code',redirect_uri:redirectUri()});
        config={...config,accessToken:token.access_token,refreshToken:token.refresh_token,openId:token.open_id||'',scope:token.scope||'',accessExpiresAt:Date.now()+Number(token.expires_in||0)*1000,refreshExpiresAt:Date.now()+Number(token.refresh_expires_in||0)*1000};
        save();
        await creatorInfo().catch(()=>{});
        res.status(200).send('<!doctype html><meta charset="utf-8"><title>TikTok подключён</title><p style="font:16px system-ui;margin:3rem">TikTok подключён. Возвращаю вас в CRM…</p><script>setTimeout(()=>location.replace("/"),600)</script><a href="/">Вернуться в CRM</a>');
      }catch(error){res.status(502).send(`Не удалось подключить TikTok: ${String(error.message).replace(/[<>]/g,'')}`);}
    });
    app.post('/api/tiktok/publish',upload.single('video'),async(req,res)=>{
      try{
        if(!req.file)return res.status(400).json({error:'Выберите видео для публикации.'});
        if(req.file.size<1)return res.status(400).json({error:'Видео пустое.'});
        const mode=String(req.body.mode||'direct');if(!['direct','inbox'].includes(mode))return res.status(400).json({error:'Выберите способ публикации.'});
        const title=String(req.body.title||'').trim();if(title.length>2200)return res.status(400).json({error:'Подпись не должна превышать 2200 символов.'});
        const mime=mimeFor(req.file);if(!mime)return res.status(400).json({error:'Неподдерживаемый формат видео.'});
        const token=await refreshIfNeeded();
        let endpoint='/post/publish/inbox/video/init/';
        const sourceInfo={source:'FILE_UPLOAD',video_size:req.file.size,chunk_size:Math.min(64*MIB,req.file.size),total_chunk_count:Math.ceil(req.file.size/Math.min(64*MIB,req.file.size))};
        const body={source_info:sourceInfo};
        if(mode==='direct'){
          if(req.body.consent!=='true')return res.status(400).json({error:'Подтвердите отправку видео в TikTok.'});
          const creator=await creatorInfo();
          const privacy=String(req.body.privacy||'SELF_ONLY');
          if(!Array.isArray(creator.privacy_level_options)||!creator.privacy_level_options.includes(privacy))return res.status(400).json({error:'Выберите доступный для этого TikTok-аккаунта уровень приватности.'});
          endpoint='/post/publish/video/init/';
          body.post_info={title,privacy_level:privacy,disable_comment:req.body.disableComment==='true'||Boolean(creator.comment_disabled),disable_duet:req.body.disableDuet==='true'||Boolean(creator.duet_disabled),disable_stitch:req.body.disableStitch==='true'||Boolean(creator.stitch_disabled),brand_content_toggle:false,brand_organic_toggle:req.body.ownBusiness==='true',is_aigc:req.body.isAigc==='true'};
        }
        const initialized=await api(endpoint,{token,body});
        if(!initialized.data?.publish_id||!initialized.data?.upload_url)throw new Error('TikTok не вернул данные загрузки видео.');
        await uploadFile(initialized.data.upload_url,req.file.buffer,mime);
        const job={publishId:initialized.data.publish_id,mode,title,createdAt:new Date().toISOString(),status:mode==='inbox'?'PROCESSING_UPLOAD':'PROCESSING_UPLOAD'};
        config.jobs=[job,...config.jobs.filter(item=>item.publishId!==job.publishId)].slice(0,50);save();
        res.status(202).json({job:safeJob(job),message:mode==='inbox'?'Видео загружено. Откройте уведомление TikTok, чтобы отредактировать и опубликовать его.':'Видео отправлено в TikTok; публикация обрабатывается.'});
      }catch(error){res.status(502).json({error:error.message||'TikTok не принял видео.'});}
    });
    app.get('/api/tiktok/publish/:publishId',async(req,res)=>{
      const job=config.jobs.find(item=>item.publishId===req.params.publishId);if(!job)return res.status(404).json({error:'Публикация не найдена.'});
      try{
        const token=await refreshIfNeeded();
        const result=await api('/post/publish/status/fetch/',{token,body:{publish_id:job.publishId}});
        job.status=result.data?.status||job.status;job.failReason=result.data?.fail_reason||'';job.postIds=result.data?.publicaly_available_post_id||[];save();
        res.json({job:safeJob(job),postIds:job.postIds});
      }catch(error){res.status(502).json({error:error.message});}
    });
    app.delete('/api/tiktok/disconnect',owner,(req,res)=>{config.accessToken='';config.refreshToken='';config.openId='';config.scope='';config.accessExpiresAt=0;config.refreshExpiresAt=0;config.creator=null;save();res.json({ok:true,status:status()});});
  }
  return{mount,status,creatorInfo};
}

module.exports={createTikTok};
