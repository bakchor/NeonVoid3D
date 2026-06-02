/* ═══════════════════════════════════════════════════════════
   VOID FIGHTER 3D — game.js
   Space shooter pseudo-3D, ennemis IA, vagues, joystick mobile
═══════════════════════════════════════════════════════════ */
'use strict';

/* ─────────────────── CONFIG ─────────────────── */
const CFG = {
  FOV: 480,
  PLAYER_SPEED: 320,
  BULLET_SPEED: 1400,
  ENEMY_BULLET_SPEED: 480,
  FIRE_RATE: 0.18,        // secondes entre tirs
  PLAYER_HP: 3,
  INVINCIBLE_TIME: 2.2,
  INTERSTITIAL_EVERY: 3,
  ENEMY_TYPES: {
    fighter: { hp:1, speed:380, size:18, track:0.6, shootRate:2.2, color:'#ff00aa', score:100 },
    bomber:  { hp:3, speed:200, size:28, track:0.3, shootRate:1.4, color:'#ff6600', score:250 },
    dart:    { hp:1, speed:620, size:14, track:0.9, shootRate:3.5, color:'#ff0044', score:150 },
    titan:   { hp:8, speed:140, size:44, track:0.2, shootRate:0.8, color:'#cc00ff', score:600 },
  },
  WAVES: [
    { enemies:[{t:'fighter',n:4}] },
    { enemies:[{t:'fighter',n:5},{t:'dart',n:2}] },
    { enemies:[{t:'fighter',n:4},{t:'bomber',n:2}] },
    { enemies:[{t:'fighter',n:6},{t:'dart',n:3},{t:'bomber',n:1}] },
    { enemies:[{t:'fighter',n:5},{t:'dart',n:4},{t:'bomber',n:2},{t:'titan',n:1}] },
  ],
};

/* ─────────────────── STATE ─────────────────── */
let canvas, ctx, W=0, H=0;
let VPX=0, VPY=0;         // vanishing point (center screen)
let PBOUND_X=0, PBOUND_Y=0; // player movement bounds

let state       = 'MENU'; // MENU|PLAYING|PAUSED|DEAD|GAME_OVER
let score       = 0;
let hiScore     = 0;
let hiWave      = 0;
let waveNum     = 1;
let deathCount  = 0;
let rewardUsed  = false;

// Player
const player = { x:0, y:80, hp:CFG.PLAYER_HP, maxHp:CFG.PLAYER_HP,
                  invTimer:0, fireTimer:0, alive:true, shield:1.0 };

// Collections
let enemies       = [];
let playerBullets = [];
let enemyBullets  = [];
let particles     = [];
let stars         = [];
let waveQueue     = [];   // enemies left to spawn in this wave
let waveSpawnTimer = 0;
let waveCleared   = false;
let waveNextTimer = 0;

// Input
const keys = {};
const joy  = { active:false, x:0, y:0, startX:0, startY:0, touchId:null };
let   mouseDown = false;
let   mobileFireHeld = false;

// Audio
let audioCtx=null, masterGain=null, soundOn=true, ambNodes=[];

/* ─────────────────── AUDIO ─────────────────── */
function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx   = new (window.AudioContext||window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(audioCtx.destination);
  } catch(e) { soundOn=false; }
}
function tone(freq,type,dur,vol,fe,delay){
  if(!soundOn||!audioCtx) return;
  const t=audioCtx.currentTime+(delay||0);
  const o=audioCtx.createOscillator(), g=audioCtx.createGain();
  o.connect(g); g.connect(masterGain);
  o.type=type; o.frequency.setValueAtTime(freq,t);
  if(fe) o.frequency.exponentialRampToValueAtTime(fe,t+dur);
  g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  o.start(t); o.stop(t+dur+.05);
}
function playSound(n){
  if(!soundOn||!audioCtx) return;
  switch(n){
    case 'shoot':  tone(880,'square',.06,.06,1200); break;
    case 'hit':    tone(200,'sawtooth',.12,.2,80); break;
    case 'explo':  [0,1,2].forEach(i=>tone(150-i*30,'sawtooth',.35,.25,30,i*.06)); break;
    case 'die':    [0,1,2,3].forEach(i=>tone(300-i*50,'sawtooth',.4,.3,30,i*.07)); break;
    case 'wave':   [523,659,784,1047].forEach((f,i)=>tone(f,'sine',.25,.18,0,i*.1)); break;
    case 'ui':     tone(880,'sine',.07,.08); break;
    case 'start':  tone(220,'sine',.35,.2,880); break;
    case 'shield': tone(440,'sine',.15,.12,220); break;
  }
}
function startMusic(){
  if(!soundOn||!audioCtx||ambNodes.length) return;
  const bass=audioCtx.createOscillator(), bG=audioCtx.createGain();
  bass.connect(bG); bG.connect(masterGain); bass.type='sawtooth'; bass.frequency.value=55; bG.gain.value=.065; bass.start(); ambNodes.push(bass);
  const pad=audioCtx.createOscillator(), pF=audioCtx.createBiquadFilter(), pG=audioCtx.createGain();
  pad.connect(pF); pF.connect(pG); pG.connect(masterGain); pad.type='sawtooth'; pad.frequency.value=110; pF.type='lowpass'; pF.frequency.value=330; pG.gain.value=.035; pad.start(); ambNodes.push(pad);
  const arp=audioCtx.createOscillator(), aG=audioCtx.createGain();
  arp.connect(aG); aG.connect(masterGain); arp.type='triangle'; arp.frequency.value=220; aG.gain.value=0; arp.start(); ambNodes.push(arp);
  let s=0; const notes=[220,330,415,440,554,660,830,554];
  const iv=setInterval(()=>{
    if(!soundOn||state!=='PLAYING') return;
    const now=audioCtx.currentTime;
    arp.frequency.setValueAtTime(notes[s++%notes.length],now);
    aG.gain.setValueAtTime(.032,now); aG.gain.exponentialRampToValueAtTime(.001,now+.18);
  },210);
  ambNodes.push({_iv:iv});
}
function stopMusic(){
  ambNodes.forEach(n=>{ try{if(n.stop)n.stop();}catch(e){} if(n._iv)clearInterval(n._iv); });
  ambNodes=[];
}

