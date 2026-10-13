import {initializeTestEnvironment,assertFails,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {doc,getDoc,getDocs,collection,setDoc,setLogLevel,updateDoc,writeBatch,serverTimestamp,Timestamp,type Firestore} from 'firebase/firestore';
import {readFileSync} from 'node:fs';
import {cleanSongText,guestAction,moderateSong,songKey} from '../src/requests/store';
let environment:RulesTestEnvironment;
setLogLevel('silent');
const event='free-reception';
function guest(uid:string){return environment.authenticatedContext(uid,{firebase:{sign_in_provider:'anonymous'}}).firestore() as unknown as Firestore;}
function dj(){return environment.authenticatedContext('moderator',{dj:true}).firestore() as unknown as Firestore;}
async function admin(fn:(db:Firestore)=>Promise<unknown>){return environment.withSecurityRulesDisabled(async context=>{await fn(context.firestore() as unknown as Firestore);});}
beforeAll(async()=>{environment=await initializeTestEnvironment({projectId:'demo-wedding-dj',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync('firestore.rules','utf8')}});});
beforeEach(async()=>{await environment.clearFirestore();await admin(db=>setDoc(doc(db,'events',event),{open:true}));});
afterAll(async()=>{await environment.cleanup();});
const submit=(uid:string,title='Dancing Queen!',artist='ABBA')=>guestAction(guest(uid),event,uid,'submit',{title,artist});
describe('direct Firestore transactions and authoritative rules',()=>{
  it('creates a pending request, private vote receipt and participant counter atomically',async()=>{
    const {id}=await submit('guest-a');const store=guest('guest-a');
    const song=(await getDoc(doc(store,'events',event,'requests',id))).data()!;
    expect(song).toMatchObject({title:'Dancing Queen!',artist:'ABBA',status:'pending',priority:0,votes:1});
    expect(Object.keys(song).sort()).toEqual(['artist','createdAt','priority','status','title','updatedAt','votes']);
    expect((await getDoc(doc(store,'events',event,'participants','guest-a'))).data()?.submissions).toBe(1);
    expect((await getDoc(doc(store,'events',event,'votes',id,'guests','guest-a'))).exists()).toBe(true);
  });
  it('merges case/punctuation duplicates and supports accented and non-Latin titles',async()=>{
    const a=await submit('a');const b=await submit('b','dancing queen','abba');expect(a.id).toBe(b.id);expect(b.duplicate).toBe(true);
    expect((await getDoc(doc(guest('a'),'events',event,'requests',a.id))).data()?.votes).toBe(2);
    await submit('c','Déjà Vu','Beyoncé');await submit('d','你好','周杰伦');
  });
  it('prevents replayed votes, forged vote increments and forged receipt-only writes',async()=>{
    const {id}=await submit('a');const store=guest('b');await guestAction(store,event,'b','vote',{requestId:id});
    await expect(guestAction(store,event,'b','vote',{requestId:id})).rejects.toThrow('already');
    await assertFails(updateDoc(doc(store,'events',event,'requests',id),{votes:50,updatedAt:serverTimestamp()}));
    await assertFails(setDoc(doc(guest('c'),'events',event,'votes',id,'guests','c'),{createdAt:serverTimestamp()}));
  });
  it('prevents quota resets, cross-user private reads/writes and approvals by guests',async()=>{
    const {id}=await submit('a');const b=guest('b');
    await assertFails(getDoc(doc(b,'events',event,'participants','a')));
    await assertFails(getDoc(doc(b,'events',event,'votes',id,'guests','a')));
    await assertFails(setDoc(doc(b,'events',event,'participants','a'),{submissions:0,votes:0}));
    await assertFails(setDoc(doc(guest('a'),'events',event,'participants','a'),{submissions:0,votes:0}));
    await expect(moderateSong(b,event,id,'approved',1)).rejects.toMatchObject({code:'permission-denied'});
  });
  it('enforces the cooldown in rules even if the client forges old timestamps',async()=>{
    await submit('a');await expect(submit('a','Next song')).rejects.toThrow('wait');
    const store=guest('a'),id=await songKey('Next song','ABBA'),batch=writeBatch(store),now=serverTimestamp();
    batch.set(doc(store,'events',event,'requests',id),{title:'Next song',artist:'ABBA',status:'pending',priority:0,votes:1,createdAt:now,updatedAt:now});
    batch.set(doc(store,'events',event,'votes',id,'guests','a'),{createdAt:now});
    batch.set(doc(store,'events',event,'participants','a'),{submissions:2,votes:0,lastSubmitAt:Timestamp.fromMillis(0),lastVoteAt:Timestamp.fromMillis(0),lastAt:now,lastKind:'submit',lastRequestId:id});
    await assertFails(batch.commit());
  });
  it('enforces submission and voting caps',async()=>{
    const {id}=await submit('a');
    await admin(db=>setDoc(doc(db,'events',event,'participants','limit'),{submissions:5,votes:50,lastSubmitAt:Timestamp.fromMillis(0),lastVoteAt:Timestamp.fromMillis(0),lastAt:Timestamp.fromMillis(0),lastKind:'submit',lastRequestId:id}));
    await expect(submit('limit','Another')).rejects.toThrow('5');
    await expect(guestAction(guest('limit'),event,'limit','vote',{requestId:id})).rejects.toThrow('50');
  });
  it('supports moderation only through a DJ claim, leaving votes and identity fields unchanged',async()=>{
    const {id}=await submit('a');const moderator=dj();
    for(const status of ['approved','rejected','approved','played'])await moderateSong(moderator,event,id,status,3);
    const data=(await getDoc(doc(moderator,'events',event,'requests',id))).data()!;expect(data.status).toBe('played');expect(data.votes).toBe(1);expect(data.priority).toBe(3);
    await assertFails(updateDoc(doc(moderator,'events',event,'requests',id),{votes:99}));
    await expect(guestAction(guest('b'),event,'b','vote',{requestId:id})).rejects.toThrow('reviewed');
  });
  it('rejects closed events, bogus hashes and malformed requests with no partial writes',async()=>{
    await admin(db=>updateDoc(doc(db,'events',event),{open:false}));await expect(submit('a')).rejects.toThrow('not allowed');
    expect((await getDocs(collection(guest('a'),'events',event,'requests'))).size).toBe(0);
    await admin(db=>updateDoc(doc(db,'events',event),{open:true}));
    await expect(submit('a','https://spam.test')).rejects.toThrow('without links');
    await assertFails(setDoc(doc(guest('a'),'events',event,'requests','random'),{title:'Song',artist:'Artist',votes:1,status:'pending',priority:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
    expect(cleanSongText('  Song  ')).toBe('Song');
  });
  it('does not lose concurrent votes or count concurrent same-user votes twice',async()=>{
    const {id}=await submit('creator');
    await Promise.all(['a','b','c'].map(uid=>guestAction(guest(uid),event,uid,'vote',{requestId:id})));
    const store=guest('same');const results=await Promise.allSettled([guestAction(store,event,'same','vote',{requestId:id}),guestAction(store,event,'same','vote',{requestId:id})]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect((await getDoc(doc(store,'events',event,'requests',id))).data()?.votes).toBe(5);
  });
  it('cannot smuggle extra vote increments into one participant action',async()=>{
    const a=await submit('creator-a'),b=await submit('creator-b','Another song');const store=guest('attacker'),batch=writeBatch(store),now=serverTimestamp();
    for(const {id} of [a,b]){batch.update(doc(store,'events',event,'requests',id),{votes:2,updatedAt:now});batch.set(doc(store,'events',event,'votes',id,'guests','attacker'),{createdAt:now});}
    batch.set(doc(store,'events',event,'participants','attacker'),{submissions:0,votes:1,lastSubmitAt:Timestamp.fromMillis(0),lastVoteAt:now,lastAt:now,lastKind:'vote',lastRequestId:a.id});
    await assertFails(batch.commit());expect((await getDoc(doc(store,'events',event,'requests',a.id))).data()?.votes).toBe(1);
  });
  it('rules reject forged counters above the cap even with a valid receipt and vote write',async()=>{
    const {id}=await submit('creator'),store=guest('attacker');
    await admin(db=>setDoc(doc(db,'events',event,'participants','attacker'),{submissions:0,votes:50,lastSubmitAt:Timestamp.fromMillis(0),lastVoteAt:Timestamp.fromMillis(0),lastAt:Timestamp.fromMillis(0),lastKind:'vote',lastRequestId:id}));
    const batch=writeBatch(store),now=serverTimestamp();
    batch.update(doc(store,'events',event,'requests',id),{votes:2,updatedAt:now});batch.set(doc(store,'events',event,'votes',id,'guests','attacker'),{createdAt:now});
    batch.set(doc(store,'events',event,'participants','attacker'),{submissions:0,votes:51,lastSubmitAt:Timestamp.fromMillis(0),lastVoteAt:now,lastAt:now,lastKind:'vote',lastRequestId:id});await assertFails(batch.commit());
  });
  it('rules enforce cooldown even when a bypassing client uses fresh server timestamps',async()=>{
    await submit('a');const store=guest('a'),title='Cooldown bypass',id=await songKey(title,'ABBA'),old=(await getDoc(doc(store,'events',event,'participants','a'))).data()!;
    const batch=writeBatch(store),now=serverTimestamp();
    batch.set(doc(store,'events',event,'requests',id),{title,artist:'ABBA',votes:1,status:'pending',priority:0,createdAt:now,updatedAt:now});batch.set(doc(store,'events',event,'votes',id,'guests','a'),{createdAt:now});
    batch.set(doc(store,'events',event,'participants','a'),{submissions:2,votes:0,lastSubmitAt:now,lastVoteAt:old.lastVoteAt,lastAt:now,lastKind:'submit',lastRequestId:id});await assertFails(batch.commit());
  });
  it('rules enforce the duplicate hash rather than trusting a supplied client ID',async()=>{
    const store=guest('a'),id='x'.repeat(43),batch=writeBatch(store),now=serverTimestamp();
    batch.set(doc(store,'events',event,'requests',id),{title:'Dancing Queen',artist:'ABBA',votes:1,status:'pending',priority:0,createdAt:now,updatedAt:now});batch.set(doc(store,'events',event,'votes',id,'guests','a'),{createdAt:now});
    batch.set(doc(store,'events',event,'participants','a'),{submissions:1,votes:0,lastSubmitAt:now,lastVoteAt:Timestamp.fromMillis(0),lastAt:now,lastKind:'submit',lastRequestId:id});await assertFails(batch.commit());
  });
});
