import assert from 'node:assert/strict';
export async function verifyBrowser(origin,cookie,room){
  const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1440,height:900}});
    await context.addCookies([{name:'pf_session',value:cookie.split('=')[1],url:origin,httpOnly:true,sameSite:'Lax'}]);
    const page=await context.newPage(),errors=[],failed=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.status()>=400&&r.url().includes('/static/'))failed.push(r.url());});
    await page.goto(origin);
    await page.waitForFunction(()=>document.querySelector('#account-status').textContent.includes('flight-gamma'));
    assert.equal(await page.locator('#sign-out').innerText(),'Sign out');
    await page.locator('#rulebook-button').click();
    await page.locator('#rulebook-next').click();await page.locator('#rulebook-next').click();
    assert.equal(await page.locator('#rulebook-counter').innerText(),'3 / 3');
    await page.locator('#rulebook-button').click();
    await page.locator('#language-button').click();
    assert.equal(await page.locator('#sign-out').innerText(),'退出登录');
    await page.locator('#language-button').click();
    await page.evaluate(room=>sessionStorage.setItem('pythonfinal.session.v1.room',room),room);
    await page.reload();await page.waitForSelector('#lobby:not([hidden])');
    assert.equal(await page.locator('#room-code').innerText(),room);
    await page.locator('#share-invite').click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#players .player.is-self').count(),1);
    await page.reload();await page.waitForSelector('#lobby:not([hidden])');
    await page.setViewportSize({width:390,height:844});
    await page.locator('#rulebook-button').click();
    assert(await page.locator('#rulebook-viewer').isVisible());
    assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
    console.log('Worker browser: authenticated lobby, share, reload recovery, rulebook and languages (desktop/mobile) passed.');
  }finally{await browser.close();}
}
