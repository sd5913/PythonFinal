/* Demo only. Game-independent effect library lives in renderer.js + effects.js. */
(async()=>{
  const root=document.getElementById('dark-effects-release');
  const status=root.querySelector('[role="status"]');
  const color=root.querySelector('#fx-color'),number=root.querySelector('#fx-number');
  const playAll=root.querySelector('#fx-play-all');
  const scenes=[];
  function backdrop(c){
    c.fillStyle='#091b2b';c.fillRect(-12,-12,504,284);c.strokeStyle='#183447';c.lineWidth=1;
    for(let x=0;x<480;x+=40){c.beginPath();c.moveTo(x,0);c.lineTo(x,260);c.stroke();}
    for(let y=10;y<260;y+=40){c.beginPath();c.moveTo(0,y);c.lineTo(480,y);c.stroke();}
    c.strokeStyle='#26495a';c.setLineDash([4,8]);c.beginPath();c.ellipse(240,135,154,76,0,0,Math.PI*2);c.stroke();c.setLineDash([]);
  }
  function choices(){return {color:color.value,number:Number(number.value),otherColor:{blue:'red',gray:'yellow',red:'blue',yellow:'gray'}[color.value],otherNumber:Number(number.value)};}
  function still(){for(const s of scenes)s.player.preview(s.effect,choices(),s.effect==='droplet_move'?.22:.35);}
  function save(effect){if(window.openai?.setWidgetState)window.openai.setWidgetState({modelContent:{color:color.value,number:Number(number.value),lastPreview:effect},privateContent:null}).catch(()=>{});}
  function restore(state){if(!state)return;if(DarkCampaignFX.colors.includes(state.color))color.value=state.color;if([...number.options].some(o=>o.value===String(state.number)))number.value=String(state.number);if(scenes.length)still();}
  function play(effect){
    const targets=scenes.filter(s=>!effect||s.effect===effect);
    status.textContent=effect?'正在播放：'+targets[0].label:'正在播放全部特效';
    save(effect||'all');
    Promise.all(targets.map(s=>s.player.play(s.effect,choices()).finished)).then(results=>{
      if(results.every(r=>r.status==='completed'))status.textContent='播放完成';
      if(results.some(r=>r.status==='error'))status.textContent='播放失败，请查看控制台';
    });
  }
  try{
    const assets=await DarkCampaignFX.loadAssets({sources:globalThis.DARK_FX_RELEASE_ASSETS});
    for(const section of root.querySelectorAll('[data-effect]')){
      const s={effect:section.dataset.effect,label:section.querySelector('h3').textContent,
        player:new DarkCampaignFX.Player(section.querySelector('canvas'),assets,{background:backdrop})};
      scenes.push(s);section.querySelector('button').onclick=()=>play(s.effect);
    }
    restore(window.openai?.widgetState?.modelContent);still();
    color.onchange=number.onchange=()=>{still();save('selection');status.textContent=color.options[color.selectedIndex].text+' · '+number.value+'号舰船';};
    playAll.onclick=()=>play();root.querySelectorAll('button,select').forEach(el=>el.disabled=false);
    status.textContent=root.dataset.compact?'四色预览 · 1号舰船':'四支舰队 · 每队五艘 · 资源已就绪';
    window.addEventListener('openai:set_globals',e=>restore(e.detail?.globals?.widgetState?.modelContent));
    window.addEventListener('pagehide',()=>scenes.forEach(s=>s.player.dispose()),{once:true});
    globalThis.DarkCampaignFXDemo={players:scenes.map(s=>s.player),play};
  }catch(error){status.textContent='素材加载失败：'+error.message;console.error(error);}
})();