/* ─────────────────── PERSPECTIVE ─────────────────── */
function project(wx,wy,wz){
  const scale=CFG.FOV/Math.max(1,wz+CFG.FOV);
  return { sx:VPX+wx*scale, sy:VPY+wy*scale, scale };
}
function rgba(hex,a){
  const n=parseInt(hex.replace('#',''),16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
}

/* ─────────────────── INIT ─────────────────── */
function init(){
  canvas = document.getElementById('game-canvas');
  ctx    = canvas.getContext('2d');
  hiScore = parseInt(localStorage.getItem('vf_hs')||'0');
  hiWave  = parseInt(localStorage.getItem('vf_hw')||'0');
  resize(); window.addEventListener('resize',resize);
  initStars(); setupInput(); setupButtons();
  updateMenuUI();
  window.NeonVoid = { continueGame, resetHS };
  // Animate menu background
  initMenuBg();
  requestAnimationFrame(loop);
}

function resize(){
  const gc=document.getElementById('game-container');
  if(!gc) return;
  const rect=gc.getBoundingClientRect();
  W=Math.floor(Math.min(rect.width,440));
  H=Math.floor(W*16/9);
  const maxH=Math.floor(window.innerHeight*.78);
  if(H>maxH){H=maxH;W=Math.floor(H*9/16);}
  canvas.width=W; canvas.height=H;
  canvas.style.width=W+'px'; canvas.style.height=H+'px';
  VPX=W/2; VPY=H*.42;
  PBOUND_X=W*.32; PBOUND_Y=H*.3;
}

function initStars(){
  stars=[];
  // 3 layers of parallax depth
  for(let i=0;i<120;i++){
    const layer=Math.floor(Math.random()*3); // 0=far, 1=mid, 2=near
    stars.push({x:Math.random(),y:Math.random(),r:(.3+layer*.6)*(Math.random()*.8+.4),
      br:.3+layer*.3+Math.random()*.3, ph:Math.random()*Math.PI*2, spd:.007+layer*.01,
      scrollSpd:.4+layer*1.2, layer});
  }
}

/* ─────────────────── INPUT ─────────────────── */
function setupInput(){
  window.addEventListener('keydown',e=>{
    keys[e.code]=true;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyW','KeyA','KeyS','KeyD','Space','KeyP','Escape'].includes(e.code)) e.preventDefault();
    if((e.code==='KeyP'||e.code==='Escape') && state==='PLAYING') togglePause();
    if((e.code==='KeyP'||e.code==='Escape') && state==='PAUSED')  togglePause();
  });
  window.addEventListener('keyup',e=>{ keys[e.code]=false; });

  // Mouse click = fire
  canvas.addEventListener('mousedown',()=>{ mouseDown=true; });
  canvas.addEventListener('mouseup',()=>{ mouseDown=false; });

  // Joystick touch
  const jb=document.getElementById('joy-base');
  if(jb){
    jb.addEventListener('touchstart',e=>{
      e.preventDefault();
      const t=e.changedTouches[0];
      const r=jb.getBoundingClientRect();
      joy.active=true; joy.touchId=t.identifier;
      joy.startX=r.left+r.width/2; joy.startY=r.top+r.height/2;
      joy.x=0; joy.y=0;
    },{passive:false});
    jb.addEventListener('touchmove',e=>{
      e.preventDefault();
      const touch=[...e.touches].find(t=>t.identifier===joy.touchId);
      if(!touch) return;
      const maxR=44;
      let dx=touch.clientX-joy.startX, dy=touch.clientY-joy.startY;
      const dist=Math.hypot(dx,dy);
      if(dist>maxR){dx=dx/dist*maxR; dy=dy/dist*maxR;}
      joy.x=dx/maxR; joy.y=dy/maxR;
      const knob=document.getElementById('joy-knob');
      if(knob){knob.style.left=(50+joy.x*38)+'%'; knob.style.top=(50+joy.y*38)+'%';}
    },{passive:false});
    const endJoy=()=>{
      joy.active=false; joy.x=0; joy.y=0; joy.touchId=null;
      const knob=document.getElementById('joy-knob');
      if(knob){knob.style.left='50%'; knob.style.top='50%';}
    };
    jb.addEventListener('touchend',endJoy,{passive:false});
    jb.addEventListener('touchcancel',endJoy,{passive:false});
  }

  // Fire button mobile
  const fb=document.getElementById('btn-fire-mobile');
  if(fb){
    fb.addEventListener('touchstart',e=>{e.preventDefault();mobileFireHeld=true;},{passive:false});
    fb.addEventListener('touchend',()=>mobileFireHeld=false,{passive:false});
    fb.addEventListener('touchcancel',()=>mobileFireHeld=false,{passive:false});
  }
}

/* ─────────────────── BUTTONS ─────────────────── */
function setupButtons(){
  const on=(id,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener('click',()=>{playSound('ui');fn();});};
  on('btn-start', startGame);
  on('btn-retry', startGame);
  on('btn-resume',resumeGame);
  on('btn-pause', togglePause);
  on('btn-quit-p',quitMenu);
  on('btn-menu',  quitMenu);
  on('btn-share', openShare);
  on('btn-def',   copyChallenge);
  on('btn-cls',   ()=>document.getElementById('modal-share').style.display='none');
  on('btn-dl',    dlShare);
  on('btn-fs',    toggleFS);
  on('btn-fs2',   toggleFS);
  on('btn-int',   closeInt);
  on('btn-snd',   toggleSnd);
  on('btn-rst',   resetHS);
}

/* ─────────────────── GAME LIFECYCLE ─────────────────── */
function startGame(){
  initAudio();
  if(audioCtx&&audioCtx.state==='suspended') audioCtx.resume();

  score=0; waveNum=1; waveCleared=false; waveNextTimer=0;
  player.x=0; player.y=80; player.hp=CFG.PLAYER_HP; player.maxHp=CFG.PLAYER_HP;
  player.invTimer=0; player.fireTimer=0; player.alive=true; player.shield=1;
  rewardUsed=false;
  enemies=[]; playerBullets=[]; enemyBullets=[]; particles=[];

  // Reset rewarded btn
  const rz=document.getElementById('rewarded-zone');
  if(rz) rz.innerHTML='<button class="rew-btn" id="btn-rew" onclick="triggerRewardedAd()">👁 Voir une pub → <strong>CONTINUER</strong></button>';

  buildWave(waveNum);
  showScreen('game');
  state='PLAYING';
  playSound('start');
  setTimeout(startMusic,500);
  updateHUD();
}

function resumeGame(){state='PLAYING';showScreen('game');startMusic();}
function togglePause(){
  if(state==='PLAYING'){state='PAUSED';stopMusic();showScreen('pause');}
  else if(state==='PAUSED'){state='PLAYING';showScreen('game');startMusic();}
}
function quitMenu(){state='MENU';stopMusic();showScreen('menu');updateMenuUI();}

/* ─────────────────── WAVES ─────────────────── */
function buildWave(n){
  waveQueue=[];
  const wIdx=Math.min(n-1,CFG.WAVES.length-1);
  const wDef=CFG.WAVES[wIdx];
  // Scale up for later waves beyond defined ones
  const scale=Math.max(1,Math.floor((n-1)/(CFG.WAVES.length))+1);
  for(const grp of wDef.enemies){
    for(let i=0;i<grp.n*scale;i++) waveQueue.push(grp.t);
  }
  // Shuffle
  for(let i=waveQueue.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [waveQueue[i],waveQueue[j]]=[waveQueue[j],waveQueue[i]];
  }
  waveSpawnTimer=0; waveCleared=false;
  updateHUD();
}

function spawnEnemy(type){
  const def=CFG.ENEMY_TYPES[type];
  const ex=(Math.random()-.5)*PBOUND_X*2.5;
  const ey=(Math.random()-.5)*PBOUND_Y*2.2;
  enemies.push({
    type, x:ex, y:ey, z:1600, hp:def.hp, maxHp:def.hp,
    speed:def.speed*(0.85+Math.random()*.3),
    size:def.size, track:def.track, shootRate:def.shootRate,
    color:def.color, score:def.score,
    shootTimer:def.shootRate*(0.5+Math.random()),
    alive:true, flashTimer:0,
  });
}

/* ─────────────────── MAIN LOOP ─────────────────── */
let lastT=0;
function loop(ts){
  const dt=Math.min((ts-lastT)/1000,0.05);
  lastT=ts;
  if(state==='PLAYING') update(dt);
  render();
  requestAnimationFrame(loop);
}

/* ─────────────────── UPDATE ─────────────────── */
function update(dt){
  // ── PLAYER MOVEMENT ──
  let vx=0, vy=0;
  if(keys['ArrowLeft']||keys['KeyA'])  vx-=1;
  if(keys['ArrowRight']||keys['KeyD']) vx+=1;
  if(keys['ArrowUp']||keys['KeyW'])    vy-=1;
  if(keys['ArrowDown']||keys['KeyS'])  vy+=1;
  if(joy.active){ vx+=joy.x; vy+=joy.y; }
  // normalize diagonal
  const vlen=Math.hypot(vx,vy);
  if(vlen>1){vx/=vlen;vy/=vlen;}
  player.x=Math.max(-PBOUND_X,Math.min(PBOUND_X,player.x+vx*CFG.PLAYER_SPEED*dt));
  player.y=Math.max(-PBOUND_Y,Math.min(PBOUND_Y,player.y+vy*CFG.PLAYER_SPEED*dt));

  // ── PLAYER FIRE ──
  player.fireTimer=Math.max(0,player.fireTimer-dt);
  const wantFire=keys['Space']||mouseDown||mobileFireHeld;
  if(player.alive && wantFire && player.fireTimer<=0){
    playerBullets.push({x:player.x,y:player.y,z:0,alive:true});
    playerBullets.push({x:player.x-10,y:player.y+12,z:0,alive:true});
    playerBullets.push({x:player.x+10,y:player.y+12,z:0,alive:true});
    player.fireTimer=CFG.FIRE_RATE;
    playSound('shoot');
  }

  // ── INVINCIBILITY ──
  if(player.invTimer>0) player.invTimer=Math.max(0,player.invTimer-dt);

  // ── SPAWN WAVE ENEMIES ──
  if(waveQueue.length>0){
    waveSpawnTimer-=dt;
    if(waveSpawnTimer<=0){
      spawnEnemy(waveQueue.shift());
      waveSpawnTimer=0.5+Math.random()*.6;
    }
  }

  // ── UPDATE ENEMIES ──
  for(let i=enemies.length-1;i>=0;i--){
    const e=enemies[i];
    if(!e.alive){enemies.splice(i,1);continue;}
    e.z-=e.speed*dt;
    // Track player XY
    const dx=player.x-e.x, dy=player.y-e.y;
    e.x+=dx*e.track*dt;
    e.y+=dy*e.track*dt;
    if(e.flashTimer>0) e.flashTimer=Math.max(0,e.flashTimer-dt);
    // Enemy shoot
    if(e.z<1200 && e.z>50){
      e.shootTimer-=dt;
      if(e.shootTimer<=0){
        enemyBullets.push({x:e.x,y:e.y,z:e.z,
          vx:(player.x-e.x)*.003, vy:(player.y-e.y)*.003, alive:true});
        e.shootTimer=e.shootRate*(0.8+Math.random()*.4);
      }
    }
    // Collide with player
    if(e.z<0 && player.alive && player.invTimer<=0){
      const dist=Math.hypot(e.x-player.x,e.y-player.y);
      if(dist<(e.size+20)){
        hitPlayer(e.size>25?2:1);
        explode(player.x,player.y,0,12,'#ff4466');
        e.alive=false;
      }
    }
    // Past player — miss
    if(e.z<-80) enemies.splice(i,1);
  }

  // ── PLAYER BULLETS ──
  for(let i=playerBullets.length-1;i>=0;i--){
    const b=playerBullets[i];
    if(!b.alive){playerBullets.splice(i,1);continue;}
    b.z+=CFG.BULLET_SPEED*dt;
    // Hit enemy
    let hit=false;
    for(const e of enemies){
      if(!e.alive) continue;
      const d=Math.hypot(b.x-e.x,b.y-e.y);
      const projB=project(b.x,b.y,b.z), projE=project(e.x,e.y,e.z);
      if(b.z>e.z-40 && b.z<e.z+60 && d*projE.scale<(e.size+6)){
        e.hp-=1; e.flashTimer=.12;
        playSound('hit');
        explode(e.x,e.y,e.z,6,e.color);
        if(e.hp<=0){
          score+=e.score;
          e.alive=false;
          explode(e.x,e.y,e.z,20,e.color);
          playSound('explo');
        }
        hit=true; break;
      }
    }
    if(hit||b.z>2000){playerBullets.splice(i,1);}
  }

  // ── ENEMY BULLETS ──
  for(let i=enemyBullets.length-1;i>=0;i--){
    const b=enemyBullets[i];
    if(!b.alive){enemyBullets.splice(i,1);continue;}
    b.z-=CFG.ENEMY_BULLET_SPEED*dt;
    b.x+=b.vx*CFG.ENEMY_BULLET_SPEED*dt;
    b.y+=b.vy*CFG.ENEMY_BULLET_SPEED*dt;
    if(b.z<0){
      const dist=Math.hypot(b.x-player.x,b.y-player.y);
      if(dist<28 && player.alive && player.invTimer<=0){
        hitPlayer(1); explode(player.x,player.y,0,8,'#ff2244');
      }
      enemyBullets.splice(i,1); continue;
    }
    if(b.z>2200) enemyBullets.splice(i,1);
  }

  // ── PARTICLES ──
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i];
    p.x+=p.vx*dt; p.y+=p.vy*dt; p.z+=p.vz*dt;
    p.a-=p.fade*dt; p.r*=Math.pow(.97,dt*60);
    if(p.a<=0||p.r<.3) particles.splice(i,1);
  }

  // ── STARS SCROLL ──
  for(const s of stars){
    s.y+=(s.scrollSpd*dt)/(H>0?H:1);
    if(s.y>1) s.y-=1;
    s.ph+=s.spd*dt*60;
  }

  // ── WAVE CLEAR CHECK ──
  if(!waveCleared && waveQueue.length===0 && enemies.length===0){
    waveCleared=true; waveNextTimer=2.5;
    playSound('wave');
  }
  if(waveCleared && waveNextTimer>0){
    waveNextTimer-=dt;
    if(waveNextTimer<=0){
      waveNum++;
      if(waveNum>hiWave){hiWave=waveNum;localStorage.setItem('vf_hw',hiWave);}
      buildWave(waveNum);
    }
  }

  // ── SHIELD REGEN ──
  player.shield=player.hp/player.maxHp;
  updateHUD();
}

