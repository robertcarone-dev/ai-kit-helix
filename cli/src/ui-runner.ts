import {isolatedWorkspace} from './isolation.ts';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,openSync,closeSync,unlinkSync,realpathSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {emptyOutput} from './config.ts';
import {compareUI,validateSpec,loadSnapshot} from './ui.ts';

export function runCommand(executable:string,args:string[],cwd:string,timeoutMs=90000,env:NodeJS.ProcessEnv=process.env):Promise<any>{return new Promise((done,reject)=>{
 const started=Date.now(),child=spawn(executable,args,{cwd,env,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});let stdout='',stderr='',failure:string|null=null,killTimer:any;
 const kill=(signal:NodeJS.Signals)=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch{}};
 const terminate=(reason:string)=>{if(failure)return;failure=reason;kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),2000);};
 const timer=setTimeout(()=>terminate('Command timeout; remote work may still be active.'),timeoutMs);
 child.stdout.on('data',b=>{stdout+=b;if(stdout.length>8_000_000)terminate('Command output limit exceeded.');});child.stderr.on('data',b=>{stderr+=b;if(stderr.length>1_000_000)terminate('Command error output limit exceeded.');});
 child.on('error',e=>{clearTimeout(timer);clearTimeout(killTimer);reject(e);});
 child.on('close',code=>{clearTimeout(timer);clearTimeout(killTimer);const record={executable,args,exitCode:code,stdout:stdout.slice(0,8_000_000),stderr:stderr.slice(0,1_000_000),elapsedMs:Date.now()-started};if(failure||code!==0){const e:any=new Error(failure??`Command exited ${code}: ${stderr.slice(-2000)}`);e.record=record;reject(e);}else done(record);});
 });}
