const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const local={apiKey:'legacy',provider:'gemini',serviceUrl:'https://service.example',appSessionToken:'token'};
const area=data=>({get:async keys=>{if(Array.isArray(keys))return Object.fromEntries(keys.filter(k=>k in data).map(k=>[k,data[k]]));return {...data};},set:async p=>Object.assign(data,p),remove:async keys=>keys.forEach(k=>delete data[k])});
const scope=vm.createContext({URL,chrome:{storage:{local:area(local),sync:area({apiKey:'legacy'})}}});
vm.runInContext(fs.readFileSync(require.resolve('./settings'),'utf8'),scope);
(async()=>{const s=await vm.runInContext('loadSettings()',scope);assert.equal(s.serviceUrl,'https://service.example');assert.equal(local.apiKey,undefined);assert.equal(await vm.runInContext("saveSettings({transcript:'bad'})",scope).catch(()=> 'rejected'),'rejected');console.log('recovery: legacy credential cleanup passed');})().catch(e=>{console.error(e);process.exitCode=1;});