function hitPlayer(dmg){
  if(player.invTimer>0||!player.alive) return;
  player.hp=Math.max(0,player.hp-dmg);
  player.invTimer=CFG.INVINCIBLE_TIME;
  playSound('shield');
  if(player.hp<=0){ player.alive=false; setTimeout(showGO,1100); playSound('die'); explode(player.x,player.y,0,40,'#00ffff'); }
}

function explode(wx,wy,wz,count,col){
  for(let i=0;i<count;i++){
    const ang=Math.random()*Math.PI*2, vel=60+Math.random()*160;
    particles.push({x:wx,y:wy,z:wz,
      vx:Math.cos(ang)*vel,vy:Math.sin(ang)*vel,vz:(Math.random()-.5)*120,
      r:2+Math.random()*5, a:1, fade:.9+Math.random()*.5, col});
  }
}

/* ─────────────────── RENDER ─────────────────── */
function render(){
  if(!ctx||!W||!H) return;
  ctx.clearRect(0,0,W,H);
  drawBg();
  drawGrid();
  drawEnemyBullets();
  drawEnemies();
  drawPlayerBullets();
  if(player.alive||(player.invTimer>.5)) drawPlayer();
  drawParticles();
  drawVignette();
  if(waveCleared && waveNextTimer>0) drawWaveClear();
}

