import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, setLogLevel, Timestamp, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
let environment: RulesTestEnvironment;
// PERMISSION_DENIED is expected in the negative cases; assertions still inspect it.
setLogLevel('silent');
beforeAll(async()=>{environment=await initializeTestEnvironment({projectId:'demo-wedding-dj',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync('firestore.rules','utf8')}});});
beforeEach(async()=>{
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();await setDoc(doc(db,'events/reception'),{open:true});
    for(const status of ['pending','approved','rejected','played']) await setDoc(doc(db,`events/reception/requests/${status}`),{title:'Display-only song',artist:'Artist',votes:1,status,priority:0,createdAt:Timestamp.fromMillis(1)});
    await setDoc(doc(db,'events/reception/quotas/guest'),{submissions:{count:1,lastAt:1}});
    await setDoc(doc(db,'events/reception/votes/pending/guests/guest'),{createdAt:Timestamp.fromMillis(1)});
  });
});
afterAll(async()=>{await environment?.cleanup();});
describe.each(['visitor','guest','dj'] as const)('%s Firestore client',role=>{
  function db() {
    if(role==='visitor') return environment.unauthenticatedContext().firestore();
    return environment.authenticatedContext(role,{...(role==='dj'?{dj:true}:{}),firebase:{sign_in_provider:role==='guest'?'anonymous':'password'}}).firestore();
  }
  it('can read display documents and run the actual requests-list query',async()=>{
    const store=db();
    for(const status of ['pending','approved','rejected','played']) await assertSucceeds(getDoc(doc(store,`events/reception/requests/${status}`)));
    const snapshot=await assertSucceeds(getDocs(query(collection(store,'events/reception/requests'),orderBy('createdAt','desc'),limit(200))));expect(snapshot.size).toBe(4);
  });
  it('cannot create, overwrite, change votes/status/priority, or delete requests',async()=>{
    const store=db(),ref=doc(store,'events/reception/requests/pending');
    await assertFails(setDoc(doc(store,'events/reception/requests/spam'),{title:'Spam',status:'approved'}));await assertFails(setDoc(ref,{title:'Replacement'}));
    for(const change of [{votes:9000},{status:'approved'},{priority:999},{title:'Changed title'}]) await assertFails(updateDoc(ref,change));await assertFails(deleteDoc(ref));
    const unchanged=await getDoc(ref);expect(unchanged.data()?.votes).toBe(1);expect(unchanged.data()?.status).toBe('pending');
  });
  it('cannot read or list event settings, quotas or individual vote receipts',async()=>{
    const store=db();
    const privatePaths = ['events/reception/participants/another-guest','events/reception/quotas/guest','events/reception/votes/pending/guests/another-guest'];
    if(role !== 'dj') privatePaths.push('events/reception');
    for(const location of privatePaths) await assertFails(getDoc(doc(store,location)));
    for(const location of ['events','events/reception/quotas','events/reception/votes/pending/guests']) await assertFails(getDocs(collection(store,location)));
  });
  it('cannot forge quota or vote records, or reopen the event',async()=>{
    const store=db();for(const location of ['events/reception','events/reception/quotas/guest','events/reception/votes/pending/guests/guest']){await assertFails(setDoc(doc(store,location),{open:true,count:0}));await assertFails(deleteDoc(doc(store,location)));}
  });
  it('cannot access request subcollections or unrelated paths',async()=>{
    const store=db();for(const location of ['events/reception/requests/pending/private/info','users/guest','admin/settings']){await assertFails(getDoc(doc(store,location)));await assertFails(setDoc(doc(store,location),{value:'secret'}));}
  });
});
