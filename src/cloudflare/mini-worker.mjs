const CRM_ORIGIN='https://bereg-crm.smm-panel.workers.dev';

export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/api'||url.pathname.startsWith('/api/')){
   const target=new URL(url.pathname+url.search,CRM_ORIGIN),headers=new Headers(request.headers);headers.delete('host');
   headers.set('Origin',url.origin);
   const upstream=new Request(target,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:'manual'});
   return env.CRM.fetch(upstream);
  }
  const assetPath=url.pathname==='/'||url.pathname==='/mini-crm'?'/mini.html':url.pathname==='/login'?'/login.html':url.pathname;
  const assetUrl=new URL(assetPath+url.search,CRM_ORIGIN),headers=new Headers(request.headers);headers.delete('host');
  const response=await env.CRM.fetch(new Request(assetUrl,{method:request.method,headers,redirect:'manual'}));
  const outHeaders=new Headers(response.headers);outHeaders.set('Cache-Control','no-store, max-age=0');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:outHeaders});
 }
};
