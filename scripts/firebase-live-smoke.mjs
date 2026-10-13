// Explicit production smoke test: creates one clearly labeled, ultimately rejected fixture.
// Credentials stay in ignored local files and are never printed.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,signInAnonymously,signInWithEmailAndPassword,signOut} from 'firebase/auth';
import {getFirestore,doc,getDocFromServer,onSnapshot,updateDoc,terminate} from 'firebase/firestore';
import {createServer} from 'vite';
const environment=Object.fromEntries((await readFile('.env.local','utf8')).trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
assert.equal(environment.VITE_FIREBASE_PROJECT_ID,'wedding-dj-console-2026');
const config={apiKey:environment.VITE_FIREBASE_API_KEY,authDomain:environment.VITE_FIREBASE_AUTH_DOMAIN,projectId:environment.VITE_FIREBASE_PROJECT_ID,appId:environment.VITE_FIREBASE_APP_ID};
const access=await readFile('DJ_ACCESS.local.md','utf8');
const email=access.match(/^Email: (.+)$/m)?.[1],password=access.match(/^Temporary password: (.+)$/m)?.[1];
assert.ok(email&&password,'Local moderator credentials are required for this test.');
const server=await createServer({server:{middlewareMode:true}});
const {guestAction,moderateSong,songKey}=await server.ssrLoadModule('/src/requests/store.ts');
const clients=['live-guest-a','live-guest-b','live-dj'].map(name=>{const app=initializeApp(config,name);return {app,auth:getAuth(app),db:getFirestore(app)};});
const [first,second,dj]=clients;
const event=environment.VITE_EVENT_ID;
let fixture,stop;
try{
  await Promise.all([signInAnonymously(first.auth),signInAnonymously(second.auth),signInWithEmailAndPassword(dj.auth,email,password)]);
  assert.equal((await dj.auth.currentUser.getIdTokenResult(true)).claims.dj,true);
  if(process.argv[2]==='reject-browser'){
    const title=process.argv[3];assert.ok(title?.startsWith('Wedding DJ browser test '));
    fixture=await songKey(title,'Disposable verification fixture');
    await moderateSong(dj.db,event,fixture,'rejected',0);
    console.log('Browser test fixture rejected.');
  }else{
  const result=await guestAction(first.db,event,first.auth.currentUser.uid,'submit',{title:`Wedding DJ connection test ${Date.now()}`,artist:'Disposable verification fixture'});
  fixture=result.id;
  const ref=doc(first.db,'events',event,'requests',fixture);
  assert.equal((await getDocFromServer(ref)).data().status,'pending');
  const observed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Live vote listener timed out')),20000);stop=onSnapshot(ref,snapshot=>{if(snapshot.data()?.votes===2){clearTimeout(timer);resolve();}},error=>{clearTimeout(timer);reject(error);});});
  await guestAction(second.db,event,second.auth.currentUser.uid,'vote',{requestId:fixture});await observed;
  await assert.rejects(()=>guestAction(second.db,event,second.auth.currentUser.uid,'vote',{requestId:fixture}),/already/);
  await assert.rejects(()=>updateDoc(doc(second.db,'events',event,'requests',fixture),{status:'approved'}));
  await moderateSong(dj.db,event,fixture,'approved',3);
  const moderatorRef=doc(dj.db,'events',event,'requests',fixture);
  assert.equal((await getDocFromServer(moderatorRef)).data().priority,3);
  await moderateSong(dj.db,event,fixture,'played',3);
  assert.equal((await getDocFromServer(moderatorRef)).data().status,'played');
  await moderateSong(dj.db,event,fixture,'rejected',0);
  const final=(await getDocFromServer(moderatorRef)).data();assert.equal(final.status,'rejected');assert.equal(final.votes,2);
  await mkdir('test-results',{recursive:true});
  await writeFile('test-results/firebase-live.json',JSON.stringify({date:new Date().toISOString(),project:config.projectId,event,fixture,status:'passed',checks:['real anonymous sign-in','DJ custom claim','pending submission','second-client vote','real-time listener','repeat vote rejected','guest moderation denied','approval and priority','mark played','rejection'],fixtureFinalStatus:final.status},null,2));
  console.log('PASS: live submission, voting, real-time updates and moderator permissions. Test fixture is rejected.');
  }
}finally{
  stop?.();
  if(fixture&&dj.auth.currentUser)await moderateSong(dj.db,event,fixture,'rejected',0).catch(()=>{});
  await Promise.allSettled(clients.map(async client=>{await signOut(client.auth);await terminate(client.db);await deleteApp(client.app);}));
  await server.close();
}
