// 별도 설치된 Playwright + Chrome으로 실행 (프로젝트 의존성 추가 없음).
// 1. 저장소 루트: python3 -m http.server 8765 --bind 127.0.0.1
// 2. NODE_PATH=/path/to/playwright/node_modules node landing/mobile.browser-test.cjs
// Chromium 화면/터치/UA 에뮬레이션이며 실제 카카오톡·Instagram·iOS 검증은 별도다.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:"chrome"});
 for(const width of [320,375,430,760,844,1280]){
 const context=await browser.newContext({viewport:{width,height:812},isMobile:width<900,hasTouch:width<900,reducedMotion:'reduce',userAgent:width<900?'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile KAKAOTALK Instagram':'Mozilla/5.0'});
 const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://cdnjs.cloudflare.com/**',route=>route.abort());
 await page.goto(process.env.LANDING_URL || 'http://127.0.0.1:8765/landing/');
 // reduced-motion 정적 시퀀스는 done→share를 지나 tablet에서 정지하므로 최종 상태를 기다린다.
 await page.waitForSelector('#heroDemo[data-state="tablet"]');
 const frame=page.frameLocator('.demo-panel');
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('denied'))},configurable:true}));
 // .tablet-scene이 패널을 덮어 실제 클릭은 불가 — JS click으로 복사 fallback 동작만 검증한다.
 await frame.locator('#copyBtn').evaluate(e=>e.click());assert(await frame.locator('#result').isVisible());
 assert.equal(await frame.locator('#result').evaluate(e=>e.selectionEnd-e.selectionStart),await frame.locator('#result').evaluate(e=>e.value.length));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ${width}`);
 await page.locator('[data-reserve]').first().click();
 assert(await page.locator('#reserveDialog').isVisible());
 // 빈 폼 제출은 이동하지 않고 필드 오류를 표시한다.
 await page.locator('#reserveSubmit').click();
 assert(await page.locator('#reserveEmailError').isVisible());
 assert.equal(await page.locator('#reserveDialog').isVisible(),true);
 await page.locator('#reserveDialog .close-button').click();
 await page.locator('#studentToggle').click();
 assert.equal(await page.locator('#studentToggle').getAttribute('aria-pressed'),'true');
 // The comparison section shows evidence highlights by default.
 await page.locator('#comparisonEvidence').scrollIntoViewIfNeeded();
 const evidence=page.locator('#comparisonEvidence [data-evidence]');
 assert(await evidence.count()>0);
 assert(await evidence.evaluateAll(els=>els.every(e=>e.classList.contains('is-highlighted'))),'evidence is highlighted by default');
 assert.equal(await page.locator('#lectureScenePlay').count(),0,'no play control; scene loops on its own');
 assert.equal(await page.locator('#lecturePlayer').getAttribute('data-scene'),'complete');
 assert(await page.locator('#lectureSceneCaption').isVisible());
 assert.equal(await page.locator('#preview .zoom-tile').count(),6,'presenter + 5 participants');
 assert.equal(await page.locator('#lectureSceneTime').count(),0,'no clock row');
 assert((await page.locator('#lecturePlayer').boundingBox()).height>350,'slide remains in player flow');
 for(const selector of ['.lecture-graph','.lecture-graph svg[role="img"]','.comparison-card']){
   for(const element of await page.locator('#preview '+selector).all()){
     const box=await element.boundingBox();assert(box.x>=0 && box.x+box.width<=width+1,`${selector} bounds ${width}`);
     assert(await element.evaluate(e=>e.scrollWidth<=e.clientWidth+1),`${selector} overflow ${width}`);
   }
 }
 assert.equal(await page.locator('#preview .note-doc').count(),2,'two summary-note previews');
 assert(await page.locator('#preview .screen-audio .note-doc table').isVisible());
 for(const id of ['free','essential','professional']){
 await page.locator(`[data-example="${id}"]`).last().click();
 assert(await page.locator('#sampleDialog').isVisible());
 assert(await page.locator('#sampleDialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1),`dialog overflow ${width} ${id}`);
 const box=await page.locator('#sampleDialog').boundingBox();assert(box.x>=0 && box.x+box.width<=width+1);
 await page.locator('#sampleDialog .close-button').click();
 }
 await page.locator('[data-reserve="essential"]').click();assert(await page.locator('#reserveDialog').isVisible());assert((await page.locator('#reservePlan').textContent()).includes('Essential'));await page.locator('#reserveDialog .close-button').click();
 await page.locator('.faq details').first().locator('summary').click();assert(await page.locator('.faq details').first().getAttribute('open')!==null);
 await page.locator('#heroDemo').scrollIntoViewIfNeeded();
 if(width<=760){assert.equal(await frame.locator('html').getAttribute('class'),'mobile-demo');const b=await page.locator('.lec-play-toggle').boundingBox();assert(b.width>=44);}
 assert.deepEqual(errors,[]);console.log('PASS',width);await context.close();
 }
 // The scene loops on its own; leaving the viewport and motion preferences must pause it.
 const playbackContext=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'no-preference'});
 const playback=await playbackContext.newPage();const playbackErrors=[];playback.on('pageerror',e=>playbackErrors.push(e.message));
 await playback.route('https://cdnjs.cloudflare.com/**',route=>route.abort());
 await playback.goto(process.env.LANDING_URL || 'http://127.0.0.1:8765/landing/');
 const player=playback.locator('#lecturePlayer');
 assert.equal(await player.getAttribute('data-playing'),'false');
 const posterHeight=(await player.boundingBox()).height;
 await player.scrollIntoViewIfNeeded();
 await playback.waitForFunction(()=>document.getElementById('lecturePlayer').dataset.playing==='true');
 await playback.waitForFunction(()=>document.getElementById('lecturePlayer').dataset.scene==='boundary');
 assert.equal((await player.boundingBox()).height,posterHeight,'caption changes do not shift player height');
 await playback.waitForFunction(()=>document.getElementById('lecturePlayer').dataset.scene==='complete');
 assert((await playback.locator('#lectureSceneCaption').textContent()).includes('0.33'));
 await playback.waitForFunction(()=>document.getElementById('lecturePlayer').dataset.scene==='points','loop restarts');
 await playback.locator('footer').scrollIntoViewIfNeeded();
 await playback.waitForFunction(()=>document.getElementById('lecturePlayer').dataset.playing==='false');
 await player.scrollIntoViewIfNeeded();
 await playback.waitForFunction(()=>document.getElementById('lecturePlayer').dataset.playing==='true','reenter resumes the loop');
 await playback.emulateMedia({reducedMotion:'reduce'});
 await playback.waitForFunction(()=>document.getElementById('lecturePlayer').dataset.playing==='false');
 assert.equal(await player.getAttribute('data-scene'),'complete');
 assert((await playback.locator('#lectureSceneCaption').textContent()).includes('0.33'));
 assert.deepEqual(playbackErrors,[]);console.log('PASS playback, autoloop, offscreen, reduced motion');
 await playbackContext.close();
 const noScript=await browser.newContext({viewport:{width:375,height:812},javaScriptEnabled:false,reducedMotion:'reduce'});
 const staticPage=await noScript.newPage();await staticPage.goto(process.env.LANDING_URL || 'http://127.0.0.1:8765/landing/',{waitUntil:'domcontentloaded'});
 assert.equal(await staticPage.locator('#lectureScenePlay').count(),0);assert(await staticPage.locator('#lectureSceneCaption').isVisible());
 assert(await staticPage.locator('.screen-audio').isVisible());
 console.log('PASS no-JavaScript readable poster and notes');await noScript.close();
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
