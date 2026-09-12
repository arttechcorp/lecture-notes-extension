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
 await page.waitForSelector('#heroDemo[data-state="done"]');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ${width}`);
 await page.locator('[data-install]').first().click();
 assert(await page.locator('#installDialog').isVisible());
 if(width<900)assert(await page.locator('#mobileInstall').isVisible());
 await page.locator('#installDialog .close-button').click();
 await page.locator('#studentToggle').click();
 assert.equal(await page.locator('#studentToggle').getAttribute('aria-pressed'),'true');
 for(const id of ['free','essential','professional']){
 if(id!=="free") { await page.locator(`[data-demo="${id}"]`).click();
 assert.equal(await page.locator(`[data-demo="${id}"]`).getAttribute('aria-selected'),'true'); }
 await page.locator(`[data-example="${id}"]`).last().click();
 assert(await page.locator('#sampleDialog').isVisible());
 assert(await page.locator('#sampleDialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1),`dialog overflow ${width} ${id}`);
 const box=await page.locator('#sampleDialog').boundingBox();assert(box.x>=0 && box.x+box.width<=width+1);
 await page.locator('#sampleDialog .close-button').click();
 }
 await page.locator('[data-plan="essential"]').click();assert(await page.locator('#checkout').isVisible());await page.locator('#checkout .close-button').click();
 await page.locator('.faq details').first().locator('summary').click();assert(await page.locator('.faq details').first().getAttribute('open')!==null);
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('denied'))},configurable:true}));
 const frame=page.frameLocator('.demo-panel');await frame.locator('#copyBtn').click();assert(await frame.locator('#result').isVisible());
 assert.equal(await frame.locator('#result').evaluate(e=>e.selectionEnd-e.selectionStart),await frame.locator('#result').evaluate(e=>e.value.length));
 await page.locator('#heroDemo').scrollIntoViewIfNeeded();
 if(width<=760){assert.equal(await frame.locator('html').getAttribute('class'),'mobile-demo');const b=await page.locator('.lec-play-toggle').boundingBox();assert(b.width>=44);}
 assert.deepEqual(errors,[]);console.log('PASS',width);await context.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
