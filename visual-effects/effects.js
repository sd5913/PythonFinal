/* Dark Campaign FX 1.0. Load renderer.js first. No dependencies or game connection. */
(function(global){
  'use strict';
  const colors=Object.freeze(['blue','gray','red','yellow']);
  const specs=Object.freeze({ship_energy_pickup:[.85,.65],ship_hit:[.65,.65],ship_collision_destroy:[.95,1.2],droplet_move:[.48,2.05],ship_detected:[.25,1.5],ship_move:[.3,2.1]});
  const finite=(v,label)=>{if(!Number.isFinite(v))throw new TypeError(label+' must be finite');return v;};
  const positive=(v,label)=>{finite(v,label);if(v<=0)throw new RangeError(label+' must be positive');return v;};
  function normalize(options={}){
    const o={x:240,y:145,scale:1,rotation:0,color:'blue',number:1,otherColor:'red',otherNumber:1,...options};
    for(const k of ['x','y','rotation'])finite(o[k],k);
    positive(o.scale,'scale');
    for(const k of ['color','otherColor'])if(!colors.includes(o[k]))throw new RangeError('Unknown '+k);
    for(const k of ['number','otherNumber'])if(!Number.isInteger(o[k])||o[k]<1||o[k]>5)throw new RangeError(k+' must be 1–5');
    for(const k of ['onComplete','onRemove','onShake'])if(o[k]!==undefined&&typeof o[k]!=='function')throw new TypeError(k+' must be a function');
    if(o.duration!==undefined)positive(o.duration,'duration');
    if(o.path){
      if(!Array.isArray(o.path)||o.path.length<2)throw new TypeError('path needs at least two {x,y} points');
      const pts=o.path.map(p=>({x:finite(p.x,'path.x'),y:finite(p.y,'path.y')}));
      const distances=[0];for(let i=1;i<pts.length;i++)distances.push(distances[i-1]+Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y));
      const total=distances[distances.length-1];positive(total,'path length');
      o.path=p=>{const at=Math.max(0,Math.min(1,p))*total;let i=1;while(i<pts.length-1&&distances[i]<at)i++;
        const span=distances[i]-distances[i-1],q=span?(at-distances[i-1])/span:0;
        return {x:pts[i-1].x+(pts[i].x-pts[i-1].x)*q,y:pts[i-1].y+(pts[i].y-pts[i-1].y)*q};};
    }
    return o;
  }
  async function loadAssets({base='assets/',sources}={}){
    if(!base.endsWith('/'))base+='/';
    const paths={droplet:base+'droplet.png'};
    for(const color of colors)for(let n=1;n<=5;n++)paths[color+'-'+n]=base+color+'-'+n+'.png';
    const art={};const preparer=global.DarkCampaignFXRenderer.create(art);
    await Promise.all(Object.entries(paths).map(([key,path])=>new Promise((resolve,reject)=>{
      const img=new Image();img.onload=()=>{art[key]=key==='droplet'?img:preparer.prepare(img,key);resolve();};
      img.onerror=()=>reject(new Error('Unable to load asset: '+key));img.src=sources?.[key]||path;
    })));
    return Object.freeze(art);
  }
  class Player{
    constructor(canvas,assets,{width=480,height=260,pixelRatio=Math.min(global.devicePixelRatio||1,2),background=null,reducedMotion}={}){
      this.canvas=canvas;this.ctx=canvas.getContext('2d');if(!this.ctx)throw new Error('Canvas 2D is unavailable');
      for(const color of colors)for(let n=1;n<=5;n++)if(!assets[color+'-'+n])throw new Error('Missing ship asset: '+color+'-'+n);
      if(!assets.droplet)throw new Error('Missing droplet asset');
      this.renderer=global.DarkCampaignFXRenderer.create(assets);this.background=background;
      this.reducedMotion=reducedMotion;this.disposed=false;this.active=null;this.raf=0;
      this.resize(width,height,pixelRatio);
    }
    resize(width,height,pixelRatio=this.pixelRatio){
      this._alive();this.width=positive(width,'width');this.height=positive(height,'height');this.pixelRatio=positive(pixelRatio,'pixelRatio');
      this.canvas.width=Math.round(width*pixelRatio);this.canvas.height=Math.round(height*pixelRatio);
      this._render();
    }
    _alive(){if(this.disposed)throw new Error('Player has been disposed');}
    _effect(effect){if(!Object.hasOwn(specs,effect))throw new RangeError('Unknown effect: '+effect);}
    _shake(effect,t){
      const reduced=this.reducedMotion??global.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const age=t-.95;if(effect!=='ship_collision_destroy'||reduced||age<0||age>=.32)return {x:0,y:0};
      const s=7*Math.pow(1-age/.32,1.5);return {x:Math.sin(age*94)*s,y:Math.cos(age*77)*s*.65};
    }
    _render(effect,elapsed=0,options){
      const c=this.ctx;c.setTransform(this.pixelRatio,0,0,this.pixelRatio,0,0);c.clearRect(0,0,this.width,this.height);
      const shake=this._shake(effect,elapsed);c.save();
      try{c.translate(shake.x,shake.y);if(this.background)this.background(c,{width:this.width,height:this.height,shake});
        if(effect)this.renderer.draw(c,effect,elapsed,options);
      }finally{c.restore();}
      return shake;
    }
    preview(effect,options={},progress=.35){
      this._alive();this._effect(effect);finite(progress,'progress');this.stop();
      const o=normalize(options),[offset,seconds]=specs[effect];this._render(effect,offset+seconds*Math.max(0,Math.min(1,progress)),o);
    }
    play(effect,options={}){
      this._alive();this._effect(effect);const o=normalize(options);this.stop();
      const [offset,seconds]=specs[effect],duration=o.duration??seconds*1000;
      let resolve;const finished=new Promise(done=>{resolve=done;});
      const job={effect,options:o,start:performance.now(),duration,removed:false,resolve};this.active=job;
      const tick=now=>{
        if(this.active!==job)return;
        const progress=Math.max(0,Math.min(1,(now-job.start)/duration)),elapsed=offset+progress*seconds;
        try{
          const shake=this._render(effect,elapsed,o);
          if(o.onShake)o.onShake(shake);
          if(this.active!==job)return;
          if(effect==='ship_collision_destroy'&&!job.removed&&elapsed>=1.3){job.removed=true;if(o.onRemove)o.onRemove();}
          if(this.active!==job)return;
          if(progress>=1){this.active=null;this.raf=0;resolve({status:'completed'});if(o.onComplete)o.onComplete();return;}
          // Callbacks may stop/dispose/restart the player.
          if(this.active===job)this.raf=requestAnimationFrame(tick);
        }catch(error){
          if(this.active===job){this.active=null;this.raf=0;}
          resolve({status:'error',error});console.error('DarkCampaignFX:',error);
        }
      };
      this.raf=requestAnimationFrame(tick);
      return {finished,cancel:()=>{if(this.active===job)this.stop();}};
    }
    stop(){
      if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;
      if(this.active){const job=this.active;this.active=null;job.resolve({status:'cancelled'});
        if(job.options.onShake)try{job.options.onShake({x:0,y:0});}catch(error){console.error(error);}}
    }
    clear(){this._alive();this.stop();this._render();}
    dispose(){if(this.disposed)return;this.clear();this.disposed=true;this.renderer=null;this.background=null;}
  }
  global.DarkCampaignFX=Object.freeze({version:'1.0.0',colors,effects:Object.keys(specs),loadAssets,Player});
})(globalThis);
