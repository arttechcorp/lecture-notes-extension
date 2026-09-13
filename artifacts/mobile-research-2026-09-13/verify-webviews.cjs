// Run: NODE_PATH=/path/to/playwright/node_modules node artifacts/mobile-research-2026-09-13/verify-webviews.cjs
// Engine + synthetic app UA, not the native app shell. No credentials or user content.
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const out=__dirname;
const base=process.env.LANDING_URL || 'https://summrizei.vercel.app/';
const profiles=[
 {id:'ios-kakao',engine:webkit,width:375,ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK'},
 {id:'ios-instagram',engine:webkit,width:390,ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram'},
 {id:'android-kakao',engine:chromium,width:360,ua:'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 KAKAOTALK'},
 {id:'android-instagram',engine:chromium,width:412,ua:'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 Instagram'},
];
const results=[];
(async()=>{
for(const p of profiles){const browser=await p.engine.launch(p.engine===chromium?{channel:'chrome',headless:true}:{headless:true});
for(const hostile of [false,true]){const r={profile:p.id,engine:browser.version(),hostile,checks:[],errors:[]};results.push(r);const context=await browser.newContext({viewport:{width:p.width,height:660},screen:{width:p.width,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:p.ua,reducedMotion:'reduce'});const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>r.errors.push(e.message));
async function check(name,fn){try{await fn();r.checks.push({name,pass:true});}catch(e){r.checks.push({name,pass:false,error:e.message});}}
if(hostile){await page.route(/cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/,route=>route.abort());await page.route('**/*.js*',async route=>{if(new URL(route.request().url()).origin===new URL(base).origin){await new Promise(r=>setTimeout(r,350));}await route.continue();});await context.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{get(){return undefined},configurable:true}));}
try{const response=await page.goto(base,{waitUntil:'domcontentloaded'});r.url=page.url();r.status=response.status();await page.locator('#heroDemo[data-state="done"]').waitFor();fs.writeFileSync(path.join(out,p.id+(hostile?'-blocked':'')+'-snapshot.txt'),await page.locator('body').ariaSnapshot());
await check('body fits width',async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)));
await check('visible navigation tap',async()=>{await page.locator('.site-header a[href="#plans"]').tap();await page.waitForFunction(()=>location.hash==='#plans');});
await check('install dialog touch / PC guidance / selectable URL',async()=>{await page.locator('[data-install]').first().tap();assert(await page.locator('#mobileInstall').isVisible());await page.locator('#installAddress').tap();assert(await page.locator('#installAddress').evaluate(e=>e.selectionEnd===e.value.length));await page.locator('#installDialog .close-button').tap();});
await check('student prices and checkout',async()=>{await page.locator('#studentToggle').tap();const price=await page.locator('[data-card="essential"] .price').innerText();await page.locator('[data-plan="essential"]').tap();assert((await page.locator('#checkoutDescription').innerText()).includes(price.replace(/\s+/g,' ').trim()));await page.locator('#checkout .close-button').tap();});
for(const id of ['free','essential','professional'])await check('sample '+id+' scroll / close at reduced height',async()=>{await page.locator(`[data-example="${id}"]`).last().tap();await page.setViewportSize({width:p.width,height:440});assert(await page.locator('#sampleDialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.locator('#sampleDialog').evaluate(e=>e.scrollTop=e.scrollHeight);const box=await page.locator('#sampleDialog .close-button').boundingBox();assert(box.y>=0&&box.y+box.height<=440);await page.locator('#sampleDialog .close-button').tap();await page.setViewportSize({width:p.width,height:660});});
await check('FAQ tap',async()=>{await page.locator('.faq summary').first().tap();assert(await page.locator('.faq details').first().evaluate(e=>e.open));});
await check('review horizontal scroll',async()=>assert(await page.locator('.reviews-viewport').first().evaluate(e=>{e.scrollLeft=250;return e.scrollLeft>0})));
await check('copy blocked: pause, readonly text and selection',async()=>{await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new DOMException('blocked','NotAllowedError'))},configurable:true}));const f=page.frameLocator('.demo-panel');await f.locator('#copyBtn').tap();await f.locator('#result').waitFor({state:'visible'});assert(await f.locator('#result').evaluate(e=>e.readOnly&&e.selectionEnd-e.selectionStart===e.value.length));assert.equal(await page.locator('.lec-play-toggle').getAttribute('aria-pressed'),'true');});
await check('orientation and font enlargement no page overflow',async()=>{await page.setViewportSize({width:844,height:390});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:320,height:660});await page.addStyleTag({content:'body {font-size: 20px !important}'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));});
await page.screenshot({path:path.join(out,p.id+(hostile?'-blocked':'')+'-result.png')});
await check('policy navigation and real history return',async()=>{await page.locator('.site-footer a[href="policies/refund"]').tap();await page.waitForURL('**/policies/refund');await page.goBack({waitUntil:'domcontentloaded'});await page.locator('[data-install]').first().tap();assert(await page.locator('#installDialog').isVisible());await page.locator('#installDialog .close-button').tap();});
}catch(e){r.fatal=e.message;}finally{await context.close();fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(results,null,2));console.log(p.id,hostile,JSON.stringify(r));}}
await browser.close();}
if(results.some(r=>r.fatal || r.errors.length || r.checks.some(c=>!c.pass)))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
