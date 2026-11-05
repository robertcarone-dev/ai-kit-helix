#!/usr/bin/env node
import {readFileSync, writeFileSync, readdirSync, existsSync, lstatSync, realpathSync, mkdirSync, renameSync, unlinkSync, chmodSync, readlinkSync, symlinkSync} from 'node:fs';
import {resolve, dirname, relative, join, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const manifestPath = 'Tools/Helix/toolkit-install.json';
function walk(dir) {
  return readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e => {
    if(e.name.startsWith('.') || e.name==='__pycache__') return [];
    if(e.isSymbolicLink()) throw new Error(`Source symlink is not distributable: ${dir}/${e.name}`);
    return e.isDirectory() ? walk(join(dir,e.name)) : [join(dir,e.name)];
  });
}
function safe(root, path) {
  if(!path || resolve(root,path)===root || isAbsolute(path) || relative(root,resolve(root,path)).split(/[\\/]/).includes('..')) throw new Error(`Unsafe install path: ${path}`);
  const dest=resolve(root,path);
  for(let p=dirname(dest); p!==root; p=dirname(p)) {
    if(existsSync(p) && (lstatSync(p).isSymbolicLink() || !lstatSync(p).isDirectory())) throw new Error(`Destination parent must be a real directory: ${p}`);
  }
  return dest;
}
function current(path) {
  let st;try {st=lstatSync(path);} catch(e) {if(e.code==='ENOENT')return null;throw e;}
  if(st.isSymbolicLink()) return {type:'link', target:readlinkSync(path)};
  if(!st.isFile()) throw new Error(`Expected a file: ${path}`);
  return {type:'file', sha256:hash(readFileSync(path))};
}
function same(a,b) { return JSON.stringify(a)===JSON.stringify(b); }
export function run(argv) {
  const command=argv.shift();
  if(!['preview','install','update','remove'].includes(command)) throw new Error('Usage: node scripts/install.mjs preview|install|update|remove --project-root DIR [--rules helix|all|none] [--adopt-legacy] [--init] [--copy-skills] [--unity-helper]');
  let project, rules, adopt=false, init=false, copies=false, unityHelper=false;
  while(argv.length) {
    const a=argv.shift();
    if(a==='--project-root')project=argv.shift();
    else if(a==='--rules')rules=argv.shift();
    else if(a==='--adopt-legacy')adopt=true;
    else if(a==='--init')init=true;
    else if(a==='--copy-skills')copies=true;
    else if(a==='--unity-helper')unityHelper=true;
    else throw new Error(`Unknown option ${a}`);
  }
  if(!project)throw new Error('--project-root is required');
  const root=realpathSync(resolve(project));
  const mp=safe(root,manifestPath), previous=existsSync(mp)?read(mp):null;
  if(current(mp)?.type==='link')throw new Error('Manifest must not be a symlink');
  if(previous && previous.schemaVersion!==1)throw new Error('Unsupported install manifest');
  rules??=previous?.rules??'none';
  copies= copies || previous?.copySkills===true;
  unityHelper = unityHelper || previous?.unityHelper===true;
  if(unityHelper && command!=='remove') {
    const packages=safe(root,'Packages/manifest.json');
    if(!existsSync(packages) || !read(packages).dependencies?.['com.unity.nuget.newtonsoft-json']) throw new Error('Unity helper requires an existing com.unity.nuget.newtonsoft-json dependency; no packages were changed.');
  }
  if(!['helix','all','none'].includes(rules))throw new Error('Invalid rule selection');
  if(command==='update'&&!previous)throw new Error('No installation to update');
  const pkg=read(join(source,'package.json')), desired={}, contents={};
  function add(path, bytes) {contents[path]=bytes;desired[path]={type:'file',sha256:hash(bytes)};}
  function tree(from,to) {for(const file of walk(join(source,from)))add(`${to}/${relative(join(source,from),file)}`,readFileSync(file));}
  if(command!=='remove') {
    if(unityHelper)tree('unity/Editor','Assets/HelixComparison/Editor');
    tree('cli/src','Tools/Helix/src');tree('cli/bin','Tools/Helix/bin');
    for(const name of ['workflow.py','evidence_utils.py','capture.py','delivery.py'])add('Tools/Helix/'+name,readFileSync(join(source,'workflows',name)));
    for(const [src,dest] of [['cli.md','Toolkit.md'],['ui.md','UI.md'],['workflows.md','WorkflowToolkit.md'],['project-adapter.md','Adapter.md'],['migration.md','Migration.md']])add(`Tools/Helix/${dest}`,readFileSync(join(source,'docs',src)));
    const installed={...pkg,scripts:{'install-browser':'playwright install chromium'}};
    add('Tools/Helix/package.json',Buffer.from(JSON.stringify(installed,null,2)+'\n'));
    add('Tools/Helix/package-lock.json',readFileSync(join(source,'package-lock.json')));
    tree('skills','.claude/skills');
    for(const skill of readdirSync(join(source,'skills')).sort()) {
      if(copies)tree(`skills/${skill}`,`.agents/skills/${skill}`);
      else desired[`.agents/skills/${skill}`]={type:'link',target:`../../.claude/skills/${skill}`};
    }
    if(rules!=='none')tree('rules/helix','.aikit/rules');
    if(rules==='all')tree('rules/ai-kit-workflows','.aikit/rules');
  }
  const legacy=adopt?read(join(source,'scripts/legacy-hashes.json')):{};
  const changes=[], conflicts=[];
  for(const path of [...new Set([...Object.keys(previous?.files??{}),...Object.keys(desired)])].sort()) {
    const dest=safe(root,path), now=current(dest), old=previous?.files[path], next=desired[path];
    if(same(now,next))continue;
    const accepted=(!now || (old && same(now,old)) || (now.type==='file'&&legacy[path]===now.sha256));
    if(!accepted){conflicts.push(path);continue;}
    changes.push({path,action:next?'write':'remove',before:now,after:next});
  }
  const seeds=[];
  if(init&&command!=='remove') {
    for(const name of ['reference.json','project-adapter.md']) {
      const path=`Tools/Helix/${name}`,dest=safe(root,path);
      if(!current(dest))seeds.push({path,bytes:readFileSync(join(source,'templates',name))});
    }
  }
  const sourceHash=hash(JSON.stringify(desired));
  const report={command,projectRoot:root,version:pkg.version,sourceHash,rules,unityHelper,changes:changes.map(({path,action,before,after})=>({path,action,before,after})),createdProjectFiles:seeds.map(x=>x.path),conflicts};
  if(command==='preview')return report;
  if(conflicts.length)throw new Error(`Locally modified or unmanaged files conflict; nothing written: ${conflicts.join(', ')}`);
  if(changes.length && existsSync(join(root,'.helix/connection.json')))throw new Error('An owned browser session may be active. Stop it before replacing the runtime.');
  // Complete validation before writing. A failed partial install leaves old manifest hashes,
  // so subsequent updates refuse unexpected bytes instead of silently accepting them.
  for(const change of changes) {
    const dest=safe(root,change.path);
    if(!same(current(dest),change.before))throw new Error(`File changed during installation: ${change.path}`);
    if(!change.after) {if(current(dest))unlinkSync(dest);continue;}
    mkdirSync(dirname(dest),{recursive:true});
    if(change.after.type==='link'){if(current(dest))unlinkSync(dest);symlinkSync(change.after.target,dest);}
    else {
      const temp=dest+`.install-${process.pid}`;writeFileSync(temp,contents[change.path],{flag:'wx'});renameSync(temp,dest);
      if(change.path==='Tools/Helix/bin/helix')chmodSync(dest,0o755);
    }
  }
  for(const seed of seeds){const dest=safe(root,seed.path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,seed.bytes,{flag:'wx'});}
  if(command==='remove'){if(previous)unlinkSync(mp);}
  else {
    const manifest={schemaVersion:1,name:pkg.name,version:pkg.version,sourceHash,rules,copySkills:copies,unityHelper,files:desired};
    mkdirSync(dirname(mp),{recursive:true});const temp=mp+`.install-${process.pid}`;writeFileSync(temp,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});renameSync(temp,mp);
  }
  return report;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(run(process.argv.slice(2)),null,2));}catch(e){console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=1;}
}