function drawBg(){
  // Deep space gradient
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'#000014'); g.addColorStop(.5,'#00001a'); g.addColorStop(1,'#000010');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

  // Stars (3 layers)
  for(const s of stars){
    const tw=0.5+0.5*(Math.sin(s.ph)*0.5+0.5);
    const a=(0.3+0.7*tw)*s.br;
    ctx.beginPath(); ctx.arc(s.x*W,s.y*H,s.r,0,Math.PI*2);
    ctx.fillStyle=`rgba(255,255,255,${a})`; ctx.fill();
  }
  // Nebula hints
  [
    {x:.25,y:.3,c:'rgba(0,0,80,.6)',r:W*.4},
    {x:.75,y:.6,c:'rgba(60,0,80,.5)',r:W*.35},
    {x:.5, y:.15,c:'rgba(0,40,80,.4)',r:W*.3},
  ].forEach(n=>{
    const g2=ctx.createRadialGradient(n.x*W,n.y*H,0,n.x*W,n.y*H,n.r);
    g2.addColorStop(0,n.c); g2.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g2; ctx.fillRect(0,0,W,H);
  });
}

function drawGrid(){
  // Perspective floor/ceiling grid — same synthwave approach
  const col='#00ffff';
  // Horizon glow
  const hg=ctx.createRadialGradient(VPX,VPY,0,VPX,VPY,W*.45);
  hg.addColorStop(0,'rgba(0,255,255,.12)'); hg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=hg; ctx.fillRect(0,0,W,H);

  // Floor grid lines
  ctx.save(); ctx.beginPath(); ctx.rect(0,VPY,W,H-VPY); ctx.clip();
  const HT=W*.44; let gs=((Date.now()*.00018)%(H*.5))%(H*.5);
  for(let i=0;i<=12;i++){
    let t=Math.pow(i/12,3);
    t=Math.min(1,t+(gs/(H*.5))*.2*(1-t));
    const y=VPY+(H-VPY+H*.08)*t, tw=HT*2.2*t;
    ctx.strokeStyle=rgba(col,0.04+0.35*t); ctx.lineWidth=0.5+1.2*t;
    ctx.shadowBlur=2; ctx.shadowColor=col;
    ctx.beginPath(); ctx.moveTo(VPX-tw/2,y); ctx.lineTo(VPX+tw/2,y); ctx.stroke();
  }
  ctx.restore();
  // Vertical lines
  [[-1.4,true],[-.47,false],[.47,false],[1.4,true]].forEach(([v,edge])=>{
    const nx=VPX+v*HT, ny=H+H*.08;
    ctx.strokeStyle=rgba(col,edge?.6:.28); ctx.lineWidth=edge?1.8:.7;
    ctx.shadowBlur=edge?8:3; ctx.shadowColor=col;
    ctx.beginPath(); ctx.moveTo(VPX,VPY); ctx.lineTo(nx,ny); ctx.stroke();
  });
  // Ceiling
  ctx.save(); ctx.beginPath(); ctx.rect(0,0,W,VPY); ctx.clip();
  for(let i=0;i<=6;i++){
    const t=Math.pow(i/6,2.5), y=VPY-VPY*t*.8, tw=HT*2*t;
    ctx.strokeStyle=rgba(col,.02+.12*t); ctx.lineWidth=.5;
    ctx.shadowBlur=0;
    ctx.beginPath(); ctx.moveTo(VPX-tw/2,y); ctx.lineTo(VPX+tw/2,y); ctx.stroke();
  }
  ctx.restore();
  // Horizon line
  ctx.strokeStyle=rgba(col,.85); ctx.lineWidth=1.5; ctx.shadowBlur=16; ctx.shadowColor=col;
  ctx.beginPath(); ctx.moveTo(0,VPY); ctx.lineTo(W,VPY); ctx.stroke();
  ctx.shadowBlur=0;
}

