
(() => {
"use strict";

const APP_VERSION="3.0.0";
const DB_NAME="academy_world_3";
const DB_VERSION=1;
const STORES=["courses","progress","notes","favorites","diplomas","settings"];
let db=null;
let currentCourseId=null;
let currentModuleIndex=0;
let currentPageIndex=0;
let currentScreen="home";

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const safeUrl=v=>{
  try{
    const s=String(v||"");
    if(/^data:image\/(?:svg\+xml|png|jpeg|webp);base64,/i.test(s)) return s;
    const u=new URL(s,location.href);
    return ["https:","http:"].includes(u.protocol)?u.href:"";
  }catch{return "";}
};
const now=()=>new Date().toISOString();

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=e=>{
      const d=e.target.result;
      STORES.forEach(name=>{if(!d.objectStoreNames.contains(name)) d.createObjectStore(name,{keyPath:"id"});});
    };
    req.onsuccess=e=>{db=e.target.result;resolve(db);};
    req.onerror=()=>reject(req.error);
  });
}
const tx=(store,mode="readonly")=>db.transaction(store,mode).objectStore(store);
const dbGet=(store,id)=>new Promise((res,rej)=>{const r=tx(store).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
const dbGetAll=store=>new Promise((res,rej)=>{const r=tx(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
const dbPut=(store,obj)=>new Promise((res,rej)=>{const r=tx(store,"readwrite").put(obj);r.onsuccess=()=>res(obj);r.onerror=()=>rej(r.error);});
const dbDelete=(store,id)=>new Promise((res,rej)=>{const r=tx(store,"readwrite").delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);});
const dbClear=store=>new Promise((res,rej)=>{const r=tx(store,"readwrite").clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error);});

function validateQuestion(q,label,errors){
  if(!q||typeof q.question!=="string"||!q.question.trim()) errors.push(`${label}: pregunta inválida`);
  if(!Array.isArray(q?.options)||q.options.length<2) errors.push(`${label}: opciones inválidas`);
  if(!Number.isInteger(q?.answer_index)||q.answer_index<0||q.answer_index>=(q.options?.length||0)) errors.push(`${label}: respuesta inválida`);
}
function validateCourse(c){
  const errors=[];
  if(!c||c.schema_version!=="1.0") errors.push("schema_version debe ser 1.0");
  if(!c?.course_id||!/^[a-z0-9_-]+$/.test(c.course_id)) errors.push("course_id inválido");
  if(!c?.title||!c?.description) errors.push("Faltan título o descripción");
  if(!Array.isArray(c?.modules)||!c.modules.length) errors.push("Debe existir al menos un módulo");
  if(!Array.isArray(c?.level_system?.placement_test)||c.level_system.placement_test.length!==c.modules.length) errors.push("El test inicial debe tener una pregunta por módulo");
  (c.level_system?.placement_test||[]).forEach((q,i)=>validateQuestion(q,`Test ${i+1}`,errors));
  const mids=new Set();
  (c.modules||[]).forEach((m,i)=>{
    if(!m.module_id||mids.has(m.module_id)) errors.push(`Módulo ${i+1}: ID inválido o duplicado`);
    mids.add(m.module_id);
    if(!Array.isArray(m.pages)||m.pages.length<2) errors.push(`Módulo ${i+1}: páginas insuficientes`);
    (m.pages||[]).forEach((p,j)=>{
      for(const f of ["page_id","title","concept","example","practice"]) if(!String(p?.[f]||"").trim()) errors.push(`Módulo ${i+1}, página ${j+1}: falta ${f}`);
      for(const a of (p.media||[])){
        if(!a?.url||(!safeUrl(a.url)&&!String(a.url).startsWith("data:image/"))) errors.push(`Módulo ${i+1}, página ${j+1}: media inválida`);
      }
    });
    validateQuestion(m.checkpoint,`Módulo ${i+1} checkpoint`,errors);
    if(!m?.checkpoint?.remediation) errors.push(`Módulo ${i+1}: falta refuerzo`);
  });
  if(!c?.boss||!Array.isArray(c.boss.questions)||c.boss.questions.length!==10) errors.push("Boss: deben existir exactamente 10 preguntas");
  (c.boss?.questions||[]).forEach((q,i)=>validateQuestion(q,`Boss ${i+1}`,errors));
  return [...new Set(errors)];
}

async function installBundledCourse(){
  const c=window.BUNDLED_COURSE;
  const errors=validateCourse(c);
  if(errors.length) throw new Error(errors.join(" · "));
  const old=await dbGet("courses",c.course_id);
  await dbPut("courses",{id:c.course_id,course:c,bundled:true,installedAt:old?.installedAt||now(),updatedAt:now()});
  const p=await dbGet("progress",c.course_id);
  if(!p){
    await dbPut("progress",{id:c.course_id,moduleIndex:0,pageIndex:0,completedModules:[],placementDone:false,level:null,placementScore:null,bossScore:null,finished:false,lastActivity:now()});
  }
}

function showScreen(id){
  currentScreen=id;
  $$(".screen").forEach(x=>x.classList.toggle("active",x.id===id));
  $$(".nav-btn").forEach(x=>x.classList.toggle("active",x.dataset.go===id));
  if(id==="home") refreshHome();
  if(id==="courses") renderLibrary();
  if(id==="search") renderSearch("");
  window.scrollTo({top:0,behavior:"smooth"});
}
$$("[data-go]").forEach(b=>b.addEventListener("click",()=>showScreen(b.dataset.go)));

async function refreshHome(){
  const courses=await dbGetAll("courses");
  const progress=await dbGetAll("progress");
  $("#statCourses").textContent=courses.length;
  $("#statModules").textContent=courses.reduce((n,r)=>n+(r.course?.modules?.length||0),0);
  $("#statDone").textContent=progress.reduce((n,p)=>n+(p.completedModules?.length||0),0);
  const current=progress.find(p=>p.id===courseDefaultId());
  $("#statBoss").textContent=current?.bossScore==null?"—":current.bossScore+"%";
  const cRec=courses.find(r=>r.id===courseDefaultId())||courses[0];
  if(!cRec){$("#continueCard").innerHTML="";return;}
  const p=await dbGet("progress",cRec.id)||{};
  const done=(p.completedModules||[]).length,total=cRec.course.modules.length,pct=Math.round(done/total*100);
  $("#continueCard").innerHTML=`<div class="card"><span class="kicker">Continuar</span><h3>${esc(cRec.course.icon||"📘")} ${esc(cRec.course.title)}</h3><p>${done}/${total} módulos · ${pct}%</p><div class="progress"><span style="width:${pct}%"></span></div><button class="btn primary" id="continueCourse">${p.finished?"Repasar":"Continuar curso"}</button></div>`;
  $("#continueCourse").addEventListener("click",()=>resumeCourse(cRec.id));
}
function courseDefaultId(){return window.BUNDLED_COURSE?.course_id||"";}

async function renderLibrary(){
  const host=$("#courseLibrary"),records=await dbGetAll("courses");
  host.innerHTML="";
  for(const rec of records){
    const c=rec.course,p=await dbGet("progress",c.course_id)||{};
    const done=(p.completedModules||[]).length,total=c.modules.length,pct=Math.round(done/total*100);
    const el=document.createElement("div");
    el.className="course-card";
    el.innerHTML=`<span class="kicker">${esc(c.category||"Curso")}</span><h3>${esc(c.icon||"📘")} ${esc(c.title)}</h3><p>${esc(c.description)}</p><div class="meta"><span class="pill">${done}/${total} módulos</span><span class="pill">${esc(p.level||"Nivel pendiente")}</span><span class="pill">Boss ${p.bossScore==null?"—":p.bossScore+"%"}</span></div><div class="progress"><span style="width:${pct}%"></span></div><button class="btn primary" data-open-course="${esc(c.course_id)}">${p.finished?"Repasar":"Continuar"}</button>`;
    host.appendChild(el);
  }
  $$("[data-open-course]").forEach(b=>b.addEventListener("click",()=>resumeCourse(b.dataset.openCourse)));
}

async function resumeCourse(id){
  currentCourseId=id;
  const rec=await dbGet("courses",id),p=await dbGet("progress",id);
  if(!rec)return;
  if(!p?.placementDone) return renderPlacement(rec.course);
  if(p.finished) return openCourse(id);
  return startModule(p.moduleIndex||0,p.pageIndex||0,true);
}

function levelFromScore(x){return x>=80?"Avanzado":x>=50?"Intermedio":"Base sólida";}

async function renderPlacement(c){
  let i=0,correct=0;
  const qs=c.level_system.placement_test;
  const draw=()=>{
    const q=qs[i];
    $("#lessonHost").innerHTML=`<div class="lesson-head"><h3>🎯 Test inicial</h3><p>${esc(c.title)} · ${i+1}/${qs.length}</p></div><div class="panel soft-purple"><h4>${esc(q.question)}</h4><div class="options">${q.options.map((o,x)=>`<button class="option" data-place="${x}">${esc(o)}</button>`).join("")}</div></div>`;
    $$("[data-place]").forEach(b=>b.addEventListener("click",async()=>{
      if(Number(b.dataset.place)===q.answer_index)correct++;
      i++;
      if(i<qs.length)draw();
      else{
        const score=Math.round(correct/qs.length*100),level=levelFromScore(score);
        const p=await dbGet("progress",c.course_id);
        await dbPut("progress",{...p,id:c.course_id,placementDone:true,placementScore:score,level,lastActivity:now()});
        $("#lessonHost").innerHTML=`<div class="lesson-head"><h3>🎯 Nivel recomendado</h3><p>${esc(level)}</p></div><div class="card"><h3>${score}%</h3><p>El test sirve para situarte, no bloquea contenido.</p><button class="btn primary" id="enterCourse">Entrar al curso</button></div>`;
        $("#enterCourse").addEventListener("click",()=>openCourse(c.course_id));
      }
    }));
  };
  draw();showScreen("lesson");
}

async function openCourse(id){
  currentCourseId=id;
  const rec=await dbGet("courses",id),p=await dbGet("progress",id);
  if(!rec)return;
  const c=rec.course;
  const done=(p.completedModules||[]).length,total=c.modules.length,pct=Math.round(done/total*100);
  $("#courseHeader").innerHTML=`<div class="lesson-head"><h3>${esc(c.icon||"📘")} ${esc(c.title)}</h3><p>${esc(c.subtitle||c.category||"Academy World")}</p><div class="progress"><span style="width:${pct}%"></span></div></div>`;
  $("#moduleList").innerHTML=c.modules.map((m,i)=>{
    const completed=(p.completedModules||[]).includes(m.module_id);
    const unlocked=i===0||(p.completedModules||[]).includes(c.modules[i-1]?.module_id)||p.finished;
    return `<button class="module-card" data-module="${i}" ${unlocked?"":"disabled"} style="opacity:${unlocked?1:.5}"><span class="kicker">Módulo ${i+1} · ${completed?"Completado":unlocked?"Disponible":"Bloqueado"}</span><h3>${esc(m.icon||"🧠")} ${esc(m.title)}</h3><p>${esc(m.summary||"")}</p></button>`;
  }).join("")+`<div class="card"><h3>🏆 Boss final</h3><p>10 preguntas. Disponible cuando completes los 12 módulos.</p><button class="btn primary" id="bossBtn" ${done===total?"":"disabled"}>${p.finished?"Repetir Boss":"Iniciar Boss"}</button></div>`;
  $$("[data-module]:not([disabled])").forEach(b=>b.addEventListener("click",()=>startModule(Number(b.dataset.module),0,true)));
  $("#bossBtn")?.addEventListener("click",()=>renderBoss());
  showScreen("course");
}

async function startModule(mi,pi=0,allowReview=false){
  const rec=await dbGet("courses",currentCourseId),p=await dbGet("progress",currentCourseId);
  const c=rec.course;
  const unlocked=mi===0||(p.completedModules||[]).includes(c.modules[mi-1]?.module_id)||p.finished||allowReview;
  if(!unlocked)return openCourse(currentCourseId);
  currentModuleIndex=mi;
  currentPageIndex=Math.max(0,Math.min(pi,c.modules[mi].pages.length-1));
  await dbPut("progress",{...p,id:currentCourseId,moduleIndex:mi,pageIndex:currentPageIndex,lastActivity:now()});
  await renderLesson();
  showScreen("lesson");
}

function resourceButton(url,title,type="recurso"){
  const safe=safeUrl(url);
  if(!safe)return "";
  return `<a class="btn secondary small" href="${esc(safe)}" target="_blank" rel="noopener noreferrer">Abrir ${esc(type)} ↗</a>`;
}

async function renderLesson(){
  const rec=await dbGet("courses",currentCourseId),c=rec.course,m=c.modules[currentModuleIndex],page=m.pages[currentPageIndex],last=currentPageIndex===m.pages.length-1;
  const noteId=`${currentCourseId}:${m.module_id}`;
  const note=await dbGet("notes",noteId)||{text:""};
  const favId=`${currentCourseId}:${m.module_id}:${page.page_id}`;
  const fav=await dbGet("favorites",favId);
  let html=`<div class="lesson-head"><h3>${esc(m.icon||"🧠")} ${esc(m.title)}</h3><p>${esc(page.title)} · ${currentPageIndex+1}/${m.pages.length}</p></div>
  <div class="panel soft-purple"><span class="eyebrow">Concepto</span><h4>${esc(page.title)}</h4><p>${esc(page.concept)}</p></div>
  <div class="panel"><span class="eyebrow">Ejemplo</span><p>${esc(page.example)}</p></div>
  <div class="panel soft-cyan"><span class="eyebrow">Práctica</span><p>${esc(page.practice)}</p></div>`;

  for(const media of (page.media||[])){
    if(media.type==="image"){
      const src=safeUrl(media.url);
      if(src)html+=`<div class="panel"><span class="eyebrow">Plano técnico</span><h4>${esc(media.title||"Plano")}</h4><img class="resource-img" loading="lazy" src="${esc(src)}" alt="${esc(media.alt||media.title||"Plano técnico")}"><p>${esc(media.caption||"")}</p></div>`;
    }else{
      html+=`<div class="panel"><span class="eyebrow">${media.type==="video"?"Vídeo":"Recurso"}</span><h4>${esc(media.title||"Recurso")}</h4>${resourceButton(media.url,media.title,media.type||"recurso")}</div>`;
    }
  }
  if(page.resource?.url){
    html+=`<div class="panel"><span class="eyebrow">Referencia</span><h4>${esc(page.resource.title||"Referencia")}</h4>${resourceButton(page.resource.url,page.resource.title,"recurso oficial")}</div>`;
  }

  html+=`<div class="panel"><span class="eyebrow">Herramientas</span><button class="favorite" id="favBtn">${fav?"★ En favoritos":"☆ Añadir a favoritos"}</button><textarea class="note" id="noteBox" placeholder="Tu nota...">${esc(note.text||"")}</textarea></div>`;

  if(last)html+=checkpointHTML(m);
  else html+=`<button class="btn primary" id="nextPage">Siguiente página →</button>`;
  html+=`<button class="btn ghost" id="backLesson">${currentPageIndex>0?"← Página anterior":"← Volver al curso"}</button>`;
  $("#lessonHost").innerHTML=html;

  $("#noteBox")?.addEventListener("input",e=>dbPut("notes",{id:noteId,courseId:currentCourseId,moduleId:m.module_id,text:e.target.value,updatedAt:now()}));
  $("#favBtn")?.addEventListener("click",async()=>{
    if(await dbGet("favorites",favId)) await dbDelete("favorites",favId);
    else await dbPut("favorites",{id:favId,courseId:currentCourseId,moduleId:m.module_id,pageId:page.page_id,title:page.title,moduleIndex:currentModuleIndex,pageIndex:currentPageIndex});
    renderLesson();
  });
  $("#nextPage")?.addEventListener("click",()=>startModule(currentModuleIndex,currentPageIndex+1,true));
  $("#backLesson")?.addEventListener("click",()=>currentPageIndex>0?startModule(currentModuleIndex,currentPageIndex-1,true):openCourse(currentCourseId));
  bindCheckpoint(m);
}

function checkpointHTML(m){
  const q=m.checkpoint;
  return `<div class="panel soft-peach"><span class="eyebrow">Checkpoint obligatorio</span><h4>${esc(q.question)}</h4><div class="options">${q.options.map((o,i)=>`<button class="option" data-answer="${i}">${esc(o)}</button>`).join("")}</div><div id="feedback" class="status"></div></div>`;
}
function bindCheckpoint(m){$$("[data-answer]").forEach(b=>b.addEventListener("click",()=>handleCheckpoint(m,Number(b.dataset.answer),b)));}
async function handleCheckpoint(m,answer,btn){
  const q=m.checkpoint;
  if(answer===q.answer_index){
    $$("[data-answer]").forEach(x=>x.disabled=true);
    btn.classList.add("correct");
    const tip=q.remediation?.micro_lesson||"";
    const f=$("#feedback");f.className="status show ok";
    f.innerHTML=`<strong>✅ Correcto</strong><br>${esc(q.explanation_correct||q.explanation||"Respuesta correcta.")}${tip?`<div style="margin-top:10px"><strong>💡 Tip</strong><br>${esc(tip)}</div>`:""}<button class="btn primary small" id="continueAfterCheckpoint">Continuar →</button>`;
    $("#continueAfterCheckpoint").addEventListener("click",()=>completeModule(m));
  }else{
    btn.classList.add("wrong");
    renderRemediation(m);
  }
}
function renderRemediation(m){
  const r=m.checkpoint.remediation;
  $("#lessonHost").innerHTML=`<div class="lesson-head"><h3>🧩 Refuerzo</h3><p>${esc(m.title)}</p></div>
  <div class="panel soft-purple"><span class="eyebrow">Explicación sencilla</span><p>${esc(r.simple_explanation||"")}</p></div>
  <div class="panel"><span class="eyebrow">Analogía</span><p>${esc(r.analogy||"")}</p></div>
  <div class="panel soft-cyan"><span class="eyebrow">Mini-lección</span><p>${esc(r.micro_lesson||"")}</p></div>
  <div class="panel soft-peach"><span class="eyebrow">Segundo intento</span><h4>${esc(r.retry_question||m.checkpoint.question)}</h4><div class="options">${(r.retry_options||m.checkpoint.options).map((o,i)=>`<button class="option" data-retry="${i}">${esc(o)}</button>`).join("")}</div><div id="feedback" class="status"></div></div>
  <button class="btn ghost" id="backToLesson">← Volver a la lección</button>`;
  $$("[data-retry]").forEach(b=>b.addEventListener("click",()=>{
    const correct=Number(b.dataset.retry)===(Number.isInteger(r.retry_answer_index)?r.retry_answer_index:m.checkpoint.answer_index);
    if(correct){
      $$("[data-retry]").forEach(x=>x.disabled=true);b.classList.add("correct");
      $("#feedback").className="status show ok";
      $("#feedback").innerHTML=`<strong>✅ Concepto reforzado.</strong><button class="btn primary small" id="continueAfterRetry">Continuar →</button>`;
      $("#continueAfterRetry").addEventListener("click",()=>completeModule(m));
    }else{
      b.classList.add("wrong");$("#feedback").className="status show bad";$("#feedback").textContent="❌ Revisa la explicación y vuelve a intentarlo.";
    }
  }));
  $("#backToLesson").addEventListener("click",()=>renderLesson());
}

async function completeModule(m){
  const p=await dbGet("progress",currentCourseId),rec=await dbGet("courses",currentCourseId),c=rec.course;
  const completed=[...(p.completedModules||[])];
  if(!completed.includes(m.module_id))completed.push(m.module_id);
  const next=currentModuleIndex+1;
  await dbPut("progress",{...p,id:currentCourseId,completedModules:completed,moduleIndex:Math.min(next,c.modules.length-1),pageIndex:0,lastActivity:now()});
  if(next<c.modules.length) startModule(next,0,true); else openCourse(currentCourseId);
}

async function renderBoss(){
  const rec=await dbGet("courses",currentCourseId),c=rec.course,p=await dbGet("progress",currentCourseId);
  if((p.completedModules||[]).length!==c.modules.length)return openCourse(currentCourseId);
  let i=0,score=0;
  const draw=()=>{
    const q=c.boss.questions[i];
    $("#lessonHost").innerHTML=`<div class="lesson-head"><h3>🏆 ${esc(c.boss.title||"Boss final")}</h3><p>Pregunta ${i+1}/10</p></div><div class="panel soft-purple"><h4>${esc(q.question)}</h4><div class="options">${q.options.map((o,x)=>`<button class="option" data-boss="${x}">${esc(o)}</button>`).join("")}</div><div id="bossFeedback" class="status"></div></div><button class="btn primary hidden" id="bossNext">${i<9?"Siguiente →":"Ver resultado"}</button>`;
    $$("[data-boss]").forEach(b=>b.addEventListener("click",()=>{
      if(!$("#bossNext").classList.contains("hidden"))return;
      const ok=Number(b.dataset.boss)===q.answer_index;
      if(ok)score++;
      b.classList.add(ok?"correct":"wrong");
      $$("[data-boss]").forEach(x=>x.disabled=true);
      const f=$("#bossFeedback");f.className="status show "+(ok?"ok":"bad");
      f.textContent=(ok?"✅ ":"❌ ")+(q.explanation||"");
      $("#bossNext").classList.remove("hidden");
    }));
    $("#bossNext").addEventListener("click",async()=>{
      i++;
      if(i<10)draw();
      else{
        const pct=Math.round(score/10*100),passed=pct>=(c.boss.passing_score||80);
        const fresh=await dbGet("progress",currentCourseId);
        await dbPut("progress",{...fresh,id:currentCourseId,bossScore:pct,finished:passed||fresh.finished,lastActivity:now()});
        if(passed) await dbPut("diplomas",{id:currentCourseId,courseId:currentCourseId,title:c.title,score:pct,date:now()});
        $("#lessonHost").innerHTML=`<div class="lesson-head"><h3>${passed?"🎓 Curso completado":"📘 Sigue practicando"}</h3><p>Boss final</p></div><div class="card"><h3>${pct}%</h3><p>${passed?"Has superado el Boss final.":"Necesitas "+(c.boss.passing_score||80)+"% para aprobar."}</p><button class="btn primary" id="bossReturn">Volver al curso</button></div>`;
        $("#bossReturn").addEventListener("click",()=>openCourse(currentCourseId));
      }
    });
  };
  draw();showScreen("lesson");
}

async function renderSearch(query){
  const host=$("#searchResults"),q=String(query||"").trim().toLowerCase();
  if(!q){host.innerHTML='<div class="card"><p>Escribe una palabra para buscar en títulos, conceptos y prácticas.</p></div>';return;}
  const records=await dbGetAll("courses"),hits=[];
  for(const rec of records){
    const c=rec.course;
    c.modules.forEach((m,mi)=>m.pages.forEach((p,pi)=>{
      const hay=[c.title,m.title,p.title,p.concept,p.example,p.practice].join(" ").toLowerCase();
      if(hay.includes(q))hits.push({courseId:c.course_id,course:c.title,module:m.title,page:p.title,mi,pi});
    }));
  }
  host.innerHTML=hits.length?hits.slice(0,50).map((h,i)=>`<button class="module-card" data-search-hit="${i}"><span class="kicker">${esc(h.course)}</span><h3>${esc(h.page)}</h3><p>${esc(h.module)}</p></button>`).join(""):'<div class="card"><p>No encontré resultados.</p></div>';
  $$("[data-search-hit]").forEach(b=>b.addEventListener("click",()=>{const h=hits[Number(b.dataset.searchHit)];currentCourseId=h.courseId;startModule(h.mi,h.pi,true);}));
}
$("#searchInput").addEventListener("input",e=>renderSearch(e.target.value));

$("#courseFile").addEventListener("change",async e=>{
  const file=e.target.files?.[0];if(!file)return;
  const status=$("#importStatus");
  try{
    const c=JSON.parse(await file.text()),errors=validateCourse(c);
    if(errors.length)throw new Error(errors.join(" · "));
    await dbPut("courses",{id:c.course_id,course:c,bundled:false,installedAt:now(),updatedAt:now()});
    const p=await dbGet("progress",c.course_id);
    if(!p)await dbPut("progress",{id:c.course_id,moduleIndex:0,pageIndex:0,completedModules:[],placementDone:false,level:null,bossScore:null,finished:false,lastActivity:now()});
    status.className="status show ok";status.textContent=`✅ ${c.title} importado correctamente.`;
    e.target.value="";renderLibrary();refreshHome();
  }catch(err){status.className="status show bad";status.textContent="❌ "+err.message;}
});

$("#exportBackup").addEventListener("click",async()=>{
  const payload={format:"academy-world-backup",version:APP_VERSION,exportedAt:now(),data:{}};
  for(const s of STORES)payload.data[s]=await dbGetAll(s);
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`academy-world-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
});

$("#backupFile").addEventListener("change",async e=>{
  const status=$("#backupStatus"),file=e.target.files?.[0];if(!file)return;
  try{
    const p=JSON.parse(await file.text());
    if(p.format!=="academy-world-backup"||!p.data)throw new Error("Backup no compatible");
    for(const s of STORES){
      for(const item of (p.data[s]||[]))await dbPut(s,item);
    }
    status.className="status show ok";status.textContent="✅ Backup importado.";
    refreshHome();renderLibrary();
  }catch(err){status.className="status show bad";status.textContent="❌ "+err.message;}
});

$("#resetApp").addEventListener("click",async()=>{
  if(!confirm("¿Restablecer Academy World? Se borrará el progreso local."))return;
  for(const s of STORES)await dbClear(s);
  await installBundledCourse();
  await refreshHome();showScreen("home");
});

$("#checkUpdates").addEventListener("click",async()=>{
  const s=$("#updateStatus");s.className="status show";s.textContent="Comprobando…";
  try{
    const r=await fetch(`./version.json?ts=${Date.now()}`,{cache:"no-store"});
    if(!r.ok)throw new Error("No se pudo leer version.json");
    const v=await r.json();
    s.className="status show ok";s.textContent=v.version===APP_VERSION?`✅ Estás en la versión ${APP_VERSION}.`:`ℹ️ Publicada: ${v.version} · instalada: ${APP_VERSION}`;
  }catch(err){s.className="status show bad";s.textContent="⚠️ "+err.message;}
});

$("#runDiagnostics").addEventListener("click",async()=>{
  const s=$("#diagnosticStatus");s.className="status show";s.textContent="Ejecutando diagnóstico…";
  const c=window.BUNDLED_COURSE,errors=validateCourse(c);
  const localFiles=["./index.html","./styles.css","./app.js","./bundled-course.js","./manifest.webmanifest","./service-worker.js","./offline.html","./version.json","./icons/icon-192.png","./icons/icon-512.png","./courses/SOLIDWORKS_DESIGN_LAB_2025.json"];
  const checks=[];
  for(const f of localFiles){
    try{const r=await fetch(f,{cache:"no-store"});checks.push({f,ok:r.ok});}catch{checks.push({f,ok:false});}
  }
  const images=c.modules.flatMap(m=>m.pages.flatMap(p=>(p.media||[]).filter(x=>x.type==="image"))).length;
  const videos=c.modules.flatMap(m=>m.pages.flatMap(p=>(p.media||[]).filter(x=>x.type==="video"))).length;
  const broken=checks.filter(x=>!x.ok);
  if(errors.length||broken.length){
    s.className="status show bad";
    s.innerHTML=`❌ Fallos detectados.<br>${errors.map(esc).join("<br>")}${broken.length?`<br>Archivos locales: ${broken.map(x=>esc(x.f)).join(", ")}`:""}`;
  }else{
    s.className="status show ok";
    s.innerHTML=`✅ Diagnóstico correcto.<br>12 módulos · ${images} planos incrustados · ${videos} vídeos · ${localFiles.length} archivos locales accesibles.`;
  }
});

async function initPWA(){
  const s=$("#pwaStatus");
  if(!("serviceWorker" in navigator)||!location.protocol.startsWith("http")){
    s.className="status show";s.textContent="La PWA se activa al publicar por HTTPS.";
    return;
  }
  try{
    const reg=await navigator.serviceWorker.register("./service-worker.js",{scope:"./"});
    await reg.update().catch(()=>{});
    s.className="status show ok";s.textContent="✅ PWA activa y modo offline preparado.";
  }catch(err){
    s.className="status show bad";s.textContent="⚠️ No se pudo registrar la PWA: "+err.message;
  }
}

async function init(){
  await openDB();
  await installBundledCourse();
  await refreshHome();
  await renderLibrary();
  renderSearch("");
  await initPWA();
}
init().catch(err=>{
  console.error(err);
  document.body.innerHTML=`<div style="padding:24px;font-family:system-ui"><h1>Academy World</h1><p>No se pudo iniciar la aplicación.</p><pre>${esc(err.message||err)}</pre></div>`;
});
})();
