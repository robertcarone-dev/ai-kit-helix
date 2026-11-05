import {mkdtempSync,mkdirSync,cpSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const editor=process.env.UNITY_EDITOR, jsonPackage=process.env.UNITY_NEWTONSOFT_PACKAGE;
if(!editor || !jsonPackage) throw new Error('Set UNITY_EDITOR executable and UNITY_NEWTONSOFT_PACKAGE to an existing local package directory. This test never installs packages into a consumer.');
const source=fileURLToPath(new URL('..',import.meta.url));
const root=mkdtempSync(join(tmpdir(),'helix-unity-smoke-'));
mkdirSync(join(root,'Assets/Editor'),{recursive:true});mkdirSync(join(root,'Packages'));
cpSync(join(source,'unity/Editor'),join(root,'Assets/HelixComparison/Editor'),{recursive:true});
cpSync(join(source,'unity/Tests/ComparisonSmoke.cs'),join(root,'Assets/Editor/ComparisonSmoke.cs'));
writeFileSync(join(root,'Packages/manifest.json'),JSON.stringify({dependencies:{'com.unity.nuget.newtonsoft-json':'file:'+resolve(jsonPackage)}}));
console.log('Isolated synthetic Unity test project: '+root);
const result=spawnSync(editor,['-batchmode','-nographics','-projectPath',root,'-executeMethod','ComparisonSmoke.Run','-logFile',join(root,'Editor.log')],{timeout:180000,stdio:'inherit'});
try {console.log(readFileSync(join(root,'smoke-result.json'),'utf8'));}catch{console.error('No result; inspect '+join(root,'Editor.log'));}
if(result.error)console.error(result.error.message);
process.exitCode=result.status??1;