function drawEnemyBullets(){
  for(const b of enemyBullets){
    if(!b.alive) continue;
    const {sx,sy,scale}=project(b.x,b.y,b.z);
    const r=4*scale;
    ctx.shadowBlur=8; ctx.shadowColor='#ff4422';
    ctx.fillStyle=`rgba(255,80,30,${Math.min(1,.3+scale*.7)})`;
    ctx.beginPath(); ctx.arc(sx,sy,Math.max(.5,r),0,Math.PI*2); ctx.fill();
  }
  ctx.shadowBlur=0;
}

function drawPlayerBullets(){
  for(const b of playerBullets){
    const {sx,sy,scale}=project(b.x,b.y,b.z);
    const r=Math.max(.5,3*scale);
    const len=Math.max(2,22*scale);
    ctx.shadowBlur=10; ctx.shadowColor='#00ffff';
    ctx.strokeStyle=`rgba(0,255,255,${Math.min(1,.4+scale*.6)})`;
    ctx.lineWidth=r;
    ctx.beginPath(); ctx.moveTo(sx,sy+len); ctx.lineTo(sx,sy-len); ctx.stroke();
    ctx.fillStyle='rgba(180,255,255,.9)';
    ctx.beginPath(); ctx.arc(sx,sy,r*.6,0,Math.PI*2); ctx.fill();
  }
  ctx.shadowBlur=0;
}

function drawEnemies(){
  const sorted=[...enemies].sort((a,b)=>b.z-a.z);
  for(const e of sorted){
    if(!e.alive) continue;
    const {sx,sy,scale}=project(e.x,e.y,e.z);
    const r=e.size*scale;
    if(r<1||sx<-r||sx>W+r||sy<-r||sy>H+r) continue;
    const flash=e.flashTimer>0;
    ctx.save(); ctx.translate(sx,sy); ctx.scale(scale,scale);
    const col=flash?'#ffffff':e.color;
    ctx.shadowBlur=flash?25:18*scale; ctx.shadowColor=col;
    // Body
    ctx.fillStyle=rgba(col,flash?.8:.5+scale*.4);
    drawShip(ctx,0,0,e.size,e.type,false);
    // Border
    ctx.strokeStyle=col; ctx.lineWidth=1.5/scale;
    ctx.stroke();
    // HP bar (if multi-HP)
    if(e.maxHp>1){
      const bw=e.size*2, bh=4/scale, by=-e.size-8/scale;
      ctx.fillStyle='rgba(0,0,0,.5)';
      ctx.fillRect(-bw/2,by,bw,bh);
      ctx.fillStyle=e.hp/e.maxHp>.5?'#00ff88':'#ff4444';
      ctx.fillRect(-bw/2,by,(bw*e.hp/e.maxHp),bh);
    }
    ctx.restore();
  }
}

