import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const root=process.argv[2],port=Number(process.argv[3]);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.mp3':'audio/mpeg'};
createServer(async(req,res)=>{try{let p=decodeURIComponent((req.url??'/').split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=normalize(join(root,p));if(!f.startsWith(normalize(root))){res.statusCode=403;res.end();return;}const s=await stat(f);if(!s.isFile())throw 0;const b=await readFile(f);res.setHeader('content-type',types[extname(f)]??'application/octet-stream');res.end(b);}catch{try{res.setHeader('content-type','text/html; charset=utf-8');res.end(await readFile(join(root,'index.html')));}catch{res.statusCode=404;res.end('not found');}}}).listen(port,'127.0.0.1',()=>console.log('static '+port));
