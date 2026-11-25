
(() => {
'use strict';
const $=id=>document.getElementById(id);
const FRIENDLY_CLASS={D00:'Longitudinal crack',D01:'Longitudinal crack (joint)',D10:'Lateral crack',D11:'Lateral crack (joint)',D20:'Alligator crack',D40:'Pothole',D43:'Faded crosswalk',D44:'Faded white line',D50:'Manhole / utility cover',D0w0:'Unrecognised class (D0w0)',waterlogging:'Waterlogging',road_edge_breakage:'Road edge breakage',failed_repair_patch:'Failed repair patch',asphalt_ravelling:'Asphalt ravelling',surface_bleeding:'Surface bleeding'};
const friendlyClass=c=>FRIENDLY_CLASS[String(c)]||String(c||'Unknown');

const api=async(path,options={})=>{
  const r=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const d=await r.json().catch(()=>({}));
  if(r.status===404&&/route not found/i.test(d.error||''))throw new Error('The running server is older than these pages. Copy server.js and insights.js from the latest zip into your StreetSense folder, then fully stop and restart start.bat.');
  if(!r.ok)throw new Error(d.error||'Request failed');
  return d;
};

let me=null,complaints=[],users=[],duplicates=[];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(s){const t=$('toast');t.textContent=s;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),3200);}
function showModal(id){$(id).classList.remove('hidden');}
function hideModals(){document.querySelectorAll('.modal').forEach(x=>x.classList.add('hidden'));}
document.querySelectorAll('[data-close]').forEach(x=>x.onclick=hideModals);

function nav(panel){
  document.querySelectorAll('.admin-nav').forEach(x=>
    x.classList.toggle('active',x.dataset.panel===panel)
  );

  document.querySelectorAll('.admin-panel').forEach(x=>
    x.classList.toggle('active',x.id==='panel-'+panel)
  );

  $('admin-heading').textContent=({
    overview:'Overview',
    complaints:'Complaints',
    accounts:'Accounts',
    verifications:'Repair Verification',
    duplicates:'Duplicate Complaints',
    settings:'Settings'
  })[panel] || 'Overview';

  if(panel==='complaints')renderComplaints();
  if(panel==='duplicates')loadDuplicates();
  if(panel==='accounts')renderUsers();

  if(panel==='verifications' && window.loadStreetSenseVerifications){
    window.loadStreetSenseVerifications();
  }
}
document.querySelectorAll('.admin-nav').forEach(x=>x.onclick=()=>nav(x.dataset.panel));
document.querySelectorAll('[data-go]').forEach(x=>x.onclick=()=>nav(x.dataset.go));

function renderMetrics(){
  const count=(s)=>complaints.filter(c=>c.status===s).length;
  $('metric-total').textContent=complaints.length;
  $('metric-review').textContent=count('Submitted')+count('Under review');
  $('metric-progress').textContent=count('Assigned')+count('In progress');
  $('metric-resolved').textContent=count('Resolved');
  $('nav-complaints').textContent=String(complaints.length).padStart(2,'0');
}

function miniComplaint(c){
  return `<div class="mini-row"><span class="mini-bullet"></span><div class="mini-row-main"><b>${esc(c.category)} · ${esc(c.id)}</b><small>${esc(c.location)} · ${esc(c.reporter?.email||'Citizen')}</small></div><span>${esc(c.status)}</span></div>`;
}

function renderOverview(){
  $('recent-complaints').innerHTML=complaints.slice(0,5).map(miniComplaint).join('')||'<div class="empty-state"><b>No community reports yet</b>New submissions will appear here.</div>';
  $('recent-users').innerHTML=users.slice(0,5).map(u=>`<div class="mini-row"><span class="mini-bullet" style="background:${u.role==='admin'?'var(--paint)':'var(--info)'}"></span><div class="mini-row-main"><b>${esc(u.displayName)}</b><small>${esc(u.email)}</small></div><span>${esc(u.role)}</span></div>`).join('')||'<div class="empty-state">No accounts found.</div>';
}

