// Prints only paths and finding categories, never matching credential values.
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024,windowsHide:true});
const findings=[];
const rules=[
  ['private key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['service-account credential',/"type"\s*:\s*"service_account"/],
  ['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['OAuth refresh token',/\b1\/\/[A-Za-z0-9_-]{30,}/],
  ['AWS access key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['Slack token',/\bxox[baprs]-[A-Za-z0-9-]{20,}/],
  ['OAuth client secret',/["']client_secret["']\s*:\s*["'][A-Za-z0-9_-]{20,}["']/],
  ['embedded bearer credential',/\bBearer\s+(?:eyJ[A-Za-z0-9_.-]{30,}|ya29\.[A-Za-z0-9_.-]{20,})/],
  ['private environment assignment',/^(?:VITE_)?[A-Z_]*(?:PASSWORD|SECRET|PRIVATE_KEY|ACCESS_TOKEN|REFRESH_TOKEN)[A-Z_]*\s*=\s*[^\s#][^\r\n]{7,}$/m]
];
const privatePath=/(?:^|\/)(?:\.env(?:\..+)?|[^/]*\.local(?:\..*)?|DJ_ACCESS[^/]*|credentials[^/]*\.json|[^/]*(?:service-account|serviceAccount|service_account|firebase-adminsdk)[^/]*\.json|application_default_credentials\.json|firebase-auth-export[^/]*\.json|state\.json(?:\..*)?|diagnostics\.[^/]*|[^/]*\.(?:log(?:\..*)?|pem|key|p12|pfx|jks|mp3|wav|ogg|flac|m4a|aac|aiff|aif|opus|wma))$/i;
const privateDirectory=/(?:^|\/)(?:test-results|\.firebase|emulator-data|firestore-export[^/]*|profiles?|user-data)(?:\/|$)/;
const knownSecrets=[];
if(existsSync('DJ_ACCESS.local.md')){
  const text=readFileSync('DJ_ACCESS.local.md','utf8');
  const password=text.match(/^Temporary password:\s*(\S+)/m)?.[1];
  if(password)knownSecrets.push(password);
}
for(const filename of ['.env.local','.env.production','.env'])if(existsSync(filename)){
  for(const line of readFileSync(filename,'utf8').split(/\r?\n/)){
    const match=line.match(/^([A-Z_]*(?:PASSWORD|SECRET|PRIVATE_KEY|ACCESS_TOKEN|REFRESH_TOKEN)[A-Z_]*)=(.+)$/);
    if(match&&match[2].length>=8)knownSecrets.push(match[2].replace(/^["']|["']$/g,''));
  }
}
function scan(path,content,scope){
  const normalized=path.replaceAll('\\','/');
  if((privatePath.test(normalized)&&normalized!=='.env.example')||privateDirectory.test(normalized))findings.push({scope,path,kind:'private file eligible for publication'});
  const text=content.toString('utf8');
  for(const [kind,pattern] of rules)if(pattern.test(text))findings.push({scope,path,kind});
  if(knownSecrets.some(secret=>text.includes(secret)))findings.push({scope,path,kind:'actual local credential copied into public content'});
}
const candidates=[...new Set(git('ls-files','--cached','--others','--exclude-standard','-z').split('\0').filter(Boolean))];
for(const path of candidates)if(existsSync(path))scan(path,readFileSync(path),'working tree');
// Check staged bytes too: a secret can remain staged after the working file is cleaned.
for(const entry of git('ls-files','--stage','-z').split('\0').filter(Boolean)){
  const match=entry.match(/^\d+ ([0-9a-f]+) \d\t([\s\S]+)$/);if(!match)continue;
  scan(match[2],execFileSync('git',['cat-file','blob',match[1]],{maxBuffer:64*1024*1024,windowsHide:true}),'staged index');
}
const scanned=new Set();
const commits=git('rev-list','--all').trim().split(/\r?\n/).filter(Boolean);
for(const commit of commits){
  for(const entry of git('ls-tree','-r','-z',commit).split('\0').filter(Boolean)){
    const match=entry.match(/^\d+ blob ([0-9a-f]+)\t([\s\S]+)$/);if(!match)continue;
    const key=match[1]+' '+match[2];if(scanned.has(key))continue;scanned.add(key);
    scan(match[2],execFileSync('git',['cat-file','blob',match[1]],{maxBuffer:64*1024*1024,windowsHide:true}),`history ${commit.slice(0,8)}`);
  }
}
if(findings.length){
  for(const finding of findings)console.error(`${finding.scope}: ${finding.path}: ${finding.kind}`);
  console.error('Publication check failed. Remove private content before committing; rotate any credential already exposed.');
  process.exitCode=1;
}else console.log(`PASS: ${candidates.length} publishable files, staged content and ${commits.length} fetched/local commits scanned; no detected credentials or private files. This pattern scan is not a guarantee against every possible secret.`);
