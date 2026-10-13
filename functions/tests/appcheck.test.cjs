// Exercise the actual exported HTTPS wrappers with Firebase's debug bypass off.
// Only rejection paths run: no credentials, external services or database writes.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const express=require('express');
assert.notEqual(process.env.FIREBASE_DEBUG_MODE,'true','This test must not bypass token verification.');
process.env.GCLOUD_PROJECT='demo-wedding-dj';
const {submitRequest,voteRequest}=require('../lib/index');
const api=express();api.use(express.json());api.post('/submitRequest',submitRequest);api.post('/voteRequest',voteRequest);
const server=createServer(api);let base;
before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));});
for(const endpoint of ['submitRequest','voteRequest']){
  test(`${endpoint} SDK wrapper rejects missing and malformed App Check before the handler`,async()=>{
    for(const token of [null,'not-a-token','eyJhbGciOiJub25lIn0.eyJzdWIiOiJmYWtlIn0.unsigned']){
      const headers={'Content-Type':'application/json'};if(token)headers['X-Firebase-AppCheck']=token;
      const response=await fetch(`${base}/${endpoint}`,{method:'POST',headers,body:JSON.stringify({data:{eventId:'emulator-only',title:'Song',artist:'Artist',requestId:'a'.repeat(64)}}),signal:AbortSignal.timeout(10000)});
      const data=await response.json();assert.equal(response.status,401);assert.equal(data.error.status,'UNAUTHENTICATED');
      // The handler's guest-auth error has different text; this proves the SDK gate ran.
      assert.equal(data.error.message,'Unauthenticated');
    }
  });
}
