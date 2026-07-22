// 9Router-styled SPA for WebProxy — served as inline HTML by server.mjs
// Dark theme (#1a1a1a bg, #E56A4A brand orange), macOS sidebar, Material Symbols,
// card-elev provider cards, AddKey modal with Name+credential+Priority+Check,
// Basic Chat playground, Endpoint info page.

export function renderUI(providers, host, port) {
  const navItems = [
    { id: "providers", label: "Providers", icon: "dns" },
    { id: "chat", label: "Basic Chat", icon: "chat" },
    { id: "endpoint", label: "Endpoint & Key", icon: "api" },
  ];

  const sidebarNav = navItems
    .map(
      (n) =>
        `<a class="nav-item" data-page="${n.id}"><span class="material-symbols-outlined">${n.icon}</span><span>${n.label}</span></a>`
    )
    .join("");

  const providerCards = providers
    .map(
      (p) => `
    <div class="card-elev provider-card" data-pid="${p.id}">
      <div class="card-header">
        <div class="provider-icon"><span class="material-symbols-outlined">language</span></div>
        <div class="provider-info">
          <h3>${p.label}</h3>
          <span class="key-count" id="cnt-${p.id}">0 keys</span>
        </div>
      </div>
      <p class="hint">${p.hint}</p>
      <details class="howto"><summary>How to copy your session</summary><p>${p.howto || p.hint}</p></details>
      <div class="models-row">${(p.models || []).map((m) => `<code>${m}</code>`).join("")}</div>
      <div class="keys-list" id="keys-${p.id}"></div>
      <button class="btn-add" data-pid="${p.id}"><span class="material-symbols-outlined">add</span> Add Key</button>
    </div>`
    )
    .join("");

  return `<!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WebProxy</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap" rel="stylesheet">
<style>
:root{--brand:#E56A4A;--brand-hover:#cc5236;--brand-glow:rgba(229,106,74,.25);--bg:#1a1a1a;--bg-alt:#1F1F1E;--surface:#262626;--surface-2:#303030;--surface-3:#3a3a3a;--border:#333;--border-subtle:#2a2a2a;--text:#ededed;--text-muted:#9ca3af;--text-subtle:#6b7280;--success:#22c55e;--danger:#ef4444;--warning:#fbbf24;--info:#60a5fa;--radius:10px;--radius-lg:14px;--shadow-soft:0 1px 2px rgba(0,0,0,.3);--shadow-warm:0 2px 12px -2px rgba(229,106,74,.25);--shadow-elev:inset 0 1px 0 rgba(255,255,255,.06),0 1px 2px rgba(0,0,0,.4),0 16px 48px -8px rgba(0,0,0,.55)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;height:100vh;overflow:hidden}
::selection{background:rgba(229,106,74,.3);color:var(--brand)}
.layout{display:flex;height:100vh;width:100%}
/* ── Sidebar ── */
.sidebar{width:272px;min-width:272px;border-right:1px solid var(--border-subtle);background:rgba(38,38,38,.72);backdrop-filter:blur(20px);display:flex;flex-direction:column;overflow-y:auto}
.traffic-lights{display:flex;gap:8px;padding:20px 24px 8px}
.tl{width:12px;height:12px;border-radius:50%}
.tl-r{background:#FF5F56}.tl-y{background:#FFBD2E}.tl-g{background:#27C93F}
.logo-section{padding:16px 24px;display:flex;align-items:center;gap:12px}
.logo-icon{width:36px;height:36px;border-radius:var(--radius);background:linear-gradient(135deg,var(--brand),var(--brand-hover));display:flex;align-items:center;justify-content:center;box-shadow:var(--shadow-warm);flex-shrink:0}
.logo-icon .material-symbols-outlined{color:#fff;font-size:20px}
.logo-text h1{font-size:17px;font-weight:600;letter-spacing:-.2px;color:var(--text)}
.logo-text span{font-size:11px;color:var(--text-subtle)}
nav{flex:1;padding:8px 12px;display:flex;flex-direction:column;gap:2px}
.nav-item{display:flex;align-items:center;gap:12px;padding:6px 12px;border-radius:8px;color:var(--text-muted);cursor:pointer;text-decoration:none;font-size:13px;font-weight:500;transition:all .15s}
.nav-item:hover{background:var(--surface-2);color:var(--text)}
.nav-item.active{background:rgba(229,106,74,.1);color:var(--brand)}
.nav-item .material-symbols-outlined{font-size:18px}
.sidebar-footer{padding:16px 20px;border-top:1px solid var(--border-subtle);font-size:11px;color:var(--text-subtle);display:flex;align-items:center;gap:6px}
.sidebar-footer .dot{width:7px;height:7px;border-radius:50%;background:var(--success)}
/* ── Main ── */
.main{flex:1;display:flex;flex-direction:column;min-width:0;position:relative}
.grid-bg{position:absolute;inset:0;pointer-events:none;z-index:0;opacity:.04;background-image:linear-gradient(to right,var(--brand) 1px,transparent 1px),linear-gradient(to bottom,var(--brand) 1px,transparent 1px);background-size:40px 40px}
.header{padding:16px 32px;border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:12px;position:relative;z-index:1;background:rgba(26,26,26,.6);backdrop-filter:blur(8px)}
.header h2{font-size:15px;font-weight:600}
.content{flex:1;overflow-y:auto;padding:24px 32px;position:relative;z-index:1}
.page{display:none}.page.active{display:block}
/* ── Cards ── */
.card-elev{background:var(--surface);box-shadow:var(--shadow-elev);border-radius:var(--radius-lg);padding:16px;margin-bottom:12px}
.card-header{display:flex;align-items:center;gap:12px;margin-bottom:8px}
.provider-icon{width:40px;height:40px;border-radius:var(--radius);background:var(--surface-2);display:flex;align-items:center;justify-content:center;color:var(--brand)}
.provider-icon .material-symbols-outlined{font-size:22px}
.provider-info h3{font-size:14px;font-weight:600}
.key-count{font-size:11px;color:var(--text-subtle)}
.hint{font-size:12px;color:var(--text-muted);margin-bottom:8px}
.howto{font-size:12px;color:var(--text-muted);margin-bottom:8px}
.howto summary{cursor:pointer;color:var(--brand);font-weight:500}
.howto p{margin-top:4px;line-height:1.5}
.models-row{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px}
.models-row code{background:var(--bg-alt);border:1px solid var(--border-subtle);border-radius:6px;padding:2px 8px;font-size:11px;color:var(--info);font-family:ui-monospace,monospace}
.keys-list{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
.key-row{display:flex;align-items:center;gap:8px;background:var(--bg-alt);border:1px solid var(--border-subtle);border-radius:8px;padding:6px 10px}
.key-row .key-name{font-size:12px;font-weight:500;color:var(--text);min-width:60px}
.key-row .key-masked{flex:1;font-family:ui-monospace,monospace;font-size:11px;color:var(--text-subtle);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.key-row .key-status{font-size:10px;padding:1px 6px;border-radius:999px;font-weight:600}
.key-row .key-status.active{background:rgba(34,197,94,.15);color:var(--success)}
.key-row .key-status.failed{background:rgba(239,68,68,.15);color:var(--danger)}
.key-row .key-status.unknown{background:rgba(156,163,175,.15);color:var(--text-muted)}
.key-row button{background:transparent;border:0;color:var(--danger);cursor:pointer;font-size:12px;padding:0 4px}
.btn-add{display:flex;align-items:center;gap:4px;background:transparent;border:1px dashed var(--border);border-radius:8px;color:var(--text-muted);padding:6px 12px;cursor:pointer;font-size:12px;font-weight:500;width:100%;justify-content:center;transition:all .15s}
.btn-add:hover{border-color:var(--brand);color:var(--brand);background:rgba(229,106,74,.05)}
.btn-add .material-symbols-outlined{font-size:16px}
/* ── Modal ── */
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);z-index:50;align-items:center;justify-content:center}
.modal-overlay.open{display:flex}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;width:min(92vw,440px);box-shadow:var(--shadow-elev)}
.modal h3{font-size:16px;font-weight:600;margin-bottom:16px}
.field{margin-bottom:12px}
.field label{display:block;font-size:12px;font-weight:500;color:var(--text-muted);margin-bottom:4px}
.field input,.field textarea{width:100%;background:var(--bg-alt);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:8px 10px;font-size:13px;outline:none;font-family:inherit}
.field input:focus,.field textarea:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-glow)}
.modal-actions{display:flex;gap:8px;margin-top:16px}
.btn-primary{background:var(--brand);color:#fff;border:0;border-radius:8px;padding:8px 16px;font-weight:600;font-size:13px;cursor:pointer;flex:1;transition:background .15s}
.btn-primary:hover{background:var(--brand-hover)}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
.btn-ghost{background:transparent;border:1px solid var(--border);border-radius:8px;padding:8px 16px;color:var(--text-muted);font-size:13px;cursor:pointer;flex:1}
.btn-ghost:hover{background:var(--surface-2)}
.validate-badge{font-size:12px;font-weight:600;padding:2px 8px;border-radius:6px;margin-top:4px;display:inline-block}
.validate-badge.ok{background:rgba(34,197,94,.15);color:var(--success)}
.validate-badge.fail{background:rgba(239,68,68,.15);color:var(--danger)}
/* ── Chat ── */
.chat-wrap{display:flex;flex-direction:column;height:calc(100vh - 130px)}
.chat-controls{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.chat-controls select{background:var(--bg-alt);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:6px 10px;font-size:13px;min-width:0}
.chat-controls label{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-muted)}
.chat-log{flex:1;overflow:auto;background:var(--bg-alt);border:1px solid var(--border-subtle);border-radius:var(--radius);padding:12px;font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap;color:var(--text);line-height:1.6}
.msg-user{color:var(--info)}.msg-assistant{color:var(--success)}.msg-err{color:var(--danger)}
.chat-input-row{display:flex;gap:8px;margin-top:8px}
.chat-input-row textarea{flex:1;background:var(--bg-alt);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:8px 10px;font-size:13px;resize:none;outline:none;min-height:44px;font-family:inherit}
.chat-input-row textarea:focus{border-color:var(--brand)}
/* ── Endpoint ── */
.ep-card{background:var(--surface);border-radius:var(--radius-lg);padding:20px;box-shadow:var(--shadow-soft);margin-bottom:12px}
.ep-card h3{font-size:14px;font-weight:600;margin-bottom:8px}
.ep-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.ep-row label{font-size:12px;color:var(--text-muted);min-width:80px}
.ep-row code{font-size:13px;color:var(--info);background:var(--bg-alt);padding:2px 8px;border-radius:4px;font-family:ui-monospace,monospace}
.providers-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
.material-symbols-outlined{font-family:'Material Symbols Outlined';font-weight:normal;font-style:normal;font-size:24px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;word-wrap:normal;direction:ltr;font-feature-settings:'liga';-webkit-font-feature-settings:'liga';-webkit-font-smoothing:antialiased;font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24}
.sidebar-toggle{display:none;background:transparent;border:0;color:var(--text);cursor:pointer;padding:4px;border-radius:6px}
.sidebar-toggle:hover{background:var(--surface-2)}
.sidebar-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:39}
.sidebar-overlay.open{display:block}
@media(max-width:768px){
  .sidebar{position:fixed;left:-280px;top:0;bottom:0;z-index:40;transition:left .25s ease}
  .sidebar.open{left:0}
  .sidebar-toggle{display:flex}
  .providers-grid{grid-template-columns:1fr}
  .chat-wrap{height:calc(100vh - 100px)}
  .content{padding:16px}
  .header{padding:12px 16px}
}
</style>
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <div class="traffic-lights"><div class="tl tl-r"></div><div class="tl tl-y"></div><div class="tl tl-g"></div></div>
    <div class="logo-section">
      <div class="logo-icon"><span class="material-symbols-outlined">hub</span></div>
      <div class="logo-text"><h1>WebProxy</h1><span>v1.0</span></div>
    </div>
    <nav>${sidebarNav}</nav>
    <div class="sidebar-footer"><div class="dot"></div><span id="health">connecting…</span></div>
  </aside>
  <div class="sidebar-overlay" id="sidebar-overlay"></div>
  <div class="main">
    <div class="grid-bg"></div>
    <div class="header"><button class="sidebar-toggle" id="sidebar-toggle"><span class="material-symbols-outlined">menu</span></button><h2 id="page-title">Providers</h2></div>
    <div class="content">
      <div class="page active" id="page-providers"><div class="providers-grid">${providerCards}</div></div>
      <div class="page" id="page-chat">
        <div class="chat-wrap">
          <div class="chat-controls">
            <select id="chat-provider"></select>
            <select id="chat-model"></select>
            <label><input type="checkbox" id="chat-stream" checked> stream</label>
          </div>
          <div class="chat-log" id="chat-log">Add a provider key first, then chat here.</div>
          <div class="chat-input-row"><textarea id="chat-prompt" placeholder="Type a message… (Ctrl+Enter to send)"></textarea><button class="btn-primary" id="chat-send" style="flex:0;min-width:64px">Send</button></div>
        </div>
      </div>
      <div class="page" id="page-endpoint">
        <div class="ep-card"><h3>Connection Info</h3>
          <div class="ep-row"><label>Base URL</label><code>http://${host}:${port}</code></div>
          <div class="ep-row"><label>API Key</label><code>not required (localhost only)</code></div>
          <div class="ep-row"><label>Chat</label><code>POST /v1/chat/completions</code></div>
          <div class="ep-row"><label>Models</label><code>GET /v1/models</code></div>
          <div class="ep-row"><label>Health</label><code>GET /api/health</code></div>
        </div>
        <div class="ep-card"><h3>Quick Start</h3>
          <pre style="font-size:12px;color:var(--info);background:var(--bg-alt);padding:12px;border-radius:8px;overflow-x:auto;font-family:ui-monospace,monospace;line-height:1.6">curl -sS http://${host}:${port}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"provider":"kimi-web","model":"kimi-k2","stream":true,
       "messages":[{"role":"user","content":"hello"}]}'</pre>
        </div>
      </div>
    </div>
  </div>
</div>
<div class="modal-overlay" id="modal-overlay">
  <div class="modal">
    <h3 id="modal-title">Add Key</h3>
    <div class="field"><label>Name</label><input id="modal-name" placeholder="Production Key"></div>
    <div class="field"><label id="modal-cred-label">Cookie / Token</label><input id="modal-cred" type="password" placeholder="paste session cookie or token"></div>
    <div class="field"><label>Priority (lower = tried first)</label><input id="modal-priority" type="number" value="1" min="1"></div>
    <div id="modal-validate-result"></div>
    <div class="modal-actions">
      <button class="btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn-primary" id="modal-check">Check</button>
      <button class="btn-primary" id="modal-save">Save</button>
    </div>
  </div>
</div>
<script>
const API="";
let CONNS=[];
let modalPid=null;
const $=id=>document.getElementById(id);

function showPage(id){
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n=>n.classList.remove("active"));
  const pg=$("page-"+id); if(pg) pg.classList.add("active");
  const nav=document.querySelector('.nav-item[data-page="'+id+'"]'); if(nav) nav.classList.add("active");
  const titles={providers:"Providers",chat:"Basic Chat",endpoint:"Endpoint & Key"};
  $("page-title").textContent=titles[id]||id;
}

document.querySelectorAll(".nav-item").forEach(n=>n.addEventListener("click",()=>{showPage(n.dataset.page);sidebarEl.classList.remove("open");overlayEl.classList.remove("open");}));

async function refresh(){
  const r=await fetch(API+"/api/connections"); const d=await r.json(); CONNS=d.connections;
  for(const c of d.connections){
    $("cnt-"+c.provider).textContent=c.credentials+" key"+(c.credentials===1?"":"s");
    const box=$("keys-"+c.provider); box.innerHTML="";
    for(const k of (c.keys||[])){
      const row=document.createElement("div"); row.className="key-row";
      const nm=document.createElement("span"); nm.className="key-name"; nm.textContent=k.name;
      const mk=document.createElement("span"); mk.className="key-masked"; mk.textContent=k.masked;
      const st=document.createElement("span"); st.className="key-status "+k.status; st.textContent=k.status;
      const del=document.createElement("button"); del.textContent="remove"; del.dataset.action="del"; del.dataset.pid=c.provider; del.dataset.index=k.index;
      row.appendChild(nm); row.appendChild(mk); row.appendChild(st); row.appendChild(del);
      box.appendChild(row);
    }
  }
  const sel=$("chat-provider");
  sel.innerHTML=d.connections.map(c=>'<option value="'+c.provider+'">'+(c.label||c.provider)+"</option>").join("");
  fillModels();
}

function fillModels(){
  const pid=$("chat-provider").value; const c=CONNS.find(x=>x.provider===pid);
  const m=$("chat-model"); if(!c){m.innerHTML="";return;}
  m.innerHTML=(c.models||[]).map(x=>'<option value="'+x+'">'+x+"</option>").join("");
}

function openModal(pid){
  modalPid=pid; const c=CONNS.find(x=>x.provider===pid);
  $("modal-title").textContent="Add "+(c?c.label:pid)+" Key";
  $("modal-cred-label").textContent=(c&&c.hint||"Cookie / Token");
  $("modal-name").value=""; $("modal-cred").value=""; $("modal-priority").value=String((c?c.credentials:0)+1);
  $("modal-validate-result").innerHTML="";
  $("modal-overlay").classList.add("open");
}

function closeModal(){$("modal-overlay").classList.remove("open"); modalPid=null;}

async function saveKey(){
  if(!modalPid) return;
  const name=$("modal-name").value.trim()||("Key "+((CONNS.find(x=>x.provider===modalPid)||{}).credentials||0)+1);
  const cred=$("modal-cred").value.trim(); if(!cred) return;
  const priority=Number($("modal-priority").value)||1;
  const r=await fetch(API+"/api/connections",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:modalPid,credential:cred,name,priority})});
  if(r.ok){closeModal(); refresh();}
}

async function checkKey(){
  if(!modalPid) return;
  const cred=$("modal-cred").value.trim(); if(!cred) return;
  const priority=Number($("modal-priority").value)||1;
  const name=$("modal-name").value.trim()||"test";
  const addR=await fetch(API+"/api/connections",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider:modalPid,credential:cred,name,priority})});
  if(!addR.ok){$("modal-validate-result").innerHTML='<span class="validate-badge fail">Add failed</span>';return;}
  await refresh();
  const c=CONNS.find(x=>x.provider===modalPid);
  const idx=c?c.credentials-1:0;
  const tR=await fetch(API+"/api/connections/"+encodeURIComponent(modalPid)+"/"+idx+"/test",{method:"POST"});
  const tD=await tR.json().catch(()=>({valid:false}));
  $("modal-validate-result").innerHTML=tD.valid?'<span class="validate-badge ok">Valid</span>':'<span class="validate-badge fail">Invalid</span>';
}

async function delKey(pid,i){
  await fetch(API+"/api/connections/"+encodeURIComponent(pid)+"/"+i,{method:"DELETE"});
  refresh();
}

async function sendChat(){
  const pid=$("chat-provider").value; const model=$("chat-model").value;
  const stream=$("chat-stream").checked; const prompt=$("chat-prompt").value.trim(); if(!prompt) return;
  const log=$("chat-log");
  log.appendChild(Object.assign(document.createElement("div"),{className:"msg-user",textContent:">> "+prompt}));
  const tail=document.createElement("div"); tail.className="msg-assistant"; tail.textContent="..."; log.appendChild(tail);
  const body={provider:pid,model:model||undefined,stream,messages:[{role:"user",content:prompt}]};
  try{
    const r=await fetch(API+"/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    if(!r.ok){const e=await r.json().catch(()=>({error:{message:r.statusText}}));tail.className="msg-err";tail.textContent="Error: "+(e.error&&e.error.message||r.status);return;}
    if(stream){
      const dec=new TextDecoder(); let buf=""; let acc=""; const reader=r.body.getReader();
      while(true){const {done,value}=await reader.read(); if(done) break; buf+=dec.decode(value,{stream:true});
        const lines=buf.split("\\n"); buf=lines.pop();
        for(const l of lines){ if(!l.startsWith("data:")) continue; const p=l.slice(5).trim(); if(!p||p==="[DONE]") continue;
          try{ const o=JSON.parse(p); const dl=o.choices&&o.choices[0]&&o.choices[0].delta; if(!dl) continue;
            if(dl.content) acc+=dl.content; if(dl.reasoning_content) acc+="[think]"+dl.reasoning_content+"[/think]"; tail.textContent=acc; log.scrollTop=log.scrollHeight; }catch(e){} } }
      if(buf.trim()){const p=buf.trim(); if(p.startsWith("data:")){const d=p.slice(5).trim(); if(d&&d!=="[DONE]") try{const o=JSON.parse(d);const dl=o.choices&&o.choices[0]&&o.choices[0].delta;if(dl){if(dl.content)acc+=dl.content;if(dl.reasoning_content)acc+="[think]"+dl.reasoning_content+"[/think]";}}catch(e){}}}
      tail.textContent=acc||"(empty)"; log.scrollTop=log.scrollHeight;
    } else { const j=await r.json(); tail.textContent=(j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content)||JSON.stringify(j); }
  }catch(e){ tail.className="msg-err"; tail.textContent="Error: "+e.message; }
  $("chat-prompt").value=""; log.scrollTop=log.scrollHeight;
}

document.addEventListener("click",e=>{
  const a=e.target.closest("[data-action]"); if(!a) return;
  if(a.dataset.action==="del") delKey(a.dataset.pid,Number(a.dataset.index));
});
document.addEventListener("click",e=>{if(e.target.closest(".btn-add")) openModal(e.target.closest(".btn-add").dataset.pid);});
$("modal-cancel").addEventListener("click",closeModal);
$("modal-save").addEventListener("click",saveKey);
$("modal-check").addEventListener("click",checkKey);
$("chat-provider").addEventListener("change",fillModels);
$("chat-send").addEventListener("click",sendChat);
$("chat-prompt").addEventListener("keydown",e=>{if((e.metaKey||e.ctrlKey)&&e.key==="Enter") sendChat();});
$("modal-overlay").addEventListener("click",e=>{if(e.target===$("modal-overlay")) closeModal();});
const sidebarEl=document.querySelector(".sidebar");
const overlayEl=$("sidebar-overlay");
$("sidebar-toggle").addEventListener("click",()=>{sidebarEl.classList.toggle("open");overlayEl.classList.toggle("open");});
overlayEl.addEventListener("click",()=>{sidebarEl.classList.remove("open");overlayEl.classList.remove("open");});
fetch(API+"/api/health").then(r=>r.json()).then(d=>$("health").textContent=d.ok?"online":"offline").catch(()=>$("health").textContent="offline");
refresh();
</script>
</body></html>`;
}
