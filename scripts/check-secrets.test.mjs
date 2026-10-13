import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
const scanner=path.resolve('scripts/check-secrets.mjs');
const ignores=readFileSync('.gitignore');
function fixture(fn){
  const root=mkdtempSync(path.join(tmpdir(),'wedding-dj-secret-check-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});
  const check=()=>spawnSync(process.execPath,[scanner],{cwd:root,encoding:'utf8',windowsHide:true});
  try{git('init','-q');writeFileSync(path.join(root,'.gitignore'),ignores);fn({root,git,check});}
  finally{const target=path.resolve(root);assert.ok(target.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(target).startsWith('wedding-dj-secret-check-'));rmSync(target,{recursive:true,force:true});}
}
test('private ignored files stay excluded; a copied local password is detected without printing it',()=>fixture(({root,check})=>{
  const secret=randomBytes(24).toString('base64url');
  writeFileSync(path.join(root,'DJ_ACCESS.local.md'),`Temporary password: ${secret}\n`);
  writeFileSync(path.join(root,'.env.local'),'PRIVATE_CONFIG=local-only\n');
  assert.equal(check().status,0);
  writeFileSync(path.join(root,'public-note.md'),secret);
  const result=check();assert.equal(result.status,1);assert.match(result.stderr,/actual local credential/);assert.ok(!result.stderr.includes(secret));
}));
test('detects a staged token even after the working copy is cleaned',()=>fixture(({root,git,check})=>{
  const token='ghp_'+randomBytes(24).toString('hex');
  writeFileSync(path.join(root,'note.md'),token);git('add','note.md');writeFileSync(path.join(root,'note.md'),'Clean working copy');
  const result=check();assert.equal(result.status,1);assert.match(result.stderr,/staged index/);assert.ok(!result.stderr.includes(token));
}));
test('blocks a private file force-added despite gitignore',()=>fixture(({root,git,check})=>{
  writeFileSync(path.join(root,'credentials.json'),'{}');git('add','-f','credentials.json');
  assert.equal(check().status,1);
}));
test('finds a token in old history after it was removed from the latest commit',()=>fixture(({root,git,check})=>{
  const token='ghp_'+randomBytes(24).toString('hex');writeFileSync(path.join(root,'note.md'),token);git('add','note.md');
  git('-c','user.name=Security Test','-c','user.email=security-test@example.invalid','-c','core.hooksPath=disabled-test-hooks','commit','-qm','Synthetic token test');
  writeFileSync(path.join(root,'note.md'),'Clean');git('add','note.md');
  git('-c','user.name=Security Test','-c','user.email=security-test@example.invalid','-c','core.hooksPath=disabled-test-hooks','commit','-qm','Remove synthetic token');
  const result=check();assert.equal(result.status,1);assert.match(result.stderr,/history /);assert.ok(!result.stderr.includes(token));
}));
