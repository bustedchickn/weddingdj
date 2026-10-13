// Read-only HTTP/artifact verification. UI and Firebase behavior are tested separately.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base='https://wedding-dj-console-2026.web.app';
const response=await fetch(base);
assert.equal(response.status,200);
assert.equal(response.url,`${base}/guest.html`);
const html=await response.text();
const sources=[...html.matchAll(/(?:src|href)="([^" ]+\.(?:js|css))"/g)].map(match=>new URL(match[1],response.url));
assert.ok(sources.length>=2);
const checks=[];
for(const source of sources){const asset=await fetch(source);assert.equal(asset.status,200);const text=await asset.text();checks.push({path:source.pathname,bytes:text.length,status:asset.status});if(source.pathname.endsWith('.js')){assert.ok(text.includes('October 24, 2026'));assert.ok(text.includes('a smashing jamboree'));assert.ok(text.includes('wedding-2026-10-24'));}}
await mkdir('test-results',{recursive:true});
await writeFile('test-results/guest-hosting.json',JSON.stringify({date:new Date().toISOString(),url:response.url,mode:'live hosting HTTP and asset verification',status:response.status,checks},null,2));
console.log('PASS: Hosting redirect, HTTP 200 assets, October 24 date, event and rotating-title content. This does not verify UI interactions.');
