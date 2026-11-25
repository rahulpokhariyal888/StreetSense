const FRIENDLY_CLASS={D00:'Longitudinal crack',D01:'Longitudinal crack (joint)',D10:'Lateral crack',D11:'Lateral crack (joint)',D20:'Alligator crack',D40:'Pothole',D43:'Faded crosswalk',D44:'Faded white line',D50:'Manhole / utility cover',D0w0:'Unrecognised class (D0w0)',waterlogging:'Waterlogging',road_edge_breakage:'Road edge breakage',failed_repair_patch:'Failed repair patch',asphalt_ravelling:'Asphalt ravelling',surface_bleeding:'Surface bleeding'};const friendlyClass=c=>FRIENDLY_CLASS[String(c)]||String(c||'Unknown');
(() => {
'use strict';
const $=id=>document.getElementById(id);
const api=async(path,options={})=>{const r=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d;};
let authMode='login',currentUser=null;
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3200);}
function modal(id,open=true){$(id).classList.toggle('hidden',!open);}
function setAuth(mode){authMode=mode;$('auth-name-wrap').classList.toggle('hidden',mode!=='register');$('auth-kicker').textContent=mode==='register'?'JOIN THE NETWORK':'WELCOME BACK';$('auth-title').textContent=mode==='register'?'Create your account.':'Good to see you.';$('auth-subtitle').textContent=mode==='register'?'Create an account to report issues and follow their progress.':'Sign in to follow your reports and share a new observation.';$('auth-submit').innerHTML=mode==='register'?'Create account <span>↗</span>':'Sign in <span>↗</span>';$('auth-switch').innerHTML=mode==='register'?'Already registered? <button id="switch-auth">Sign in</button>':'New to StreetSense? <button id="switch-auth">Create an account</button>'; $('switch-auth').onclick=()=>setAuth(mode==='register'?'login':'register');$('auth-error').textContent='';$('auth-password').value='';}
async function refreshUser() {
  const d = await api('/auth/me');
  currentUser = d.user;

  const notificationButton = $('notification-button');

  if (currentUser) {
    $('profile-chip').classList.remove('hidden');
    $('profile-chip').textContent =
      currentUser.displayName + ' · ' +
      (currentUser.role === 'admin' ? 'Admin' : 'My reports');

    $('profile-chip').onclick = () =>
      currentUser.role === 'admin'
        ? location.href = '/admin.html'
        : openMyReports();

    $('open-login').classList.add('hidden');
    $('open-register').textContent = 'Report an issue';
    $('open-register').onclick = () => openReport();

    if (notificationButton && currentUser.role !== 'admin') {
      notificationButton.classList.remove('hidden');
      if (window.loadStreetSenseNotifications) {
        window.loadStreetSenseNotifications();
      }
    }
  } else {
    $('profile-chip').classList.add('hidden');
    $('open-login').classList.remove('hidden');
    $('open-register').textContent = 'Create account ↗';
    $('open-register').onclick = () => {
      setAuth('register');
      modal('auth-modal');
    };

    if (notificationButton) {
      notificationButton.classList.add('hidden');
    }
  }
}
function openAuth(mode='login'){setAuth(mode);modal('auth-modal');}
function openReport(){if(!currentUser){openAuth('login');toast('Sign in to submit a street report.');return;}modal('report-modal');}
function closeAll(){document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden'));}
document.querySelectorAll('[data-close]').forEach(x=>x.addEventListener('click',closeAll));
$('open-login').onclick=()=>openAuth('login');$('open-register').onclick=()=>openAuth('register');$('hero-report').onclick=openReport;$('impact-report').onclick=openReport;
$('auth-form').addEventListener('submit',async e=>{e.preventDefault();$('auth-error').textContent='';const payload={email:$('auth-email').value,password:$('auth-password').value};if(authMode==='register'){payload.name=$('auth-name').value;}try{await api(authMode==='register'?'/auth/register':'/auth/login',{method:'POST',body:JSON.stringify(payload)});closeAll();await refreshUser();toast(authMode==='register'?'Your account is ready.':'Signed in successfully.');if(location.hash==='#report')openReport();}catch(err){$('auth-error').textContent=err.message;}});
$('profile-chip').addEventListener('contextmenu',async e=>{e.preventDefault();try{await api('/auth/logout',{method:'POST'});currentUser=null;await refreshUser();toast('You have signed out.');}catch(err){toast(err.message);}});
$('report-image').addEventListener('change',()=>{const f=$('report-image').files[0];$('image-preview').classList.toggle('hidden',!f);$('image-preview').textContent=f?`${f.name} · ${(f.size/1024/1024).toFixed(2)} MB`:'';});
$('use-location').onclick=()=>{if(!navigator.geolocation){toast('Location is not available in this browser.');return;}$('use-location').textContent='Requesting location…';navigator.geolocation.getCurrentPosition(pos=>{$('report-lat').value=pos.coords.latitude.toFixed(6);$('report-lng').value=pos.coords.longitude.toFixed(6);$('use-location').textContent='✓ Location added';},()=>{$('use-location').textContent='◎ Use my current location';toast('Location permission was not granted.');},{enableHighAccuracy:true,timeout:10000});};
$('ai-result-close').onclick=()=>{closeAll();$('ai-result').classList.add('hidden');$('report-form').classList.remove('hidden');};
$('report-form').addEventListener('submit',async e=>{e.preventDefault();$('report-error').textContent='';const button=$('report-submit');button.disabled=true;button.textContent='Submitting...';try{const f=$('report-image').files[0];let image=null;if(f){if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>8*1024*1024)throw new Error('Choose a JPG, PNG or WebP photo up to 8 MB.');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read the photo.'));reader.readAsDataURL(f);});image={mimeType:f.type,base64:data};}
const lat=$('report-lat').value,lng=$('report-lng').value;if(Boolean(lat)!==Boolean(lng))throw new Error('Enter both latitude and longitude, or use the location button.');
const payload={category:$('report-category').value.trim(),location:$('report-location').value.trim(),description:$('report-description').value.trim(),lat:lat?Number(lat):null,lng:lng?Number(lng):null,image};
const d=await api('/complaints',{method:'POST',body:JSON.stringify(payload)});const item=d.item||{};const ai=item.aiAnalysis||{};$('report-form').reset();$('image-preview').classList.add('hidden');$('report-form').classList.add('hidden');$('ai-result').classList.remove('hidden');$('ai-result').querySelector('h2').textContent='Report received.';$('ai-result-message').textContent='Report '+item.id+' was submitted successfully. '+(ai.status==='inference_complete'?'The AI analysis is complete.':ai.status==='not_run'?'No photo was provided for analysis.':'The report was saved, but AI analysis could not be completed.');const details=$('ai-result-details');details.replaceChildren();const addMetric=(label,value)=>{const card=document.createElement('div');card.className='ai-metric';const caption=document.createElement('span');caption.textContent=label;const strong=document.createElement('strong');strong.textContent=value;card.append(caption,strong);details.append(card);};addMetric('REPORT ID',item.id||'Submitted');addMetric('AI STATUS',ai.status||'Not available');if(ai.status==='inference_complete'){const detections=Array.isArray(ai.detections)?ai.detections:[];if(detections.length){(()=>{const g=new Map();detections.forEach(d=>{const k=friendlyClass(d.className),e=g.get(k)||{n:0,best:0};e.n++;e.best=Math.max(e.best,Number(d.confidence)||0);g.set(k,e);});[...g.entries()].slice(0,5).forEach(([k,e],i)=>addMetric('DETECTION '+(i+1),k+' · '+(e.best*100).toFixed(1)+'% confidence'+(e.n>1?' · '+e.n+' areas found':'')));if([...g.values()].every(e=>e.best<0.6))addMetric('MODEL NOTE','The model is unsure about this photo, so a reviewer will look at it closely.');})()}else if(ai.scene&&ai.scene.isRoad===false){addMetric('PHOTO CHECK',ai.scene.reason+' The AI result was ignored and a reviewer will check your report.');}else{addMetric('MODEL RESULT','No defects detected above the model confidence threshold.');}}else if(ai.message){addMetric('DETAIL',ai.message);}if(ai.prediction)addMetric('SUGGESTED CATEGORY',ai.prediction.type);modal('report-modal');}catch(err){$('report-error').textContent=err.message;}finally{button.disabled=false;button.innerHTML='Submit report <span>↗</span>';}});
async function openMyReports(){try{const d=await api('/complaints');const box=$('mine-list');box.replaceChildren();if(!d.items.length){const p=document.createElement('p');p.className='empty-mine';p.textContent='You have not submitted any reports yet.';box.append(p);}d.items.forEach(x=>{const row=document.createElement('article');row.className='mine-row';const top=document.createElement('div');top.className='mine-top';const id=document.createElement('span');id.className='plate';id.textContent=x.id;const st=document.createElement('span');st.className='st st-'+String(x.status).toLowerCase().replace(/\s+/g,'-');st.textContent=x.status;top.append(id,st);const h=document.createElement('strong');h.textContent=x.category;const l=document.createElement('small');l.textContent=x.location+' · '+new Date(x.createdAt).toLocaleDateString();row.append(top,h,l);if(x.adminNote){const n=document.createElement('p');n.className='mine-note';n.textContent='Reviewer note: '+x.adminNote;row.append(n);}box.append(row);});modal('mine-modal');}catch(err){toast(err.message);}}
$('mine-signout').onclick=async()=>{try{await api('/auth/logout',{method:'POST'});currentUser=null;closeAll();await refreshUser();toast('You have signed out.');}catch(err){toast(err.message);}};
(async()=>{try{await refreshUser();}catch(e){console.error(e);}})();
})();