function drawShip(ctx,cx,cy,r,type,isPlayer){
  if(isPlayer){
    // Player: elegant fighter shape
    ctx.beginPath();
    ctx.moveTo(cx,cy-r);           // nose
    ctx.lineTo(cx+r*.55,cy+r*.4);  // right wing tip
    ctx.lineTo(cx+r*.25,cy+r*.15); // right inner
    ctx.lineTo(cx,cy+r*.45);       // tail center
    ctx.lineTo(cx-r*.25,cy+r*.15); // left inner
    ctx.lineTo(cx-r*.55,cy+r*.4);  // left wing tip
    ctx.closePath();
    // Engine glow
    ctx.fillRect(cx-r*.12,cy+r*.2,r*.24,r*.35);
    // Cockpit
    ctx.save(); ctx.fillStyle='rgba(180,255,255,.8)';
    ctx.beginPath(); ctx.ellipse(cx,cy-r*.15,r*.12,r*.22,0,0,Math.PI*2); ctx.fill(); ctx.restore();
  } else if(type==='titan'){
    // Titan: hexagonal heavy
    ctx.beginPath();
    for(let i=0;i<6;i++){
      const a=i/6*Math.PI*2-Math.PI/6;
      ctx.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);
    }
    ctx.closePath();
    ctx.moveTo(cx,cy+r*.2); ctx.lineTo(cx+r*.5,cy-r*.3); ctx.lineTo(cx-r*.5,cy-r*.3); ctx.closePath();
  } else if(type==='bomber'){
    // Bomber: wide body
    ctx.beginPath();
    ctx.moveTo(cx,cy+r);            // nose (toward player)
    ctx.lineTo(cx+r*.9,cy-r*.2);
    ctx.lineTo(cx+r*.5,cy-r*.7);
    ctx.lineTo(cx-r*.5,cy-r*.7);
    ctx.lineTo(cx-r*.9,cy-r*.2);
    ctx.closePath();
  } else if(type==='dart'){
    // Dart: thin needle
    ctx.beginPath();
    ctx.moveTo(cx,cy+r);
    ctx.lineTo(cx+r*.3,cy-r*.5);
    ctx.lineTo(cx,cy-r*.2);
    ctx.lineTo(cx-r*.3,cy-r*.5);
    ctx.closePath();
  } else {
    // Fighter: standard
    ctx.beginPath();
    ctx.moveTo(cx,cy+r);             // nose toward player
    ctx.lineTo(cx+r*.6,cy-r*.5);     // right wing
    ctx.lineTo(cx+r*.2,cy-r*.2);
    ctx.lineTo(cx,cy-r*.5);          // tail
    ctx.lineTo(cx-r*.2,cy-r*.2);
    ctx.lineTo(cx-r*.6,cy-r*.5);     // left wing
    ctx.closePath();
  }
}

function drawPlayer(){
  const {sx,sy}=project(player.x,player.y,0);
  const r=W*.055;
  const blink=player.invTimer>0 && Math.floor(player.invTimer*8)%2===0;
  if(blink) return;

  // Thruster
  const tLen=(6+Math.random()*10)*2;
  ctx.shadowBlur=20; ctx.shadowColor='#ff8800';
  const tg=ctx.createLinearGradient(sx,sy+r*.4,sx,sy+r*.4+tLen);
  tg.addColorStop(0,'rgba(255,180,0,.9)'); tg.addColorStop(1,'rgba(255,60,0,0)');
  ctx.fillStyle=tg; ctx.fillRect(sx-r*.08,sy+r*.4,r*.16,tLen);

  ctx.save(); ctx.translate(sx,sy);
  ctx.shadowBlur=28; ctx.shadowColor='#00e5ff';
  ctx.fillStyle='rgba(0,229,255,.5)';
  drawShip(ctx,0,0,r,'player',true);
  ctx.fill();
  ctx.strokeStyle='#00ffff'; ctx.lineWidth=1.5;
  ctx.stroke();
  // Cockpit
  ctx.shadowBlur=0;
  ctx.restore();

  // Shield ring when invincible
  if(player.invTimer>0){
    const alpha=Math.min(1,player.invTimer/CFG.INVINCIBLE_TIME);
    ctx.beginPath(); ctx.arc(sx,sy,r*1.5,0,Math.PI*2);
    ctx.strokeStyle=`rgba(0,255,255,${alpha*.5})`; ctx.lineWidth=2;
    ctx.shadowBlur=12; ctx.shadowColor='#00ffff';
    ctx.stroke(); ctx.shadowBlur=0;
  }
}

function drawParticles(){
  for(const p of particles){
    const {sx,sy,scale}=project(p.x,p.y,Math.max(0,p.z));
    const r=p.r*scale;
    ctx.save(); ctx.globalAlpha=p.a;
    ctx.shadowBlur=8; ctx.shadowColor=p.col;
    ctx.fillStyle=p.col;
    ctx.beginPath(); ctx.arc(sx,sy,Math.max(.3,r),0,Math.PI*2); ctx.fill();
    ctx.restore();
  }
}

function drawVignette(){
  const v=ctx.createRadialGradient(W/2,H/2,H*.25,W/2,H/2,H*.85);
  v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,'rgba(0,0,20,.6)');
  ctx.fillStyle=v; ctx.fillRect(0,0,W,H);
}

function drawWaveClear(){
  const a=Math.min(1,waveNextTimer/2.5);
  ctx.save(); ctx.globalAlpha=a;
  ctx.fillStyle='rgba(0,255,136,.08)'; ctx.fillRect(0,H*.3,W,H*.3);
  ctx.shadowBlur=20; ctx.shadowColor='#00ff88';
  ctx.fillStyle='#00ff88'; ctx.font=`bold ${Math.floor(W*.07)}px Orbitron,monospace`;
  ctx.textAlign='center'; ctx.fillText('VAGUE EFFACÉE !',W/2,H*.44);
  ctx.font=`${Math.floor(W*.04)}px Orbitron,monospace`;
  ctx.fillStyle='rgba(0,255,255,.8)';
  ctx.fillText('VAGUE '+(waveNum+1)+' EN APPROCHE...',W/2,H*.52);
  ctx.restore();
}

/* ─────────────────── GAME OVER ─────────────────── */
function showGO(){
  state='GAME_OVER'; deathCount++;
  const isRec=score>hiScore;
  if(isRec){hiScore=score;localStorage.setItem('vf_hs',Math.floor(hiScore));}
  document.getElementById('go-score').textContent=Math.floor(score);
  document.getElementById('go-wave').textContent=waveNum;
  const rc=document.getElementById('go-rec');
  if(isRec){rc.style.display='flex';document.getElementById('go-hs').textContent=Math.floor(hiScore);playSound('wave');}
  else rc.style.display='none';
  document.getElementById('rewarded-zone').style.display=rewardUsed?'none':'flex';
  showScreen('go');
  if(deathCount%CFG.INTERSTITIAL_EVERY===0) setTimeout(showInt,700);
}

