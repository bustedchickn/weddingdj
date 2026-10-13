const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {writeFileSync,mkdirSync}=require('node:fs');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {getAuth}=require('firebase-admin/auth');
const {requestKey}=require('../lib/validation');
const project='demo-wedding-dj';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099') throw Error('Refusing to test outside local Firebase emulators.');
const app=initializeApp({projectId:project},'integration-tests'),db=getFirestore(app),auth=getAuth(app);
const report=[];
// The Functions emulator skips cryptographic token verification. This unsigned
// fixture exercises its App Check header gate. It is NEVER a production token.
const part=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const appCheck=`${part({alg:'none',typ:'JWT'})}.${part({sub:'emulator-only-app',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})}.emulator`;
async function account(claims) {
  const response=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true})});
  const user=await response.json();assert.equal(response.status,200,JSON.stringify(user));
  if(!claims)return {uid:user.localId,token:user.idToken};
  await auth.setCustomUserClaims(user.localId,claims);
  const refreshed=await fetch('http://127.0.0.1:9099/securetoken.googleapis.com/v1/token?key=emulator-only',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:user.refreshToken})});
  const body=await refreshed.json();assert.equal(refreshed.status,200,JSON.stringify(body));return {uid:user.localId,token:body.id_token};
}
async function event(open=true){const id=`test-${randomUUID()}`;await db.doc(`events/${id}`).set({open});return id;}
async function call(name,data,user,check=appCheck) {
  const headers={'Content-Type':'application/json'};if(user)headers.Authorization=`Bearer ${user.token}`;if(check)headers['X-Firebase-AppCheck']=check;
  const response=await fetch(`http://127.0.0.1:5001/${project}/us-central1/${name}`,{method:'POST',headers,body:JSON.stringify({data}),signal:AbortSignal.timeout(30000)});
  return {status:response.status,body:await response.json()};
}
function success(result){assert.equal(result.status,200,JSON.stringify(result.body));assert.ok('result' in result.body);return result.body.result;}
function failure(result,status){assert.notEqual(result.status,200,JSON.stringify(result.body));assert.equal(result.body.error?.status,status,JSON.stringify(result.body));}
async function seed(eventId,status='pending',name=randomUUID()){
  const id=createHash('sha256').update(name).digest('hex');await db.doc(`events/${eventId}/requests/${id}`).set({title:name,artist:'Artist',votes:1,status,priority:0,createdAt:FieldValue.serverTimestamp()});return id;
}
function check(name,fn){test(name,{timeout:120000},async()=>{try{await fn();report.push({name,passed:true});}catch(error){report.push({name,passed:false,error:error.message});throw error;}});}
before(async()=>{const res=await fetch('http://127.0.0.1:4400/emulators');assert.equal(res.status,200);const running=await res.json();for(const service of ['firestore','auth','functions'])assert.ok(running[service],`${service} emulator is missing`);});
after(async()=>{mkdirSync('test-results',{recursive:true});writeFileSync('test-results/firebase-integration.json',JSON.stringify({date:new Date().toISOString(),project,emulators:['firestore','auth','functions'],appCheck:'Emulator header gate only; production signatures and reCAPTCHA unverified',tests:report},null,2));await deleteApp(app);});

