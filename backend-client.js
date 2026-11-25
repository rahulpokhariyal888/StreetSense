/* StreetSense backend bridge. The UI remains usable in read-only city operations fallback if API is unavailable. */
(() => {
  const API = '/api';
  async function request(path, options={}) {
    const response = await fetch(`${API}${path}`, { ...options, headers:{'Content-Type':'application/json',...(options.headers||{})} });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.error || `API request failed (${response.status})`);
    return data;
  }
  window.streetSenseBackend = {
    online:false,
    async connect() { try { await request('/health'); this.online=true; document.documentElement.dataset.backend='online'; const badge=document.querySelector('.system-status'); if(badge) badge.innerHTML='<span class="pulse-dot"></span> Server connected · SQLite'; const pill=document.querySelector('.local-save-pill'); if(pill){pill.textContent='Server sync enabled';pill.title='Incident and work-order data syncs to the local SQLite backend.';} return true; } catch (_) { this.online=false; document.documentElement.dataset.backend='offline'; const badge=document.querySelector('.system-status'); if(badge) badge.innerHTML='<span class="pulse-dot"></span> Offline · local city operations mode'; const pill=document.querySelector('.local-save-pill'); if(pill){pill.textContent='Saved on this device';pill.title='Backend unavailable; browser-local city operations storage is being used.';} return false; } },
    async loadSnapshot() { const data=await request('/snapshot'); return data; },
    async saveSnapshot(incidents, workOrders, baseVersion) { if (!this.online) return null; return request('/snapshot',{method:'PUT',body:JSON.stringify({incidents,workOrders,baseVersion})}); },
    async getAnalytics() { return request('/analytics'); },
    async getAudit() { return request('/audit'); }
  };
})();

// Evidence storage and optional browser GPS. Coordinates are only collected after an explicit user action.
(() => {
  const api = window.streetSenseBackend;
  api.uploadEvidence = async (file, coords = null) => {
    if (!api.online) throw new Error('Start the StreetSense server to store evidence.');
    if (!file.type.startsWith('image/')) throw new Error('Evidence storage currently supports JPG, PNG and WebP images.');
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Please use a JPG, PNG or WebP image.');
    if (file.size > 8 * 1024 * 1024) throw new Error('Image must be 8 MB or smaller for this city operations.');
    const base64 = await new Promise((resolve,reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read image.'));
      reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file);
    });
    const response = await fetch('/api/evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:file.name,mimeType:file.type,base64,lat:coords?.lat ?? null,lng:coords?.lng ?? null})});
    const result = await response.json().catch(()=>({})); if(!response.ok) throw new Error(result.error || 'Evidence upload failed.'); return result;
  };
  api.getEvidence = async () => { const response=await fetch('/api/evidence'); const data=await response.json(); if(!response.ok) throw new Error(data.error||'Could not load evidence.'); return data; };
})();
