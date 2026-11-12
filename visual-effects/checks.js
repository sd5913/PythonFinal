/* Run with node checks.js. Virtual canvas checks the actual public API and timing. */
await (async()=>{
  const fs=await import('node:fs/promises'),vm=await import('node:vm'),assert=(await import('node:assert/strict')).default;
  const base=new URL('.',import.meta.url);let now=0,next=0;const frames=new Map(),errors=[];
  function canvas(){
    const calls=[];const noop=()=>{};const gradient=()=>({addColorStop:noop});
    const c=new Proxy({calls,createLinearGradient:gradient,createRadialGradient:gradient,
      drawImage:(...a)=>calls.push(['image',...a]),translate:(...a)=>calls.push(['translate',...a]),
      save:noop,restore:noop},{get:(o,k)=>k in o?o[k]:noop});
    return {width:0,height:0,getContext:()=>c};
  }
  class FakeImage{set src(value){this.url=value;queueMicrotask(()=>this.onload());}}
  const env={document:{createElement:()=>canvas()},Image:FakeImage,console:{error:e=>errors.push(e)},
    performance:{now:()=>now},requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},
    cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>({matches:false}),devicePixelRatio:2};
  vm.createContext(env);
  for(const name of ['renderer.js','effects.js'])vm.runInContext(await fs.readFile(new URL(name,base),'utf8'),env,{filename:name});
  const FX=env.DarkCampaignFX;const loaded=await FX.loadAssets();assert.equal(Object.keys(loaded).length,21);
  const art={droplet:{id:'droplet'}};for(const color of FX.colors)for(let n=1;n<=5;n++)art[color+'-'+n]={id:color+'-'+n};
  const cv=canvas(),player=new FX.Player(cv,art);
  let count=0;function ok(){count++;}
  for(const color of FX.colors)for(let number=1;number<=5;number++){
    for(const effect of ['ship_energy_pickup','ship_hit','ship_collision_destroy','ship_detected','ship_move']){
      cv.getContext().calls.length=0;player.preview(effect,{color,number},.15);
      assert(cv.getContext().calls.some(c=>c[0]==='image'&&c[1].id===color+'-'+number),effect+' '+color+'-'+number);
    }ok();
  }
  for(const effect of ['ship_move','droplet_move']){
    cv.getContext().calls.length=0;
    player.preview(effect,{path:[{x:40,y:180},{x:180,y:20},{x:340,y:80}]},1);
    assert(cv.getContext().calls.some(c=>c[0]==='translate'&&Math.abs(c[1]-340)<.001&&Math.abs(c[2]-80)<.001));ok();
  }
  const advance=ms=>{now+=ms;const jobs=[...frames.values()];frames.clear();jobs.forEach(fn=>fn(now));};
  let removed=0,complete=0;const shake=[];
  const h=player.play('ship_collision_destroy',{onRemove:()=>removed++,onComplete:()=>complete++,onShake:s=>shake.push(s)});
  advance(80);advance(80);advance(80);assert(shake.some(s=>s.x!==0||s.y!==0));
  advance(160);assert.equal(removed,1);advance(1000);
  assert.equal((await h.finished).status,'completed');assert.equal(removed,1);assert.equal(complete,1);assert.equal(frames.size,0);ok();
  // Late frames (hidden tabs) still deliver the removal exactly once.
  const late=player.play('ship_collision_destroy',{onRemove:()=>removed++});advance(5000);
  assert.equal((await late.finished).status,'completed');assert.equal(removed,2);ok();
  const a=player.play('ship_energy_pickup'),b=player.play('ship_detected');assert.equal((await a.finished).status,'cancelled');
  a.cancel();assert.equal(frames.size,1);b.cancel();assert.equal((await b.finished).status,'cancelled');assert.equal(frames.size,0);ok();
  const quiet=new FX.Player(canvas(),art,{reducedMotion:true});const quietShake=[];
  const q=quiet.play('ship_collision_destroy',{onShake:s=>quietShake.push(s)});advance(100);advance(1500);await q.finished;
  assert(quietShake.every(s=>s.x===0&&s.y===0));quiet.dispose();ok();
  // Cancellation from a callback must not dispatch completion afterwards.
  let called=0;const cancelled=player.play('ship_collision_destroy',{onRemove:()=>player.stop(),onComplete:()=>called++});
  advance(2000);assert.equal((await cancelled.finished).status,'cancelled');assert.equal(called,0);ok();
  assert.throws(()=>player.play('missing'));assert.throws(()=>player.play('ship_hit',{color:'pink'}));
  assert.throws(()=>player.play('ship_move',{path:[{x:0,y:0},{x:0,y:0}]}));assert.throws(()=>player.play('ship_hit',{number:6}));
  assert.throws(()=>player.play('ship_hit',{duration:0}));ok();
  const doomed=player.play('ship_move');player.dispose();player.dispose();assert.equal((await doomed.finished).status,'cancelled');
  assert.equal(frames.size,0);assert.throws(()=>player.play('ship_hit'));assert.equal(errors.length,0);ok();
  console.log('PASS: '+count+' behavior groups; 100 color/number/effect combinations; path endpoints; lifecycle; reduced motion; removal timing.');
})().catch(error=>{console.error(error);throw error;});
