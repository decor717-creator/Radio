const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
test('a Radio PWA update deletes only its own older shell caches',async()=>{
  const listeners={},deleted=[];
  const sandbox={self:{location:{origin:'https://example.test',href:'https://example.test/Radio/sw.js'},clients:{claim:async()=>{}},addEventListener:(type,fn)=>listeners[type]=fn},caches:{keys:async()=>['my-radio-shell-v11','my-radio-shell-v12','coach-zheka-shell-v9','another-site'],delete:async name=>{deleted.push(name);return true;}},URL,Promise};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),sandbox);
  let finished;listeners.activate({waitUntil:promise=>finished=promise});await finished;
  assert.deepEqual(deleted,['my-radio-shell-v11']);
});
test('audio, catalogue and unrelated same-origin resources bypass the shell cache',()=>{
  const listeners={},sandbox={self:{location:{origin:'https://example.test',href:'https://example.test/Radio/sw.js'},addEventListener:(type,fn)=>listeners[type]=fn},URL};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),sandbox);
  for(const url of ['https://radio.test/stream.mp3','https://example.test/other-app/app.js','https://example.test/Radio/stream.mp3']){
    let handled=false;listeners.fetch({request:{url,method:'GET'},respondWith(){handled=true;}});assert.equal(handled,false,url);
  }
});
