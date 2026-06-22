import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
const rootArg=args.find(a=>a.startsWith('--root='));
const root=path.resolve(rootArg?rootArg.slice(7):path.join(here,'..'));
const lintOnly=args.includes('--lint');
const errors=[];
const warnings=[];
const required=['index.html','admin.html','admin-rules.html','admin-groups.html','admin-teams.html','admin-players.html','admin-matches.html','admin-articles.html','admin-photos.html','admin-reports.html','admin-customize.html','print.html','404.html','assets/css/styles.css','assets/js/ux-a11y.js'];
for(const rel of required){if(!fs.existsSync(path.join(root,rel)))errors.push(`File obbligatorio mancante: ${rel}`);}

const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  const full=path.join(dir,entry.name);
  if(entry.name==='node_modules'||entry.name==='.git'||entry.name==='dist')return [];
  return entry.isDirectory()?walk(full):[full];
});
const files=fs.existsSync(root)?walk(root):[];
const htmlFiles=files.filter(f=>f.endsWith('.html'));
const jsFiles=files.filter(f=>f.endsWith('.js'));

for(const file of htmlFiles){
  const rel=path.relative(root,file);
  const html=fs.readFileSync(file,'utf8');
  const checks=[
    [/<!doctype html>/i,'doctype'],[/<html[^>]+lang="it"/i,'lang="it"'],[/name="viewport"/i,'viewport'],[/name="theme-color"/i,'theme-color'],[/class="skip-link"/i,'skip link'],[/<main\b/i,'main landmark'],[/assets\/css\/styles\.css\?v=[a-z0-9-]+/i,'versioned stylesheet'],[/assets\/js\/ux-a11y\.js\?v=[a-z0-9-]+/i,'UX accessibility runtime']
  ];
  for(const [re,label] of checks){if(!re.test(html))errors.push(`${rel}: ${label} mancante`);}
  const attr=/\b(?:src|href)="([^"]+)"/g;
  let match;
  while((match=attr.exec(html))){
    const ref=match[1].split('?')[0].split('#')[0];
    if(!ref||/^(?:https?:|data:|mailto:|tel:|javascript:)/i.test(ref))continue;
    const target=path.resolve(path.dirname(file),ref);
    if(!fs.existsSync(target))errors.push(`${rel}: riferimento locale mancante ${match[1]}`);
  }
}

for(const file of jsFiles){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0)errors.push(`${path.relative(root,file)}: sintassi JavaScript non valida\n${result.stderr.trim()}`);
}

const cssPath=path.join(root,'assets/css/styles.css');
if(fs.existsSync(cssPath)){
  const css=fs.readFileSync(cssPath,'utf8');
  const opens=(css.match(/{/g)||[]).length, closes=(css.match(/}/g)||[]).length;
  if(opens!==closes)errors.push(`assets/css/styles.css: parentesi graffe non bilanciate (${opens}/${closes})`);
  if(/transition\s*:\s*all\b/i.test(css))errors.push('assets/css/styles.css: transition: all ancora presente');
  if(!/prefers-reduced-motion/.test(css))errors.push('assets/css/styles.css: supporto prefers-reduced-motion mancante');
  if(!/scrollbar-gutter\s*:\s*stable/.test(css))warnings.push('scrollbar-gutter stabile non rilevato');
}

const forbiddenRoot=files.filter(f=>path.dirname(f)===root&&/\.(?:js|css)$/.test(f));
for(const file of forbiddenRoot)errors.push(`Asset legacy duplicato nella root: ${path.basename(file)}`);

const hashes=new Map();
for(const file of files.filter(f=>/\.(?:js|css|png|jpg|jpeg)$/i.test(f))){
  const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const list=hashes.get(hash)||[];list.push(path.relative(root,file));hashes.set(hash,list);
}
for(const list of hashes.values())if(list.length>1)warnings.push(`File identici: ${list.join(', ')}`);

const summary={root,html:htmlFiles.length,js:jsFiles.length,errors:errors.length,warnings:warnings.length,mode:lintOnly?'lint':'test'};
console.log(JSON.stringify(summary,null,2));
for(const warning of warnings)console.warn(`WARN: ${warning}`);
for(const error of errors)console.error(`ERROR: ${error}`);
if(errors.length)process.exit(1);
