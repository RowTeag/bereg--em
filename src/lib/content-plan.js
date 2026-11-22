'use strict';

const fs=require('./runtime-fs');
const path=require('node:path');
const crypto=require('node:crypto');

function mountContentPlan(app,{directory}){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const file=path.join(directory,'content-plan.json');
  let items=[];
  try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));items=Array.isArray(saved)?saved:[];}catch(error){if(error.code!=='ENOENT')throw error;}
  const save=()=>{fs.writeFileSync(file+'.tmp',JSON.stringify(items),{mode:0o600});fs.renameSync(file+'.tmp',file);};
  const clean=input=>{
    const item={title:String(input.title||'').trim().slice(0,120),text:String(input.text||'').trim().slice(0,5000),platform:String(input.platform||'instagram'),format:String(input.format||'post'),scheduledAt:String(input.scheduledAt||''),status:String(input.status||'draft')};
    if(!item.title)throw Error('Добавьте название публикации.');
    if(!['instagram','facebook','telegram','youtube','tiktok'].includes(item.platform))throw Error('Выберите площадку.');
    if(!['post','story','video','short','reel'].includes(item.format))throw Error('Выберите формат.');
    if(item.scheduledAt&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(item.scheduledAt)||!Number.isFinite(Date.parse(item.scheduledAt))))throw Error('Проверьте дату и время публикации.');
    if(!['draft','planned','published'].includes(item.status))throw Error('Неизвестный статус публикации.');
    return item;
  };
  app.get('/api/content-plan',(req,res)=>res.json({items:[...items].sort((a,b)=>String(a.scheduledAt||'9999').localeCompare(String(b.scheduledAt||'9999')))}));
  app.post('/api/content-plan',(req,res)=>{try{const item={id:crypto.randomUUID(),...clean(req.body),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),createdBy:req.panelUser?.id||''};items.push(item);save();res.status(201).json({item});}catch(error){res.status(400).json({error:error.message});}});
  app.put('/api/content-plan/:id',(req,res)=>{const item=items.find(row=>row.id===req.params.id);if(!item)return res.sendStatus(404);try{Object.assign(item,clean(req.body),{updatedAt:new Date().toISOString()});save();res.json({item});}catch(error){res.status(400).json({error:error.message});}});
  app.delete('/api/content-plan/:id',(req,res)=>{const index=items.findIndex(row=>row.id===req.params.id);if(index<0)return res.sendStatus(404);items.splice(index,1);save();res.json({ok:true});});
}

module.exports={mountContentPlan};