function renderComplaints(){
  const q=$('complaint-search').value.toLowerCase(),f=$('complaint-filter').value;
  const items=complaints.filter(c=>(!f||c.status===f)&&(!q||[c.id,c.category,c.location,c.reporter?.email,c.description].join(' ').toLowerCase().includes(q)));
  $('all-complaints').innerHTML=items.map(c=>`<article class="complaint-card" data-id="${esc(c.id)}"><div class="complaint-card-top"><span class="mono complaint-meta">${esc(c.id)} · ${new Date(c.createdAt).toLocaleString()}</span><span class="status-pill ${c.status==='Resolved'?'resolved':c.status==='Rejected'?'rejected':''}">${esc(c.status)}</span></div><h3>${esc(c.category)}</h3><div class="complaint-meta">⌖ ${esc(c.location)}</div><p>${esc(c.description)}</p><div class="complaint-meta">REPORTED BY ${esc(c.reporter?.email||'Unknown')}</div>${c.incidentId?'<div style="margin-top:8px"><span class="st st-assigned">Approved · in the repair pipeline</span></div>':''}<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${c.status==='Submitted'&&!c.incidentId?(Number.isFinite(c.lat)&&Number.isFinite(c.lng)?`<button type="button" class="btn btn-primary btn-sm" data-approve="${esc(c.id)}">Approve</button>`:'<small>No map location, so it cannot be approved yet.</small>')+`<button type="button" class="btn btn-sm" data-reject="${esc(c.id)}">Reject</button>`:''}<button type="button" class="btn btn-danger btn-sm" data-del="${esc(c.id)}">Delete</button></div></article>`).join('')||'<div class="empty-state"><b>Nothing to review</b>Try changing your search or status filter.</div>';

  document.querySelectorAll('.complaint-card').forEach(el=>el.onclick=()=>openComplaint(el.dataset.id));
  document.querySelectorAll('#all-complaints [data-del]').forEach(b=>b.onclick=e=>{e.stopPropagation();deleteComplaint(b.dataset.del);});
  document.querySelectorAll('#all-complaints [data-approve]').forEach(b=>b.onclick=e=>{e.stopPropagation();approveReport(b.dataset.approve);});
  document.querySelectorAll('#all-complaints [data-reject]').forEach(b=>b.onclick=e=>{e.stopPropagation();rejectReport(b.dataset.reject);});
}
// DUPLICATE COMPLAINTS
async function loadDuplicates(){
  try {
    const data = await api('/admin/duplicates');
    duplicates = data.items || [];

    $('duplicate-pending-count').textContent = duplicates.length;
    $('nav-duplicates').textContent =
      String(duplicates.length).padStart(2,'0');

    renderDuplicates();
  } catch(error) {
    toast(error.message);
  }
}

function renderDuplicates(){
  $('duplicate-list').innerHTML = duplicates.map(d => `
    <article class="complaint-card">
      <div class="complaint-card-top">
        <span class="mono complaint-meta">
          ${esc(d.complaintId)}
        </span>
        <span class="status-pill">
          ${Number(d.similarityScore).toFixed(1)}% match
        </span>
      </div>

      <h3>${esc(d.complaint?.category || 'Unknown category')}</h3>
      <p>${esc(d.complaint?.description || 'No description')}</p>

      <div class="complaint-meta">
        Possible duplicate: ${esc(d.possibleDuplicateId)}
      </div>

      <div class="complaint-meta">
        Location: ${esc(d.complaint?.location || 'Unknown')}
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn-primary btn-sm"
          data-confirm-duplicate="${esc(d.id)}">
          Confirm duplicate
        </button>

        <button class="btn btn-sm"
          data-reject-duplicate="${esc(d.id)}">
          Reject match
        </button>
      </div>
    </article>
  `).join('') ||
  '<div class="empty-state"><b>No pending duplicates</b>All duplicate reviews are clear.</div>';

  document.querySelectorAll('[data-confirm-duplicate]').forEach(b => {
    b.onclick = () => reviewDuplicate(b.dataset.confirmDuplicate,'confirmed');
  });

  document.querySelectorAll('[data-reject-duplicate]').forEach(b => {
    b.onclick = () => reviewDuplicate(b.dataset.rejectDuplicate,'rejected');
  });
}
async function reviewDuplicate(id,reviewStatus){
  try {
    await api('/admin/duplicates/'+encodeURIComponent(id),{
      method:'PATCH',
      body:JSON.stringify({reviewStatus})
    });

    toast(
      reviewStatus==='confirmed'
        ? 'Duplicate confirmed.'
        : 'Duplicate match rejected.'
    );

    await loadDuplicates();
  } catch(error) {
    toast(error.message);
  }
}
// ACCOUNTS
function renderUsers(){
  $('all-users').innerHTML=
    '<div class="user-table-row header"><span>PERSON</span><span>EMAIL</span><span>ROLE / STATUS</span><span>ACTIONS</span></div>'+
    users.map(u=>`
      <div class="user-table-row">
        <div><b>${esc(u.displayName)}</b><small>Joined ${u.role==='admin'?'19/11/2026':new Date(u.createdAt).toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'})}</small></div>
        <div>${esc(u.email)}</div>
        <div>${esc(u.role)}<small>${u.active?'Active':'Disabled'}</small></div>
        <div class="user-actions">
          <button data-reset="${esc(u.id)}">Reset password</button>
          <button data-toggle="${esc(u.id)}" data-active="${u.active?'1':'0'}">${u.active?'Disable':'Enable'}</button>
          ${u.role==='citizen'?`<button class="btn-danger" data-delete-user="${esc(u.id)}" data-email="${esc(u.email)}">Delete</button>`:''}
        </div>
      </div>
    `).join('');

  document.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>resetPassword(b.dataset.reset));
  document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>toggleUser(b.dataset.toggle,b.dataset.active==='1'));
  document.querySelectorAll('[data-delete-user]').forEach(b=>b.onclick=()=>deleteUser(b.dataset.deleteUser,b.dataset.email));
}

