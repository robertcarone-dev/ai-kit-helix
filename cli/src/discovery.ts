import { existsSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { localUrl } from './config.ts';
const exec = promisify(execFile);
export function desktopLaunchEnvironment(env: NodeJS.ProcessEnv, accountHome: string): NodeJS.ProcessEnv {
  // A system-installed macOS app must find the account's existing catalog/keychain setup,
  // even when an agent's HOME and Foundation home are isolated for its own tools.
  return {...env, HOME:accountHome, CFFIXED_USER_HOME:accountHome};
}
export function serviceUrl(config: any) {
  const url = new URL(localUrl(process.env.HELIX_URL ?? config.helix?.url ?? `http://127.0.0.1:${process.env.HELIX_DESKTOP_PORT ?? 47600}`));
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('Helix service URL must be an origin, without a path/query.');
  return url.origin;
}
export async function getJson(url: string) {
  const response = await fetch(localUrl(url), {signal: AbortSignal.timeout(10000), redirect:'error'});
  if (!response.ok) throw new Error(`Helix returned HTTP ${response.status} for ${url}. Check local Helix setup/sign-in.`);
  return response.json();
}
export function selectProject(projects: any[], identity: any, origin: string) {
  if (!identity || typeof identity.project !== 'string' || typeof identity.variant !== 'string') throw new Error('Config needs helix.project (slug or exact name) and helix.variant (key or exact name).');
  const exact = projects.filter(p => p.slug === identity.project);
  const matches = exact.length ? exact : projects.filter(p => p.name === identity.project);
  if (matches.length !== 1) throw new Error(`Helix project ${identity.project} ${matches.length ? 'is ambiguous; use its slug' : 'was not found; pull it into local Helix'}.`);
  const project = matches[0];
  const keys = project.variants.filter((v:any) => v.key === identity.variant);
  const variants = keys.length ? keys : project.variants.filter((v:any) => v.name === identity.variant);
  if (variants.length !== 1) throw new Error(`Variant ${identity.variant} is missing or ambiguous. Available keys: ${project.variants.map((v:any)=>v.key).join(', ')}`);
  const variant = variants[0];
  const url = new URL(project.devUrl, origin);
  if (url.origin !== origin || !url.pathname.startsWith('/preview/')) throw new Error('Helix returned an invalid preview URL.');
  for (const [key,value] of Object.entries(identity.query ?? {})) url.searchParams.set(key,String(value));
  url.searchParams.set('variant',variant.key);
  return {project:project.slug,name:project.name,variant:variant.key,variantName:variant.name,sourceRoot:project.rootPath,variantDirectory:project.variantsDir,scenes:variant.scenes,serviceUrl:origin,url:localUrl(url.href),assetsUrl:`${origin}/api/projects/${encodeURIComponent(project.slug)}/assets`};
}
export async function discover(config: any, launch = false) {
  const origin = serviceUrl(config);
  let catalog: any;
  try { catalog = await getJson(origin+'/api/projects'); }
  catch (error) {
    // Only connection failures justify launching. Authentication/schema errors need attention.
    if (!launch || !(error instanceof TypeError) || !['ECONNREFUSED','ENOTFOUND'].includes((error.cause as any)?.code)) throw error;
    if (process.platform !== 'darwin') throw new Error(`Start local Helix at ${origin}, then retry. Automatic Desktop launch is supported on macOS.`);
    const app = config.helix?.appPath ?? ['/Applications/Helix Desktop.app',join(homedir(),'Applications/Helix Desktop.app')].find(existsSync);
    if (!app || !existsSync(app)) throw new Error('Helix Desktop is not installed. Install/setup Helix, or set HELIX_URL to an existing local service.');
    await exec('/usr/bin/open',['-g',app],{env:desktopLaunchEnvironment(process.env,userInfo().homedir)});
    const deadline = Date.now()+45000;
    while (Date.now()<deadline) {
      try { catalog=await getJson(origin+'/api/projects'); break; } catch {}
      await new Promise(r=>setTimeout(r,500));
    }
    if (!catalog) throw new Error(`Helix did not become ready at ${origin} within 45 seconds. Complete Desktop setup/sign-in; then retry.`);
  }
  if (!Array.isArray(catalog.projects)) throw new Error('Unexpected Helix project catalog response.');
  return selectProject(catalog.projects,config.helix,origin);
}
export async function assets(identity: any, match = '') {
  const data = await getJson(identity.assetsUrl);
  if (!Array.isArray(data.assets)) throw new Error('Unexpected Helix asset catalog response.');
  return {identity,scope:'project (shared across variants; not proof that an asset is used by this variant)',assets:data.assets.filter((a:any)=>a.path.includes(match)).map((a:any)=>({...a,url:identity.assetsUrl+'/'+a.path.split('/').map(encodeURIComponent).join('/')}))};
}
