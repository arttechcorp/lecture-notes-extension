const assert=require('node:assert/strict');
const {DEFAULTS,validateSettings}=require('./settings.js');
assert.equal('apiKey' in DEFAULTS,false);
assert.equal('appSessionToken' in DEFAULTS,true);
assert.equal(validateSettings({serviceUrl:'https://example.test/'}).serviceUrl,'https://example.test');
assert.throws(()=>validateSettings({serviceUrl:'http://external.example'}));
assert.equal(validateSettings({serviceUrl:'http://localhost:8787/'}).serviceUrl,'http://localhost:8787');
console.log('settings: secure service configuration passed');
