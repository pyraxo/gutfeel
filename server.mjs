import {createServer} from 'node:http';
import {createReadStream, existsSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createGzip} from 'node:zlib';
import {pipeline} from 'node:stream';
import {attachMultiuser,MultiuserRelay} from './server/multiuser.mjs';
import {LobbyRegistry} from './server/lobbies.mjs';
import {clientAddress,serverConfiguration} from './server/config.mjs';
const root = path.resolve(fileURLToPath(new URL('./web/public/',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.css':'text/css','.pdf':'application/pdf','.mp3':'audio/mpeg','.wav':'audio/wav','.dir':'application/x-director','.dxr':'application/x-director','.dcr':'application/x-director'};
const compressible=new Set(['.dir','.dcr','.js','.json','.css','.html','.mjs','.wasm','.svg']);
const acceptsGzip=header=>{let wildcard=false;for(const part of String(header||'').toLowerCase().split(',')){const [encoding,...params]=part.trim().split(';');const q=Number((params.find(p=>p.trim().startsWith('q='))||'q=1').trim().slice(2));if(encoding==='gzip')return q>0;if(encoding==='*')wildcard=q>0;}return wildcard;};
const lingoString=value=>'"'+String(value).replace(/["\r\n\x00]/g,'').slice(0,100)+'"';
const json=(res,status,value)=>res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(value));
const bodyJson=async req=>{let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>4096)throw Object.assign(new Error('body_too_large'),{status:413,code:'body_too_large'});chunks.push(chunk);}if(!size)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('invalid_json'),{status:400,code:'invalid_json'});}};
const bearer=req=>{const value=String(req.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7):'';};
export function createGutFeelServer(options={}){
 const configuration=serverConfiguration(options);
 const {publicOrigin,sourceCodeUrl,trustedProxyAddresses}=configuration;
 const requestAddress=req=>clientAddress(req,trustedProxyAddresses);
 const legacySetting=process.env.GUTFEL_LEGACY_OPEN;
 const legacyOpen=options.legacyOpen??legacySetting==='1';
 const hosts=new Map();
 const lobbies=new LobbyRegistry({relayFactory:relayOptions=>new MultiuserRelay({...relayOptions,enforceSenderIdentity:true})});
 const registerAuthenticatedHost=(client,connection)=>{
  if(connection.mode!=='host')return;
  for(const [key,entry] of hosts){
   if(entry.subject.toLowerCase()===client.movie.toLowerCase()&&entry.name.toLowerCase()===client.name.toLowerCase())hosts.delete(key);
  }
  hosts.set(client.movie+'\0'+client.name,{subject:client.movie,name:client.name,seen:Date.now()});
 };
 const removeOwnedHostEntry=(client)=>{
  for(const [key,entry] of hosts){
   if(entry.subject.toLowerCase()===client.movie.toLowerCase()&&entry.name.toLowerCase()===client.name.toLowerCase())hosts.delete(key);
  }
 };
 const server=createServer(async(req,res)=>{
  let url,pathname;
  try {url=new URL(req.url,'http://localhost');pathname=decodeURIComponent(url.pathname);}catch {res.writeHead(400).end();return;}
  if(pathname==='/source'){
   if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
   if(sourceCodeUrl){res.writeHead(302,{'Location':sourceCodeUrl,'Cache-Control':'no-store'}).end();return;}
   const message='Corresponding source is this development working tree. Public deployments must set SOURCE_CODE_URL to the exact published source.\n';
   res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','Content-Length':Buffer.byteLength(message)});
   if(req.method==='HEAD')res.end();else res.end(message);
   return;
  }
  if(pathname.startsWith('/api/lobbies')){
   const requestOrigin=req.headers.origin;
   if(publicOrigin&&((req.method==='GET'&&requestOrigin&&requestOrigin!==publicOrigin)||(req.method!=='GET'&&requestOrigin!==publicOrigin))){json(res,403,{error:'origin_not_allowed'});return;}
   try{
    const parts=pathname.split('/').filter(Boolean);
    if(parts.length===2&&req.method==='POST'){
     if(!lobbies.checkRate('create',requestAddress(req),10,60*60*1000))throw lobbies.error(429,'rate_limited');
     await bodyJson(req);json(res,201,lobbies.create());return;
    }
    if(parts.length===3&&req.method==='GET'){
     if(req.headers.authorization)lobbies.authorize(parts[2],bearer(req));
     json(res,200,lobbies.snapshot(parts[2]));return;
    }
    if(parts.length===4&&parts[3]==='join'&&req.method==='POST'){
     if(!lobbies.checkRate('join',requestAddress(req),30,60*60*1000))throw lobbies.error(429,'rate_limited');
     await bodyJson(req);json(res,201,lobbies.join(parts[2]));return;
    }
    if(parts.length===4&&parts[3]==='start'&&req.method==='POST'){
     await bodyJson(req);json(res,200,lobbies.start(parts[2],bearer(req)));return;
    }
    if(parts.length===4&&parts[3]==='leave'&&req.method==='POST'){
     await bodyJson(req);lobbies.leave(parts[2],bearer(req));res.writeHead(204,{'Cache-Control':'no-store'}).end();return;
    }
    if(parts.length===4&&parts[3]==='remove'&&req.method==='POST'){
     const body=await bodyJson(req);lobbies.remove(parts[2],bearer(req),String(body.memberId||''));res.writeHead(204,{'Cache-Control':'no-store'}).end();return;
    }
    if(parts.length===4&&parts[3]==='end'&&req.method==='POST'){
     await bodyJson(req);lobbies.end(parts[2],bearer(req));res.writeHead(204,{'Cache-Control':'no-store'}).end();return;
    }
    json(res,req.method==='GET'||req.method==='POST'?404:405,{error:'not_found'});return;
   }catch(error){json(res,error.status||500,{error:error.code||'internal_error',...(error.snapshot?{snapshot:error.snapshot}:{})});return;}
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
  if(pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({status:'ok',hosts:hosts.size}));return;}
  if(pathname.startsWith('/legacy/MUI/')){
   if(publicOrigin&&req.headers.origin&&req.headers.origin!==publicOrigin){json(res,403,{error:'origin_not_allowed'});return;}
   const q=url.searchParams, subject=q.get('mymoviename')||'DS', name=q.get('myhostname')||'Host';
   const lobbyId=q.get('lobby'),credential=q.get('credential'),instance=q.get('instance');
   let entries;
   if(lobbyId){
    try{const grant=lobbies.connectionGrant(lobbyId,credential,instance);entries=lobbies.listHosts(grant,subject);}
    catch(error){json(res,error.status||401,{error:error.code||'invalid_credential'});return;}
    if(pathname.endsWith('/ipconfig.php')||pathname.endsWith('/ipdelete.php')){res.writeHead(405).end();return;}
   }else if(legacyOpen){
    if(pathname.endsWith('/ipconfig.php')) hosts.set(subject+'\0'+name,{subject,name,seen:Date.now()});
    if(pathname.endsWith('/ipdelete.php')) hosts.delete(subject+'\0'+name);
    entries=[...hosts.values()].filter(h=>h.subject===subject);
   }else{json(res,401,{error:'lobby_credential_required'});return;}
   // Same-origin WebSocket resolver chooses the physical endpoint; preserve the
   // three-column directory response consumed by the original getIPADD script.
   const data='['+entries.map(h=>'['+[h.name,h.subject,'localhost'].map(lingoString).join(',')+']').join(',')+']';
   res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'}).end(data);return;
  }
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if((file!==root&&!file.startsWith(root+path.sep))||pathname.includes('\0')||!existsSync(file)||!statSync(file).isFile()){res.writeHead(404).end('Not found');return;}
 const stat=statSync(file);
  const accepts=acceptsGzip(req.headers['accept-encoding']);
  const headers={'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Vary':'Accept-Encoding'};
  if(accepts&&compressible.has(path.extname(file).toLowerCase())) headers['Content-Encoding']='gzip'; else headers['Content-Length']=stat.size;
  res.writeHead(200,headers);
  if(req.method==='HEAD')res.end();else {const stream=createReadStream(file); if(headers['Content-Encoding']) pipeline(stream,createGzip({level:6}),res,()=>{}); else pipeline(stream,res,()=>{});}
 });
 const multiuser=attachMultiuser(server,{path:'/multiuser',onClientLogon:registerAuthenticatedHost,onClientClose:removeOwnedHostEntry,
  verifyOrigin:origin=>!publicOrigin||origin===publicOrigin,
  resolveConnection:request=>{const query=new URL(request.url||'/', 'ws://localhost').searchParams;const lobbyId=query.get('lobby');if(!lobbyId){if(legacyOpen)return null;throw lobbies.error(401,'lobby_credential_required');}const credential=query.get('credential');const instance=query.get('instance');const grant=lobbies.connectionGrant(lobbyId,credential,instance);return{relay:grant.lobby.relay,grant,instance};}});
 const sweep=setInterval(()=>{try{lobbies.sweep();}catch{}},30_000);sweep.unref?.();server.on('close',()=>clearInterval(sweep));
 return {server,multiuser,lobbies};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const {server}=createGutFeelServer();
  const port=Number(process.env.PORT)||4173;
  server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`Gut Feel: http://localhost:${port}`));
 }catch(error){console.error(`Gut Feel server configuration error: ${error.message}`);process.exitCode=1;}
}
