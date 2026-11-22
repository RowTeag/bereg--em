const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path');
const {createFacebookAuth}=require('../lib/facebook-auth');

test('Facebook OAuth exchanges, stores and refreshes a managed Page token',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'facebook-auth-'));
 let exchanges=0;
 const fetchImpl=async url=>{
  const parsed=new URL(url);
  if(parsed.pathname.endsWith('/oauth/access_token')&&parsed.searchParams.has('code'))return Response.json({access_token:'short-user-token'});
  if(parsed.pathname.endsWith('/oauth/access_token')){exchanges++;return Response.json({access_token:`long-user-token-${exchanges}`,expires_in:5184000});}
  if(parsed.pathname.endsWith('/me/accounts'))return Response.json({data:[{id:'123456789',name:'BEREG Page',access_token:`page-token-${exchanges}`,tasks:['CREATE_CONTENT']} ]});
  return Response.json({error:{message:'Unexpected request'}},{status:400});
 };
 try{
  const auth=createFacebookAuth({directory,graphVersion:'v26.0',redirectUri:'http://localhost:3000/api/facebook/oauth/callback',env:{FACEBOOK_PAGE_ID:'123456789'},fetchImpl});
  auth.saveAppConfig({appId:'987654321',appSecret:'secret-value'});
  const loginUrl=new URL(auth.begin('owner-id'));
  assert(loginUrl.searchParams.get('scope').includes('pages_manage_posts'));
  assert(loginUrl.searchParams.get('scope').includes('pages_messaging'));
  assert(loginUrl.searchParams.get('scope').includes('pages_manage_metadata'));
  const connected=await auth.complete({code:'oauth-code',state:loginUrl.searchParams.get('state'),userId:'owner-id'});
  assert.equal(connected.pageId,'123456789');
  assert.equal(connected.accessToken,'page-token-1');
  assert.equal(connected.managed,true);
  assert.equal(auth.publicConfig().appSecretConfigured,true);
  assert.equal(auth.publicConfig().appSecret,undefined);
  await auth.refresh(true);
  assert.equal(auth.peek().accessToken,'page-token-2');
  const stored=fs.readFileSync(path.join(directory,'facebook-oauth.json'),'utf8');
  assert(stored.includes('page-token-2'));
  assert.equal(fs.statSync(path.join(directory,'facebook-oauth.json')).mode&0o777,0o600);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
