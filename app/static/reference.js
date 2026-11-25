"use strict";
(() => {
  const viewer=document.getElementById('rulebook-viewer');
  const toggle=document.getElementById('rulebook-button');
  const image=document.getElementById('rulebook-page');
  const previous=document.getElementById('rulebook-previous');
  const next=document.getElementById('rulebook-next');
  let page=1, returnFocus=null;
  function render(){
    image.src=`/static/rulebook/page-${page}.png`;
    image.alt=`Rule book — ${page} / 3`;
    previous.disabled=page===1;next.disabled=page===3;
    document.getElementById('rulebook-counter').textContent=`${page} / 3`;
  }
  function close(){viewer.hidden=true;toggle.setAttribute('aria-expanded','false');returnFocus?.focus();}
  toggle.onclick=()=>{
    if(!viewer.hidden){close();return;}
    returnFocus=document.activeElement;render();viewer.hidden=false;
    toggle.setAttribute('aria-expanded','true');toggle.focus();
  };
  previous.onclick=()=>{if(page>1){page--;render();}};
  next.onclick=()=>{if(page<3){page++;render();}};
  document.getElementById('rulebook-close').onclick=close;
  document.addEventListener('keydown',event=>{
    if(viewer.hidden)return;
    if(event.key==='Escape'){event.preventDefault();close();}
    if(event.key==='ArrowLeft'){event.preventDefault();previous.click();}
    if(event.key==='ArrowRight'){event.preventDefault();next.click();}
    if(event.key==='Tab'){
      const items=[toggle,...viewer.querySelectorAll('button:not(:disabled)')];
      const index=items.indexOf(document.activeElement);
      event.preventDefault();items[(index+(event.shiftKey?-1:1)+items.length)%items.length].focus();
    }
  });
  document.getElementById('language-button').onclick=()=>I18n.toggle();
  document.addEventListener('languagechange',()=>{
    document.getElementById('language-button').textContent=I18n.language==='en'?'中':'EN';
    // Refit the existing console after localized text changes its natural size.
    window.dispatchEvent(new Event('resize'));
  });
  for(let i=1;i<=3;i++){const preload=new Image();preload.src=`/static/rulebook/page-${i}.png`;}
})();