async function loadAll(){
  const [c,u]=await Promise.all([api('/admin/complaints'),api('/users')]);
  complaints=c.items;
  users=u.items;
  renderMetrics();
  renderOverview();
  if($('panel-complaints').classList.contains('active'))renderComplaints();
  if($('panel-duplicates').classList.contains('active'))loadDuplicates();
  if($('panel-accounts').classList.contains('active'))renderUsers();
}

function renderAIAnalysis(c) {
  const ai = c.aiAnalysis || {};
  const detections = Array.isArray(ai.detections) ? ai.detections : [];
  const status = String(ai.status || 'not_available');

  const groups = Object.values(detections.reduce((m, d) => {
    const k = friendlyClass(d.className);
    const e = m[k] || (m[k] = { className: k, confidence: 0, count: 0 });
    e.count++;
    e.confidence = Math.max(e.confidence, Number(d.confidence) || 0);
    return m;
  }, {}));

  const cards = groups.length
    ? groups.slice(0, 10).map(d => {
        const confidence = Number(d.confidence);
        const score = Number.isFinite(confidence)
          ? (confidence * 100).toFixed(1) + '% confidence' + (d.count > 1 ? ' · ' + d.count + ' areas found' : '')
          : 'Confidence unavailable';
        return '<div class="ai-detection"><b>' + esc(d.className || 'Unknown') + '</b><span>' + score + '</span></div>';
      }).join('')
    : '<p>No detections available for this report.</p>';

  return '<section class="admin-ai">' +
    '<div class="kicker">MODEL ANALYSIS</div>' +
    '<p>AI STATUS: <b>' + esc(status) + '</b></p>' +
    (ai.scene && ai.scene.isRoad === false ? '<p><b>PHOTO CHECK:</b> ' + esc(ai.scene.reason) + ' The AI result was ignored.</p>' : '') +
    cards +
    (ai.prediction ? '<p>SUGGESTED CATEGORY: <b>' + esc(ai.prediction.type || 'Not available') + '</b></p>' : '') +
    (ai.message ? '<p>' + esc(ai.message) + '</p>' : '') +
    '<p class="ai-review-note">AI predictions are preliminary and require human verification.</p></section>';
}

