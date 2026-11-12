/* Dark Campaign FX 1.0 — approved artwork and deterministic Canvas rendering.
 * Coordinates are logical pixels. No network access or game state mutations.
 */
(function(global){
  'use strict';
  const TAU=Math.PI*2;
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const smooth=v=>{v=clamp(v);return v*v*(3-2*v);};
  const ease=v=>1-Math.pow(1-clamp(v),3);
  const rgba=a=>`rgba(97,225,255,${clamp(a)})`;
  function createRenderer(art){
    let settings={};
    const overlay=document.createElement('canvas');overlay.width=363;overlay.height=478;
  function hullPath(c,color='blue') {
    if(color==='gray'){
      c.beginPath();c.ellipse(181,172,97,98,0,0,TAU);
      c.moveTo(139,166);c.lineTo(225,166);c.lineTo(225,304);c.lineTo(247,312);
      c.lineTo(247,257);c.lineTo(285,257);c.lineTo(285,333);c.lineTo(297,344);c.lineTo(297,364);
      c.lineTo(285,376);c.lineTo(257,376);c.lineTo(244,365);c.lineTo(244,342);c.lineTo(217,335);
      c.lineTo(200,348);c.lineTo(162,348);c.lineTo(145,335);c.lineTo(117,342);c.lineTo(117,365);
      c.lineTo(106,376);c.lineTo(78,376);c.lineTo(65,365);c.lineTo(65,344);c.lineTo(77,333);
      c.lineTo(65,315);c.lineTo(65,257);c.lineTo(116,257);c.lineTo(116,312);c.lineTo(139,304);c.closePath();
      c.moveTo(77,251);c.quadraticCurveTo(92,224,110,251);c.closePath();
      c.moveTo(252,251);c.quadraticCurveTo(270,224,289,251);c.closePath();return;
    }
    if(color==='red'){
      c.beginPath();c.moveTo(74,112);c.lineTo(87,98);c.quadraticCurveTo(105,62,123,99);
      c.lineTo(136,109);c.quadraticCurveTo(181,66,229,109);c.lineTo(241,99);
      c.quadraticCurveTo(256,62,275,99);c.lineTo(289,112);c.lineTo(289,166);c.lineTo(274,180);
      c.lineTo(274,201);c.lineTo(289,214);c.lineTo(289,252);c.lineTo(273,267);c.lineTo(273,360);
      c.lineTo(261,376);c.lineTo(243,376);c.lineTo(231,361);c.lineTo(231,239);c.lineTo(220,239);
      c.lineTo(218,355);c.lineTo(206,380);c.lineTo(155,380);c.lineTo(143,355);c.lineTo(142,239);
      c.lineTo(130,239);c.lineTo(130,360);c.lineTo(119,376);c.lineTo(101,376);c.lineTo(89,361);
      c.lineTo(89,267);c.lineTo(74,252);c.lineTo(74,214);c.lineTo(87,201);c.lineTo(87,180);
      c.lineTo(74,166);c.closePath();return;
    }
    if(color==='yellow'){
      c.beginPath();c.moveTo(67,143);c.lineTo(89,136);c.lineTo(103,122);c.lineTo(95,107);
      c.lineTo(103,98);c.lineTo(117,107);c.lineTo(142,94);c.lineTo(142,84);c.lineTo(154,83);
      c.lineTo(156,73);c.lineTo(164,74);c.lineTo(162,85);c.lineTo(200,85);c.lineTo(199,75);
      c.lineTo(207,74);c.lineTo(210,85);c.lineTo(219,88);c.lineTo(219,95);c.lineTo(244,107);
      c.lineTo(258,98);c.lineTo(268,106);c.lineTo(260,121);c.lineTo(274,135);c.lineTo(297,142);
      c.lineTo(297,166);c.lineTo(274,174);c.lineTo(258,187);c.lineTo(258,267);
      c.lineTo(244,287);c.lineTo(265,303);c.lineTo(265,244);c.lineTo(273,233);c.lineTo(291,233);
      c.lineTo(299,244);c.lineTo(299,289);c.lineTo(305,300);c.lineTo(305,338);c.lineTo(297,350);
      c.lineTo(297,375);c.lineTo(265,375);c.lineTo(265,351);c.lineTo(219,351);c.lineTo(209,362);
      c.lineTo(155,362);c.lineTo(144,351);c.lineTo(100,351);c.lineTo(100,375);c.lineTo(66,375);
      c.lineTo(66,351);c.lineTo(58,338);c.lineTo(58,300);c.lineTo(65,289);c.lineTo(65,244);
      c.lineTo(73,233);c.lineTo(91,233);c.lineTo(100,244);c.lineTo(100,303);c.lineTo(120,287);
      c.lineTo(105,267);c.lineTo(105,187);c.lineTo(89,174);c.lineTo(67,166);c.closePath();return;
    }
    // Isolate the printed vessel inside its original rectangular token at draw time.
    c.beginPath(); c.ellipse(181,158,85,84,0,0,TAU);
    c.moveTo(150,224); c.lineTo(105,302); c.lineTo(82,302); c.lineTo(82,228);
    c.quadraticCurveTo(68,201,53,228); c.lineTo(53,348); c.lineTo(80,348);
    c.lineTo(114,339); c.lineTo(146,355); c.lineTo(163,355); c.lineTo(181,375);
    c.lineTo(199,355); c.lineTo(218,355); c.lineTo(251,339); c.lineTo(283,348);
    c.lineTo(312,348); c.lineTo(312,228); c.quadraticCurveTo(296,201,282,228);
    c.lineTo(282,302); c.lineTo(258,302); c.lineTo(213,224); c.closePath();
  }
  function cutShip(img,key='blue-1') {
    const c=document.createElement('canvas'); c.width=363;c.height=478;
    const g=c.getContext('2d'); hullPath(g,key.split('-')[0]);g.clip();g.drawImage(img,0,0,363,478);return c;
  }
  function circle(c,x,y,r,fill,stroke,line=2) {
    if(r<=0)return;c.beginPath();c.arc(x,y,r,0,TAU);
    if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=line;c.stroke();}
  }
  function star(c,x,y,r,fill,rotation=0) {
    c.beginPath();for(let i=0;i<16;i++){const a=rotation+i*Math.PI/8,rr=i%2?r*.39:r;
      const px=x+Math.cos(a)*rr,py=y+Math.sin(a)*rr;i?c.lineTo(px,py):c.moveTo(px,py);}
    c.closePath();c.fillStyle=fill;c.fill();
  }
  function vessel(c,x,y,angle=0,kind='blue',flash=0,scan=0) {
    c.save();c.translate(x,y);c.rotate(angle);const key=kind==='red'?settings.otherColor+'-'+settings.otherNumber:settings.color+'-'+settings.number;const img=art[key],w=108,h=142;
    if(flash>0){c.shadowColor='#61e1ff';c.shadowBlur=22*flash;}
    c.drawImage(img,-w/2,-h/2,w,h);c.shadowBlur=0;
    if(flash>0 || scan>0){
      const layer=overlay;const g=layer.getContext('2d');g.globalCompositeOperation='source-over';g.clearRect(0,0,363,478);g.drawImage(img,0,0);g.globalCompositeOperation='source-atop';
      if(flash>0){g.fillStyle=rgba(flash*.8);g.fillRect(0,0,363,478);}
      if(scan>0){g.strokeStyle=rgba(scan);g.lineWidth=4;
        for(let n=0;n<478;n+=28){g.beginPath();g.moveTo(0,n);g.lineTo(363,n);g.stroke();}
        for(let n=0;n<363;n+=28){g.beginPath();g.moveTo(n,0);g.lineTo(n,478);g.stroke();}}
      c.drawImage(layer,-w/2,-h/2,w,h);
    }c.restore();
  }
  function sparks(c,x,y,t,large=false) {
    if(t<0||t>1)return;const count=large?22:14;
    for(let i=0;i<count;i++){
      const a=i*2.399+0.3, distance=(large?125:84)*ease(t)*(0.5+0.5*((i*17)%9)/9);
      const px=x+Math.cos(a)*distance,py=y+Math.sin(a)*distance+(large?20:13)*t*t;
      c.globalAlpha=1-t;c.strokeStyle=i%3?'#ffb24d':'#fff3bb';c.lineWidth=(large?5:4)*(1-t)+1;c.lineCap='round';
      c.beginPath();c.moveTo(px,py);c.lineTo(px+Math.cos(a)*(13*(1-t)+3),py+Math.sin(a)*13*(1-t));c.stroke();
    }c.globalAlpha=1;
  }
  function ship_energy_pickup(c,t) {
    const flash=Math.max(0,Math.sin(clamp((t-.85)/.65)*Math.PI));
    vessel(c,240,142,0,'blue',flash);
  }
  function ship_hit(c,t) {
    const q=(t-.65)/.65,shake=q>0&&q<1?Math.sin(q*47)*4*(1-q):0;
    vessel(c,240+shake,145,0,'blue');
    // Printed number center: (181,157) in the original 363×478 sprite.
    const anchorY=settings.color==='gray'?176:157;
    const impactX=240+shake+(181/363-.5)*108,impactY=145+(anchorY/478-.5)*142;
    if(q>=0&&q<1){sparks(c,impactX,impactY,q);if(q<.5){star(c,impactX,impactY,29*(1-q*2),'#ffb04c',q);star(c,impactX,impactY,17*(1-q*2),'#fff4bd',q);}}
  }
  function ship_collision_destroy(c,t) {
    // Both ship centers reach the same cell before the explosion starts.
    const p=smooth(t/.8),q=(t-.95)/1.2;
    // Once the impact shake finishes, both vessels are removed under the blast.
    if(t<1.3){
      vessel(c,140+100*p,139,Math.PI/2,'blue');vessel(c,340-100*p,139,-Math.PI/2,'red');
    }
    if(q>=0&&q<1){
      circle(c,240,139,28+90*ease(q),null,`rgba(255,191,94,${(1-q)*.8})`,7*(1-q)+1);
      if(q<.68){const size=Math.sin(clamp(q/.68)*Math.PI)*94+8;
        star(c,240,139,size*1.15,'#ff7447',q*.8);star(c,240,139,size*.8,'#ffc45f',-.3);star(c,240,139,size*.42,'#fff0b1',.3);}
      for(let i=0;i<9;i++){const a=i*2.4,r=30+q*52;c.globalAlpha=Math.sin(q*Math.PI)*.68;
        circle(c,240+Math.cos(a)*r,139+Math.sin(a)*r-13*q,12+17*q,'#697f89');}c.globalAlpha=1;
      sparks(c,240,139,q,true);
    }
  }
  function dropletPosition(p) {return settings.path?settings.path(p):{x:88+294*p,y:145-27*Math.sin(Math.PI*p)};}
  function dropletHeading(p) {if(!settings.path)return Math.atan2(-27*Math.PI*Math.cos(Math.PI*p),294);const a=settings.path(clamp(p-.001)),b=settings.path(clamp(p+.001));return Math.atan2(b.y-a.y,b.x-a.x);}
  function movePosition(p) {return settings.path?settings.path(p):{x:86+296*p,y:154-38*Math.sin(Math.PI*p)};}
  function trail(c,position,p,age,width,isDroplet) {
    for(let i=0;i<45;i++){
      const u=i/44, sample=p-age*(1-u);if(sample<0||sample>1)continue;const at=position(sample);
      c.globalAlpha=(.04+.65*u)*clamp((1.42-p)/.42);
      circle(c,at.x,at.y,width*(.15+.85*u),isDroplet?'#247fab':'#2e8dba');
      if(u>.25)circle(c,at.x,at.y,width*.3*u,isDroplet?'#b0f6ff':'#8ceaff');
    }c.globalAlpha=1;
  }
  function dropletWake(c,progress,time) {
    // Flow envelopes the full body, rounds its leading face, and sheds two wakes.
    const end=Math.min(1,progress),start=Math.max(0,progress-.58);
    if(end<=start)return;
    const fade=1-smooth((progress-1)/.58),pos=dropletPosition(end),heading=dropletHeading(end);
    const world=(x,y)=>({x:pos.x+Math.cos(heading)*x-Math.sin(heading)*y,
                        y:pos.y+Math.sin(heading)*x+Math.cos(heading)*y});
    c.save();c.globalAlpha=fade;c.lineCap='round';c.lineJoin='round';
    for(const side of [-1,1]) {
      const points=[];
      for(let i=0;i<=72;i++) {
        const u=i/72,p=start+(end-start)*u,a=dropletHeading(p),at=dropletPosition(p);
        const age=(end-p)*294,flank=4+14*Math.exp(-age/32);
        const ripple=Math.sin(age*.065-time*6)*Math.min(age/30,1)*1.1;
        const n=side*(flank+ripple);
        points.push({x:at.x+10*Math.cos(a)-Math.sin(a)*n,
                     y:at.y+10*Math.sin(a)+Math.cos(a)*n});
      }
      const first=points[0],front=world(35,0);
      const ink=c.createLinearGradient(first.x,first.y,front.x,front.y);
      ink.addColorStop(0,'rgba(64,177,244,0)');
      ink.addColorStop(.35,'rgba(64,177,244,.08)');
      ink.addColorStop(.78,'rgba(93,220,255,.32)');
      ink.addColorStop(1,'rgba(158,245,255,.27)');
      const draw=()=>{
        c.beginPath();points.forEach((v,i)=>i?c.lineTo(v.x,v.y):c.moveTo(v.x,v.y));
        const one=world(27,side*19),two=world(36,side*13);
        c.bezierCurveTo(one.x,one.y,two.x,two.y,front.x,front.y);c.stroke();
      };
      c.strokeStyle=ink;c.shadowColor='#48cfff';c.shadowBlur=9;
      c.lineWidth=7;c.globalAlpha=fade*.22;draw();
      c.shadowBlur=0;c.filter='blur(1.2px)';c.lineWidth=1.8;c.globalAlpha=fade*.4;draw();
      c.filter='none';
      // Boost only the wake behind the body; leave the soft body envelope unchanged.
      const tail=points.filter((v,i)=>(end-(start+(end-start)*i/72))*294>=30);
      if(tail.length>1){
        const tip=tail[tail.length-1];
        const tailInk=c.createLinearGradient(first.x,first.y,tip.x,tip.y);
        tailInk.addColorStop(0,'rgba(64,177,244,0)');
        tailInk.addColorStop(.22,'rgba(64,177,244,.22)');
        tailInk.addColorStop(.7,'rgba(108,229,255,.66)');
        tailInk.addColorStop(1,'rgba(139,238,255,.25)');
        const drawTail=()=>{c.beginPath();tail.forEach((v,i)=>i?c.lineTo(v.x,v.y):c.moveTo(v.x,v.y));c.stroke();};
        c.strokeStyle=tailInk;c.filter='blur(2px)';c.lineWidth=7;c.globalAlpha=fade*.6;drawTail();
        c.filter='blur(.6px)';c.lineWidth=2.4;c.globalAlpha=fade*.8;drawTail();
        c.filter='none';
      }
    }
    // A translucent sheath follows the silhouette, including the pointed rear.
    c.translate(pos.x,pos.y);c.rotate(heading);
    const outline=()=>{
      c.beginPath();c.moveTo(-34,0);
      c.bezierCurveTo(-15,-5,0,-19,16,-18);
      c.bezierCurveTo(40,-17,40,17,16,18);
      c.bezierCurveTo(0,19,-15,5,-34,0);c.closePath();
    };
    const aura=c.createRadialGradient(10,0,4,10,0,42);
    aura.addColorStop(0,'rgba(84,218,255,.025)');
    aura.addColorStop(.65,'rgba(84,218,255,.07)');
    aura.addColorStop(1,'rgba(84,218,255,0)');
    // Only a diffuse fill surrounds the body; no contour or dashed highlights.
    c.fillStyle=aura;c.globalAlpha=fade;c.shadowBlur=0;c.filter='blur(3px)';outline();c.fill();
    c.restore();
  }
  function droplet_move(c,t) {
    let p=clamp((t-.55)/1.25),pos=dropletPosition(p);
    // A filled, soft light cloud spreads outward from the departure center.
    if(t>=.48&&t<1.23){
      const age=(t-.48)/.75,origin=dropletPosition(0);
      const radius=7+49*ease(age),opacity=smooth(age/.1)*Math.pow(1-age,1.25);
      c.save();c.globalAlpha=opacity;
      const glow=c.createRadialGradient(origin.x,origin.y,0,origin.x,origin.y,radius);
      glow.addColorStop(0,'rgba(229,253,255,.96)');
      glow.addColorStop(.18,'rgba(163,241,255,.78)');
      glow.addColorStop(.48,'rgba(75,204,255,.45)');
      glow.addColorStop(.76,'rgba(51,158,235,.16)');
      glow.addColorStop(1,'rgba(51,158,235,0)');
      c.fillStyle=glow;c.fillRect(origin.x-radius,origin.y-radius,radius*2,radius*2);
      // A small bright core dissolves into the expanding volume, never an outline.
      const coreRadius=4+15*ease(age),core=c.createRadialGradient(origin.x,origin.y,0,origin.x,origin.y,coreRadius);
      core.addColorStop(0,'rgba(228,253,255,.8)');core.addColorStop(1,'rgba(119,230,255,0)');
      c.globalAlpha=opacity*(1-age);c.fillStyle=core;
      c.fillRect(origin.x-coreRadius,origin.y-coreRadius,coreRadius*2,coreRadius*2);
      // Short tapered rays and small shards add force to the filled light cloud.
      const blast=clamp((age-.035)/.8),power=Math.pow(1-blast,1.8)*smooth(age/.09);
      c.shadowColor='#6bdfff';c.shadowBlur=4*power;
      for(let i=0;i<9;i++){
        const angle=i*2.399+.35,spread=.6+(i%4)*.12;
        const reach=7+46*ease(blast)*spread,length=(12+i%3*4)*(1-blast),width=1.8*(1-blast);
        c.save();c.translate(origin.x,origin.y);c.rotate(angle);
        c.globalAlpha=power*.75;
        const ray=c.createLinearGradient(reach,0,reach+length,0);
        ray.addColorStop(0,'rgba(83,212,255,0)');ray.addColorStop(.45,'rgba(180,247,255,.9)');ray.addColorStop(1,'rgba(225,253,255,0)');
        c.fillStyle=ray;c.beginPath();c.moveTo(reach,-width);c.lineTo(reach+length,0);c.lineTo(reach,width);c.closePath();c.fill();c.restore();
      }
      for(let i=0;i<7;i++){
        const angle=i*2.399+1,reach=10+48*ease(blast)*(.55+(i%3)*.14);
        const size=(1.5+i%2)*Math.sin(Math.PI*clamp(blast/.95));
        c.save();c.translate(origin.x+Math.cos(angle)*reach,origin.y+Math.sin(angle)*reach);
        c.rotate(angle+blast*2);c.globalAlpha=power*.85;c.fillStyle=i%2?'#80e6ff':'#ddfcff';
        c.beginPath();c.moveTo(-size*1.7,0);c.lineTo(0,-size);c.lineTo(size*1.7,0);c.lineTo(0,size);c.closePath();c.fill();c.restore();
      }
      c.restore();
    }
    if(t>.55&&t<2.5)dropletWake(c,(t-.55)/1.25,t);
    // The image's pointed top is its tail: rotate it backward along the path.
    c.save();c.translate(pos.x,pos.y);c.rotate(dropletHeading(p)-Math.PI/2);c.drawImage(art.droplet,-14,-30,28,60);c.restore();
  }
  function ship_detected(c,t) {
    const q=clamp((t-.25)/1.5),a=Math.sin(q*Math.PI),lineX=149+182*q;
    if(t>.25&&t<1.75){c.fillStyle=rgba(a*.08);c.fillRect(lineX-55,72,55,137);
      c.strokeStyle=rgba(a*.9);c.lineWidth=3;c.beginPath();c.moveTo(lineX,75);c.lineTo(lineX,207);c.stroke();}
    vessel(c,240,145,0,'blue',0,a);
    const a2=a*.8;c.strokeStyle=rgba(a2);c.lineWidth=2;
    for(const [x,y,sx,sy]of [[194,92,1,1],[286,92,-1,1],[194,198,1,-1],[286,198,-1,-1]]){
      c.beginPath();c.moveTo(x,y+sy*13);c.lineTo(x,y);c.lineTo(x+sx*13,y);c.stroke();}
    if(t>1&&t<1.75){circle(c,294,87,4,'#91ebfd');}
  }
  function ship_move(c,t) {
    const raw=(t-.3)/1.45,p=clamp(raw),pos=movePosition(p);
    if(raw>0&&raw<1.45)trail(c,movePosition,raw,.27,8,false);
    const a=movePosition(clamp(p-.001)),b=movePosition(clamp(p+.001));const angle=Math.atan2(b.y-a.y,b.x-a.x)+Math.PI/2;
    if(p>0&&p<1){c.save();c.translate(pos.x,pos.y);c.rotate(angle);
      const flame=15+Math.sin(t*40)*4;
      c.beginPath();c.moveTo(-9,30);c.quadraticCurveTo(-10,43,0,45+flame);c.quadraticCurveTo(10,43,9,30);c.fillStyle='#4cc9f5';c.fill();
      c.beginPath();c.moveTo(-4,30);c.lineTo(0,43+flame*.4);c.lineTo(4,30);c.fillStyle='#d2faff';c.fill();c.restore();}
    vessel(c,pos.x,pos.y,angle,'blue');
  }

    const renderers={ship_energy_pickup,ship_hit,ship_collision_destroy,droplet_move,ship_detected,ship_move};
    return {
      prepare:cutShip,
      draw(c,effect,t,options){
        settings=options;
        c.save();
        try {
          if(effect!=='ship_move'&&effect!=='droplet_move'){
            c.translate(options.x,options.y);c.rotate(options.rotation);c.scale(options.scale,options.scale);c.translate(-240,-145);
          }
          renderers[effect](c,t);
        } finally {c.restore();}
      }
    };
  }
  global.DarkCampaignFXRenderer={create:createRenderer};
})(globalThis);
