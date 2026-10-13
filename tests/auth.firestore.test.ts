import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInAnonymously} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,onSnapshot,setDoc,terminate} from 'firebase/firestore';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {guestAction,moderateSong} from '../src/requests/store';
it('real anonymous Auth sessions submit/vote and see two-client updates, with guest moderation denied',async()=>{
  const environment=await initializeTestEnvironment({projectId:'demo-wedding-dj',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync('firestore.rules','utf8')}});
  const event=`auth-${crypto.randomUUID()}`;await environment.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),'events',event),{open:true}));
  const clients=[0,1].map(index=>{
    const app=initializeApp({projectId:'demo-wedding-dj',apiKey:'emulator-only',appId:'emulator-only'},`auth-live-${index}-${event}`);
    const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});const db=getFirestore(app);connectFirestoreEmulator(db,'127.0.0.1',8080);return {app,auth,db};
  });
  try{
    const [a,b]=await Promise.all(clients.map(client=>signInAnonymously(client.auth)));expect(a.user.uid).not.toBe(b.user.uid);
    const {id}=await guestAction(clients[0].db,event,a.user.uid,'submit',{title:'Reception test',artist:'Test artist'});
    const wait=(db:ReturnType<typeof getFirestore>)=>new Promise<void>((resolve,reject)=>{
      let stop:()=>void;const timeout=setTimeout(()=>{stop?.();reject(Error('Real-time update timed out'));},15000);
      stop=onSnapshot(doc(db,'events',event,'requests',id),snapshot=>{if(snapshot.data()?.votes===2){clearTimeout(timeout);stop();resolve();}},error=>{clearTimeout(timeout);reject(error);});
    });
    const updates=clients.map(client=>wait(client.db));await guestAction(clients[1].db,event,b.user.uid,'vote',{requestId:id});await Promise.all(updates);
    await expect(moderateSong(clients[1].db,event,id,'approved',1)).rejects.toMatchObject({code:'permission-denied'});
  }finally{await Promise.all(clients.map(async client=>{await terminate(client.db);await deleteApp(client.app);}));await environment.cleanup();}
});
