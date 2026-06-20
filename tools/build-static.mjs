import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const out=path.join(root,'dist');
const validation=spawnSync(process.execPath,[path.join(here,'validate-project.mjs')],{stdio:'inherit'});
if(validation.status!==0)process.exit(validation.status||1);
fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});
const entries=fs.readdirSync(root,{withFileTypes:true});
for(const entry of entries){
  if(['dist','tools','node_modules','.git','UX_REVIEW_REPORT.md','package.json'].includes(entry.name))continue;
  const source=path.join(root,entry.name),target=path.join(out,entry.name);
  if(entry.isDirectory())fs.cpSync(source,target,{recursive:true});
  else fs.copyFileSync(source,target);
}
const productionValidation=spawnSync(process.execPath,[path.join(here,'validate-project.mjs'),`--root=${out}`],{stdio:'inherit'});
if(productionValidation.status!==0)process.exit(productionValidation.status||1);
console.log(`Build statico creato in ${out}`);
