// Uses the Firebase CLI's existing signed-in account. Never prints auth tokens.
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const require=createRequire(import.meta.url);
const auth=require('firebase-tools/lib/auth');
const {Client}=require('firebase-tools/lib/apiv2');
const project='wedding-dj-console-2026';
const projectNumber='962047673027';
const appId='1:962047673027:web:02d751e16bf560b0485876';
const management=new Client({urlPrefix:'https://firebase.googleapis.com'});
const identity=new Client({urlPrefix:'https://identitytoolkit.googleapis.com'});
async function publicConfig(){return (await management.get(`/v1beta1/projects/${project}/webApps/${appId}/config`)).body;}
async function enableServices(){
  const usage=new Client({urlPrefix:'https://serviceusage.googleapis.com'});
  const operation=(await usage.post(`/v1/projects/${projectNumber}/services:batchEnable`,{serviceIds:['firestore.googleapis.com','identitytoolkit.googleapis.com']})).body;
  for(let attempt=0;attempt<60;attempt++){
    const status=(await usage.get(`/v1/${operation.name}`)).body;
    if(status.done){if(status.error)throw Error(status.error.message);console.log('Firestore and Firebase Auth APIs enabled.');return;}
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw Error('Service enabling is still pending.');
}
auth.setActiveAccount({},auth.getGlobalDefaultAccount());
const [mode]=process.argv.slice(2);
if(mode==='provision'){
  await enableServices();
  const configPath=`/admin/v2/projects/${project}/config`;
  let config;
  try { config=(await identity.get(configPath)).body; }
  catch(error){
    if(error.status!==404)throw error;
    throw Error('Basic Firebase Authentication is not initialized. Open Authentication in the Firebase console and choose Get started; do not upgrade to Identity Platform or enable billing.');
  }
  await identity.patch(configPath,{signIn:{anonymous:{enabled:true},email:{enabled:true,passwordRequired:true}},authorizedDomains:[...new Set([...(config.authorizedDomains||[]),`${project}.web.app`,`${project}.firebaseapp.com`])]}, {queryParams:{updateMask:'signIn.anonymous.enabled,signIn.email.enabled,signIn.email.passwordRequired,authorizedDomains'}});
  const configPublic=await publicConfig();
  await writeFile('.env.local',`VITE_FIREBASE_API_KEY=${configPublic.apiKey}\nVITE_FIREBASE_AUTH_DOMAIN=${configPublic.authDomain}\nVITE_FIREBASE_PROJECT_ID=${project}\nVITE_FIREBASE_APP_ID=${appId}\nVITE_EVENT_ID=wedding-2026-10-24\nVITE_GUEST_URL=https://${project}.web.app/guest.html\nVITE_GUEST_PREVIEW=false\n`);
  console.log('Anonymous and email sign-in enabled; public client configuration saved to .env.local.');
}else if(mode==='event'){
  const firestore=new Client({urlPrefix:'https://firestore.googleapis.com'});
  const path=`/v1/projects/${project}/databases/(default)/documents/events/wedding-2026-10-24`;
  await firestore.patch(path,{fields:{open:{booleanValue:true},weddingDate:{stringValue:'2026-10-24'}}});
  console.log('October 24 event is open for requests.');
}else if(mode==='moderator'){
  const email=auth.getGlobalDefaultAccount().user.email;
  const existing=(await identity.post(`/v1/projects/${project}/accounts:lookup`,{email:[email]})).body.users?.[0];
  let uid=existing?.localId;
  if(!uid){
    const password=randomBytes(18).toString('base64url')+'aA1!';
    uid=(await identity.post(`/v1/projects/${project}/accounts`,{email,password,displayName:'Wedding DJ Moderator'})).body.localId;
    await writeFile('DJ_ACCESS.local.md',`# Wedding DJ moderator access\n\nProject: ${project}\n\nEmail: ${email}\n\nTemporary password: ${password}\n\nKeep this file private. Sign into the desktop request panel with these credentials.\n`);
  }
  const oldClaims=existing?.customAttributes?JSON.parse(existing.customAttributes):{};
  await identity.post(`/v1/projects/${project}/accounts:update`,{localId:uid,customAttributes:JSON.stringify({...oldClaims,dj:true})});
  console.log('Moderator account provisioned. Credentials, if newly created, are in DJ_ACCESS.local.md.');
}else if(mode==='status'){
  const billing=new Client({urlPrefix:'https://cloudbilling.googleapis.com'});
  const info=await billing.get(`/v1/projects/${project}/billingInfo`);
  console.log(JSON.stringify({project,billingEnabled:info.body.billingEnabled,billingAccountName:info.body.billingAccountName},null,2));
}else if(mode==='inspect'){
  const billing=new Client({urlPrefix:'https://cloudbilling.googleapis.com'});
  const accounts=await billing.get('/v1/billingAccounts');
  const info=await billing.get(`/v1/projects/${project}/billingInfo`);
  console.log(JSON.stringify({project,billing:info.body,accounts:accounts.body.billingAccounts?.map(a=>({name:a.name,displayName:a.displayName,open:a.open}))},null,2));
}else throw Error('Unknown command.');
