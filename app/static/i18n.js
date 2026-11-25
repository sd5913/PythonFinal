"use strict";
// Chinese remains the canonical wire/log language; localization never changes game state.
const I18n = (() => {
  let language = "en";
  let names = [];
  const catalog = {
    "规则书":"Rule book","上一页":"Previous page","下一页":"Next page","关闭规则书":"Close rule book","界面工具":"Interface tools","切换语言":"Switch language",
    "房间或身份已失效":"Room or session expired","已离开房间":"Left the room","舰船种类":"Ship class","种类":" class","选择":"Select ","此座位已在另一个连接打开":"This seat is open in another connection",
    "0档转向":"Turn around (gear 0)","黄色 · 确认":"Yellow · Confirmed","蓝色 · 推测":"Blue · Suspected",
    "深空乱斗 · 指挥终端":"Dark Campaign · Command terminal",
    "深空之中，":"In deep space,", "集结你的":"assemble your ", "舰队。":"fleet.",
    "建立通信，召集你的队友。":"Establish communications. Rally your crew.","从同一片星域出发。":"Set out from the same starfield.",
    "名指挥官":"commanders","同一 Wi-Fi · 浏览器加入":"Same Wi-Fi · Join in your browser",
    "通信待命 · 请输入你的指挥官昵称。":"Comms standing by · Enter your commander name.",
    "确认指挥官身份":"Identify your commander","你的昵称将显示在队友的集结列表中。":"Your name appears in your crew's assembly list.",
    "指挥官昵称":"Commander name","输入你的呼号":"Enter your callsign","建立集结点":"Create an assembly point",
    "开启独立通信频道，等待队友接入。":"Open a private channel and wait for your crew.","创建后生成专属房间号":"A room code is generated when you create a room",
    "创建房间":"Create room","接入友方舰队":"Join your fleet","已有队友建立频道？输入房间号会合。":"Crew already online? Enter their room code to join.",
    "六位房间号":"Six-character room code","加入房间":"Join room","离开房间":"Leave room",
    "邀请队友接入":"Invite your crew","打开下方地址，再输入房间号。":"Open this address, then enter the room code.",
    "舰队席位":"Fleet seats","开始游戏":"Start game","发送联机测试信号":"Send connection test",
    "通信记录":"Comms log","菜单不会暂停其他玩家的操作。":"This menu does not pause other players.",
    "退出游戏 · 全员返回备战大厅":"Exit match · Everyone returns to the lobby","继续游戏":"Resume game",
    "关闭、刷新或返回大厅将退出房间":"Closing, refreshing or going back leaves the room",
    "局域网联机":"LAN multiplayer","联机大厅":"Multiplayer lobby","舰队集结":"Fleet assembly",
    "游戏信息":"Game information","设置":"Settings","对局界面":"Game view","房间号":"Room code",
    "（你）":" (you)","房主":"Host","正在接入":"Connecting","已连接 · 已准备":"Connected · Ready",
    "已连接 · 等待准备":"Connected · Waiting","等待指挥官":"Waiting for commander","频道待接入":"Channel open",
    "取消准备":"Unready","所有人已准备，等待房主开始游戏。":"Everyone is ready. Waiting for the host to start.",
    "至少两人连接并准备后，房主可以开始游戏。":"The host can start once at least two connected players are ready.",
    "已入座":"Seated","正在连接房间…":"Connecting to room…","已连接 · 房间状态实时同步":"Connected · Room updates in real time",
    "此座位已在另一个连接打开。":"This seat is open in another connection.","已退出房间，请重新创建或加入。":"You have left the room. Create or join a room again.",
    "无法连接服务器，请确认服务仍在运行。":"Cannot connect. Check that the server is running.","请输入昵称。":"Enter a name.",
    "请检查昵称和房间号。":"Check your name and room code.","连接失败。":"Connection failed.","请输入六位字母或数字房间号。":"Enter a six-character alphanumeric room code.",
    "已退出房间。":"You have left the room.","准备":"Ready",
    "每支舰队只能由一名指挥官带领。选择会实时展示给队友。":"Each fleet has one commander. Your selection is shared live.",
    "选择你的舰队":"Choose your fleet","等待指挥官选择":"Waiting for fleet selection","等待房主进入对局":"Waiting for the host",
    "进入对局":"Enter match","舰队只能有一名指挥官":"Each fleet can have only one commander",
    "该格已有舰船，请重新摆放。":"This cell is occupied. Place the ship again.",
    "确认部署":"Confirm placement","选择亮起的己方行动舰船":"Select a highlighted friendly ship",
    "选择高亮范围内的一艘敌舰":"Select an enemy ship in the highlighted range",
    "请选择探测问题":"Choose a scan question","横移 · 1能量":"Shift · 1 energy","点选高亮的相邻圈层":"Select a highlighted adjacent orbit",
    "取消横移":"Cancel shift","确认调档":"Confirm gear","情报标记":"Intel markers","拖动放置":"Drag to place","右键消除":"Right-click to remove",
    "舰船状态记录":"Ship intel record","剩余能量":"Energy reserve","公共能量":"Shared energy","舰队控制台":"Fleet console",
    "己方舰种":"Your ship classes","结束回合":"End turn","待部署舰船":"Ships to deploy",
    "您的舰队已被全灭":"Your fleet has been eliminated","平局 · 母舰同时摧毁":"Draw · Motherships destroyed together",
    "您是最后的幸存者":"You are the last survivor","本局回合记录":"Match log","回合记录":"Turn log",
    "全员放置完毕后开始记录":"Logging starts after deployment","请等待其他舰长":"Waiting for other commanders",
    "请部署舰船种类":"Assign your ship classes","选择舰种":"Choose class","部署完成":"Finish assignment",
    "请选择攻击舰*2；探测舰*2；母舰*1":"Choose 2 attack ships, 2 scouts and 1 mothership",
    "仅你可见":"Visible only to you","你的舰种已秘密锁定。其他玩家不会收到你的舰种配置。":"Your classes are locked privately. Other players cannot see your assignments.",
    "背面向上的牌堆":"Face-down deck","卡牌背面":"Card back","抽取卡牌":"Drawing a card",
    "四维空间留存判定":"4D retention check","水滴的回合":"Droplet turn","四维空间碎块将出现在":"4D fragments will appear at",
    "舰船将被传送至：":"Ship will teleport to:","水滴将出现在":"Droplet will appear at",
    "判定成功":"Check passed","判定失败":"Check failed","前进6格":"Advance 6 cells","前进12格":"Advance 12 cells",
    "内移":"Move inward","外移":"Move outward","调头":"Reverse direction","留下黑域":"Leave a black domain",
    "选择一个原生能力问题":"Choose a native ability question","可攻击？":"Can it attack?","可探测？":"Can it scan?",
    "是否发起碰撞？":"Initiate a collision?","撞击警告":"Collision alert","不碰撞":"Skip collision",
    "等待碰撞发起方选择":"Waiting for the initiator","撞击成功":"Collision succeeded","撞击失败":"Collision failed",
    "碰撞判定":"Collision check","发起方点数 ≥ 防守方点数之和，则所有参与舰船各受2点伤害":"If the initiator's roll ≥ the defenders' total, every participating ship takes 2 damage",
    "发起方":"Initiator","防守方":"Defender","对局结束":"Match over","秘密配置舰种":"Secret class assignment","轮流部署舰船":"Deploy ships in turn",
    "每人每次部署一艘 · 初始0档 · 确认后轮到下一位舰长":"One ship per turn · Start at gear 0 · Confirm to pass deployment",
    "位置公开 / 舰种隐藏 · V3 星云与水滴事件":"Positions public / Classes hidden · V3 nebula and droplet events",
    "点选空格，预览部署位置。":"Select an empty cell to preview placement.",
    "拖拽舰船到空格，或点选舰船后选择空格。":"Drag a ship to an empty cell, or select a ship and then a cell.",
    "正在结算移动或途中事件，请稍候":"Resolving movement or events. Please wait.",
    "公共棋盘 · 点选己方舰船查看操作":"Shared board · Select your ship for actions","战斗开始":"Battle begins","你的回合":"Your turn",
    "蓝色空间舰队":"Blue Space Fleet","自然选择舰队":"Natural Selection Fleet","企业舰队":"Enterprise Fleet","终极规律舰队":"Ultimate Law Fleet",
    "攻击舰":"Attack ship","探测舰":"Scout","母舰":"Mothership","舰船种类":"Ship class","舰船":"Ship",
    "顺时针":"Clockwise","逆时针":"Counterclockwise","档位":"Gear ","转向":"Turn around","移动":"Move","战术":"Tactics",
    "攻击":"Attack","探测":"Scan","取消":"Cancel","确认":"Confirm","推测":"Suspected","雷达":"Radar",
    "可用":"Available","已用":"Used","已摧毁":"Destroyed","蓝色":"Blue","黄色":"Yellow","部署":"Deploy ",
    "星云":"Nebula","水滴":"Droplet","事件":" event","碰撞":"Collision","导弹":"Missile","探测器":"Probe","修复组件":"Repair kit",
    "前进档位":"Forward gear","受到一次攻击":"Take one hit","恢复攻击能力":"Restore native attack","获得":"Gain ","能量":" energy",
    "四维留存中的舰船无法行动，也不能成为目标。":"A ship retained in 4D cannot act or be targeted.",
    "四维留存中的舰船无法行动。":"A ship retained in 4D cannot act.",
    "房间不存在或已过期，请检查房间号。":"Room not found or expired. Check the code.","房间数量已达上限，请稍后再试。":"Room limit reached. Try again later.",
    "房间已关闭，请重新创建或加入。":"Room closed. Create or join another room.","游戏已经开始，请等待房间返回备战大厅。":"Match already started. Wait for the room to return to the lobby.",
    "房间已满，最多四人。":"Room full. Maximum four players.","身份校验失败。":"Authentication failed.","消息格式错误。":"Invalid message format.",
    "对局中不能修改准备状态。":"Ready status cannot change during a match.","不支持的操作。":"Unsupported action.",
    "请选择己方舰船。":"Select one of your ships.","请先完成舰种部署。":"Complete class assignment first.","该舰船已经被摧毁。":"This ship has been destroyed.",
    "对局已经开始。":"Match already started.","只有房主可以开始游戏。":"Only the host can start the match.","至少需要两名玩家。":"At least two players are required.",
    "请等待所有玩家连接并准备。":"Wait for everyone to connect and get ready.","舰队选择已开始":"Fleet selection started",
    "当前没有进行中的对局。":"No match is in progress.","一名舰长退出对局，所有玩家返回备战大厅":"A commander exited. Everyone returns to the lobby",
    "当前不能更换舰队。":"Cannot change fleet now.","请选择有效舰队。":"Select a valid fleet.","只有房主可以进入对局。":"Only the host can enter the match.",
    "当前不在舰队选择阶段。":"Not in fleet selection.","舰队只能有一名指挥官，请确保每人都已选择不同舰队。":"Each commander must select a different fleet.",
    "请秘密部署舰船种类":"Assign your ship classes privately","当前不能修改舰船种类。":"Cannot change ship classes now.",
    "当前不在棋盘部署阶段。":"Not in deployment.","请等待其他舰长部署。":"Wait for the other commander to deploy.","请等待水滴生成完成。":"Wait for the droplet to spawn.",
    "该舰船已经部署。":"This ship is already deployed.","无效的部署位置或朝向。":"Invalid deployment cell or direction.","该格已有舰船，请选择空格。":"Cell occupied. Choose an empty cell.",
    "水滴所在格不可初始部署。":"You cannot deploy on the droplet.","请先完成舰船部署。":"Complete deployment first.","你的舰队已被全灭。":"Your fleet is eliminated.",
    "现在不是你的回合。":"It is not your turn.","请等待移动和事件结算完成。":"Wait for movement and events to resolve.","请等待被动移动或开局提示完成。":"Wait for passive movement or the battle intro.",
    "本回合移动部署必须作用于同一艘舰船。":"Movement actions this turn must use the same ship.","本回合已经调过档位。":"Gear was already changed this turn.",
    "请选择不同的有效档位。":"Select a different valid gear.","公共能量不足。":"Not enough shared energy.","本回合已经横移。":"Already shifted this turn.",
    "只能横移到相邻圈层。":"You can only shift to an adjacent orbit.","只有 0 档舰船可以转向。":"Only a ship in gear 0 can turn around.","不支持的游戏操作。":"Unsupported game action.",
    "当前没有等待你处理的碰撞选择。":"No collision decision is waiting for you.","请选择是否碰撞。":"Choose whether to collide.","选择不碰撞。":"Skipped the collision.",
    "本回合已经使用过战术行动。":"Tactical action already used this turn.","该舰船当前无法进行此战术行动。":"This ship cannot perform that tactical action.",
    "请选择敌方舰船。":"Select an enemy ship.","目标不在前后两列的作用范围内。":"Target is outside the two-column range.","请选择探测攻击能力或探测能力。":"Choose attack or scan capability.",
    "最后的幸存者：":"Last survivor: ","双方母舰同时摧毁，平局。":"Draw: the last motherships were destroyed together.",
    "碰撞成功":"Collision succeeded","碰撞失败":"Collision failed","的回合":"'s turn","舰长":" Commander",
    "号：":": ","号舰船":" ship","号":"", "从轨道":"from orbit ","横移至轨道":"shifted to orbit ","被摧毁，在":"destroyed at ","留下资源":"resources dropped",
    "进入黑域，降至0档并停止行程":"entered a black domain; gear set to 0 and movement stopped",
    "四维留存判定成功":"4D retention passed","四维留存判定失败":"4D retention failed","留存在原格":"retained in the current cell","准备传送":"preparing to teleport",
    "传送至":"teleported to ","抽取":"drew ","拾取":"picked up ","受击":"took damage: ","发动探测":"initiated a scan",
    "被动":"Passive ","主动":"Active ","加速":"accelerated ","减速":"decelerated ","消耗":"cost ","朝向":"heading ","从":"from ","至":"to ",
    "已退出房间":"left the room","已连接":"connected","发送了联机测试信号":"sent a connection test",
    "不可":"cannot ","可":"can ","格":" cells","档":" gear","轮":" round","第 ":"Round ","点":" points",
    "列三圈棋盘":" columns, three orbits","联机":"Multiplayer","深空乱斗":"Dark Campaign",
  };
  const keys = Object.keys(catalog).sort((a,b)=>b.length-a.length);
  const pattern = new RegExp(keys.map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|"),"g");
  const texts = new WeakMap(), attrs = new WeakMap();
  function translate(source) {
    if (language === "zh-CN") return source;
    const literals=[];
    for(const name of names) source=source.split(name).join(`\uE000${literals.push(name)-1}\uE001`);
    source=source.replace(/第\s*(\d+)\s*轮/g,'Round $1').replace(/(\d+)号舰船种类/g,'Ship $1 class').replace(/(\d+)号舰船/g,'Ship $1').replace(/(\d+)号/g,'Ship $1');
    return source.replace(pattern, key=>catalog[key]).replace(/，/g,", ").replace(/。/g,".").replace(/；/g,"; ").replace(/：/g,": ").replace(/（/g," (").replace(/）/g,")").replace(/\uE000(\d+)\uE001/g,(_,index)=>literals[index]);
  }
  function apply(root=document.body) {
    const nodes=[];
    if(root.nodeType===Node.TEXT_NODE) nodes.push(root);
    else {const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);while(walk.nextNode())nodes.push(walk.currentNode);}
    for(const node of nodes){
      if(node.parentElement?.closest('script,style,[data-i18n-ignore],.card-caption'))continue;
      const saved=texts.get(node);
      const source=saved&&node.nodeValue===saved.output?saved.source:node.nodeValue;
      const output=translate(source);
      texts.set(node,{source,output});
      if(node.nodeValue!==output)node.nodeValue=output;
    }
    const elements=root.nodeType===Node.ELEMENT_NODE?[root,...root.querySelectorAll('*')]:root.querySelectorAll?.('*')||[];
    for(const element of elements){
      if(element.closest('script,style,[data-i18n-ignore]'))continue;
      const saved=attrs.get(element)||{};
      for(const attr of ['title','placeholder','aria-label','alt']){
        const value=element.getAttribute(attr);if(value===null)continue;
        const source=saved[attr]&&value===saved[attr].output?saved[attr].source:value;
        const output=translate(source);saved[attr]={source,output};
        if(value!==output)element.setAttribute(attr,output);
      }
      attrs.set(element,saved);
    }
  }
  function setLanguage(value){language=value;document.documentElement.lang=value;apply();document.dispatchEvent(new CustomEvent('languagechange'));}
  new MutationObserver(records=>{
    const roots=new Set();for(const record of records){
      if(record.type==='childList')record.addedNodes.forEach(n=>{if(n.isConnected)roots.add(n)});
      else if(record.target.isConnected)roots.add(record.target);
    }
    roots.forEach(root=>apply(root));
  }).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','placeholder','aria-label','alt']});
  document.addEventListener('DOMContentLoaded',()=>apply());
  return {apply,translate,setNames(values){names=[...new Set(values.filter(n=>/[\u4e00-\u9fff]/.test(n)))].sort((a,b)=>b.length-a.length);},get language(){return language;},toggle(){setLanguage(language==='en'?'zh-CN':'en');}};
})();