/* ─────────────────── REWARDED AD ─────────────────── */
function triggerRewardedAd(){
  if(rewardUsed) return; rewardUsed=true;
  const btn=document.getElementById('btn-rew');
  if(!btn) return;
  btn.disabled=true; btn.textContent='⏳ Pub en cours… (3s)';
  /* Remplace par : adBreak({type:'reward', adViewed: continueGame}) */
  setTimeout(()=>{
    const rz=document.getElementById('rewarded-zone');
    if(rz) rz.innerHTML='<p style="color:#00ffff;font-size:13px;text-align:center">✅ Continue !</p>';
    setTimeout(continueGame,700);
  },3000);
}
function continueGame(){
  player.alive=true; player.hp=1; player.invTimer=CFG.INVINCIBLE_TIME; player.shield=1/player.maxHp;
  particles=[]; enemyBullets=[];
  showScreen('game'); state='PLAYING';
  initAudio(); if(audioCtx&&audioCtx.state==='suspended') audioCtx.resume();
  startMusic(); playSound('start');
}

/* ─────────────────── INTERSTITIEL ─────────────────── */
let _iIv;
function showInt(){
  const el=document.getElementById('interstitial'),tn=document.getElementById('int-n'),
        cn=document.getElementById('int-c'),cb=document.getElementById('btn-int');
  if(!el) return;
  el.style.display='flex'; cb.style.display='none';
  let n=5; if(tn)tn.textContent=n; if(cn)cn.textContent=n;
  _iIv=setInterval(()=>{n--;if(tn)tn.textContent=n;if(cn)cn.textContent=n;if(n<=0){clearInterval(_iIv);cb.style.display='block';}},1000);
}
function closeInt(){document.getElementById('interstitial').style.display='none';clearInterval(_iIv);}

/* ─────────────────── SHARE ─────────────────── */
function openShare(){
  const sc=document.getElementById('share-canvas'), s=sc.getContext('2d');
  const sw=sc.width,sh=sc.height;
  s.fillStyle='#000014'; s.fillRect(0,0,sw,sh);
  s.strokeStyle='rgba(0,255,255,.08)'; s.lineWidth=1;
  for(let x=0;x<sw;x+=38){s.beginPath();s.moveTo(x,0);s.lineTo(x,sh);s.stroke();}
  for(let y=0;y<sh;y+=38){s.beginPath();s.moveTo(0,y);s.lineTo(sw,y);s.stroke();}
  s.shadowBlur=25; s.shadowColor='#00ffff';
  s.fillStyle='#00ffff'; s.font='bold 46px Orbitron,monospace'; s.textAlign='center';
  s.fillText('VOID FIGHTER 3D',sw/2,78);
  s.shadowBlur=35; s.shadowColor='#ff00ff';
  s.fillStyle='#fff'; s.font='bold 84px Orbitron,monospace';
  s.fillText(Math.floor(score)+'pts',sw/2,192);
  s.shadowBlur=12; s.shadowColor='#00ff88';
  s.fillStyle='#00ff88'; s.font='20px Orbitron,monospace';
  s.fillText('VAGUE : '+waveNum+'  |  RECORD : '+Math.floor(hiScore),sw/2,252);
  s.shadowBlur=0; s.fillStyle='rgba(255,255,255,.4)'; s.font='14px Share Tech Mono,monospace';
  s.fillText('Peux-tu me battre ? ▶ VOTRE-DOMAINE.com',sw/2,318);
  document.getElementById('modal-share').style.display='flex';
  document.getElementById('share-ok').style.display='none';
}
function dlShare(){
  const a=document.createElement('a');
  a.download='voidfighter-'+Math.floor(score)+'.png';
  a.href=document.getElementById('share-canvas').toDataURL(); a.click();
}
function copyChallenge(){
  const link=location.origin+location.pathname+'?challenge='+Math.floor(score);
  navigator.clipboard.writeText(link).then(()=>showToast('⚡ Lien défi copié !')).catch(()=>showToast(link));
}

