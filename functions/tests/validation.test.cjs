const {test}=require('node:test');const assert=require('node:assert/strict');
const {eventKey,text,requestKey,checkQuota}=require('../lib/validation');
test('duplicate detection ignores capitalization, whitespace and punctuation',()=>{assert.equal(requestKey(text(' Dancing  Queen! '),text('ABBA')),requestKey('dancing queen','abba'));assert.notEqual(requestKey('ab','c'),requestKey('a','bc'));});
test('rejects links, invalid event paths, missing title and long text',()=>{assert.throws(()=>text('https://spam.test'));assert.throws(()=>text(' '));assert.throws(()=>text('x'.repeat(121)));assert.throws(()=>eventKey('../event'));});
test('enforces submission cap and cooldown',()=>{assert.throws(()=>checkQuota({count:5,lastAt:0},100000,5,30000));assert.throws(()=>checkQuota({count:1,lastAt:95000},100000,5,30000));assert.doesNotThrow(()=>checkQuota({count:1,lastAt:1000},100000,5,30000));});