async function openComplaint(id){
  const c=complaints.find(x=>x.id===id);
  if(!c)return;
  const img=c.image?`<img class="detail-image" src="${esc(c.image)}" alt="Complaint evidence">`:'';
  const coords=Number.isFinite(Number(c.lat))&&Number.isFinite(Number(c.lng))&&c.lat!==null&&c.lng!==null?`<p class="mono detail-meta">GPS ${Number(c.lat).toFixed(6)}, ${Number(c.lng).toFixed(6)}</p>`:'';

  $('complaint-detail').innerHTML=`<div class="kicker">COMPLAINT / ${esc(c.id)}</div><h2 class="detail-h">${esc(c.category)}</h2><p class="detail-sub">${esc(c.location)} · ${new Date(c.createdAt).toLocaleString()}</p>${coords}${img}${renderAIAnalysis(c)}<p class="detail-text">${esc(c.description)}</p><p class="mono detail-meta">REPORTED BY ${esc(c.reporter?.name||'Citizen')} · ${esc(c.reporter?.email||'')}</p><form class="detail-form" id="status-form"><label>Complaint status<select id="detail-status">${['Submitted','Under review','Assigned','In progress','Resolved','Rejected'].map(s=>`<option ${c.status===s?'selected':''}>${s}</option>`).join('')}</select></label><label>Administrator note<textarea id="detail-note">${esc(c.adminNote||'')}</textarea></label><button class="btn btn-primary">Save update</button><button type="button" class="btn btn-danger" id="detail-delete">Delete this report</button></form>`;

  showModal('complaint-detail-modal');
  $('detail-delete').onclick=()=>deleteComplaint(id,true);
  $('status-form').onsubmit=async e=>{
    e.preventDefault();
    try{
      await api('/admin/complaints/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:$('detail-status').value,adminNote:$('detail-note').value})});
      hideModals();
      await loadAll();
      toast('Complaint record updated.');
    }catch(err){toast(err.message);}
  };
}

$('complaint-search').oninput=renderComplaints;
$('complaint-filter').onchange=renderComplaints;
$('refresh-complaints').onclick=()=>loadAll().catch(e=>toast(e.message));
$('refresh-duplicates').onclick=()=>loadDuplicates();
$('create-user-open').onclick=()=>showModal('create-user-modal');

$('generate-password').onclick=()=>{
  $('new-user-password').value=Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$'[b%62]).join('');
};

$('create-user-form').onsubmit=async e=>{
  e.preventDefault();
  $('create-user-error').textContent='';
  try{
    const d=await api('/users',{method:'POST',body:JSON.stringify({name:$('new-user-name').value,email:$('new-user-email').value,password:$('new-user-password').value,role:$('new-user-role').value})});
    hideModals();
    e.target.reset();
    await loadAll();
    toast(`Account created for ${d.user.email}. Share the temporary password securely.`);
  }catch(err){$('create-user-error').textContent=err.message;}
};

async function resetPassword(id){
  const pass=prompt('Enter a new temporary password (at least 10 characters):');
  if(pass===null)return;
  try{
    await api('/users/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({password:pass})});
    toast('Password reset. Share the temporary password privately.');
  }catch(err){toast(err.message);}
}

async function toggleUser(id,active){
  try{
    await api('/users/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({active:!active})});
    await loadAll();
    toast('Account access updated.');
  }catch(err){toast(err.message);}
}

// DELETE CITIZEN ACCOUNT
async function deleteUser(id,email){
  const confirmed=window.confirm(
    'Are you sure you want to permanently delete the citizen account for '+email+'?\n\nThis action cannot be undone.'
  );
  if(!confirmed)return;

  try{
    await api('/users/'+encodeURIComponent(id),{method:'DELETE'});
    await loadAll();
    toast('Citizen account deleted successfully.');
  }catch(err){
    toast(err.message);
  }
}

$('admin-logout').onclick=async()=>{
  await api('/auth/logout',{method:'POST'});
  location.reload();
};

async function boot(){
  try{
    const status=await api('/auth/status');
    const meData=await api('/auth/me');
    me=meData.user;

    if(!me){
      $('admin-content').classList.add('hidden');
      $('admin-login').classList.remove('hidden');
      $('admin-logout').classList.add('hidden');

      if(status.setupRequired){
        $('admin-auth-title').textContent='Create the first administrator';
        $('admin-auth-copy').textContent='This one-time setup creates the protected administrator account for this StreetSense installation.';
        $('setup-name-wrap').classList.remove('hidden');
        $('admin-auth-submit').textContent='Create administrator';
      }else{
        $('admin-auth-title').textContent='Administrator sign in';
        $('admin-auth-copy').textContent='Access complaint review and account controls.';
        $('setup-name-wrap').classList.add('hidden');
      }
      return;
    }

    if(me.role!=='admin')throw new Error('This account does not have administrator access.');

    $('admin-login').classList.add('hidden');
    $('admin-content').classList.remove('hidden');
    $('admin-email').textContent=me.email;
    await loadAll();
  }catch(err){
    $('admin-login').classList.remove('hidden');
    $('admin-content').classList.add('hidden');
    $('admin-auth-error').textContent=err.message;
  }
}

$('admin-auth-form').onsubmit=async e=>{
  e.preventDefault();
  $('admin-auth-error').textContent='';
  try{
    const status=await api('/auth/status');
    if(status.setupRequired){
      await api('/auth/setup',{method:'POST',body:JSON.stringify({name:$('setup-name').value,email:$('admin-auth-email').value,password:$('admin-auth-password').value})});
    }else{
      await api('/auth/login',{method:'POST',body:JSON.stringify({email:$('admin-auth-email').value,password:$('admin-auth-password').value})});
    }
    await boot();
  }catch(err){$('admin-auth-error').textContent=err.message;}
};

async function deleteComplaint(id,fromDetail){
  if(!window.confirm('Delete report '+id+' and its photo permanently? This cannot be undone.'))return;
  try{
    await api('/complaints/'+encodeURIComponent(id),{method:'DELETE'});
    if(fromDetail)hideModals();
    await loadAll();
    toast('Report '+id+' deleted.');
  }catch(e){toast(e.message);}
}

async function approveReport(id){
  try{
    const r=await api('/insights/complaints/'+encodeURIComponent(id)+'/approve',{method:'POST'});
    await loadAll();
    toast('Approved. Incident '+r.incident+' and work order '+r.workOrder+' created.');
  }catch(e){toast(e.message);}
}

async function rejectReport(id){
  if(!window.confirm('Reject report '+id+'? The reporter will see it as Rejected.'))return;
  try{
    await api('/admin/complaints/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status:'Rejected'})});
    await loadAll();
    toast('Report '+id+' rejected.');
  }catch(e){toast(e.message);}
}

async function loadSettings(){
  try{
    const s=await api('/insights/settings');
    const r=document.querySelector('input[name=approval][value='+s.mode+']');
    if(r)r.checked=true;
    $('auto-min').value=s.minConfidence;
    $('wait-info').innerHTML='<b>Waiting now:</b> '+s.waitingReports+' citizen report'+(s.waitingReports===1?'':'s')+(s.waitingWithoutLocation?' ('+s.waitingWithoutLocation+' with no map location, which cannot be approved)':'')+' · '+s.waitingDetections+' AI detection'+(s.waitingDetections===1?'':'s')+' in the <a href="/insights.html">review queue</a>.';
  }catch(e){$('wait-info').textContent=e.message;}
}

document.querySelector('[data-panel="settings"]').addEventListener('click',loadSettings);

$('save-approval').onclick=async()=>{
  try{
    const mode=document.querySelector('input[name=approval]:checked').value;
    const s=await api('/insights/settings',{method:'PUT',body:JSON.stringify({mode,minConfidence:Number($('auto-min').value)})});
    $('approval-msg').textContent='Saved: '+(s.mode==='auto'?'auto approval':'manual approval')+'.';
    toast('Approval mode saved.');
    loadSettings();
  }catch(e){$('approval-msg').textContent=e.message;}
};

$('approve-all').onclick=async()=>{
  if(!window.confirm('Approve every waiting report that has a map location? Each becomes an incident with a repair order.'))return;
  try{
    const r=await api('/insights/complaints/approve-all',{method:'POST'});
    await loadAll();
    loadSettings();
    toast(r.approved+' approved'+(r.skipped?', '+r.skipped+' skipped (no map location)':'')+'.');
  }catch(e){toast(e.message);}
};

$('clear-data').onclick=async()=>{
  const t=window.prompt('This permanently deletes ALL reports, incidents, work orders, photos and scans. Accounts are kept and a database backup is saved first.\n\nType DELETE ALL DATA to confirm:');
  if(t===null)return;
  if(t!=='DELETE ALL DATA'){toast('Nothing was cleared: the confirmation text did not match.');return;}
  try{
    const r=await api('/insights/clear-data',{method:'POST',body:JSON.stringify({confirm:t})});
    await loadAll();
    loadSettings();
    toast('All data cleared. Backup saved as '+r.backup+'.');
  }catch(e){toast(e.message);}
};

boot();
})();