/* ─────────────────── FULLSCREEN ─────────────────── */
function toggleFS(){
  if(!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
  else document.exitFullscreen().catch(()=>{});
}
document.addEventListener('fullscreenchange',()=>setTimeout(resize,120));

/* ─────────────────── MISC UI ─────────────────── */
function showScreen(n){
  const map={menu:'screen-menu',game:'screen-game',pause:'screen-pause',go:'screen-go'};
  Object.values(map).forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  const t=map[n]; if(t){const el=document.getElementById(t);if(el)el.style.display='flex';}
  const mc=document.getElementById('mobile-ctrl');
  if(mc) mc.style.display=n==='game'?'flex':'none';
}
function updateHUD(){
  document.getElementById('hud-score').textContent=Math.floor(score);
  document.getElementById('hud-hs').textContent=Math.floor(hiScore);
  document.getElementById('hud-wave').textContent='VAGUE '+waveNum;
  const sf=document.getElementById('shield-bar');
  if(sf) sf.style.width=(player.hp/player.maxHp*100)+'%';
  const hp=document.getElementById('hud-hp');
  if(hp) hp.textContent='❤'.repeat(player.hp)+'🖤'.repeat(Math.max(0,player.maxHp-player.hp));
}
function updateMenuUI(){
  const m=document.getElementById('menu-hs'),w=document.getElementById('menu-wave');
  if(m)m.textContent=Math.floor(hiScore); if(w)w.textContent=hiWave;
}
function resetHS(){
  if(!confirm('Réinitialiser les records ?')) return;
  hiScore=0;hiWave=0;localStorage.removeItem('vf_hs');localStorage.removeItem('vf_hw');
  updateMenuUI(); showToast('↺ Records réinitialisés');
}
function toggleSnd(){
  soundOn=!soundOn;
  const b=document.getElementById('btn-snd');if(b)b.textContent=soundOn?'🔊':'🔇';
  if(!soundOn)stopMusic(); else if(state==='PLAYING')startMusic();
}
let _tT;
function showToast(msg){
  const t=document.getElementById('toast');if(!t)return;
  t.textContent=msg;t.className='toast show';clearTimeout(_tT);
  _tT=setTimeout(()=>t.className='toast',2800);
}

/* ─────────────────── MENU BACKGROUND ANIMATION ─────────────────── */
function initMenuBg(){
  const c=document.getElementById('menu-bg');if(!c)return;
  const ct=c.getContext('2d');
  let ms=[]; // mini enemy ships for menu
  for(let i=0;i<8;i++){
    ms.push({x:(Math.random()-.5)*300,y:(Math.random()-.5)*200,
      z:200+Math.random()*1400, spd:120+Math.random()*200,
      col:['#ff00aa','#ff6600','#ff0044','#cc00ff'][Math.floor(Math.random()*4)]});
  }
  let gt=0;
  function drawM(){
    if(document.getElementById('screen-menu').style.display==='none'){requestAnimationFrame(drawM);return;}
    const GW=c.parentElement.offsetWidth, GH=c.parentElement.offsetHeight;
    if(c.width!==GW||c.height!==GH){c.width=GW;c.height=GH;}
    const W2=c.width,H2=c.height,VX=W2/2,VY=H2*.38;
    gt+=.012;
    ct.clearRect(0,0,W2,H2);
    // Bg
    const bg=ct.createLinearGradient(0,0,0,H2);
    bg.addColorStop(0,'#000014');bg.addColorStop(1,'#00001a');
    ct.fillStyle=bg;ct.fillRect(0,0,W2,H2);
    // Horizon glow
    const hg=ct.createRadialGradient(VX,VY,0,VX,VY,W2*.4);
    hg.addColorStop(0,'rgba(0,255,255,.15)');hg.addColorStop(1,'rgba(0,0,0,0)');
    ct.fillStyle=hg;ct.fillRect(0,0,W2,H2);
    // Stars
    for(const s of stars){
      const tw=0.5+0.5*(Math.sin(s.ph+gt*10)*0.5+0.5);
      ct.beginPath();ct.arc(s.x*W2,s.y*H2,s.r,0,Math.PI*2);
      ct.fillStyle=`rgba(255,255,255,${(0.2+0.6*tw)*s.br})`;ct.fill();
    }
    // Grid
    const HT=W2*.42;
    const gs2=(gt*H2*.25)%(H2*.5);
    ct.save();ct.beginPath();ct.rect(0,VY,W2,H2-VY);ct.clip();
    for(let i=0;i<=10;i++){
      let t=Math.pow(i/10,3);t=Math.min(1,t+(gs2/(H2*.5))*.22*(1-t));
      const y=VY+(H2-VY+H2*.08)*t,tw2=HT*2.2*t;
      ct.strokeStyle=`rgba(0,255,255,${.04+.3*t})`;ct.lineWidth=.5+t;
      ct.beginPath();ct.moveTo(VX-tw2/2,y);ct.lineTo(VX+tw2/2,y);ct.stroke();
    }
    ct.restore();
    [[-1.4,true],[-.47,false],[.47,false],[1.4,true]].forEach(([v,edge])=>{
      ct.strokeStyle=`rgba(0,255,255,${edge?.55:.22})`;ct.lineWidth=edge?1.5:.6;
      ct.beginPath();ct.moveTo(VX,VY);ct.lineTo(VX+v*HT,H2+H2*.08);ct.stroke();
    });
    ct.strokeStyle='rgba(0,255,255,.8)';ct.lineWidth=1.5;
    ct.beginPath();ct.moveTo(0,VY);ct.lineTo(W2,VY);ct.stroke();
    // Mini enemies
    for(const e of ms){
      e.z-=e.spd*.016;if(e.z<0)e.z=1600;
      const scale=480/(Math.max(1,e.z+480));
      const sx=VX+e.x*scale,sy=VY+e.y*scale,r=16*scale;
      if(r<1) continue;
      ct.save();ct.translate(sx,sy);ct.scale(scale,scale);
      ct.shadowBlur=12;ct.shadowColor=e.col;
      ct.fillStyle=e.col.replace('ff','44');
      ct.beginPath();
      ct.moveTo(0,16);ct.lineTo(10,-8);ct.lineTo(0,-3);ct.lineTo(-10,-8);ct.closePath();
      ct.fill();ct.strokeStyle=e.col;ct.lineWidth=1.5/scale;ct.stroke();
      ct.restore();
    }
    // Player idle (bobbing)
    const bob=Math.sin(gt*2.5)*5;
    const pr=W2*.055;
    ct.save();ct.translate(VX,H2*.78+bob);
    ct.shadowBlur=30;ct.shadowColor='#00e5ff';
    ct.fillStyle='rgba(0,229,255,.5)';
    ct.beginPath();
    ct.moveTo(0,-pr);ct.lineTo(pr*.55,pr*.4);ct.lineTo(pr*.25,pr*.15);
    ct.lineTo(0,pr*.45);ct.lineTo(-pr*.25,pr*.15);ct.lineTo(-pr*.55,pr*.4);
    ct.closePath();ct.fill();
    ct.strokeStyle='#00ffff';ct.lineWidth=1.5;ct.stroke();
    ct.restore();
    // Vignette
    const vg=ct.createRadialGradient(W2/2,H2/2,H2*.25,W2/2,H2/2,H2*.85);
    vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(1,'rgba(0,0,20,.7)');
    ct.fillStyle=vg;ct.fillRect(0,0,W2,H2);
    requestAnimationFrame(drawM);
  }
  drawM();
}

/* ─────────────────── ENTRY POINT ─────────────────── */
window.addEventListener('DOMContentLoaded',init);
