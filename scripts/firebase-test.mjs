// Test-only launcher: fixes stale Windows PATH after a Java install and always
// uses local emulators with a demo project; it cannot write production data.
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const suite = process.argv[2];
if (!['rules', 'all', 'suite'].includes(suite)) throw Error('Expected rules, all or suite.');
const env = {...process.env};
// First SDK load on Windows may exceed Firebase CLI's 10-second discovery limit.
env.FUNCTIONS_DISCOVERY_TIMEOUT = '60';
async function run(script, args = []) {
  return await new Promise(resolve => {
    const child = spawn(process.execPath, [script, ...args], {cwd: root, env, stdio: 'inherit', windowsHide: true});
    child.once('error', error => { console.error(error.message); resolve(1); });
    child.once('exit', code => resolve(code ?? 1));
  });
}
if (suite === 'suite') {
  if (env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw Error('Integration tests require the local demo emulators.');
  const rules = await run(path.join(root, 'node_modules/vitest/vitest.mjs'), ['run', '--config', 'vitest.rules.config.ts']);
  process.exitCode = rules;
} else {
  if (spawnSync('java', ['-version'], {env, windowsHide: true}).status !== 0 && process.platform === 'win32') {
    const installRoot = path.join(env.ProgramFiles || 'C:\\Program Files', 'Eclipse Adoptium');
    if (existsSync(installRoot)) {
      for (const name of readdirSync(installRoot).filter(name => /^jdk-21[.-]/.test(name)).sort().reverse()) {
        const bin = path.join(installRoot, name, 'bin');
        if (existsSync(path.join(bin, 'java.exe'))) { env.JAVA_HOME = path.dirname(bin); env.PATH = `${bin}${path.delimiter}${env.PATH || env.Path || ''}`; break; }
      }
    }
  }
  const java = spawnSync('java', ['-version'], {env, windowsHide: true, encoding: 'utf8'});
  if (java.status !== 0) throw Error('Install Java 21+ and add it to PATH (or install Temurin 21 in its default Windows location).');
  console.log(java.stderr.trim());
  mkdirSync(path.join(root, 'test-results'), {recursive: true});
  const command = suite === 'rules' ? 'vitest run --config vitest.rules.config.ts' : 'node scripts/firebase-test.mjs suite';
  process.exitCode = await run(path.join(root, 'node_modules/firebase-tools/lib/bin/firebase.js'), ['emulators:exec', '--project', 'demo-wedding-dj', '--only', suite === 'rules' ? 'firestore' : 'firestore,auth', command]);
}
