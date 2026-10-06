(()=>{
  const asset='../assets/figma-agents/';
  const agents=[
    {id:'codex',name:'Codex',vendor:'Open AI',logo:'230-imgIcons8Chatgpt961.png',status:'ready',account:'kskblzdjd@qq.com',model:'GPT-6 Astra',autoStart:true},
    {id:'hermes',name:'Hermes Agent',vendor:'Hermes',logo:'230-imgFrame12.svg',status:'stopped',account:'未连接账户',model:'默认模型',autoStart:false},
    {id:'deepseek',name:'Deepseek Harness',vendor:'Deepseek',logo:'230-imgFrame13.svg',status:'stopped',account:'未连接账户',model:'默认模型',autoStart:false},
    {id:'kimi',name:'Kimi Code',vendor:'Kimi',logo:'230-imgImage2065413621.png',status:'disconnected',account:'未连接账户',model:'默认模型',autoStart:false}
  ];
  let activeTab='local',managed=null,lastFocus=null,toastTimer;
  const list=document.getElementById('agentList'),layer=document.getElementById('dialogLayer'),search=document.getElementById('agentSearch');
  const statusText=a=>a.status==='ready'?`已就绪${a.id==='codex'?' · 默认 Agent':''}`:a.status==='stopped'?'未启动':'未连接';
  function row(a){
    const action=a.status==='ready'?['stop','关闭']:a.status==='stopped'?['start','启动']:['connect','前往连接'];
    return `<article class="agent-row" data-agent="${a.id}"><div class="agent-identity"><img class="agent-logo" src="${asset+a.logo}" alt="" /><div class="agent-copy"><h2 class="agent-name">${a.name}</h2><span class="agent-status"><img class="status-dot" src="${asset}${a.status==='ready'?'230-imgEllipse8.svg':'230-imgEllipse9.svg'}" alt="" />${statusText(a)}</span></div></div><div class="agent-actions">${a.status!=='disconnected'?`<button class="more-button" type="button" data-action="manage" aria-label="管理 ${a.name}"><img src="${asset}230-imgFrame11.svg" alt="" /></button>`:''}<button class="action-button ${a.status==='stopped'?'primary':''}" type="button" data-action="${action[0]}">${action[1]}</button></div></article>`;
  }
  function render(){
    if(activeTab==='cloud'){list.innerHTML='<p class="empty-state">云端 Agent 接入界面待设计</p>';return}
    const q=search.value.trim().toLowerCase(),shown=agents.filter(a=>a.name.toLowerCase().includes(q));
    list.innerHTML=shown.length?shown.map((a,i)=>`${i===3?`<img class="agent-divider" src="${asset}230-imgVector4298.svg" alt="" />`:''}${row(a)}`).join(''):'<p class="empty-state">没有找到匹配的 Agent</p>';
  }
  function showToast(message){document.querySelector('.toast')?.remove();clearTimeout(toastTimer);const el=document.createElement('div');el.className='toast';el.setAttribute('role','status');el.textContent=message;document.body.append(el);toastTimer=setTimeout(()=>el.remove(),3200)}
  function openDialog(a,trigger){
    managed=a;lastFocus=trigger;
    document.getElementById('dialogTitle').textContent=a.name;
    document.getElementById('dialogVendor').textContent=a.vendor;
    document.getElementById('dialogLogo').src=asset+(a.id==='codex'?'234-imgIcons8Chatgpt961.png':a.logo);
    document.getElementById('accountText').textContent=a.account;
    document.getElementById('defaultToggle').setAttribute('aria-checked',String(a.id==='codex'));
    document.getElementById('autoStartToggle').setAttribute('aria-checked',String(a.autoStart));
    const picker=document.getElementById('modelPicker');
    if(!Array.from(picker.options).some(o=>o.value===a.model))picker.add(new Option(a.model,a.model));
    picker.value=a.model;layer.classList.add('open');layer.setAttribute('aria-hidden','false');document.getElementById('dialogClose').focus();
  }
  function closeDialog(){layer.classList.remove('open');layer.setAttribute('aria-hidden','true');managed=null;lastFocus?.focus()}
  document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{activeTab=tab.dataset.tab;document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected',String(t===tab)));render()}));
  search.addEventListener('input',render);
  list.addEventListener('click',e=>{
    const button=e.target.closest('button[data-action]');if(!button)return;
    const a=agents.find(item=>item.id===button.closest('.agent-row')?.dataset.agent);if(!a)return;
    switch(button.dataset.action){
      case 'manage':openDialog(a,button);break;
      case 'connect':showToast('连接流程将在主进程 Agent 接入后开放');break;
      case 'start':a.status='ready';render();showToast('界面演示：尚未启动真实 Agent');break;
      case 'stop':a.status='stopped';render();showToast('界面演示：尚未关闭真实 Agent');break;
    }
  });
  document.getElementById('defaultToggle').addEventListener('click',e=>{const checked=e.currentTarget.getAttribute('aria-checked')==='true';e.currentTarget.setAttribute('aria-checked',String(!checked));showToast('默认 Agent 设置仅用于界面演示')});
  document.getElementById('autoStartToggle').addEventListener('click',e=>{const checked=e.currentTarget.getAttribute('aria-checked')==='true';e.currentTarget.setAttribute('aria-checked',String(!checked));if(managed)managed.autoStart=!checked;showToast('自动启动设置仅用于界面演示')});
  document.getElementById('modelPicker').addEventListener('change',e=>{if(managed)managed.model=e.target.value;showToast('默认模型设置仅用于界面演示')});
  document.getElementById('reconnectButton').addEventListener('click',()=>showToast('账户重新连接流程尚未接入'));
  document.getElementById('uninstallButton').addEventListener('click',()=>showToast('卸载流程尚未接入'));
  for(const id of ['dialogClose','dialogCancel'])document.getElementById(id).addEventListener('click',closeDialog);
  layer.addEventListener('click',e=>{if(e.target===layer)closeDialog()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&layer.classList.contains('open'))closeDialog()});
  render();
})();
