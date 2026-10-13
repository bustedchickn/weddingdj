import {afterEach, expect, it} from 'vitest';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const {readAudio}=createRequire(import.meta.url)('../electron/media.cjs');
const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
it('streams exact bytes with length and supports bounded, open and suffix ranges',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'dj-media-test-'));dirs.push(dir);const file=path.join(dir,'fixture.wav');await writeFile(file,'0123456789');
  const full=await readAudio(file,new Request('http://test/'));expect(full.headers.get('content-length')).toBe('10');expect(full.headers.get('content-type')).toBe('audio/wav');expect(await full.text()).toBe('0123456789');
  for(const [range,body,contentRange] of [['bytes=2-4','234','bytes 2-4/10'],['bytes=7-','789','bytes 7-9/10'],['bytes=-2','89','bytes 8-9/10']]){const res=await readAudio(file,new Request('http://test/',{headers:{range}}));expect(res.status).toBe(206);expect(res.headers.get('content-range')).toBe(contentRange);expect(await res.text()).toBe(body);}
  const bad=await readAudio(file,new Request('http://test/',{headers:{range:'bytes=999-'}}));expect(bad.status).toBe(416);
  const head=await readAudio(file,new Request('http://test/',{method:'HEAD'}));expect(head.headers.get('content-length')).toBe('10');expect(await head.text()).toBe('');
});