check('callable gates reject missing App Check and unauthenticated guests',async()=>{
  const eventId=await event(),user=await account(),data={eventId,title:'Song',artist:'Artist'};
  failure(await call('submitRequest',data,user,null),'UNAUTHENTICATED');
  failure(await call('submitRequest',data,null),'UNAUTHENTICATED');failure(await call('submitRequest',data,{token:'not-a-token'}),'UNAUTHENTICATED');
  failure(await call('voteRequest',{eventId,requestId:'a'.repeat(64)},user,null),'UNAUTHENTICATED');
  assert.equal((await db.collection(`events/${eventId}/requests`).get()).size,0);
});
check('anonymous submission is pending, normalized and contains only public display fields',async()=>{
  const eventId=await event(),user=await account(),result=success(await call('submitRequest',{eventId,title:'  Dancing   Queen!  ',artist:' ABBA ',honeypot:''},user));
  const data=(await db.doc(`events/${eventId}/requests/${result.id}`).get()).data();
  assert.equal(result.id,requestKey('Dancing Queen!','ABBA'));assert.equal(result.duplicate,false);assert.equal(data.title,'Dancing Queen!');assert.equal(data.artist,'ABBA');
  assert.equal(data.status,'pending');assert.equal(data.votes,1);assert.equal(data.priority,0);assert.deepEqual(Object.keys(data).sort(),['artist','createdAt','priority','status','title','votes']);
  assert.equal((await db.doc(`events/${eventId}/votes/${result.id}/guests/${user.uid}`).get()).exists,true);
  assert.equal((await db.doc(`events/${eventId}/quotas/${user.uid}`).get()).data().submissions.count,1);
});
check('simultaneous normalized duplicate requests create one song and two votes',async()=>{
  const eventId=await event(),users=await Promise.all([account(),account()]);
  const results=await Promise.all([call('submitRequest',{eventId,title:'Dancing Queen!',artist:'ABBA'},users[0]),call('submitRequest',{eventId,title:'dancing queen',artist:'abba'},users[1])]);
  const songs=results.map(success);assert.equal(songs[0].id,songs[1].id);assert.deepEqual(songs.map(x=>x.duplicate).sort(),[false,true]);
  const docs=await db.collection(`events/${eventId}/requests`).get();assert.equal(docs.size,1);assert.equal(docs.docs[0].data().votes,2);
});
check('submission cooldown and five-submission cap are enforced server-side',async()=>{
  const eventId=await event(),user=await account();success(await call('submitRequest',{eventId,title:'First',artist:'Artist'},user));
  failure(await call('submitRequest',{eventId,title:'Too soon',artist:'Artist'},user),'RESOURCE_EXHAUSTED');
  const ref=db.doc(`events/${eventId}/quotas/${user.uid}`);await ref.set({submissions:{count:4,lastAt:0}},{merge:true});
  success(await call('submitRequest',{eventId,title:'Fifth',artist:'Artist'},user));failure(await call('submitRequest',{eventId,title:'Sixth',artist:'Artist'},user),'RESOURCE_EXHAUSTED');
  assert.equal((await ref.get()).data().submissions.count,5);assert.equal((await db.collection(`events/${eventId}/requests`).get()).size,2);
});
check('concurrent submissions by one guest cannot bypass cooldown',async()=>{
  const eventId=await event(),user=await account(),results=await Promise.all(['A','B'].map(title=>call('submitRequest',{eventId,title,artist:'Artist'},user)));
  assert.equal(results.filter(r=>r.status===200).length,1);failure(results.find(r=>r.status!==200),'RESOURCE_EXHAUSTED');
  assert.equal((await db.collection(`events/${eventId}/requests`).get()).size,1);assert.equal((await db.doc(`events/${eventId}/quotas/${user.uid}`).get()).data().submissions.count,1);
});
check('a guest can vote only once and cannot vote again for their own submission',async()=>{
  const eventId=await event(),creator=await account(),voter=await account(),song=success(await call('submitRequest',{eventId,title:'Favorite',artist:'Artist'},creator));
  failure(await call('voteRequest',{eventId,requestId:song.id},creator),'ALREADY_EXISTS');success(await call('voteRequest',{eventId,requestId:song.id},voter));
  failure(await call('voteRequest',{eventId,requestId:song.id},voter),'ALREADY_EXISTS');failure(await call('submitRequest',{eventId,title:'favorite!',artist:'artist'},voter),'ALREADY_EXISTS');
  assert.equal((await db.doc(`events/${eventId}/requests/${song.id}`).get()).data().votes,2);
});
check('concurrent votes from different guests do not lose increments',async()=>{
  const eventId=await event(),id=await seed(eventId),users=await Promise.all(Array.from({length:6},()=>account()));
  const results=await Promise.all(users.map(user=>call('voteRequest',{eventId,requestId:id},user)));results.forEach(success);
  assert.equal((await db.doc(`events/${eventId}/requests/${id}`).get()).data().votes,7);assert.equal((await db.collection(`events/${eventId}/votes/${id}/guests`).get()).size,6);
});
check('concurrent votes from the same guest are counted once',async()=>{
  const eventId=await event(),id=await seed(eventId),user=await account(),data={eventId,requestId:id},results=await Promise.all([call('voteRequest',data,user),call('voteRequest',data,user)]);
  assert.equal(results.filter(r=>r.status===200).length,1);failure(results.find(r=>r.status!==200),'ALREADY_EXISTS');
  assert.equal((await db.doc(`events/${eventId}/requests/${id}`).get()).data().votes,2);assert.equal((await db.doc(`events/${eventId}/quotas/${user.uid}`).get()).data().votes.count,1);
});
check('two-second vote cooldown and fifty-vote cap are enforced',async()=>{
  const eventId=await event(),user=await account(),a=await seed(eventId),b=await seed(eventId),c=await seed(eventId);
  success(await call('voteRequest',{eventId,requestId:a},user));failure(await call('voteRequest',{eventId,requestId:b},user),'RESOURCE_EXHAUSTED');
  const ref=db.doc(`events/${eventId}/quotas/${user.uid}`);await ref.set({votes:{count:49,lastAt:0}},{merge:true});
  success(await call('voteRequest',{eventId,requestId:b},user));failure(await call('voteRequest',{eventId,requestId:c},user),'RESOURCE_EXHAUSTED');
  assert.equal((await ref.get()).data().votes.count,50);assert.equal((await db.doc(`events/${eventId}/requests/${c}`).get()).data().votes,1);
});
check('closed/missing events and reviewed requests reject guest actions',async()=>{
  const eventId=await event(false),user=await account(),id=await seed(eventId);
  failure(await call('submitRequest',{eventId,title:'Closed',artist:'Artist'},user),'FAILED_PRECONDITION');failure(await call('voteRequest',{eventId,requestId:id},user),'FAILED_PRECONDITION');
  failure(await call('submitRequest',{eventId:`missing-${randomUUID()}`,title:'Missing',artist:'Artist'},user),'FAILED_PRECONDITION');
  const openId=await event();for(const status of ['rejected','played']){
    const title=`${status} song`,songId=requestKey(title,'Artist');await db.doc(`events/${openId}/requests/${songId}`).set({title,artist:'Artist',status,votes:1,priority:0,createdAt:FieldValue.serverTimestamp()});
    failure(await call('voteRequest',{eventId:openId,requestId:songId},user),'FAILED_PRECONDITION');failure(await call('submitRequest',{eventId:openId,title,artist:'Artist'},user),'FAILED_PRECONDITION');
  }
  failure(await call('voteRequest',{eventId:openId,requestId:'f'.repeat(64)},user),'FAILED_PRECONDITION');
});
check('malformed submissions, links, honeypots and invalid IDs do not write data',async()=>{
  const eventId=await event(),user=await account(),base={eventId,title:'Song',artist:'Artist'};
  for(const change of [{title:''},{artist:''},{title:'x'.repeat(121)},{artist:'https://spam.test'},{title:17},{honeypot:'bot'},{eventId:'../escape'}]) failure(await call('submitRequest',{...base,...change},user),'INVALID_ARGUMENT');
  failure(await call('voteRequest',{eventId,requestId:'../escape'},user),'INVALID_ARGUMENT');assert.equal((await db.collection(`events/${eventId}/requests`).get()).size,0);
});
check('moderation rejects guests, missing auth, body-injected roles and nonboolean DJ claims',async()=>{
  const eventId=await event(),id=await seed(eventId),guest=await account(),falseDJ=await account({dj:'true'}),data={eventId,requestId:id,status:'approved',priority:1};
  for(const user of [null,guest,falseDJ])failure(await call('moderateRequest',{...data,dj:true,auth:{token:{dj:true}}},user,null),'PERMISSION_DENIED');
  assert.equal((await db.doc(`events/${eventId}/requests/${id}`).get()).data().status,'pending');
});
check('DJ claim can approve, prioritize, reject and mark played without altering votes',async()=>{
  const eventId=await event(),id=await seed(eventId),dj=await account({dj:true});
  for(const [status,priority] of [['approved',2],['rejected',3],['approved',5],['played',5]]){
    success(await call('moderateRequest',{eventId,requestId:id,status,priority},dj,null));const song=(await db.doc(`events/${eventId}/requests/${id}`).get()).data();
    assert.equal(song.status,status);assert.equal(song.priority,priority);assert.equal(song.votes,1);assert.ok(song.moderatedAt);
  }
  await db.doc(`events/${eventId}`).update({open:false});success(await call('moderateRequest',{eventId,requestId:id,status:'approved',priority:0},dj,null));
});
check('moderation rejects invalid status/priority and reports missing songs clearly',async()=>{
  const eventId=await event(),id=await seed(eventId),dj=await account({dj:true}),base={eventId,requestId:id,status:'approved',priority:1};
  for(const change of [{priority:-1},{priority:1001},{priority:1.5},{status:'queued'},{requestId:'../escape'}])failure(await call('moderateRequest',{...base,...change},dj,null),'INVALID_ARGUMENT');
  failure(await call('moderateRequest',{...base,requestId:'0'.repeat(64)},dj,null),'NOT_FOUND');
});
check('two public Firestore clients receive vote and moderation updates in real time',async()=>{
  const {initializeApp:initClient,deleteApp:deleteClient}=await import('firebase/app');
  const {getFirestore:getClient,connectFirestoreEmulator,doc,onSnapshot,terminate}=await import('firebase/firestore');
  const eventId=await event(),id=await seed(eventId),guest=await account(),dj=await account({dj:true}),clients=[];
  function wait(store,predicate){return new Promise((resolve,reject)=>{let stop;const timer=setTimeout(()=>{stop?.();reject(Error('Live snapshot timeout'));},15000);stop=onSnapshot(doc(store,`events/${eventId}/requests/${id}`),snapshot=>{if(predicate(snapshot.data())){clearTimeout(timer);stop();resolve();}},error=>{clearTimeout(timer);stop?.();reject(error);});});}
  try{
    for(let i=0;i<2;i++){const client=initClient({projectId:project,apiKey:'emulator-only',appId:'emulator-only'},`guest-${randomUUID()}`),store=getClient(client);connectFirestoreEmulator(store,'127.0.0.1',8080);clients.push({client,store});}
    await Promise.all(clients.map(({store})=>wait(store,data=>data?.votes===1)));
    const votes=clients.map(({store})=>wait(store,data=>data?.votes===2));success(await call('voteRequest',{eventId,requestId:id},guest));await Promise.all(votes);
    const approval=clients.map(({store})=>wait(store,data=>data?.status==='approved'&&data?.priority===7));success(await call('moderateRequest',{eventId,requestId:id,status:'approved',priority:7},dj,null));await Promise.all(approval);
  }finally{await Promise.all(clients.map(async({client,store})=>{await terminate(store);await deleteClient(client);}));}
});
