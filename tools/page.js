(()=>{
  const asset='../assets/figma-agents/';
  const agents=[
    {id:'codex',name:'Codex',vendor:'OpenAI',logo:'230-imgIcons8Chatgpt961.png',status:'disconnected',account:'检查中…',model:'GPT-5.6 Luna',autoStart:true},
    {id:'hermes',name:'Hermes Agent',vendor:'Hermes',logo:'230-imgFrame12.svg',status:'stopped',account:'未连接账户',model:'默认模型',autoStart:false},
    {id:'deepseek',name:'Deepseek Harness',vendor:'Deepseek',logo:'230-imgFrame13.svg',status:'disconnected',account:'检查中…',model:'默认模型',autoStart:false},
    {id:'kimi',name:'Kimi Code',vendor:'Kimi',logo:'230-imgImage2065413621.png',status:'disconnected',account:'未连接账户',model:'默认模型',autoStart:false}
  ];
  let activeTab='local',managed=null,lastFocus=null,toastTimer;
  const list=document.getElementById('agentList'),layer=document.getElementById('dialogLayer'),search=document.getElementById('agentSearch');
  const statusText=a=>a.id==='deepseek'?(a.status==='ready'?'接口已配置':'接口未配置'):a.status==='ready'?`已就绪${a.id==='codex'?' · 默认 Agent':''}`:a.status==='stopped'?'未启动':'未连接';
  function row(a){
    const action=a.id==='codex'?(a.status==='ready'?['use','使用']:['connect','连接']):a.id==='deepseek'?['connect',a.status==='ready'?'管理接口':'配置接口']:a.status==='ready'?['stop','关闭']:a.status==='stopped'?['start','启动']:['connect','前往连接'];
    return `<article class="agent-row" data-agent="${a.id}"><div class="agent-identity"><img class="agent-logo" src="${asset+a.logo}" alt="" /><div class="agent-copy"><h2 class="agent-name">${a.name}</h2><span class="agent-status"><img class="status-dot" src="${asset}${a.status==='ready'?'230-imgEllipse8.svg':'230-imgEllipse9.svg'}" alt="" />${statusText(a)}</span></div></div><div class="agent-actions">${a.status!=='disconnected'||a.id==='codex'?`<button class="more-button" type="button" data-action="manage" aria-label="管理 ${a.name}"><img src="${asset}230-imgFrame11.svg" alt="" /></button>`:''}<button class="action-button ${a.status==='stopped'?'primary':''}" type="button" data-action="${action[0]}">${action[1]}</button></div></article>`;
  }
  function render(){
    document.getElementById('temporaryApi').hidden=activeTab!=='cloud';
    if(activeTab==='cloud'){list.innerHTML='';return}
    const q=search.value.trim().toLowerCase(),shown=agents.filter(a=>a.name.toLowerCase().includes(q));
    list.innerHTML=shown.length?shown.map((a,i)=>`${i===3?`<img class="agent-divider" src="${asset}230-imgVector4298.svg" alt="" />`:''}${row(a)}`).join(''):'<p class="empty-state">没有找到匹配的 Agent</p>';
  }
  function showToast(message){document.querySelector('.toast')?.remove();clearTimeout(toastTimer);const el=document.createElement('div');el.className='toast';el.setAttribute('role','status');el.textContent=message;document.body.append(el);toastTimer=setTimeout(()=>el.remove(),3200)}
  function openDialog(a,trigger){
    managed=a;lastFocus=trigger;
    document.querySelector('.manage-dialog').classList.toggle('has-api-key',a.id==='deepseek');
    document.getElementById('apiKeyCard').hidden=a.id!=='deepseek';
    document.getElementById('apiKeyInput').value='';
    document.getElementById('dialogTitle').textContent=a.name;
    document.getElementById('dialogVendor').textContent=a.vendor;
    document.getElementById('dialogLogo').src=asset+(a.id==='codex'?'234-imgIcons8Chatgpt961.png':a.logo);
    document.getElementById('accountText').textContent=a.account;
    document.getElementById('defaultToggle').setAttribute('aria-checked',String(a.id==='codex'));
    document.getElementById('autoStartToggle').setAttribute('aria-checked',String(a.autoStart));
    const picker=document.getElementById('modelPicker');
    if(!Array.from(picker.options).some(o=>o.value===a.model))picker.add(new Option(a.model,a.model));
    picker.value=a.model;picker.disabled=a.id==='codex';layer.classList.add('open');layer.setAttribute('aria-hidden','false');(a.id==='deepseek'?document.getElementById('apiKeyInput'):document.getElementById('dialogClose')).focus();
  }
  async function refreshCodexStatus(refresh=false){
    const codex=agents[0];
    try{
      const response=await fetch(`http://127.0.0.1:8787/codex/status${refresh?'?refresh=1':''}`);
      const data=await response.json();
      codex.status=data.connected?'ready':'disconnected';
      codex.account=data.connected?(data.account||'已连接'):(data.error||'未登录');
    }catch{codex.status='disconnected';codex.account='本地服务未启动'}
    render();
    if(managed===codex)document.getElementById('accountText').textContent=codex.account;
  }
  async function refreshDeepSeekStatus(){
    const deepseek=agents.find(a=>a.id==='deepseek');
    try{
      const response=await fetch('http://127.0.0.1:8787/health');
      if(!response.ok)throw new Error('本地服务不可用');
      const data=await response.json();
      deepseek.status=data.configured?'ready':'disconnected';
      deepseek.account=data.configured?'接口密钥已保存在本机':'尚未配置接口密钥';
    }catch{deepseek.status='disconnected';deepseek.account='本地服务未启动'}
    render();
    if(managed===deepseek)document.getElementById('accountText').textContent=deepseek.account;
  }
  function closeDialog(){layer.classList.remove('open');layer.setAttribute('aria-hidden','true');managed=null;lastFocus?.focus()}
  document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{activeTab=tab.dataset.tab;document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected',String(t===tab)));render()}));
  search.addEventListener('input',render);
  list.addEventListener('click',e=>{
    const button=e.target.closest('button[data-action]');if(!button)return;
    const a=agents.find(item=>item.id===button.closest('.agent-row')?.dataset.agent);if(!a)return;
    switch(button.dataset.action){
      case 'manage':openDialog(a,button);break;
      case 'use':if(window.parent!==window)window.parent.postMessage({type:'open-view',view:'new'},location.protocol==='file:'?'*':location.origin);else location.assign(new URL(location.protocol==='file:'?'../index.html?electron=1#view=new':'../new-conversation/',location.href).href);break;
      case 'connect':if(a.id==='codex'){showToast('请先在终端执行 codex login，然后重新打开工具页');refreshCodexStatus()}else if(a.id==='deepseek')openDialog(a,button);else showToast('连接流程将在主进程 Agent 接入后开放');break;
      case 'start':a.status='ready';render();showToast('界面演示：尚未启动真实 Agent');break;
      case 'stop':a.status='stopped';render();showToast('界面演示：尚未关闭真实 Agent');break;
    }
  });
  document.getElementById('defaultToggle').addEventListener('click',e=>{const checked=e.currentTarget.getAttribute('aria-checked')==='true';e.currentTarget.setAttribute('aria-checked',String(!checked));showToast('默认 Agent 设置仅用于界面演示')});
  document.getElementById('autoStartToggle').addEventListener('click',e=>{const checked=e.currentTarget.getAttribute('aria-checked')==='true';e.currentTarget.setAttribute('aria-checked',String(!checked));if(managed)managed.autoStart=!checked;showToast('自动启动设置仅用于界面演示')});
  document.getElementById('modelPicker').addEventListener('change',e=>{if(managed)managed.model=e.target.value;showToast('默认模型设置仅用于界面演示')});
  document.getElementById('reconnectButton').addEventListener('click',async()=>{if(managed?.id==='deepseek'){await refreshDeepSeekStatus();showToast('接口连接状态已更新');return}if(managed?.id!=='codex'){showToast('账户重新连接流程尚未接入');return}await refreshCodexStatus(true);showToast(agents[0].status==='ready'?'Codex 账户状态已更新':'请先在终端执行 codex login')});
  document.getElementById('apiKeyCard').addEventListener('submit',async e=>{
    e.preventDefault();
    const input=document.getElementById('apiKeyInput'),status=document.getElementById('apiKeyStatus'),button=document.getElementById('saveApiKeyBtn');
    const key=input.value.trim();if(!key)return;
    button.disabled=true;status.textContent='正在保存到本机…';
    try{
      const response=await fetch('http://127.0.0.1:8787/configure',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({key})});
      if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'保存失败')}
      input.value='';status.textContent='已保存到本机';await refreshDeepSeekStatus();showToast('接口密钥已保存');
    }catch(error){status.textContent=error.message||'保存失败';showToast(status.textContent)}
    finally{button.disabled=false}
  });
  const temporaryApi=window.top.temporaryAiApi;
  const temporaryStatus=document.getElementById('temporaryApiStatus');
  function syncTemporaryStatus(){temporaryStatus.textContent=temporaryApi.ready()?'已连接 · 刷新页面后自动清除':'尚未连接'}
  document.getElementById('temporaryApiKeyForm').addEventListener('submit',event=>{
    event.preventDefault();
    const input=document.getElementById('temporaryApiKey');
    temporaryApi.setKey(input.value);
    input.value='';
    syncTemporaryStatus();
    showToast('临时 API 已连接');
  });
  document.getElementById('clearTemporaryApi').addEventListener('click',()=>{temporaryApi.clear();syncTemporaryStatus();showToast('临时密钥已清除')});
  document.getElementById('temporaryApiAskForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const output=document.getElementById('temporaryApiAnswer');
    const button=event.currentTarget.querySelector('button[type="submit"]');
    const question=document.getElementById('temporaryApiQuestion').value.trim();
    if(!question)return;
    button.disabled=true;output.textContent='正在获取回答…';
    try{const answer=await temporaryApi.ask(question);output.textContent=answer.message||'API 未返回回答'}
    catch(error){output.textContent=error.message||'请求失败'}
    finally{button.disabled=false}
  });
  syncTemporaryStatus();
  document.getElementById('uninstallButton').addEventListener('click',()=>showToast('卸载流程尚未接入'));
  for(const id of ['dialogClose','dialogCancel'])document.getElementById(id).addEventListener('click',closeDialog);
  layer.addEventListener('click',e=>{if(e.target===layer)closeDialog()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&layer.classList.contains('open'))closeDialog()});
  render();
  refreshCodexStatus();
  refreshDeepSeekStatus();
})();
