import express from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=dirname(fileURLToPath(import.meta.url));
const app=express();
const port=Number(process.env.PORT||3000);
const helpDir=join(__dirname,'public','help');

const helpPage=(_req,res)=>res.type('html').send(readFileSync(join(helpDir,'index.html'),'utf8'));

app.get('/health',(_req,res)=>res.json({ok:true,service:'public-help-center',version:'0.9-docs'}));
app.get('/',(_req,res)=>res.redirect(302,'/help'));
app.get('/help',helpPage);
app.get('/help/',helpPage);
app.get('/help/profile/:role',helpPage);
app.get('/help/article/:slug',helpPage);
app.get('/help/error/:code',helpPage);
app.use('/help',express.static(helpDir,{index:false,fallthrough:true}));

app.use((_req,res)=>res.status(404).type('html').send(readFileSync(join(helpDir,'index.html'),'utf8')));

app.listen(port,'0.0.0.0',()=>console.log(`Business & Life public Help Center listening on ${port}`));