function inside(root:string,path:string){const r=relative(root,path);return r!==''&&!r.startsWith('..')&&!isAbsolute(r);}
export async function runMatrix(options:any,command=runCommand){
 const {root,cli,specPath}=options;
 const spec=JSON.parse(readFileSync(specPath,'utf8'));
 const config=JSON.parse(readFileSync(join(root,'Tools/Helix/reference.json'),'utf8'));
 // Local overrides are part of execution, so plan with the same effective config as the CLI.
 const local=join(root,'Tools/Helix/reference.local.json');const override=existsSync(local)?JSON.parse(readFileSync(local,'utf8')):{};Object.assign(config,override);
 if(spec.schemaVersion!==1||!Array.isArray(spec.cases)||!spec.cases.length)throw new Error('Matrix needs schemaVersion:1 and nonempty cases.');
 const out=resolve(options.out),scratch=join(root,'.aikit/scratch');
 if(!inside(scratch,out))throw new Error('Matrix output must be below this checkout’s .aikit/scratch.');
 const ids=new Set();
 const cases=spec.cases.map((c:any)=>{if(!/^[A-Za-z0-9_-]+$/.test(c.id)||ids.has(c.id))throw new Error('Case IDs must be unique filename-safe names.');ids.add(c.id);if(!config.scenarios?.[c.scenario]?.unity||!config.viewports?.[c.viewport])throw new Error('Case requires a configured Unity recipe and viewport: '+c.id);if(c.safeArea!==undefined)throw new Error('Use safeAreaInsets with top/right/bottom/left pixel values.');if(c.safeAreaInsets&&(!['top','right','bottom','left'].every(k=>Number.isFinite(c.safeAreaInsets[k])&&c.safeAreaInsets[k]>=0)||Object.keys(c.safeAreaInsets).length!==4))throw new Error('Invalid safe-area insets.');if(typeof c.uiSpec!=='string')throw new Error('Case needs uiSpec path.');const uiSpec=resolve(root,c.uiSpec);validateSpec(JSON.parse(readFileSync(uiSpec,'utf8')));return {...c,uiSpec,out:join(out,c.id)};});
 if(options.execute===undefined)return {schemaVersion:1,execute:false,cases,notes:['Use --execute yes only in an idle isolated workspace. Recipes execute in preflight/prepare/capture/restore order.','No build or Production check. A failed restoration stops the matrix. Unsupported safe-area cases remain blocked.']};
 if(options.execute!=='yes')throw new Error('--execute must be yes, or omitted for a plan.');
 if(!isolatedWorkspace(root))throw new Error('Execution requires an isolated managed lane or opted-in linked worktree.');
 if(existsSync(join(root,'.helix/connection.json')))throw new Error('An existing browser session is owned elsewhere; stop it explicitly before the matrix.');
 // Reject symlinked output ancestors before starting either application.
 for(let p=out;p!==root;p=resolve(p,'..'))if(existsSync(p)&&!inside(realpathSync(root),realpathSync(p)))throw new Error('Output escapes the checkout through a symlink.');
 mkdirSync(join(root,'.helix'),{recursive:true});const lock=join(root,'.helix/ui-matrix.lock'),fd=openSync(lock,'wx',0o600),matrixToken=randomUUID();
 writeFileSync(fd,JSON.stringify({pid:process.pid,token:matrixToken}));
 let interrupted=false;const onSignal=()=>{interrupted=true;};process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
 const report:any={schemaVersion:1,cases:[],status:'running',startedAt:new Date().toISOString()};
 let created=false;
 try{emptyOutput(out);created=true;
 const save=()=>writeFileSync(join(out,'matrix.json'),JSON.stringify(report,null,2));save();
 for(const c of cases){if(interrupted)break;const row:any={id:c.id,scenario:c.scenario,viewport:c.viewport,status:'running',commands:[]};report.cases.push(row);mkdirSync(c.out);save();
 const invoke=async(executable:string,args:string[],stage:string)=>{try{const r=await command(executable,args,root,90000,{...process.env,HELIX_MATRIX_TOKEN:matrixToken});let payload;try{payload=JSON.parse(r.stdout);}catch{}if(payload?.success===false||payload?.ok===false){const e:any=new Error('Command returned a failure response.');e.record=r;throw e;}row.commands.push({stage,...r});save();return r;}catch(e){row.commands.push({stage,error:String(e),...(e as any).record});save();throw e;}};
 const helix=(args:string[],stage:string)=>invoke(process.execPath,[cli,...args,'--project-root',root],stage);
 let browserAttempted=false,prepareAttempted=false,plan:any,restoreFailed=false;
 try{
 if(c.safeAreaInsets&&Object.values(c.safeAreaInsets).some((v:any)=>v!==0)&&!['top','right','bottom','left'].every(k=>config.scenarios[c.scenario].safeAreaInsets?.[k]===c.safeAreaInsets[k]))throw new Error('The scenario has no matching device capture recipe for these safe-area insets.');
 const planned=await helix(['unity-plan',c.scenario,'--viewport',c.viewport,'--out',join(c.out,'unity')],'plan');plan=JSON.parse(planned.stdout);
 for(const stage of ['preflight','prepare','capture','restore'])if(!Array.isArray(plan.stages[stage])||!plan.stages[stage].length||plan.stages[stage].some((a:any)=>!Array.isArray(a)||a.some((v:any)=>typeof v!=='string')))throw new Error('Incomplete Unity lifecycle recipe: '+stage);
 mkdirSync(join(c.out,'unity'),{recursive:true});
 for(const argv of plan.stages.preflight)await invoke(options.aiKit??'ai-kit',argv,'preflight');
 browserAttempted=true;await helix(['start','--viewport',c.viewport],'reference-start');await helix(['scenario',c.scenario],'reference-scenario');await helix(['capture',c.id,'--out',join(c.out,'reference')],'reference-capture');
 prepareAttempted=true;for(const argv of plan.stages.prepare){if(interrupted)throw new Error('Interrupted');await invoke(options.aiKit??'ai-kit',argv,'prepare');}
 for(const argv of plan.stages.capture)await invoke(options.aiKit??'ai-kit',argv,'capture');
 if(c.safeAreaInsets){const v=config.viewports[c.viewport],i=c.safeAreaInsets,expected={x:i.left,y:i.top,width:v.width-i.left-i.right,height:v.height-i.top-i.bottom};for(const receipt of ['reference/reference.json','unity/unity.json']){const actual=loadSnapshot(join(c.out,receipt)).ui.safeArea;if(!Object.entries(expected).every(([key,value])=>actual?.[key]===value))throw new Error('Captured safe area does not match the requested device case.');}}
 row.comparison=compareUI(join(c.out,'reference/reference.json'),join(c.out,'unity/unity.json'),c.uiSpec,join(c.out,'review'));row.status=row.comparison.status;
 }catch(e){row.status='blocked';row.error=String(e);}
 finally {
 if(prepareAttempted){row.restoration=[];for(const argv of plan.stages.restore){try{await invoke(options.aiKit??'ai-kit',argv,'restore');row.restoration.push({argv,status:'completed'});}catch(e){row.restoration.push({argv,status:'failed',error:String(e)});restoreFailed=true;}}}
 if(browserAttempted){try{await helix(['stop'],'reference-stop');}catch(e){row.browserCleanupError=String(e);restoreFailed=true;}}
 if(restoreFailed){row.status='blocked';row.cleanupFailed=true;}save();
 }
 if(restoreFailed||interrupted)break;
 }
 report.status=report.cases.some((c:any)=>c.status==='blocked')||report.cases.length!==cases.length?'blocked':report.cases.some((c:any)=>c.status==='difference')?'difference':report.cases.some((c:any)=>c.status==='unmeasured')?'unmeasured':'passed';
 report.notRun=cases.filter((c:any)=>!report.cases.some((r:any)=>r.id===c.id)).map((c:any)=>c.id);save();return {status:report.status,out,cases:report.cases.map(({id,status}:any)=>({id,status})),notRun:report.notRun};
 }catch(e){report.status='blocked';report.error=String(e);if(created)writeFileSync(join(out,'matrix.json'),JSON.stringify(report,null,2));throw e;}
 finally{closeSync(fd);unlinkSync(lock);process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);}
}
