// ═══════════════════════════════
// UTILS
// ═══════════════════════════════
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function hl(html,kws){
  kws.forEach((k,i)=>{
    const e=k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    html=html.replace(new RegExp(`(${e})`,'gi'),`<mark class="mk${i%5}">$1</mark>`);
  });
  return html;
}
function setLoad(id,on,msg){ const el=document.getElementById(id); on?el.classList.add('show'):el.classList.remove('show'); if(msg){ const p=el.querySelector('p'); if(p) p.textContent=msg; } }
function parseJSON(raw){
  const cleaned = String(raw || '').replace(/```json|```/gi, '').trim();
  if (!cleaned) throw new Error('AI returned empty response');

  // Attempt 1: parse as-is
  try { return JSON.parse(cleaned); } catch(_) {}

  // Attempt 2: slice between first { and last }
  const s = cleaned.indexOf('{');
  const e = cleaned.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try { return JSON.parse(cleaned.slice(s, e + 1)); } catch(_) {}
  }

  // Attempt 3: repair truncated JSON
  if (s >= 0) {
    let frag = cleaned.slice(s);

    // Close any unterminated string
    let inStr = false, escNext = false;
    for (const ch of frag) {
      if (escNext) { escNext = false; continue; }
      if (ch === '\\') { escNext = true; continue; }
      if (ch === '"') inStr = !inStr;
    }
    if (inStr) frag += '"';

    // Now try progressively shorter prefixes, dropping incomplete trailing tokens
    // until we find one that parses after auto-closing brackets.
    const tryClose = (str) => {
      const stack = [];
      let inS = false, esc = false;
      for (const ch of str) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inS = !inS; continue; }
        if (inS) continue;
        if (ch === '{' || ch === '[') stack.push(ch);
        else if (ch === '}' && stack[stack.length-1] === '{') stack.pop();
        else if (ch === ']' && stack[stack.length-1] === '[') stack.pop();
      }
      let out = str;
      while (stack.length) {
        const open = stack.pop();
        out += (open === '{') ? '}' : ']';
      }
      return out;
    };

    // Strategy: repeatedly trim back to the last "safe" position (after a complete value)
    // and try to parse. A complete value ends with }, ], ", digit, e, l (from true/false/null).
    let attempt = frag;
    for (let i = 0; i < 20; i++) {
      // remove any trailing whitespace and commas
      attempt = attempt.replace(/[\s,]+$/, '');
      // if ends with ":" or ":" + whitespace, drop the key too
      attempt = attempt.replace(/,?\s*"[^"]*"\s*:\s*$/, '');
      // try parsing with auto-closed brackets
      try {
        const closed = tryClose(attempt);
        const result = JSON.parse(closed);
        if (i > 0) console.warn('AI response was truncated; auto-repaired.');
        return result;
      } catch(_) {
        // trim the last token (value or key-value pair) and retry
        // find last safe boundary: a comma, {, or [ that's not inside a string
        let depth = 0, inS = false, esc = false, cut = -1;
        for (let j = 0; j < attempt.length; j++) {
          const ch = attempt[j];
          if (esc) { esc = false; continue; }
          if (ch === '\\') { esc = true; continue; }
          if (ch === '"') { inS = !inS; continue; }
          if (inS) continue;
          if (ch === '{' || ch === '[') depth++;
          else if (ch === '}' || ch === ']') depth--;
          else if (ch === ',' && depth >= 1) cut = j;
        }
        if (cut < 0) break;
        attempt = attempt.slice(0, cut);
      }
    }

    console.error('AI raw response:', raw);
    throw new Error('AI returned malformed JSON (likely truncated). First 200 chars: ' + cleaned.slice(0, 200));
  }

  console.error('AI raw response:', raw);
  throw new Error('AI returned non-JSON. First 200 chars: ' + cleaned.slice(0, 200));
}

// AI wrapper — the backend proxies to Anthropic using its own API key.
// Never put an API key in frontend code; anyone viewing the page can steal it.
async function aiGenerate(messages, system='', max=1000){
  const r = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({messages, system, max})
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || ('AI error ' + r.status));
  return d.text || '';
}

// ═══════════════════════════════
// PATENT COUNT
// ═══════════════════════════════
fetch('/api/patents/count').then(r=>r.json()).then(d=>{
  document.getElementById('dbCount').textContent=d.count.toLocaleString();
}).catch(()=>{ document.getElementById('dbCount').textContent='—'; });

// ═══════════════════════════════
// AI PANEL OPEN/CLOSE
// ═══════════════════════════════
const aiPanel=document.getElementById('aiPanel');
const overlay=document.getElementById('panelOverlay');
const aiBtn=document.getElementById('aiToolsBtn');

function openPanel(){ aiPanel.classList.add('open'); overlay.classList.add('open'); aiBtn.classList.add('open'); document.body.style.overflow='hidden'; }
function closePanel(){ aiPanel.classList.remove('open'); overlay.classList.remove('open'); aiBtn.classList.remove('open'); document.body.style.overflow=''; }

aiBtn.addEventListener('click',()=>{ aiPanel.classList.contains('open')?closePanel():openPanel(); });
document.getElementById('panelClose').addEventListener('click',closePanel);
document.getElementById('panelMiniBtn').addEventListener('click',()=>{ aiPanel.classList.toggle('narrow'); });
overlay.addEventListener('click',closePanel);
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ closeModal(); closePanel(); } });

// ═══════════════════════════════
// PANEL TABS
// ═══════════════════════════════
document.querySelectorAll('.panel-tab').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.panel-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.feature-panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('feat-'+btn.dataset.feat).classList.add('active');
  });
});

function switchFeat(name){
  openPanel();
  const btn=document.querySelector(`.panel-tab[data-feat="${name}"]`);
  if(btn) btn.click();
}



// ═══════════════════════════════
// SEMANTIC SEARCH MODE
// ═══════════════════════════════
let _searchMode = 'keyword'; // 'keyword' | 'semantic' | 'visual'
let _visualQueryImage = null;

const MODE_CONFIG = {
  keyword:  { label: '🔤 Keyword',  placeholder: 'e.g. gear motor, TechHK Ltd, Chan Tai Man …' },
  semantic: { label: '🧠 Semantic', placeholder: 'Describe what you\'re looking for… e.g. "device that helps people walk"' },
  visual:   { label: '🖼️ Visual',   placeholder: 'Describe a shape or drop an image… e.g. "gear mechanism"' },
};

function _applySearchMode(){
  const btn = document.getElementById('searchModeBtn');
  const inp = document.getElementById('searchInput');
  const cfg = MODE_CONFIG[_searchMode];
  if(btn) btn.textContent = cfg.label;
  if(inp) inp.placeholder = cfg.placeholder;

  // Highlight the active pill in the segmented mode bar
  document.querySelectorAll('#modeBar .mode-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.mode === _searchMode);
  });

  const upWrap = document.getElementById('visualUploadWrap');
  if(upWrap) upWrap.style.display = (_searchMode === 'visual') ? 'inline-flex' : 'none';
  if(_searchMode !== 'visual') _clearVisualImage();
}

function setSearchMode(m){
  if(!['keyword','semantic','visual'].includes(m)) return;
  _searchMode = m;
  _applySearchMode();
}

function toggleSearchMode(){
  _searchMode = (_searchMode === 'keyword')  ? 'semantic'
              : (_searchMode === 'semantic') ? 'visual'
                                             : 'keyword';
  _applySearchMode();
}

function _onVisualFilePicked(file){
  if(!file || !file.type.startsWith('image/')) return;
  _visualQueryImage = file;
  if(_searchMode !== 'visual'){ _searchMode = 'visual'; _applySearchMode(); }
  const prev = document.getElementById('visualPreview');
  if(prev){
    const url = URL.createObjectURL(file);
    prev.innerHTML = '<img src="'+url+'" alt="query" style="height:28px;width:28px;object-fit:cover;border-radius:6px;border:1px solid var(--border2)"> <span style="font-size:.7rem;color:var(--muted)">'+file.name+'</span> <button onclick="_clearVisualImage()" style="border:none;background:none;cursor:pointer;color:var(--muted);font-size:.9rem">✕</button>';
    prev.style.display = 'inline-flex';
  }
}

function _clearVisualImage(){
  _visualQueryImage = null;
  const prev = document.getElementById('visualPreview');
  if(prev){ prev.innerHTML=''; prev.style.display='none'; }
  const inp = document.getElementById('visualFileInput');
  if(inp) inp.value = '';
}

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('visualFileInput');
  if(fileInput){
    fileInput.addEventListener('change', e => _onVisualFilePicked(e.target.files[0]));
  }
  const searchBox = document.getElementById('searchInput');
  if(searchBox){
    ['dragenter','dragover'].forEach(ev =>
      searchBox.addEventListener(ev, e => { e.preventDefault(); searchBox.style.borderColor='var(--accent)'; }));
    ['dragleave','drop'].forEach(ev =>
      searchBox.addEventListener(ev, e => { e.preventDefault(); searchBox.style.borderColor=''; }));
    searchBox.addEventListener('drop', e => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if(f) _onVisualFilePicked(f);
    });
    searchBox.addEventListener('paste', e => {
      const items = e.clipboardData && e.clipboardData.items;
      if(!items) return;
      for(const it of items){
        if(it.type && it.type.startsWith('image/')){
          _onVisualFilePicked(it.getAsFile());
          e.preventDefault();
          break;
        }
      }
    });
  }
  _applySearchMode();
});


// ═══════════════════════════════
// TEXT SEARCH
// ═══════════════════════════════
document.getElementById('searchBtn').addEventListener('click',doSearch);
document.getElementById('searchInput').addEventListener('keydown',e=>{ if(e.key==='Enter') doSearch(); });
// Initial static chips
document.querySelectorAll('.try-chip').forEach(c=>{
  c.addEventListener('click',()=>{ document.getElementById('searchInput').value=c.dataset.q; doSearch(); });
});

// Recent searches history
const _recentKey = 'hkps_recent';
function _getRecent(){ try{ return JSON.parse(localStorage.getItem(_recentKey)||'[]'); }catch{ return []; } }
function _addRecent(q){
  let r = _getRecent().filter(x=>x!==q);
  r.unshift(q);
  r = r.slice(0,3);
  try{ localStorage.setItem(_recentKey, JSON.stringify(r)); }catch{}
  _renderRecent();
}
function _renderRecent(){
  const recent = _getRecent();
  const row = document.getElementById('tryRow');
  const label = document.getElementById('tryLabel');
  if(!recent.length) return;
  label.textContent = 'Recent:';
  // Remove old chips
  row.querySelectorAll('.try-chip').forEach(c=>c.remove());
  recent.forEach(q=>{
    const chip = document.createElement('span');
    chip.className = 'try-chip';
    chip.textContent = q;
    chip.dataset.q = q;
    chip.addEventListener('click',()=>{ document.getElementById('searchInput').value=q; doSearch(); });
    row.appendChild(chip);
  });
}
// Load recent on page start
_renderRecent();

// filter state
let _allRes=[], _status='all', _ass='', _yr=2000, _q='';
const _assMap = {};

function _normalizeAssignee(name){
  return String(name||'')
    .toLowerCase()
    .replace(/[\.,'"()&/\\\-]+/g,' ')
    .replace(/\b(limited|ltd|inc|co|company|corp|corporation|holdings|group)\b/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function _parseYear(raw){
  const s=String(raw||'');
  const m=s.match(/\b(20\d{2}|19\d{2})\b/);
  return m?parseInt(m[1],10):null;
}

function _statusOf(p){
  const explicit=String(p.status||'').toLowerCase();
  if(explicit==='granted'||explicit==='pending'||explicit==='expired') return explicit;
  const pn=String(p.patent_number||'').toUpperCase();
  if(/^HK3/.test(pn)) return 'granted';
  if(/^HK[14]/.test(pn)) return 'pending';
  const y=_parseYear(p.filing_date);
  if(y && y <= (new Date().getFullYear()-20)) return 'expired';
  return 'unknown';
}

function _syncYearRange(res){
  const years=res.map(p=>_parseYear(p.filing_date)).filter(Boolean);
  const nowY=new Date().getFullYear();
  const minY=years.length?Math.min(...years):2000;
  const maxY=years.length?Math.max(...years):nowY;
  const slider=document.getElementById('yrSlider');
  slider.min=String(minY);
  slider.max=String(Math.max(maxY, nowY));
  if(_yr<minY) _yr=minY;
  if(_yr>parseInt(slider.max,10)) _yr=parseInt(slider.max,10);
  slider.value=String(_yr||minY);
  document.getElementById('yrFromLbl').textContent=String(_yr||minY);
  const labels=document.querySelectorAll('.yr-labels span');
  if(labels[0]) labels[0].textContent=String(minY);
  if(labels[1]) labels[1].textContent=slider.max;
}

function _handleSearchResponse(d){
  (d.results||[]).forEach(r => { if(r.similarity!=null && r._similarity==null) r._similarity = r.similarity; });
  _allRes = d.results || [];
  _syncYearRange(_allRes);
  _buildAss(_allRes);
  document.getElementById('filterSidebar').classList.add('show');
  document.getElementById('resultsInner').classList.add('has-sidebar');
  _render();
}

function _handleSearchError(){
  document.getElementById('statusBar').textContent = '';
  document.getElementById('resultsArea').innerHTML = '<div class="state-msg"><div class="ico">⚠️</div><h3>Cannot connect</h3><p>Run <code>python app.py</code> first</p></div>';
}

function doSearch(){
  const q = document.getElementById('searchInput').value.trim();

  if(_searchMode === 'visual' && _visualQueryImage){
    _q = q || ('[image: '+_visualQueryImage.name+']');
    _addRecent(_q);
    document.getElementById('taBox').style.display='none';
    const sb=document.getElementById('statusBar'), ra=document.getElementById('resultsArea');
    sb.innerHTML='<div class="spinner"></div> Visual search…'; ra.innerHTML='';
    const fd = new FormData();
    fd.append('image', _visualQueryImage);
    fetch('/api/blueprint-search', { method:'POST', body: fd })
      .then(r=>r.json()).then(_handleSearchResponse).catch(_handleSearchError);
    return;
  }

  if(!q) return;
  _q = q; _addRecent(q);
  document.getElementById('taBox').style.display='none';
  const sb=document.getElementById('statusBar'), ra=document.getElementById('resultsArea');
  sb.innerHTML='<div class="spinner"></div> Searching…'; ra.innerHTML='';

  let url;
  if(_searchMode === 'visual')        url = '/api/blueprint-search?q=' + encodeURIComponent(q);
  else if(_searchMode === 'semantic') url = '/api/semantic-search?q='  + encodeURIComponent(q);
  else                                url = '/api/search?q='           + encodeURIComponent(q);

  fetch(url).then(r=>r.json()).then(_handleSearchResponse).catch(_handleSearchError);
}

function _buildAss(res){
  Object.keys(_assMap).forEach(k=>delete _assMap[k]);
  const grouped={};
  res.forEach(p=>{
    const label=String(p.assignee||'').trim();
    if(!label) return;
    const key=_normalizeAssignee(label);
    if(!key) return;
    if(!grouped[key]) grouped[key]={count:0,labels:{}};
    grouped[key].count += 1;
    grouped[key].labels[label]=(grouped[key].labels[label]||0)+1;
  });
  const top=Object.entries(grouped)
    .map(([key,v])=>{
      const bestLabel=Object.entries(v.labels).sort((a,b)=>b[1]-a[1])[0]?.[0]||key;
      _assMap[key]=bestLabel;
      return [key,bestLabel,v.count];
    })
    .sort((a,b)=>b[2]-a[2])
    .slice(0,6);
  const sec=document.getElementById('assSection'), list=document.getElementById('assList');
  if(!top.length){sec.style.display='none';return;}
  sec.style.display='';
  list.innerHTML=top.map(([key,label,count])=>`<div class="ass-item ${_ass===key?'on':''}" data-name="${esc(key)}"><span class="ass-name" title="${esc(label)}">${esc(label)}</span><span class="ass-n">${count}</span></div>`).join('');
  list.querySelectorAll('.ass-item').forEach(el=>el.addEventListener('click',()=>{
    _ass=_ass===el.dataset.name?'':el.dataset.name;
    _buildAss(_allRes); _render();
  }));
}

function _renderActiveFilters(){
  const box=document.getElementById('activeFilters');
  const chips=[];
  if(_status!=='all') chips.push(`<span class="fchip"><b>Status:</b> ${esc(_status)}</span>`);
  if(_yr>2000) chips.push(`<span class="fchip"><b>Year:</b> from ${_yr}</span>`);
  if(_ass) chips.push(`<span class="fchip"><b>Assignee:</b> ${esc(_assMap[_ass]||_ass)}</span>`);
  if(!chips.length){ box.style.display='none'; box.innerHTML=''; return; }
  box.style.display='flex';
  box.innerHTML=chips.join('')+`<button class="fclear" id="clearFiltersBtn">Clear filters</button>`;
  document.getElementById('clearFiltersBtn').addEventListener('click',()=>{
    _status='all'; _ass='';
    const slider=document.getElementById('yrSlider');
    _yr=parseInt(slider.min||'2000',10);
    document.querySelectorAll('.fs-btn[data-st]').forEach(b=>b.classList.remove('on'));
    const allBtn=document.querySelector('.fs-btn[data-st="all"]');
    if(allBtn) allBtn.classList.add('on');
    slider.value=String(_yr);
    document.getElementById('yrFromLbl').textContent=String(_yr);
    _buildAss(_allRes); _render();
  });
}

function _render(){
  let res=[..._allRes];
  if(_status==='granted') res=res.filter(p=>_statusOf(p)==='granted');
  else if(_status==='pending') res=res.filter(p=>_statusOf(p)==='pending');
  else if(_status==='expired') res=res.filter(p=>{
    const derived=_statusOf(p);
    if(derived==='expired') return true;
    const y=_parseYear(p.filing_date);
    return Boolean(y && y <= (new Date().getFullYear()-20));
  });
  if(_yr > 2000) {
    res=res.filter(p=>{
      const y=_parseYear(p.filing_date);
      return y ? y >= _yr : true;
    });
  }
  if(_ass) res=res.filter(p=>_normalizeAssignee(p.assignee)===_ass);
  const kws=_q.toLowerCase().split(/\s+/).filter(Boolean);
  const sb=document.getElementById('statusBar'), ra=document.getElementById('resultsArea');
  sb.innerHTML=res.length
    ?`<strong>${res.length}</strong> result${res.length!==1?'s':''} for <strong>\"${esc(_q)}\"</strong>`
    :'No patents match the current filters';
  _renderActiveFilters();
  if(!res.length){ra.innerHTML='<div class="state-msg"><div class="ico">🗂️</div><h3>No results</h3><p>Try adjusting the filters.</p></div>';return;}
  function _buildCard(p, i = 0){
    const div=document.createElement('div');
    div.className='patent-card anim-in'+(_cmpSet.has(p.patent_number)?' csel':'');
    // Stagger: each card starts .06s after the previous one, capped so a huge
    // result set doesn't produce a 5-second wait for the last card.
    const delay = Math.min(i * 0.06, 1.4);
    div.style.animationDelay = delay.toFixed(2) + 's';
    div.addEventListener('click',()=>openWorkspace(p));
    const img=p.image_path?`<img class="patent-img" src="/static/${esc(p.image_path)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="no-img" style="display:none">📄</div>`:'<div class="no-img">📄</div>';
    div.innerHTML=`<div class="cbox ${_cmpSet.has(p.patent_number)?'on':''}" data-pnum="${esc(p.patent_number)}">${_cmpSet.has(p.patent_number)?'✓':''}</div><div><div class="card-title">${hl(esc(p.title),kws)}</div><div class="card-meta"><span><span class="lbl">Inventor</span> ${hl(esc(p.inventor||'—'),kws)}</span><span><span class="lbl">Assignee</span> ${hl(esc(p.assignee||'—'),kws)}</span>${p.filing_date?`<span><span class="lbl">Filed</span> ${esc(p.filing_date)}</span>`:''}${p._similarity?`<span><span class="lbl">Match</span> <span style="color:var(--green);font-weight:600">${p._similarity}%</span></span>`:''}${p.litigation_flag?`<span class="lit-flag">⚖ ${p.litigation_count||1} case${(p.litigation_count||1)!==1?'s':''}</span>`:''}</div><div class="card-abstract">${hl(esc(p.abstract||''),kws)}</div></div><div class="card-aside"><div class="pnum">${esc(p.patent_number||'')}</div>${img}</div>`;
    div.querySelector('.cbox').addEventListener('click',e=>{
      e.stopPropagation();
      const pn=e.currentTarget.dataset.pnum;
      if(_cmpSet.has(pn)){_cmpSet.delete(pn);}
      else{if(_cmpSet.size>=4){alert('Max 4 patents for comparison');return;}_cmpSet.add(pn);}
      _updateCmpBar(); _render();
    });
    return div;
  }

  // Single scrollable container holding all results
  const scrollBox = document.createElement('div');
  scrollBox.className = 'results-list results-scroll';
  scrollBox.style.cssText = 'max-height:720px;overflow-y:auto;padding:4px;scroll-behavior:smooth';
  res.forEach((p, i) => scrollBox.appendChild(_buildCard(p, i)));

  ra.innerHTML = '';
  ra.appendChild(scrollBox);
}

// status filter buttons
document.querySelectorAll('.fs-btn[data-st]').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.fs-btn[data-st]').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on'); _status=btn.dataset.st;
  if(_allRes.length) _render();
}));

// year slider
document.getElementById('yrSlider').addEventListener('input',e=>{
  _yr=parseInt(e.target.value);
  document.getElementById('yrFromLbl').textContent=_yr;
  if(_allRes.length) _render();
});
document.querySelectorAll('.preset-btn').forEach(btn=>btn.addEventListener('click',()=>{
  const slider=document.getElementById('yrSlider');
  const maxY=parseInt(slider.max,10);
  const minY=parseInt(slider.min,10);
  const yrs=btn.dataset.yrs;
  _yr = yrs==='all' ? minY : Math.max(minY, maxY-parseInt(yrs,10)+1);
  slider.value=String(_yr);
  document.getElementById('yrFromLbl').textContent=String(_yr);
  if(_allRes.length) _render();
}));

function searchFor(q){ document.getElementById('searchInput').value=q; doSearch(); closePanel(); }

// ═══════════════════════════════
// TYPEAHEAD
// ═══════════════════════════════
let _taTO;
document.getElementById('searchInput').addEventListener('input', e => {
  clearTimeout(_taTO);
  const q = e.target.value.trim();
  if (q.length < 2) { document.getElementById('taBox').style.display = 'none'; return; }
  _taTO = setTimeout(() => _showTA(q), 320);
});
document.getElementById('searchInput').addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('taBox').style.display = 'none';
});
document.addEventListener('click', e => {
  if (!e.target.closest('.ta-wrap')) document.getElementById('taBox').style.display = 'none';
});

async function _showTA(q) {
  try {
    const r = await fetch('/api/search?q=' + encodeURIComponent(q));
    const d = await r.json();
    const res = d.results || [];
    if (!res.length) { document.getElementById('taBox').style.display = 'none'; return; }
    const inv = {}, ass = {};
    const ql = q.toLowerCase();
    res.forEach(p => {
      if (p.inventor && p.inventor.toLowerCase().includes(ql)) inv[p.inventor] = (inv[p.inventor]||0)+1;
      if (p.assignee && p.assignee.toLowerCase().includes(ql)) ass[p.assignee] = (ass[p.assignee]||0)+1;
    });
    const ti = Object.entries(inv).sort((a,b)=>b[1]-a[1]).slice(0,3);
    const ta = Object.entries(ass).sort((a,b)=>b[1]-a[1]).slice(0,3);
    let html = '';
    if (ti.length) html += '<div class="ta-group-lbl">👤 Inventors</div>' + ti.map(([n,c]) => `<div class="ta-row" data-q="${esc(n)}"><span class="ta-name">${esc(n)}</span><span class="ta-badge">${c} patent${c!==1?'s':''}</span></div>`).join('');
    if (ta.length) html += '<div class="ta-group-lbl">🏢 Companies</div>' + ta.map(([n,c]) => `<div class="ta-row" data-q="${esc(n)}"><span class="ta-name">${esc(n)}</span><span class="ta-badge">${c} patent${c!==1?'s':''}</span></div>`).join('');
    const box = document.getElementById('taBox');
    box.innerHTML = html;
    box.style.display = html ? 'block' : 'none';
    box.querySelectorAll('.ta-row').forEach(el => el.addEventListener('click', () => {
      document.getElementById('searchInput').value = el.dataset.q;
      box.style.display = 'none';
      doSearch();
    }));
  } catch(e) { /* silent */ }
}

// ═══════════════════════════════
// BLUEPRINT
// ═══════════════════════════════
let bpB64=null,bpMime=null;
document.getElementById('uploadZone').addEventListener('click',()=>document.getElementById('blueprintFile').click());
document.getElementById('uploadZone').addEventListener('dragover',e=>{e.preventDefault();e.currentTarget.classList.add('drag')});
document.getElementById('uploadZone').addEventListener('dragleave',e=>e.currentTarget.classList.remove('drag'));
document.getElementById('uploadZone').addEventListener('drop',e=>{e.preventDefault();e.currentTarget.classList.remove('drag');const f=e.dataTransfer.files[0];if(f)loadBp(f);});
document.getElementById('blueprintFile').addEventListener('change',e=>{if(e.target.files[0])loadBp(e.target.files[0]);});

function loadBp(file){
  if(!file.type.startsWith('image/')) return;
  bpMime=file.type;
  const r=new FileReader();
  r.onload=ev=>{ bpB64=ev.target.result.split(',')[1]; const p=document.getElementById('blueprintPreview'); p.src=ev.target.result; p.style.display='block'; document.getElementById('blueprintBtn').disabled=false; document.getElementById('uploadZone').querySelector('p').innerHTML=`<strong>${esc(file.name)}</strong> loaded`; };
  r.readAsDataURL(file);
}

document.getElementById('blueprintBtn').addEventListener('click',async()=>{
  if(!bpB64) return;
  const desc=document.getElementById('blueprintDesc').value.trim();
  setLoad('blueprintLoading',true); document.getElementById('blueprintResult').innerHTML='';
  try{
    const content=[{type:'image',source:{type:'base64',media_type:bpMime,data:bpB64}},{type:'text',text:`Analyse this patent drawing.${desc?' Context: '+desc+'.':''}\n\n1. Description: What is this?\n2. Key Technical Features: 3-5 elements\n3. Search Keywords: 3-5 comma-separated keywords\n4. Suggested IPC codes`}];
    const res=await aiGenerate([{role:'user',content}],'You are a patent analyst. Be concise and precise.',700);
    setLoad('blueprintLoading',false);
    const kwM=res.match(/(?:search keywords?|keywords?)[:\s]+([^\n]+)/i);
    const chips=kwM?kwM[1].split(/[,;]+/).map(k=>k.replace(/^\d+\.\s*/,'').replace(/[*_"""]/g,'').trim()).filter(k=>k&&k.length<40).slice(0,5):[];
    document.getElementById('blueprintResult').innerHTML=`<div class="ai-box"><h4>AI Analysis</h4><pre>${esc(res)}</pre>${chips.length?`<hr style="border:none;border-top:1px solid var(--border);margin:12px 0"><div style="font-size:.72rem;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px;font-family:'IBM Plex Mono',monospace">Search database →</div><div class="chip-row">${chips.map(k=>`<span class="chip" data-s="${esc(k)}">${esc(k)}</span>`).join('')}</div>`:''}</div>`;
    document.querySelectorAll('#blueprintResult [data-s]').forEach(c=>c.addEventListener('click',()=>searchFor(c.dataset.s)));
  }catch(e){ setLoad('blueprintLoading',false); document.getElementById('blueprintResult').innerHTML=`<div class="ai-box"><p style="color:var(--red2)">⚠️ ${esc(e.message)}</p></div>`; }
});

// ═══════════════════════════════
// CLASSIFY
// ═══════════════════════════════
document.getElementById('classifyExBtn').addEventListener('click',()=>{
  document.getElementById('classifyInput').value='An integrated gear motor assembly combining a planetary gearbox and brushless motor for electric vehicle drivetrains, offering improved torque density and thermal management through novel cooling channels.';
});

document.getElementById('classifyBtn').addEventListener('click',async()=>{
  const txt=document.getElementById('classifyInput').value.trim(); if(!txt) return;
  setLoad('classifyLoading',true); document.getElementById('classifyResult').innerHTML='';
  try{
    const raw=await aiGenerate([{role:'user',content:`Classify this patent:\n\n"${txt}"\n\nRespond ONLY with valid JSON (no markdown):\n{"primary":{"code":"H02K 7/116","description":"Motors with gear reduction","confidence":95},"secondary":[{"code":"B60K 1/00","description":"Electric propulsion","confidence":85}],"technology_area":"Electric Mobility","summary":"One sentence summary","keywords":["motor","gearbox","EV"]}`}],'You are a patent classifier. Respond ONLY with valid JSON.',1200);
    const d=parseJSON(raw); setLoad('classifyLoading',false);
    const tc=['tag-g','tag-b','tag-p','tag-o'];
    document.getElementById('classifyResult').innerHTML=`<div class="ai-box"><h4>Classification</h4><div style="margin-bottom:12px"><div style="font-size:.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-family:'IBM Plex Mono',monospace;margin-bottom:3px">Technology Area</div><div style="font-size:.92rem;font-weight:600;color:var(--text)">${esc(d.technology_area||'')}</div></div><div style="margin-bottom:12px"><div style="font-size:.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-family:'IBM Plex Mono',monospace;margin-bottom:3px">Summary</div><div style="font-size:.82rem;color:#555">${esc(d.summary||'')}</div></div><div style="font-size:.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-family:'IBM Plex Mono',monospace;margin-bottom:6px">IPC Codes</div><div class="tag-row"><span class="tag tag-g">⭐ ${esc(d.primary?.code||'')} ${esc(d.primary?.description||'')} ${d.primary?.confidence||0}%</span>${(d.secondary||[]).map((s,i)=>`<span class="tag ${tc[(i+1)%4]}">${esc(s.code)} ${esc(s.description)} ${s.confidence}%</span>`).join('')}</div>${(d.keywords||[]).length?`<hr style="border:none;border-top:1px solid var(--border);margin:12px 0"><div class="chip-row">${d.keywords.map(k=>`<span class="chip" data-s="${esc(k)}">${esc(k)}</span>`).join('')}</div>`:''}</div>`;
    document.querySelectorAll('#classifyResult [data-s]').forEach(c=>c.addEventListener('click',()=>searchFor(c.dataset.s)));
  }catch(e){ setLoad('classifyLoading',false); document.getElementById('classifyResult').innerHTML=`<div class="ai-box"><p style="color:var(--red2)">⚠️ ${esc(e.message)}</p></div>`; }
});

// ═══════════════════════════════
// TRENDS
// ═══════════════════════════════
document.getElementById('trendsBtn').addEventListener('click',async()=>{
  setLoad('trendsLoading',true); document.getElementById('trendsResult').innerHTML='';
  let pts=[];
  try{ const r=await fetch('/api/search?q=the'); const d=await r.json(); pts=d.results||[]; }catch{}
  try{
    const sum=pts.slice(0,20).map(p=>`- "${p.title}" (${p.assignee||'?'}, ${p.filing_date||'?'}): ${(p.abstract||'').slice(0,80)}`).join('\n')||'Sample: batteries, motors, AI, medical devices, displays';
    const raw=await aiGenerate([{role:'user',content:`Analyse HK patents for trends:\n\n${sum}\n\nSTRICT LIMITS: max 5 sectors, max 5 assignees, max 4 insights (each under 12 words), max 6 keywords (single words only).\n\nRespond ONLY valid JSON, no markdown, no commentary:\n{"top_sectors":[{"name":"Electric Vehicles","count":4,"trend":"up","pct":80}],"top_assignees":[{"name":"TechHK Ltd","count":3,"focus":"Electronics"}],"insights":["Battery patents rising"],"hot_keywords":["motor","battery"]}`}],'Patent analytics expert. Respond ONLY with valid JSON. Keep all text fields short.',4096);
    const d=parseJSON(raw); setLoad('trendsLoading',false);
    document.getElementById('trendsResult').innerHTML=`<div class="ai-box"><h4>Top Sectors</h4>${(d.top_sectors||[]).map(s=>`<div class="trend-row"><span class="trend-lbl" title="${esc(s.name)}">${esc(s.name)}</span><div class="trend-track"><div class="trend-fill" style="width:0%" data-w="${s.pct||0}%"></div></div><span class="trend-n">${s.count}</span><span class="trend-arrow ${s.trend==='up'?'up':s.trend==='down'?'dn':''}">${s.trend==='up'?'↑':s.trend==='down'?'↓':'→'}</span></div>`).join('')}</div><div class="ai-box" style="margin-top:8px"><h4>AI Insights</h4><ul>${(d.insights||[]).map(i=>`<li>${esc(i)}</li>`).join('')}</ul></div><div class="ai-box" style="margin-top:8px"><h4>Hot Keywords</h4><div class="chip-row">${(d.hot_keywords||[]).map(k=>`<span class="chip" data-s="${esc(k)}">${esc(k)}</span>`).join('')}</div></div>`;
    setTimeout(()=>document.querySelectorAll('.trend-fill').forEach(b=>{b.style.width=b.dataset.w;}),100);
    document.querySelectorAll('#trendsResult [data-s]').forEach(c=>c.addEventListener('click',()=>searchFor(c.dataset.s)));
  }catch(e){ setLoad('trendsLoading',false); document.getElementById('trendsResult').innerHTML=`<div class="ai-box"><p style="color:var(--red2)">⚠️ ${esc(e.message)}</p></div>`; }
});

// ═══════════════════════════════
// RISK
// ═══════════════════════════════
document.getElementById('riskExBtn').addEventListener('click',()=>{
  document.getElementById('riskInput').value='A foldable smartphone with a flexible OLED display that bends 180 degrees using a magnetic hinge mechanism. Screen does not crease when folded.';
});

document.getElementById('riskBtn').addEventListener('click',async()=>{
  const desc=document.getElementById('riskInput').value.trim(); if(!desc) return;
  setLoad('riskLoading',true); document.getElementById('riskResult').innerHTML='';
  let rel=[];
  try{ const r=await fetch(`/api/search?q=${encodeURIComponent(desc.split(/\s+/).slice(0,4).join(' '))}`); const d=await r.json(); rel=(d.results||[]).slice(0,5); }catch{}
  const relStr=rel.length?rel.map(p=>`${p.patent_number}: "${p.title}" — ${(p.abstract||'').slice(0,100)}`).join('\n'):'No local patents found; general assessment only.';
  try{
    const raw=await aiGenerate([{role:'user',content:`Infringement risk for:\n\nPRODUCT: "${desc}"\n\nRELATED PATENTS:\n${relStr}\n\nRespond ONLY valid JSON:\n{"overall_risk":"medium","risks":[{"patent_number":"HK123456","title":"Foldable display","risk_level":"high","reason":"Hinge mechanism overlaps","overlap_score":85}],"recommendations":["License HK123456","Modify hinge design"],"disclaimer":"AI only. Consult a patent attorney."}`}],'Patent risk analyst. Respond ONLY valid JSON.',2048);
    const d=parseJSON(raw); setLoad('riskLoading',false);
    document.getElementById('riskResult').innerHTML=`<div class="ai-box"><h4 style="display:flex;align-items:center;gap:8px">Risk Assessment <span class="risk-badge ${d.overall_risk||'medium'}">${(d.overall_risk||'?').toUpperCase()}</span></h4>${(d.risks||[]).map(r=>`<div class="risk-row"><div class="risk-dot ${r.risk_level||'medium'}"></div><div class="risk-info"><div class="risk-title">${esc(r.title||'')} <span style="font-family:'IBM Plex Mono',monospace;font-size:.68rem;color:var(--muted)">${esc(r.patent_number||'')}</span></div><div class="risk-desc">${esc(r.reason||'')} · ${r.overlap_score||0}% overlap</div></div><span class="risk-badge ${r.risk_level||'medium'}">${(r.risk_level||'?').toUpperCase()}</span></div>`).join('')}${(d.recommendations||[]).length?`<hr style="border:none;border-top:1px solid var(--border);margin:10px 0"><div style="font-size:.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-family:'IBM Plex Mono',monospace;margin-bottom:6px">Recommendations</div><ul>${(d.recommendations||[]).map(r=>`<li>${esc(r)}</li>`).join('')}</ul>`:''}<div style="margin-top:10px;padding:8px 10px;background:var(--bg2);border-radius:var(--r);font-size:.72rem;color:var(--muted)">⚡ ${esc(d.disclaimer||'Not legal advice.')}</div></div>`;
  }catch(e){ setLoad('riskLoading',false); document.getElementById('riskResult').innerHTML=`<div class="ai-box"><p style="color:var(--red2)">⚠️ ${esc(e.message)}</p></div>`; }
});

// ═══════════════════════════════
// COMPETITOR
// ═══════════════════════════════
document.getElementById('companyInput').addEventListener('keydown',e=>{ if(e.key==='Enter') document.getElementById('competitorBtn').click(); });
document.getElementById('competitorBtn').addEventListener('click',runCompetitor);
document.querySelectorAll('.chip[data-company]').forEach(c=>c.addEventListener('click',()=>{ document.getElementById('companyInput').value=c.dataset.company; runCompetitor(); }));

async function runCompetitor(){
  const co=document.getElementById('companyInput').value.trim(); if(!co) return;
  setLoad('competitorLoading',true,`Searching for ${co}…`); document.getElementById('competitorResult').innerHTML='';
  let pts=[];
  try{ const r=await fetch(`/api/search?q=${encodeURIComponent(co)}`); const d=await r.json(); pts=d.results||[]; }catch{}
  const patStr=pts.length?pts.map(p=>`${p.patent_number}: "${p.title}" (${p.filing_date||'?'}) — ${(p.abstract||'').slice(0,80)}`).join('\n'):`No patents for "${co}" in database.`;
  try{
    const raw=await aiGenerate([{role:'user',content:`Patent intelligence for "${co}":\n\n${patStr}\n\nRespond ONLY valid JSON:\n{"company":"${co}","total_patents":${pts.length},"activity_level":"medium","technology_focus":["AI","Electronics"],"filing_frequency":"~2/month","threat_level":"medium","summary":"2-sentence strategic summary"}`}],'Competitive patent intelligence analyst. Respond ONLY valid JSON.',1500);
    const d=parseJSON(raw); setLoad('competitorLoading',false);
    document.getElementById('competitorResult').innerHTML=`<div class="ai-box"><h4>${esc(d.company||co)} — Patent Profile</h4><div class="stat-grid"><div class="stat-box"><div class="stat-box-lbl">Total Patents</div><div class="stat-box-val">${d.total_patents}</div></div><div class="stat-box"><div class="stat-box-lbl">Activity</div><div class="stat-box-val">${esc(d.activity_level||'—')}</div></div><div class="stat-box"><div class="stat-box-lbl">Frequency</div><div class="stat-box-val">${esc(d.filing_frequency||'—')}</div></div><div class="stat-box"><div class="stat-box-lbl">Threat Level</div><div class="stat-box-val">${esc(d.threat_level||'—')}</div></div></div><div style="font-size:.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-family:'IBM Plex Mono',monospace;margin-bottom:6px">Technology Focus</div><div class="tag-row">${(d.technology_focus||[]).map((t,i)=>`<span class="tag ${['tag-g','tag-b','tag-p','tag-o'][i%4]}">${esc(t)}</span>`).join('')}</div><hr style="border:none;border-top:1px solid var(--border);margin:12px 0"><p>${esc(d.summary||'')}</p></div>${pts.length?`<div style="margin-top:12px"><div style="font-size:.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-family:'IBM Plex Mono',monospace;margin-bottom:8px">${pts.length} patents in database</div><div id="compList"></div></div>`:''}`; 
    if(pts.length){ const list=document.getElementById('compList'); pts.slice(0,4).forEach(p=>{ const div=document.createElement('div'); div.className='patent-card'; div.style.marginBottom='6px'; div.addEventListener('click',()=>openModal(p)); div.innerHTML=`<div><div class="card-title" style="font-size:.9rem">${esc(p.title)}</div><div class="card-meta"><span><span class="lbl">Filed</span> ${esc(p.filing_date||'—')}</span></div></div><div class="card-aside"><div class="pnum">${esc(p.patent_number||'')}</div></div>`; list.appendChild(div); }); }
  }catch(e){ setLoad('competitorLoading',false); document.getElementById('competitorResult').innerHTML=`<div class="ai-box"><p style="color:var(--red2)">⚠️ ${esc(e.message)}</p></div>`; }
}

// ═══════════════════════════════
// DESIGN ANALYSER
// ═══════════════════════════════
document.getElementById('designExBtn').addEventListener('click',()=>{
  document.getElementById('designInput').value='An electric motor with a permanent magnet rotor using radial flux configuration, copper wound stator coils with double-layer winding, a PWM motor control circuit with variable frequency drive, sealed deep groove ball bearings, and an aluminium die-cast housing with integrated cooling fins.';
});

document.getElementById('designBtn').addEventListener('click', runDesignAnalyser);

async function runDesignAnalyser(){
  const desc = document.getElementById('designInput').value.trim();
  if(!desc){ alert('Please describe your design first'); return; }

  const res = document.getElementById('designResult');
  res.innerHTML = '';
  setLoad('designLoading', true, 'Breaking design into components…');

  // Step 1: Ask AI to decompose design into components
  let components = [];
  try{
    const raw = await aiGenerate([{role:'user', content:
      `Decompose this design into 4-7 distinct technical components for patent analysis:\n\n"${desc}"\n\n` +
      `Respond ONLY with valid JSON:\n` +
      `{"components":[{"id":"rotor","name":"Rotor Assembly","description":"What this part does in 1 sentence","keywords":["magnet","rotor","flux"]}]}`
    }], 'Patent component analyst. Respond ONLY with valid JSON.', 1500);
    const d = parseJSON(raw);
    components = d.components || [];
  }catch(e){
    setLoad('designLoading', false);
    res.innerHTML = `<div class="ai-box"><p style="color:var(--red2)">⚠️ ${esc(e.message)}</p></div>`;
    return;
  }

  if(!components.length){
    setLoad('designLoading', false);
    res.innerHTML = `<div class="ai-box"><p>Could not decompose design. Try being more specific.</p></div>`;
    return;
  }

  // Step 2: For each component, search DB and get risk
  setLoad('designLoading', true, `Checking ${components.length} components against patents…`);

  const results = [];
  for(const comp of components){
    const kw = (comp.keywords||[comp.name]).slice(0,3).join(' ');
    let related = [];
    try{
      const r = await fetch(`/api/search?q=${encodeURIComponent(kw)}`);
      const d = await r.json();
      related = (d.results||[]).slice(0,4);
    }catch{}

    const relStr = related.length
      ? related.map(p=>`${p.patent_number}: "${p.title}" — ${(p.abstract||'').slice(0,80)}`).join('\n')
      : 'No matching patents found.';

    let risk = {risk_level:'unknown', reason:'No patents found to compare.', overlap_score:0, conflicting_patents:[], redesign_tip:'—'};
    try{
      const raw2 = await aiGenerate([{role:'user', content:
        `Assess patent conflict risk for this component:\n\nCOMPONENT: "${comp.name}" — ${comp.description}\n\nRELATED PATENTS:\n${relStr}\n\n` +
        `Respond ONLY with valid JSON:\n{"risk_level":"high","reason":"1 sentence why","overlap_score":75,"conflicting_patents":["HK30089123"],"redesign_tip":"1 sentence suggestion"}`
      }], 'Patent risk analyst. Respond ONLY valid JSON. risk_level must be high/medium/low/unknown.', 800);
      risk = parseJSON(raw2);
    }catch{}

    results.push({ ...comp, ...risk, related });
  }

  setLoad('designLoading', false);

  // Step 3: Render the analyser UI
  const high   = results.filter(r=>r.risk_level==='high').length;
  const medium = results.filter(r=>r.risk_level==='medium').length;
  const low    = results.filter(r=>['low','unknown'].includes(r.risk_level)).length;

  // Layout components in a schematic grid
  const positions = _daLayout(results.length);
  let activeIdx = 0;

  function riskClass(lvl){ return lvl==='high'?'da-danger':lvl==='medium'?'da-warn':lvl==='low'?'da-safe':'da-unknown'; }
  function riskMeter(lvl){ return lvl==='high'?'da-meter-high':lvl==='medium'?'da-meter-mid':'da-meter-low'; }
  function riskBadge(lvl){
    const map={high:'var(--red2)',medium:'var(--orange)',low:'var(--green)',unknown:'var(--muted)'};
    return `<span style="font-family:'IBM Plex Mono',monospace;font-size:.6rem;font-weight:700;padding:2px 7px;border-radius:3px;background:${map[lvl]||map.unknown};color:#fff">${(lvl||'?').toUpperCase()}</span>`;
  }

  const schematicHtml = results.map((r,i)=>{
    const p = positions[i];
    return `<div class="da-component ${riskClass(r.risk_level)} ${i===0?'da-active':''}" 
      id="dacomp-${i}" 
      style="left:${p.x}%;top:${p.y}%;width:${p.w}%;height:${p.h}px;transform:translate(-50%,-50%)"
      onclick="_daSelect(${i})">${esc(r.name)}</div>`;
  }).join('');

  const cardListHtml = results.map((r,i)=>
    `<div class="da-card ${i===0?'da-active':''}" id="dacard-${i}" onclick="_daSelect(${i})">
      <div style="width:8px;height:8px;border-radius:2px;flex-shrink:0;background:${
        r.risk_level==='high'?'#c0392b':r.risk_level==='medium'?'#e67e22':r.risk_level==='low'?'#27ae60':'#bbb'
      }"></div>
      <div class="da-card-info">
        <div class="da-card-name">${esc(r.name)}</div>
        <div class="da-card-sub">${esc(r.reason||'')}</div>
      </div>
      ${riskBadge(r.risk_level)}
    </div>`
  ).join('');

  const first = results[0];
  res.innerHTML = `
    <div class="da-grid">
      <div class="da-stat"><div class="da-stat-n" style="color:var(--red2)">${high}</div><div class="da-stat-l">High risk</div></div>
      <div class="da-stat"><div class="da-stat-n" style="color:var(--orange)">${medium}</div><div class="da-stat-l">Medium</div></div>
      <div class="da-stat"><div class="da-stat-n" style="color:var(--green)">${low}</div><div class="da-stat-l">Clear</div></div>
    </div>

    <div class="da-legend">
      <div class="da-leg"><div class="da-leg-dot" style="background:#c0392b"></div>High risk</div>
      <div class="da-leg"><div class="da-leg-dot" style="background:#e67e22"></div>Medium</div>
      <div class="da-leg"><div class="da-leg-dot" style="background:#27ae60"></div>Clear</div>
      <div class="da-leg"><div class="da-leg-dot" style="background:var(--border2)"></div>Unknown</div>
    </div>

    <div class="da-schematic" id="daSchematic" style="min-height:${Math.max(220, results.length*40+60)}px">
      ${schematicHtml}
    </div>

    <div class="da-detail" id="daDetail">
      <div class="da-detail-title">${esc(first.name)} ${riskBadge(first.risk_level)}</div>
      <div class="da-detail-body" id="daDetailBody">${esc(first.reason||'')}</div>
      ${(first.conflicting_patents||[]).length?`<div class="da-detail-patent" id="daDetailPatent" onclick="searchFor('${esc((first.conflicting_patents||[])[0]||'')}')">${(first.conflicting_patents||[]).map(p=>`↗ ${esc(p)}`).join(' · ')}</div>`:'<div id="daDetailPatent"></div>'}
      <div class="da-meter"><div class="da-meter-fill ${riskMeter(first.risk_level)}" id="daDetailMeter" style="width:${first.overlap_score||0}%"></div></div>
      <div style="font-size:.68rem;color:var(--muted);margin-top:4px" id="daDetailScore">${first.overlap_score||0}% overlap score</div>
      <div style="font-size:.72rem;color:#666;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)" id="daDetailTip">💡 ${esc(first.redesign_tip||'—')}</div>
    </div>

    <div style="font-size:.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-family:'IBM Plex Mono',monospace;margin-bottom:8px">All components</div>
    ${cardListHtml}

    <div class="btn-row" style="margin-top:12px">
      <button class="btn btn-dark btn-sm" onclick="_daFullReport()">📋 Full Report</button>
      <button class="btn btn-outline btn-sm" onclick="_daRedesign()">💡 Redesign Suggestions</button>
    </div>
    <div id="daExtraResult"></div>
  `;

  // Store results for interactions
  window._daResults = results;

  window._daSelect = function(idx){
    const r = window._daResults[idx];
    if(!r) return;
    document.querySelectorAll('.da-component').forEach(el=>el.classList.remove('da-active'));
    document.querySelectorAll('.da-card').forEach(el=>el.classList.remove('da-active'));
    const comp = document.getElementById('dacomp-'+idx);
    const card = document.getElementById('dacard-'+idx);
    if(comp) comp.classList.add('da-active');
    if(card) card.classList.add('da-active');
    document.querySelector('.da-detail-title').innerHTML = `${esc(r.name)} ${riskBadge(r.risk_level)}`;
    document.getElementById('daDetailBody').textContent = r.reason||'';
    const patEl = document.getElementById('daDetailPatent');
    if((r.conflicting_patents||[]).length){
      patEl.textContent = (r.conflicting_patents||[]).map(p=>`↗ ${p}`).join(' · ');
      patEl.onclick = ()=>searchFor(r.conflicting_patents[0]);
      patEl.style.display = '';
    } else {
      patEl.textContent = ''; patEl.style.display = 'none';
    }
    const mf = document.getElementById('daDetailMeter');
    mf.style.width = (r.overlap_score||0)+'%';
    mf.className = 'da-meter-fill '+riskMeter(r.risk_level);
    document.getElementById('daDetailScore').textContent = (r.overlap_score||0)+'% overlap score';
    document.getElementById('daDetailTip').innerHTML = '💡 '+esc(r.redesign_tip||'—');
    if(card) card.scrollIntoView({behavior:'smooth',block:'nearest'});
  };

  window._daFullReport = async function(){
    const box = document.getElementById('daExtraResult');
    box.innerHTML = '<div class="ai-loading show"><div class="spinner"></div><p>Generating report…</p></div>';
    try{
      const summary = (window._daResults||[]).map(r=>`${r.name}: ${r.risk_level} risk (${r.overlap_score}%) — ${r.reason}`).join('\n');
      const raw = await aiGenerate([{role:'user',content:`Generate a patent conflict report for this design:\n\n${summary}\n\nWrite a clear structured summary with: 1) Overall Risk Assessment, 2) Critical Issues, 3) Safe Components, 4) Recommended Next Steps. Plain text, concise.`}],'Patent report writer.',800);
      box.innerHTML = `<div class="ai-box" style="margin-top:10px"><h4>Full Report</h4><pre>${esc(raw)}</pre></div>`;
    }catch(e){ box.innerHTML = `<div class="ai-box"><p style="color:var(--red2)">⚠️ ${esc(e.message)}</p></div>`; }
  };

  window._daRedesign = async function(){
    const box = document.getElementById('daExtraResult');
    box.innerHTML = '<div class="ai-loading show"><div class="spinner"></div><p>Generating redesign ideas…</p></div>';
    try{
      const conflicts = (window._daResults||[]).filter(r=>r.risk_level==='high'||r.risk_level==='medium').map(r=>`${r.name}: ${r.reason} (Patents: ${(r.conflicting_patents||[]).join(', ')||'none found'})`).join('\n')||'No specific conflicts identified.';
      const raw = await aiGenerate([{role:'user',content:`Suggest design-around strategies for these patent conflicts:\n\n${conflicts}\n\nFor each conflict give 1-2 specific technical alternatives that would avoid the patent claims. Be practical and specific.`}],'Patent design-around strategist.',700);
      box.innerHTML = `<div class="ai-box" style="margin-top:10px"><h4>💡 Redesign Suggestions</h4><pre>${esc(raw)}</pre></div>`;
    }catch(e){ box.innerHTML = `<div class="ai-box"><p style="color:var(--red2)">⚠️ ${esc(e.message)}</p></div>`; }
  };
}

function _daLayout(n){
  // Arrange n components in a natural scattered grid
  const configs = {
    1:[{x:50,y:50,w:40,h:50}],
    2:[{x:30,y:50,w:38,h:44},{x:70,y:50,w:38,h:44}],
    3:[{x:25,y:35,w:35,h:44},{x:65,y:35,w:35,h:44},{x:45,y:72,w:35,h:44}],
    4:[{x:28,y:32,w:36,h:44},{x:72,y:32,w:36,h:44},{x:28,y:72,w:36,h:44},{x:72,y:72,w:36,h:44}],
    5:[{x:25,y:28,w:34,h:42},{x:65,y:28,w:34,h:42},{x:45,y:55,w:34,h:42},{x:22,y:78,w:32,h:40},{x:72,y:78,w:32,h:40}],
    6:[{x:22,y:25,w:33,h:42},{x:55,y:25,w:33,h:42},{x:83,y:25,w:30,h:42},{x:22,y:68,w:33,h:42},{x:55,y:68,w:33,h:42},{x:83,y:68,w:30,h:42}],
    7:[{x:20,y:22,w:30,h:40},{x:52,y:22,w:30,h:40},{x:82,y:22,w:28,h:40},{x:20,y:58,w:30,h:40},{x:52,y:58,w:30,h:40},{x:82,y:58,w:28,h:40},{x:50,y:88,w:32,h:40}],
  };
  return (configs[Math.min(n,7)] || configs[7]).slice(0,n);
}

// ═══════════════════════════════
// PATENT AGENT + LANDSCAPE
// ═══════════════════════════════
document.getElementById('agentBtn').addEventListener('click', async()=>{
  const q=document.getElementById('agentInput').value.trim();
  if(!q){alert('Ask a question first');return;}
  if(!_allRes.length){alert('Run a search first to give the agent context');return;}
  setLoad('agentLoading',true);
  document.getElementById('agentResult').innerHTML='';
  try{
    const ctx=_allRes.slice(0,12).map((p,i)=>`${i+1}. ${p.patent_number||'?'} | ${p.title||''} | ${p.assignee||'?'} | ${(p.abstract||'').slice(0,220)}`).join('\n');
    const raw=await aiGenerate([{
      role:'user',
      content:`You are a patent prior-art strategist. Use only the provided dataset context.\n\nUSER QUESTION:\n${q}\n\nDATASET CONTEXT:\n${ctx}\n\nAnswer with:\n1) Direct answer\n2) Why (cite patent numbers)\n3) Design-around suggestions`
    }],'Patent agent analyst. Be practical and concise.',900);
    document.getElementById('agentResult').innerHTML=`<div class="ai-box"><h4>Patent Agent Response</h4><pre>${esc(raw)}</pre></div>`;
  }catch(e){
    document.getElementById('agentResult').innerHTML=`<div class="ai-box"><p style="color:var(--red2)">⚠️ ${esc(e.message)}</p></div>`;
  }finally{
    setLoad('agentLoading',false);
  }
});

document.getElementById('landscapeBtn').addEventListener('click',()=>{
  _buildLandscape();
});

async function _buildLandscape(){
  const box=document.getElementById('landscapeResult');
  if(!_allRes.length){box.innerHTML='<div class="ai-box"><p>Run a search first to build a network map.</p></div>';return;}

  // ── Build node data ──
  const byAss={};
  _allRes.forEach(p=>{
    const a=(p.assignee||'Unknown').trim()||'Unknown';
    if(!byAss[a]) byAss[a]={name:a,count:0,inventors:new Set(),keywords:new Set(),patents:[]};
    byAss[a].count+=1;
    byAss[a].patents.push(p.patent_number||'');
    String(p.inventor||'').split(/[;,]/).map(s=>s.trim()).filter(Boolean).forEach(inv=>byAss[a].inventors.add(inv.toLowerCase()));
    String(p.title||'').toLowerCase().split(/\s+/).filter(w=>w.length>4).forEach(w=>byAss[a].keywords.add(w));
  });
  const nodes=Object.values(byAss)
    .sort((a,b)=>b.count-a.count)
    .filter(n=>n.count>=2)  // only show assignees with 2+ patents
    .slice(0,20);

  // If too few nodes after filter, fall back to top 5 regardless
  if(nodes.length<3){
    nodes.length=0;
    Object.values(byAss).sort((a,b)=>b.count-a.count).slice(0,8).forEach(n=>nodes.push(n));
  }

  // ── Build edges ──
  const links=[];
  for(let i=0;i<nodes.length;i++){
    for(let j=i+1;j<nodes.length;j++){
      const a=nodes[i],b=nodes[j];
      let invOverlap=0;
      a.inventors.forEach(x=>{if(b.inventors.has(x))invOverlap++;});
      if(invOverlap>0){links.push({i,j,w:invOverlap,kind:'inventor'});continue;}
      let kwOverlap=0;
      a.keywords.forEach(x=>{if(b.keywords.has(x))kwOverlap++;});
      if(kwOverlap>=2)links.push({i,j,w:Math.min(kwOverlap,5),kind:'keyword'});
    }
  }
  let transferEdges=[];
  try{
    const r=await fetch('/api/landscape/edges',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assignees:nodes.map(n=>n.name)})});
    const d=await r.json();
    transferEdges=(d.edges||[]).slice(0,30);
  }catch{}
  transferEdges.forEach(e=>{
    const i=nodes.findIndex(n=>n.name===e.from_assignee);
    const j=nodes.findIndex(n=>n.name===e.to_assignee);
    if(i>=0&&j>=0)links.push({i,j,w:e.count||1,kind:'transfer'});
  });

  // ── Force-directed layout ──
  const CW=900,CH=650;
  const pos=nodes.map((_,idx)=>{
    // Place in a grid-ish spiral to avoid initial clumping
    const angle=(idx/nodes.length)*Math.PI*2;
    const radius=CW*0.3;
    return{
      x:CW/2+Math.cos(angle)*radius+(Math.random()-.5)*80,
      y:CH/2+Math.sin(angle)*radius+(Math.random()-.5)*80,
      vx:0,vy:0
    };
  });
  const REPEL=nodes.length<=4?50000:nodes.length<=8?25000:16000;
  const ATTRACT=0.006,DAMPEN=0.75,ITERS=500;
  for(let iter=0;iter<ITERS;iter++){
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
      const dx=pos[j].x-pos[i].x,dy=pos[j].y-pos[i].y;
      const d=Math.sqrt(dx*dx+dy*dy)||1;
      const f=REPEL/(d*d);
      pos[i].vx-=f*dx/d;pos[i].vy-=f*dy/d;
      pos[j].vx+=f*dx/d;pos[j].vy+=f*dy/d;
    }
    links.forEach(l=>{
      const dx=pos[l.j].x-pos[l.i].x,dy=pos[l.j].y-pos[l.i].y;
      const d=Math.sqrt(dx*dx+dy*dy)||1;
      const s=ATTRACT*d*(l.w||1);
      pos[l.i].vx+=s*dx/d;pos[l.i].vy+=s*dy/d;
      pos[l.j].vx-=s*dx/d;pos[l.j].vy-=s*dy/d;
    });
    pos.forEach(p=>{p.vx+=(CW/2-p.x)*.003;p.vy+=(CH/2-p.y)*.003;});
    pos.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vx*=DAMPEN;p.vy*=DAMPEN;
      p.x=Math.max(70,Math.min(CW-70,p.x));p.y=Math.max(50,Math.min(CH-50,p.y));});
  }

  // ── Legend counts ──
  const invLinks=links.filter(l=>l.kind==='inventor').length;
  const kwLinks=links.filter(l=>l.kind==='keyword').length;
  const trLinks=links.filter(l=>l.kind==='transfer').length;

  // ── Render interactive canvas ──
  box.innerHTML=`
  <div class="ai-box" style="padding:0;overflow:hidden">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border)">
      <h4 style="margin:0">Assignee Relationship Map</h4>
      <div style="display:flex;gap:14px;font-size:.72rem;color:var(--muted)">
        ${invLinks?`<span style="display:flex;align-items:center;gap:4px"><span style="width:16px;height:2px;background:#999;display:inline-block"></span> Shared Inventor (${invLinks})</span>`:''}
        ${kwLinks?`<span style="display:flex;align-items:center;gap:4px"><span style="width:16px;height:2px;background:#b8860b;border-top:2px dotted #b8860b;display:inline-block"></span> Co-filing (${kwLinks})</span>`:''}
        ${trLinks?`<span style="display:flex;align-items:center;gap:4px"><span style="width:16px;height:2px;border-top:2px dashed #d35400;display:inline-block"></span> Transfer (${trLinks})</span>`:''}
        <span style="color:var(--muted2)">Scroll to zoom · Drag to pan · Hover nodes</span>
      </div>
    </div>
    <div style="position:relative;width:100%;height:600px;background:#faf8f4;overflow:hidden" id="netContainer">
      <canvas id="netCanvas" style="position:absolute;top:0;left:0;cursor:grab"></canvas>
      <div id="netTooltip" style="position:absolute;display:none;background:#1a1a1a;color:#f5f0e8;padding:10px 14px;border-radius:6px;font-size:.78rem;pointer-events:none;max-width:220px;z-index:10;box-shadow:0 4px 16px rgba(0,0,0,.3)"></div>
    </div>
    <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px">
      <button onclick="_netZoom(1.2)" style="padding:5px 12px;border:1px solid var(--border2);border-radius:4px;background:none;cursor:pointer;font-size:.78rem">＋ Zoom In</button>
      <button onclick="_netZoom(0.8)" style="padding:5px 12px;border:1px solid var(--border2);border-radius:4px;background:none;cursor:pointer;font-size:.78rem">－ Zoom Out</button>
      <button onclick="_netReset()" style="padding:5px 12px;border:1px solid var(--border2);border-radius:4px;background:none;cursor:pointer;font-size:.78rem">⌂ Reset</button>
      <span style="margin-left:auto;font-size:.72rem;color:var(--muted);line-height:2">${nodes.length} assignees · ${links.length} connections</span>
    </div>
  </div>`;

  // ── Canvas renderer ──
  const container=document.getElementById('netContainer');
  const canvas=document.getElementById('netCanvas');
  const tooltip=document.getElementById('netTooltip');
  canvas.width=container.offsetWidth;
  canvas.height=container.offsetHeight;
  canvas.style.width=canvas.width+'px';
  canvas.style.height=canvas.height+'px';
  const ctx=canvas.getContext('2d');

  let transform={x:0,y:0,scale:1};
  let dragging=false,dragStart={x:0,y:0},dragOrigin={x:0,y:0};
  let hoveredNode=-1;

  function nodeRadius(n){return Math.max(22, 22+Math.min(n.count*3,30));}

  function toScreen(wx,wy){
    return{x:wx*transform.scale+transform.x,y:wy*transform.scale+transform.y};
  }
  function toWorld(sx,sy){
    return{x:(sx-transform.x)/transform.scale,y:(sy-transform.y)/transform.scale};
  }

  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.save();

    // Draw edges
    links.forEach(l=>{
      const a=toScreen(pos[l.i].x,pos[l.i].y);
      const b=toScreen(pos[l.j].x,pos[l.j].y);
      ctx.beginPath();
      ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
      if(l.kind==='transfer'){ctx.strokeStyle='#d35400';ctx.setLineDash([6,3]);ctx.globalAlpha=.7;}
      else if(l.kind==='keyword'){ctx.strokeStyle='#b8860b';ctx.setLineDash([3,3]);ctx.globalAlpha=.5;}
      else{ctx.strokeStyle='#aaa';ctx.setLineDash([]);ctx.globalAlpha=.8;}
      ctx.lineWidth=(1+Math.min(l.w,4))*transform.scale;
      ctx.stroke();
      ctx.setLineDash([]);ctx.globalAlpha=1;
    });

    // Draw nodes
    nodes.forEach((n,idx)=>{
      const {x,y}=toScreen(pos[idx].x,pos[idx].y);
      const r=nodeRadius(n)*transform.scale;
      const isHover=idx===hoveredNode;

      // Shadow
      ctx.shadowColor='rgba(0,0,0,.18)';ctx.shadowBlur=isHover?18:8;

      // Circle
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
      const grad=ctx.createRadialGradient(x-r*.2,y-r*.2,r*.1,x,y,r);
      grad.addColorStop(0,isHover?'#d4a017':'#c99a10');
      grad.addColorStop(1,isHover?'#8a6500':'#7a5800');
      ctx.fillStyle=grad;ctx.fill();
      ctx.strokeStyle='#fff';ctx.lineWidth=isHover?2.5:1.5;ctx.stroke();
      ctx.shadowBlur=0;

      // Count label inside
      ctx.fillStyle='#fff';
      ctx.font=`bold ${Math.max(11,13*Math.min(transform.scale,1))}px "IBM Plex Mono",monospace`;
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(n.count,x,y-4);
      ctx.font=`${Math.max(8,9*Math.min(transform.scale,1))}px Inter,sans-serif`;
      ctx.fillStyle='rgba(255,255,255,.75)';
      ctx.fillText('patent'+(n.count!==1?'s':''),x,y+8);

      // Name label above node — always readable
      const label=n.name.length>28?n.name.slice(0,26)+'…':n.name;
      const fontSize=Math.max(10,12*Math.min(transform.scale,1.2));
      ctx.font=`600 ${fontSize}px Inter,sans-serif`;
      ctx.textBaseline='bottom';
      const tw=ctx.measureText(label).width;
      // pill background
      const px=x-tw/2-5, py=y-r-fontSize-8, pw=tw+10, ph=fontSize+6;
      ctx.fillStyle='rgba(255,255,255,.92)';
      ctx.beginPath();
      ctx.roundRect(px,py,pw,ph,4);
      ctx.fill();
      ctx.strokeStyle='rgba(184,134,11,.3)';ctx.lineWidth=1;ctx.stroke();
      ctx.fillStyle=isHover?'#8a6500':'#333';
      ctx.fillText(label,x,y-r-4);
    });

    ctx.restore();
  }

  // Initial centre
  transform.x=canvas.width/2-CW/2;
  transform.y=canvas.height/2-CH/2;
  draw();

  // ── Interactions ──
  function getHovered(ex,ey){
    const w=toWorld(ex,ey);
    for(let i=nodes.length-1;i>=0;i--){
      const r=nodeRadius(nodes[i]);
      const dx=pos[i].x-w.x,dy=pos[i].y-w.y;
      if(dx*dx+dy*dy<r*r)return i;
    }
    return -1;
  }

  canvas.addEventListener('mousemove',e=>{
    const rect=canvas.getBoundingClientRect();
    const ex=e.clientX-rect.left,ey=e.clientY-rect.top;
    if(dragging){
      transform.x=dragOrigin.x+(ex-dragStart.x);
      transform.y=dragOrigin.y+(ey-dragStart.y);
      draw();return;
    }
    const h=getHovered(ex,ey);
    if(h!==hoveredNode){hoveredNode=h;draw();}
    if(h>=0){
      canvas.style.cursor='pointer';
      const n=nodes[h];
      const connectedTo=links.filter(l=>l.i===h||l.j===h).map(l=>{
        const other=l.i===h?nodes[l.j]:nodes[l.i];
        return `${other.name} (${l.kind})`;
      });
      tooltip.innerHTML=`<strong>${esc(n.name)}</strong><br>${n.count} patent${n.count!==1?'s':''}`+
        (connectedTo.length?`<br><br><span style="color:#bbb;font-size:.7rem">Linked to:</span><br>${connectedTo.slice(0,4).map(s=>`• ${esc(s)}`).join('<br>')}${connectedTo.length>4?`<br>+${connectedTo.length-4} more`:''}` :'');
      const sx=toScreen(pos[h].x,pos[h].y);
      let tx=sx.x+20,ty=sy=sx.y-10;
      if(tx+230>canvas.width)tx=sx.x-240;
      tooltip.style.left=tx+'px';tooltip.style.top=ty+'px';
      tooltip.style.display='block';
    }else{
      canvas.style.cursor='grab';
      tooltip.style.display='none';
    }
  });

  canvas.addEventListener('mousedown',e=>{
    const rect=canvas.getBoundingClientRect();
    dragging=true;canvas.style.cursor='grabbing';
    dragStart={x:e.clientX-rect.left,y:e.clientY-rect.top};
    dragOrigin={x:transform.x,y:transform.y};
  });
  canvas.addEventListener('mouseup',()=>{dragging=false;canvas.style.cursor='grab';});
  canvas.addEventListener('mouseleave',()=>{dragging=false;tooltip.style.display='none';});

  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    const rect=canvas.getBoundingClientRect();
    const mx=e.clientX-rect.left,my=e.clientY-rect.top;
    const factor=e.deltaY<0?1.12:0.9;
    const newScale=Math.max(0.3,Math.min(4,transform.scale*factor));
    transform.x=mx-(mx-transform.x)*(newScale/transform.scale);
    transform.y=my-(my-transform.y)*(newScale/transform.scale);
    transform.scale=newScale;
    draw();
  },{passive:false});

  // Touch support
  let lastTouchDist=0;
  canvas.addEventListener('touchstart',e=>{
    if(e.touches.length===1){
      const rect=canvas.getBoundingClientRect();
      dragging=true;
      dragStart={x:e.touches[0].clientX-rect.left,y:e.touches[0].clientY-rect.top};
      dragOrigin={x:transform.x,y:transform.y};
    }else if(e.touches.length===2){
      lastTouchDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    }
  },{passive:true});
  canvas.addEventListener('touchmove',e=>{
    e.preventDefault();
    const rect=canvas.getBoundingClientRect();
    if(e.touches.length===1&&dragging){
      transform.x=dragOrigin.x+(e.touches[0].clientX-rect.left-dragStart.x);
      transform.y=dragOrigin.y+(e.touches[0].clientY-rect.top-dragStart.y);
    }else if(e.touches.length===2){
      const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      const factor=d/lastTouchDist;
      transform.scale=Math.max(0.3,Math.min(4,transform.scale*factor));
      lastTouchDist=d;
    }
    draw();
  },{passive:false});
  canvas.addEventListener('touchend',()=>{dragging=false;});

  // Expose zoom/reset controls
  window._netZoom=function(f){
    transform.scale=Math.max(0.3,Math.min(4,transform.scale*f));
    draw();
  };
  window._netReset=function(){
    transform={x:canvas.width/2-CW/2,y:canvas.height/2-CH/2,scale:1};
    draw();
  };

  // Resize observer
  new ResizeObserver(()=>{
    canvas.width=container.offsetWidth;
    canvas.height=container.offsetHeight;
    canvas.style.width=canvas.width+'px';
    canvas.style.height=canvas.height+'px';
    draw();
  }).observe(container);
}

async function _fetchLitigation(pn){
  try{
    const r=await fetch(`/api/litigation?patent_number=${encodeURIComponent(pn||'')}`);
    const d=await r.json();
    return d.cases||[];
  }catch{
    return [];
  }
}

// ═══════════════════════════════
// MODAL — Full HK Registry Layout
// ═══════════════════════════════
function _regRow(num, labelEn, labelCn, valHtml){
  return `<tr>
    <td style="width:42%;padding:9px 8px;vertical-align:top;border-bottom:1px solid var(--border)">
      ${num?`<span style="font-family:'IBM Plex Mono',monospace;font-size:.6rem;color:var(--muted2);background:var(--bg2);border:1px solid var(--border);border-radius:3px;padding:1px 5px;display:inline-block;margin-bottom:3px">[${num}]</span><br>`:''}
      <span style="font-size:.75rem;font-weight:600;color:#555;display:block">${labelEn}</span>
      ${labelCn?`<span style="font-size:.65rem;color:var(--muted2)">${labelCn}</span>`:''}
    </td>
    <td style="padding:9px 8px;vertical-align:top;font-size:.83rem;color:var(--text);border-bottom:1px solid var(--border)">${valHtml||'—'}</td>
  </tr>`;
}

function _secHeader(titleEn, titleCn, open=true){
  const id='sec_'+Math.random().toString(36).slice(2,6);
  return {id, html:`
    <tr class="reg-sec-hdr" onclick="
      const b=document.getElementById('${id}');
      const arr=this.querySelector('.arr');
      const hidden=b.style.display==='none';
      b.style.display=hidden?'':'none';
      arr.textContent=hidden?'▾':'▸';
    " style="cursor:pointer;background:var(--bg2);border-top:2px solid var(--border2)">
      <td colspan="2" style="padding:9px 12px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted)">
        <span class="arr" style="margin-right:6px;font-size:.8rem">${open?'▾':'▸'}</span>
        <span style="color:var(--gold)">${titleCn}</span> ${titleEn}
      </td>
    </tr>
    <tbody id="${id}" style="display:${open?'':'none'}">`
  };
}

function _statusBadge(p){
  const st=String(p.status||'').toLowerCase();
  const pn=String(p.patent_number||'').toUpperCase();
  if(st==='granted'||/^HK3/.test(pn))
    return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:4px;background:rgba(39,174,96,.1);border:1px solid rgba(39,174,96,.25);color:#1a7f47;font-size:.78rem;font-weight:600"><span style="width:7px;height:7px;border-radius:50%;background:#27ae60"></span>專利有效 Patent in force</span>`;
  if(st==='expired')
    return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:4px;background:rgba(150,150,150,.1);border:1px solid rgba(150,150,150,.25);color:#666;font-size:.78rem;font-weight:600"><span style="width:7px;height:7px;border-radius:50%;background:#999"></span>Expired</span>`;
  return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:4px;background:rgba(230,126,34,.1);border:1px solid rgba(230,126,34,.25);color:#c06000;font-size:.78rem;font-weight:600"><span style="width:7px;height:7px;border-radius:50%;background:#e67e22"></span>Pending</span>`;
}

function _patentType(p){
  const pn=String(p.patent_number||'').toUpperCase();
  if(p.patent_type) return esc(p.patent_type);
  if(/^HK3/.test(pn)) return '短期專利 Short-term Patent';
  if(/^HK1/.test(pn)) return 'Standard Patent';
  return '—';
}

async function openModal(p){
  openWorkspace(p);
}
function closeModal(){ closeWorkspace(); }

// ═══════════════════════════════
// COMPARE MODE
// ═══════════════════════════════
const _cmpSet = new Set();

function _updateCmpBar(){
  document.getElementById('cmpCnt').textContent=_cmpSet.size;
  document.getElementById('cmpBar').classList.toggle('show',_cmpSet.size>=1);
}

document.getElementById('clrCmpBtn').addEventListener('click',()=>{
  _cmpSet.clear(); _updateCmpBar(); if(_allRes.length) _render();
});

document.getElementById('expCsvBtn').addEventListener('click',()=>{
  const sel=_allRes.filter(p=>_cmpSet.has(p.patent_number));
  if(!sel.length){alert('Select at least 1 patent first');return;}
  const cols=['patent_number','title','inventor','assignee','filing_date','abstract'];
  const escCsv=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const lines=[cols.join(',')].concat(sel.map(p=>cols.map(c=>escCsv(p[c])).join(',')));
  const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='patent-selection.csv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
});

document.getElementById('expPdfBtn').addEventListener('click',()=>{
  const sel=_allRes.filter(p=>_cmpSet.has(p.patent_number));
  if(!sel.length){alert('Select at least 1 patent first');return;}
  const w=window.open('','_blank');
  const rows=sel.map(p=>`<tr><td>${esc(p.patent_number||'')}</td><td>${esc(p.title||'')}</td><td>${esc(p.assignee||'—')}</td><td>${esc(p.filing_date||'—')}</td></tr>`).join('');
  w.document.write(`<html><head><title>Patent Export</title><style>body{font-family:Arial,sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:8px;text-align:left;font-size:12px}th{background:#f1f1f1}</style></head><body><h2>Selected Patents (${sel.length})</h2><table><thead><tr><th>No.</th><th>Title</th><th>Assignee</th><th>Filed</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
  w.document.close();
  w.focus();
  w.print();
});

document.getElementById('execRptBtn').addEventListener('click',async()=>{
  const sel=_allRes.filter(p=>_cmpSet.has(p.patent_number));
  if(!sel.length){alert('Select at least 1 patent first');return;}
  let summary='AI summary unavailable.';
  try{
    const ctx=sel.slice(0,12).map(p=>`${p.patent_number}: ${p.title} (${p.assignee||'?'}, ${p.filing_date||'?'})`).join('\n');
    summary=await aiGenerate([{role:'user',content:`Create a concise 1-page executive patent report summary from these records:\n${ctx}\n\nReturn markdown with sections: Executive Summary, Risk Snapshot, Top Assignees, Recommended Next Actions.`}],'Patent portfolio analyst',700);
  }catch{}
  const w=window.open('','_blank');
  const liRisk=sel.filter(p=>p.litigation_flag).length;
  const topAss={}; sel.forEach(p=>{const a=p.assignee||'Unknown'; topAss[a]=(topAss[a]||0)+1;});
  const topList=Object.entries(topAss).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([a,c])=>`<li>${esc(a)} - ${c}</li>`).join('');
  w.document.write(`<html><head><title>Executive Patent Report</title><style>body{font-family:Inter,Arial,sans-serif;padding:24px;color:#111}h1{margin:0 0 6px}h2{margin:16px 0 6px;font-size:16px}p,li{font-size:13px;line-height:1.5}pre{white-space:pre-wrap;background:#f7f7f7;border:1px solid #ddd;border-radius:6px;padding:10px}</style></head><body><h1>Executive Patent Report</h1><p>Generated: ${new Date().toLocaleString()}</p><h2>Portfolio Snapshot</h2><ul><li>Selected patents: ${sel.length}</li><li>Litigation-flagged: ${liRisk}</li></ul><h2>Top Assignees</h2><ul>${topList}</ul><h2>AI Executive Summary</h2><pre>${esc(summary)}</pre></body></html>`);
  w.document.close();
  w.focus();
  w.print();
});

document.getElementById('cmpOverlay').addEventListener('click',e=>{
  if(e.target===e.currentTarget) e.currentTarget.classList.remove('open');
});

document.getElementById('doCmpBtn').addEventListener('click',async()=>{
  const sel=_allRes.filter(p=>_cmpSet.has(p.patent_number));
  if(sel.length<2){alert('Select at least 2 patents first');return;}
  const ov=document.getElementById('cmpOverlay'), mc=document.getElementById('cmpModal');
  mc.innerHTML=`<div style="text-align:center;padding:48px"><div class="spinner" style="width:22px;height:22px;margin:0 auto 14px"></div><p>Comparing ${sel.length} patents with AI…</p></div>`;
  ov.classList.add('open');
  try{
    const patStr=sel.map(p=>`Patent: ${p.patent_number}\nTitle: ${p.title}\nAssignee: ${p.assignee||'?'}\nFiled: ${p.filing_date||'?'}\nAbstract: ${(p.abstract||'').slice(0,200)}`).join('\n---\n');
    const raw=await aiGenerate([{role:'user',content:`Compare these ${sel.length} HK patents. Identify similarities, key differences and novelty gaps:\n\n${patStr}\n\nRespond ONLY with valid JSON (no markdown):\n{"summary":"2-sentence overview","similarities":["sim 1","sim 2"],"key_differences":["diff 1","diff 2"],"novelty_gaps":["gap 1","gap 2"],"recommendation":"1-sentence strategic tip"}`}],'Patent comparison expert. Respond ONLY with valid JSON.',2048);
    let d; try{d=parseJSON(raw);}catch{d={};}
    mc.innerHTML=`
      <button class="modal-close" onclick="document.getElementById('cmpOverlay').classList.remove('open')">×</button>
      <h2>Patent Comparison — ${sel.length} Patents</h2>
      <table class="cmp-table">
        <thead><tr><th>Field</th>${sel.map(p=>`<th>${esc(p.patent_number)}</th>`).join('')}</tr></thead>
        <tbody>
          <tr><td><strong>Title</strong></td>${sel.map(p=>`<td>${esc(p.title||'—')}</td>`).join('')}</tr>
          <tr><td><strong>Assignee</strong></td>${sel.map(p=>`<td>${esc(p.assignee||'—')}</td>`).join('')}</tr>
          <tr><td><strong>Filed</strong></td>${sel.map(p=>`<td>${esc(p.filing_date||'—')}</td>`).join('')}</tr>
        </tbody>
      </table>
      ${d.summary?`<div class="ai-box" style="margin-top:16px"><h4>AI Summary</h4><p>${esc(d.summary)}</p></div>`:''}
      ${(d.similarities||[]).length?`<div class="ai-box" style="margin-top:10px"><h4>Similarities</h4><ul>${d.similarities.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></div>`:''}
      ${(d.key_differences||[]).length?`<div class="ai-box" style="margin-top:10px"><h4>Key Differences</h4><ul>${d.key_differences.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></div>`:''}
      ${(d.novelty_gaps||[]).length?`<div class="novelty-gap"><strong>🔍 Novelty Gaps</strong><br><br>${d.novelty_gaps.map(g=>`• ${esc(g)}`).join('<br>')}</div>`:''}
      ${d.recommendation?`<div class="ai-box" style="margin-top:10px"><h4>Strategic Recommendation</h4><p>${esc(d.recommendation)}</p></div>`:''}`;
  }catch(e){
    mc.innerHTML=`<button class="modal-close" onclick="document.getElementById('cmpOverlay').classList.remove('open')">×</button><div class="ai-box"><p style="color:#e74c3c">⚠️ ${esc(e.message)}</p></div>`;
  }
});// ═══════════════════════════════════════════════════
// WORKSPACE
// ═══════════════════════════════════════════════════
let _wsPatent = null;
const _wsSelected = new Set();

function wsGetRefs(){ try{return JSON.parse(localStorage.getItem('hkps_refs')||'[]');}catch{return[];} }
function wsSaveRefs(r){ localStorage.setItem('hkps_refs',JSON.stringify(r)); }
function wsIsInRefs(pn){ return !!wsGetRefs().find(r=>r.patent_number===pn); }
function wsAddRef(p){
  const refs=wsGetRefs();
  if(!refs.find(r=>r.patent_number===p.patent_number)){ refs.unshift(p); wsSaveRefs(refs); }
  wsRenderSidebar(); wsRenderRefList(); wsUpdateRefCount();
}
function wsRemoveRef(pn){
  wsSaveRefs(wsGetRefs().filter(r=>r.patent_number!==pn));
  wsRenderSidebar(); wsRenderRefList(); wsUpdateRefCount();
}
function wsUpdateRefCount(){
  const n=wsGetRefs().length;
  document.getElementById('wsRefCount').textContent=n;
  document.getElementById('wsSideRefCount').textContent=n;
  document.getElementById('wsRefTitle').textContent=`Reference List (${n} patent${n!==1?'s':''})`;
}

function openWorkspace(p){
  _wsPatent=p;
  document.getElementById('wsOverlay').style.display='flex';
  document.body.style.overflow='hidden';
  document.getElementById('wsPN').textContent=p.patent_number||'';
  document.getElementById('wsTitle').textContent=p.title||'';
  switchWsTab('detail');
  wsRenderDetail(p);
  wsRenderSidebar();
  wsRenderRefList();
  wsUpdateRefCount();
  wsUpdateAddBtn();
}

function closeWorkspace(){
  document.getElementById('wsOverlay').style.display='none';
  document.body.style.overflow='';
}

document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeWorkspace(); });

function switchWsTab(name){
  document.querySelectorAll('.ws-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.ws-panel').forEach(p=>p.classList.remove('active'));
  document.querySelector(`.ws-tab[data-wstab="${name}"]`).classList.add('active');
  document.getElementById('wsp-'+name).classList.add('active');
  if(name==='trends') wsRenderTrends();
}

function wsUpdateAddBtn(){
  if(!_wsPatent) return;
  const btn=document.getElementById('wsAddRef');
  if(wsIsInRefs(_wsPatent.patent_number)){
    btn.textContent='✓ In References';
    btn.style.color='var(--green)';
    btn.style.borderColor='var(--green)';
  } else {
    btn.textContent='＋ Add to References';
    btn.style.color='';
    btn.style.borderColor='';
  }
}

function wsToggleRef(){
  if(!_wsPatent) return;
  if(wsIsInRefs(_wsPatent.patent_number)) wsRemoveRef(_wsPatent.patent_number);
  else wsAddRef(_wsPatent);
  wsUpdateAddBtn();
}

function wsRegRow(num,en,cn,val){
  return `<tr>
    <td>
      ${num?`<span style="font-family:'IBM Plex Mono',monospace;font-size:.58rem;color:var(--muted2);background:var(--bg2);border:1px solid var(--border);border-radius:3px;padding:1px 5px;display:inline-block;margin-bottom:2px">[${num}]</span><br>`:''}
      <span style="font-size:.73rem;font-weight:600;color:#555;display:block">${en}</span>
      ${cn?`<span style="font-size:.63rem;color:var(--muted2)">${cn}</span>`:''}
    </td>
    <td style="font-size:.83rem;color:var(--text)">${val||'—'}</td>
  </tr>`;
}

function wsCollapsible(titleEn,titleCn,bodyHtml,open=true){
  const id='wsc_'+Math.random().toString(36).slice(2,6);
  return `<div style="margin-bottom:16px">
    <div onclick="const b=document.getElementById('${id}');const c=this.classList.toggle('wsc-closed');b.style.maxHeight=c?'0':'1500px';this.querySelector('.wsarr').textContent=c?'▸':'▾';"
      style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:2px solid var(--border2);cursor:pointer;user-select:none">
      <span style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted)"><span style="color:var(--gold)">${titleCn}</span> ${titleEn}</span>
      <span class="wsarr" style="font-size:.8rem;color:var(--muted);transition:transform .2s">${open?'▾':'▸'}</span>
    </div>
    <div id="${id}" style="overflow:hidden;transition:max-height .3s ease;max-height:${open?'1500px':'0'}">
      <table class="ws-reg-table">${bodyHtml}</table>
    </div>
  </div>`;
}

function wsRenderDetail(p){
  const pn=String(p.patent_number||'').toUpperCase();
  const st=String(p.status||'').toLowerCase();
  const isGranted=st==='granted'||/^HK3/.test(pn);
  const statusBadge=isGranted
    ?`<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:4px;background:rgba(39,174,96,.1);border:1px solid rgba(39,174,96,.3);color:#1a7f47;font-size:.72rem;font-weight:600">● Patent in force</span>`
    :`<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:4px;background:rgba(230,126,34,.1);border:1px solid rgba(230,126,34,.3);color:#c06000;font-size:.72rem;font-weight:600">● Pending</span>`;
  const pt=p.patent_type||(/^HK3/i.test(pn)?'Short-term Patent':'Standard Patent');
  const titleDisplay=(p.title_cn?`<div style="margin-bottom:2px">${esc(p.title_cn)}</div><div style="font-size:.78rem;color:#666">${esc(p.title||'')}</div>`:esc(p.title||'—'));
  const invBlock=(p.inventor||'—').split(';').map(s=>`<div>${esc(s.trim())}</div>`).join('');
  const appBlock=p.assignee?`<div style="font-weight:600;margin-bottom:2px">${esc(p.assignee)}</div>${p.assignee_address?`<div style="font-size:.76rem;color:#666">${esc(p.assignee_address)}</div>`:''}${p.assignee_country?`<div style="font-size:.76rem;color:#666">${esc(p.assignee_country)}</div>`:''}` :'—';
  const agentBlock=p.agent?`<div style="font-weight:600;margin-bottom:2px">${esc(p.agent)}</div>${p.agent_address?`<div style="font-size:.76rem;color:#666">${esc(p.agent_address)}</div>`:''}` :'—';
  const ipdUrl=`https://esearch.ipd.gov.hk/nis-pos-view/#/pt/details?id=${encodeURIComponent(p.patent_number||'')}`;

  document.getElementById('wsDetailContent').innerHTML=`
    <h1 style="font-family:'Playfair Display',serif;font-size:1.5rem;line-height:1.3;margin-bottom:10px">${esc(p.title||'Untitled Patent')}</h1>
    <div style="display:flex;flex-wrap:wrap;gap:6px 16px;margin-bottom:20px;align-items:center">
      ${statusBadge}
      <span style="font-size:.75rem;color:var(--muted)">Filed <strong style="color:var(--text)">${esc(p.filing_date||'—')}</strong></span>
      ${p.grant_date?`<span style="font-size:.75rem;color:var(--muted)">Granted <strong style="color:var(--text)">${esc(p.grant_date)}</strong></span>`:''}
    </div>

    ${p.abstract?`<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:18px;margin-bottom:20px">
      <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:8px;font-family:'IBM Plex Mono',monospace">Abstract</div>
      <p style="font-size:.87rem;line-height:1.8;color:#444">${esc(p.abstract)}</p>
    </div>`:''}

    <a href="${ipdUrl}" target="_blank" style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--card);border:1px solid var(--border);border-radius:var(--r);margin-bottom:20px;text-decoration:none;color:var(--text);transition:border-color .15s" onmouseover="this.style.borderColor='var(--gold)'" onmouseout="this.style.borderColor='var(--border)'">
      <span style="font-size:1.1rem">🏛</span>
      <div style="flex:1">
        <div style="font-size:.82rem;font-weight:600">View full record on HK IPD e-Search</div>
        <div style="font-size:.7rem;color:var(--muted)">Official drawings, claims and full specification ↗</div>
      </div>
    </a>

    ${wsCollapsible('Basic Information','基本資料',`
      ${wsRegRow('','Status','狀況：',statusBadge)}
      ${wsRegRow('','Patent Type','專利類別：',esc(pt))}
      ${wsRegRow('','Patent No.','專利編號：',`<span style="font-family:'IBM Plex Mono',monospace;font-size:.8rem">${esc(p.patent_number||'—')}</span>`)}
      ${wsRegRow(11,'Publication No.','發表號碼：',`<span style="font-family:'IBM Plex Mono',monospace;font-size:.8rem">${esc(p.publication_number||p.patent_number||'—')}</span>`)}
      ${wsRegRow(21,'Application No.','申請編號：',`<span style="font-family:'IBM Plex Mono',monospace;font-size:.8rem">${esc(p.application_number||'—')}</span>`)}
      ${wsRegRow(54,'Title of Invention','發明名稱：',titleDisplay)}
      ${wsRegRow(51,'Classified to','分類：',`<span style="font-family:'IBM Plex Mono',monospace;font-size:.8rem">${esc(p.ipc||'—')}</span>`)}
      ${wsRegRow('','Language','法律程序所用語文：',esc(p.language||'Chinese'))}
    `)}

    ${wsCollapsible('Dates','日期',`
      ${wsRegRow(45,'Patent Grant Date','批予專利日期：',esc(p.grant_date||'—'))}
      ${wsRegRow(43,'Date of First Publication','專利說明書首次發表日期：',esc(p.publication_date||'—'))}
      ${wsRegRow(22,'Filing Date','提交日期：',esc(p.filing_date||'—'))}
    `)}

    ${wsCollapsible('Parties','當事人',`
      ${wsRegRow('71/73','Applicant / Proprietor','申請人/專利權人：',appBlock)}
      ${wsRegRow(72,'Inventor','發明人：',invBlock)}
      ${wsRegRow(74,'Agent','代理人：',agentBlock)}
    `)}

    ${wsCollapsible('Priority','優先權',`
      ${wsRegRow(30,'Priority Date','優先權日期：',esc(p.priority_date||'—'))}
      ${wsRegRow(30,'Priority Country','優先權國家：',esc(p.priority_country||'—'))}
      ${wsRegRow(30,'Priority Application No.','優先權申請編號：',`<span style="font-family:'IBM Plex Mono',monospace;font-size:.8rem">${esc(p.priority_app_number||'—')}</span>`)}
    `, !!(p.priority_date||p.priority_country))}

    ${wsCollapsible('Renewal','續期',`
      ${wsRegRow('','Next Renewal Due Date','下次續期到期日期：',esc(p.renewal_due_date||'—'))}
    `, !!p.renewal_due_date)}
  `;
}

function wsRenderRefList(){
  const refs=wsGetRefs();
  const box=document.getElementById('wsRefList');
  if(!refs.length){
    box.innerHTML=`<div style="text-align:center;padding:48px;color:var(--muted)"><div style="font-size:1.8rem;margin-bottom:10px">📚</div><p>No references yet. Add patents while browsing.</p></div>`;
    return;
  }
  box.innerHTML=refs.map(p=>`
    <div class="ws-ref-card">
      <div class="ws-ref-card-hdr">
        <div onclick="event.stopPropagation();wsToggleCmpSelect('${esc(p.patent_number||'')}')"
          style="width:18px;height:18px;border:1.5px solid ${_wsSelected.has(p.patent_number)?'var(--gold)':'var(--border2)'};border-radius:3px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:.6rem;color:${_wsSelected.has(p.patent_number)?'var(--gold)':'transparent'};flex-shrink:0;margin-top:2px;transition:all .15s;background:${_wsSelected.has(p.patent_number)?'rgba(184,134,11,.1)':'none'}">✓</div>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:.63rem;color:var(--muted);background:var(--bg2);border:1px solid var(--border);border-radius:3px;padding:2px 6px;flex-shrink:0">${esc(p.patent_number||'')}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:.85rem;font-weight:600;color:var(--text);margin-bottom:3px;line-height:1.4">${esc(p.title||'Untitled')}</div>
          <div style="font-size:.7rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:3px 10px">
            ${p.assignee?`<span>${esc(p.assignee)}</span>`:''}
            ${p.filing_date?`<span>Filed ${esc(p.filing_date)}</span>`:''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;align-items:center">
          <button onclick="event.stopPropagation();openWorkspace(${JSON.stringify(p).replace(/"/g,'&quot;')})" style="font-size:.7rem;color:var(--gold);background:none;border:none;cursor:pointer;padding:2px 4px">View</button>
          <button onclick="event.stopPropagation();wsRemoveRef('${esc(p.patent_number||'')}')" style="width:20px;height:20px;border:none;background:none;cursor:pointer;color:var(--muted2);font-size:.8rem;border-radius:3px">×</button>
        </div>
      </div>
      ${p.abstract?`<div style="padding:0 14px 12px;font-size:.76rem;color:#666;line-height:1.65;border-top:1px solid var(--border);padding-top:10px;display:none" id="wsra_${esc(p.patent_number||'').replace(/[^a-z0-9]/gi,'')}">${esc((p.abstract||'').slice(0,280))}${p.abstract.length>280?'…':''}</div>`:''}
    </div>
  `).join('');
}

function wsToggleCmpSelect(pn){
  if(_wsSelected.has(pn)) _wsSelected.delete(pn);
  else{ if(_wsSelected.size>=5){alert('Max 5 patents');return;} _wsSelected.add(pn); }
  wsRenderRefList();
}

function wsSelectAll(){
  const refs=wsGetRefs();
  if(_wsSelected.size===refs.length) _wsSelected.clear();
  else refs.forEach(p=>_wsSelected.add(p.patent_number));
  wsRenderRefList();
}

async function wsAICompare(){
  const refs=wsGetRefs();
  const sel=refs.filter(p=>_wsSelected.has(p.patent_number));
  if(sel.length<2){alert('Select at least 2 patents (use the checkboxes)');return;}
  switchWsTab('compare');
  const box=document.getElementById('wsCompareContent');
  const fields=['patent_number','title','assignee','filing_date','grant_date','ipc','patent_type','status'];
  const labels={'patent_number':'Patent No.','title':'Title','assignee':'Assignee','filing_date':'Filing Date','grant_date':'Grant Date','ipc':'IPC Class','patent_type':'Type','status':'Status'};
  const tableHtml=`<div style="overflow-x:auto;margin-bottom:16px"><table class="ws-cmp-table">
    <thead><tr><th>Field</th>${sel.map(p=>`<th>${esc(p.patent_number||'')}</th>`).join('')}</tr></thead>
    <tbody>${fields.map(f=>`<tr><td style="font-weight:600;background:var(--bg2);white-space:nowrap;font-size:.75rem">${labels[f]||f}</td>${sel.map(p=>`<td>${esc(p[f]||'—')}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
  box.innerHTML=tableHtml+`<div class="ai-loading show" id="wsCmpLoad"><div class="spinner"></div><p>AI comparing ${sel.length} patents…</p></div>`;
  try{
    const patStr=sel.map(p=>`Patent: ${p.patent_number}\nTitle: ${p.title}\nAssignee: ${p.assignee||'?'}\nFiled: ${p.filing_date||'?'}\nAbstract: ${(p.abstract||'').slice(0,180)}`).join('\n---\n');
    const raw=await aiGenerate([{role:'user',content:`Compare these ${sel.length} HK patents. ONLY valid JSON:\n\n${patStr}\n\n{"summary":"2 sentence overview","similarities":["s1"],"key_differences":["d1"],"novelty_gaps":["g1"],"recommendation":"strategic tip"}`}],'Patent comparison expert. ONLY valid JSON.',900);
    const d=parseJSON(raw);
    document.getElementById('wsCmpLoad').classList.remove('show');
    box.innerHTML=tableHtml+`<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:18px">
      <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:12px;font-family:'IBM Plex Mono',monospace">AI Feature Analysis</div>
      ${d.summary?`<p style="font-size:.85rem;color:#444;line-height:1.7;margin-bottom:14px">${esc(d.summary)}</p>`:''}
      ${(d.similarities||[]).length?`<div style="margin-bottom:12px"><div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:6px;font-family:'IBM Plex Mono',monospace">Similarities</div><ul style="padding-left:16px">${d.similarities.map(s=>`<li style="font-size:.82rem;color:#444;line-height:1.7;margin-bottom:3px">${esc(s)}</li>`).join('')}</ul></div>`:''}
      ${(d.key_differences||[]).length?`<div style="margin-bottom:12px"><div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:6px;font-family:'IBM Plex Mono',monospace">Key Differences</div><ul style="padding-left:16px">${d.key_differences.map(s=>`<li style="font-size:.82rem;color:#444;line-height:1.7;margin-bottom:3px">${esc(s)}</li>`).join('')}</ul></div>`:''}
      ${(d.novelty_gaps||[]).length?`<div style="background:rgba(184,134,11,.07);border-left:3px solid var(--gold);padding:12px 14px;border-radius:0 6px 6px 0;margin-bottom:12px"><strong style="font-size:.8rem">🔍 Novelty Gaps</strong><br><br>${d.novelty_gaps.map(g=>`<div style="font-size:.82rem;color:#555;line-height:1.7">• ${esc(g)}</div>`).join('')}</div>`:''}
      ${d.recommendation?`<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)"><div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:6px;font-family:'IBM Plex Mono',monospace">Strategic Recommendation</div><p style="font-size:.83rem;color:#444">${esc(d.recommendation)}</p></div>`:''}
    </div>`;
  }catch(e){
    document.getElementById('wsCmpLoad').classList.remove('show');
    box.innerHTML+=`<div style="color:var(--red);font-size:.82rem;margin-top:8px">⚠️ ${esc(e.message)}</div>`;
  }
}

function wsRenderSidebar(){
  const refs=wsGetRefs();
  const sideList=document.getElementById('wsSideRefList');
  if(!refs.length){ sideList.innerHTML=`<p style="font-size:.73rem;color:var(--muted)">No references yet.</p>`; return; }
  sideList.innerHTML=refs.slice(0,5).map(p=>`
    <div style="display:flex;align-items:center;gap:6px;padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="openWorkspace(${JSON.stringify(p).replace(/"/g,'&quot;')})">
      <span style="font-family:'IBM Plex Mono',monospace;font-size:.58rem;color:var(--muted);background:var(--bg2);border:1px solid var(--border);border-radius:3px;padding:1px 4px;flex-shrink:0">${esc(p.patent_number||'')}</span>
      <span style="font-size:.72rem;color:var(--text);flex:1;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.4">${esc(p.title||'')}</span>
      <button onclick="event.stopPropagation();wsRemoveRef('${esc(p.patent_number||'')}')" style="width:16px;height:16px;border:none;background:none;cursor:pointer;color:var(--muted2);font-size:.7rem">×</button>
    </div>
  `).join('')+(refs.length>5?`<div style="font-size:.7rem;color:var(--muted);padding-top:5px">+${refs.length-5} more</div>`:'');
}

function wsRenderTrends(){
  const refs=wsGetRefs();
  const all=refs.length?refs:(_wsPatent?[_wsPatent]:[]);
  if(!all.length){ document.getElementById('wsTrendsContent').innerHTML=`<div style="text-align:center;padding:48px;color:var(--muted)">Add patents to your reference list to see trends.</div>`; return; }
  const yearMap={},assMap={},ipcMap={};
  all.forEach(p=>{
    const m=String(p.filing_date||'').match(/\b(20\d{2}|19\d{2})\b/);
    if(m) yearMap[m[1]]=(yearMap[m[1]]||0)+1;
    if(p.assignee) assMap[p.assignee]=(assMap[p.assignee]||0)+1;
    if(p.ipc){ const code=p.ipc.split('|')[0].trim().split(' ')[0]; ipcMap[code]=(ipcMap[code]||0)+1; }
  });
  const years=Object.keys(yearMap).sort();
  const maxY=Math.max(...Object.values(yearMap),1);
  const topAss=Object.entries(assMap).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const maxA=Math.max(...topAss.map(a=>a[1]),1);
  const topIpc=Object.entries(ipcMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const maxI=Math.max(...topIpc.map(i=>i[1]),1);

  document.getElementById('wsTrendsContent').innerHTML=`
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:16px;margin-bottom:14px">
      <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:12px;font-family:'IBM Plex Mono',monospace">Filing Activity by Year</div>
      <div style="display:flex;align-items:flex-end;gap:4px;height:70px;padding-bottom:20px">
        ${years.map(y=>`<div style="flex:1;background:var(--gold);border-radius:2px 2px 0 0;height:${Math.max(4,(yearMap[y]/maxY)*62)}px;opacity:.75;position:relative;cursor:pointer;transition:opacity .15s" title="${y}: ${yearMap[y]}"><span style="position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);font-size:.55rem;color:var(--muted);white-space:nowrap;font-family:'IBM Plex Mono',monospace">${y.slice(2)}</span></div>`).join('')}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:14px">
        <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:10px;font-family:'IBM Plex Mono',monospace">Top Assignees</div>
        ${topAss.map(([n,c])=>`<div class="ws-bar-row"><div class="ws-bar-lbl" title="${esc(n)}">${esc(n.length>14?n.slice(0,12)+'…':n)}</div><div class="ws-bar-track"><div class="ws-bar-fill" style="width:${(c/maxA)*100}%"></div></div><div class="ws-bar-n">${c}</div></div>`).join('')}
      </div>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--r);padding:14px">
        <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:10px;font-family:'IBM Plex Mono',monospace">IPC Classes</div>
        ${topIpc.map(([c,n])=>`<div class="ws-bar-row"><div class="ws-bar-lbl" style="font-family:'IBM Plex Mono',monospace;font-size:.7rem">${esc(c)}</div><div class="ws-bar-track"><div class="ws-bar-fill" style="width:${(n/maxI)*100}%"></div></div><div class="ws-bar-n">${n}</div></div>`).join('')}
      </div>
    </div>
    <div style="font-size:.7rem;color:var(--muted);margin-top:10px">Based on ${all.length} patent${all.length!==1?'s':''} in your reference list.</div>
  `;
}

function wsQuickAction(type){
  if(!_wsPatent) return;
  if(type==='ipd') window.open(`https://esearch.ipd.gov.hk/nis-pos-view/#/pt/details?id=${encodeURIComponent(_wsPatent.patent_number||'')}`, '_blank');
  else if(type==='classify'){ closeWorkspace(); document.getElementById('classifyInput').value=(_wsPatent.title||'')+'. '+(_wsPatent.abstract||'').slice(0,200); switchFeat('classify'); openPanel(); }
  else if(type==='risk'){ closeWorkspace(); document.getElementById('riskInput').value=_wsPatent.abstract||_wsPatent.title||''; switchFeat('risk'); openPanel(); }
  else if(type==='competitor'){ closeWorkspace(); document.getElementById('companyInput').value=_wsPatent.assignee||''; switchFeat('competitor'); openPanel(); runCompetitor(); }
}

function wsExport(){
  if(!_wsPatent) return;
  const p=_wsPatent;
  const refs=wsGetRefs();
  const w=window.open('','_blank');
  const refsHtml=refs.length?`<h2>Reference List (${refs.length})</h2><table border="1" cellpadding="6" style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr><th>Patent No.</th><th>Title</th><th>Assignee</th><th>Filed</th></tr></thead><tbody>${refs.map(r=>`<tr><td>${esc(r.patent_number||'')}</td><td>${esc(r.title||'')}</td><td>${esc(r.assignee||'')}</td><td>${esc(r.filing_date||'')}</td></tr>`).join('')}</tbody></table>`:'';
  w.document.write(`<html><head><title>${esc(p.patent_number||'')} — HK Patent</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111;font-size:13px}h1{font-size:17px}h2{font-size:14px;margin-top:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px;text-align:left;font-size:11px}th{background:#f5f5f5}.meta{font-size:12px;color:#666;margin:6px 0 16px}</style></head><body><h1>${esc(p.title||'')}</h1><div class="meta">${esc(p.patent_number||'')} · Filed: ${esc(p.filing_date||'—')} · ${esc(p.assignee||'')}</div><h2>Abstract</h2><p>${esc(p.abstract||'—')}</p><h2>Details</h2><table><tr><th>Field</th><th>Value</th></tr><tr><td>IPC</td><td>${esc(p.ipc||'—')}</td></tr><tr><td>Status</td><td>${esc(p.status||'—')}</td></tr><tr><td>Grant Date</td><td>${esc(p.grant_date||'—')}</td></tr><tr><td>Priority</td><td>${esc(p.priority_date||'—')} ${esc(p.priority_country||'')}</td></tr><tr><td>Agent</td><td>${esc(p.agent||'—')}</td></tr></table>${refsHtml}</body></html>`);
  w.document.close(); w.focus(); w.print();
}


// ═══════════════════════════════════════════════════════════════════════
// STRATEGIC PROMPTS — Patsnap-style deep reasoning prompts for each tool
// ═══════════════════════════════════════════════════════════════════════
const STRATEGIC_PROMPTS = {
  agent: {
    title: 'Agent — Deep R&D Assistant',
    subtitle: 'Autonomy, objective-based reasoning, workflow automation',
    body: `Act as a Senior R&D Intelligence Agent specializing in [Target Industry, e.g., Solid-State Battery Electrolytes]. Your objective is to perform an end-to-end white-space analysis to guide our next three years of laboratory research.

First, conduct a broad search for all patents published globally within the last 36 months that specifically reference [Primary Technology] and [Secondary Component]. I need you to go beyond simple keyword matching; use your semantic understanding to include relevant documents that might use alternative terminology or chemical formulas.

Once you have the data set, apply 'Retrieval-Augmented Thinking' (RAT) to rank these documents based on 'Inventive Step' strength and 'Commercial Potential.' Filter out any utility models or low-quality defensive filings. Identify the top five 'Blind Spots' in the current landscape—areas where consumer demand for [Specific Feature, e.g., fast charging at sub-zero temperatures] is high, but patent density is surprisingly low.

For each identified white-space opportunity, provide a detailed 'Innovation Hypothesis' using TRIZ principles. Suggest a technical path forward that would allow us to file a 'Pioneer Patent' without infringing on the current high-density clusters held by [Competitor A] and [Competitor B].

Finally, format your response as a strategic memo for our Chief Technology Officer. Include a summary of the most influential 'Standard Essential Patents' (SEPs) we must navigate, a list of emerging startups that are filing in this niche, and a recommendation on whether we should 'Build, Buy, or Partner' to secure a dominant position in this specific sub-sector. Cite every claim using the specific Patent Publication Numbers from your search results.`
  },
  landscape: {
    title: 'Landscape — Visualizing Market Strategy',
    subtitle: 'Clustering, market visualization, 3D terrain mapping',
    body: `I want to generate a comprehensive 360-degree Technology Landscape map for the [Global Drone Logistics and Last-Mile Delivery] sector. The goal of this analysis is to visualize the 'competitive topography' to see where the market is oversaturated and where it is 'ripe for disruption.'

Configure the landscape using the last 10 years of global patent data, focusing specifically on IPC codes related to [Aeronautics, Autonomous Navigation, and Battery Management]. In your analysis, I need you to distinguish between 'Core Technologies' (the high-density peaks) and 'Peripheral Innovations' (the surrounding foothills).

Please identify the 'Topographic Hotspots' where [Specific Tech, e.g., Hydrogen Fuel Cell Drones] are currently clustering. Compare this to the 'Desolate Valleys'—areas with less than 50 active patents—and determine if these valleys represent 'Technological Dead-Ends' or 'Untapped Frontiers.'

Use the 'Animated Landscape' feature to explain the evolution of this field from 2018 to 2026. I want to see which companies are 'Migrating' from one cluster to another—for example, are traditional automotive companies moving into the aerial delivery space?

Provide a narrative summary that interprets the map:
• Which 'Patent Thickets' should we avoid due to extreme litigation risk?
• Where are the 'Islands of Innovation' held by single, small inventors that could be prime targets for M&A?
• Based on the current trajectory of the landscape, where will the 'Highest Peak' (most active innovation area) be in 2030? Give me a data-backed prediction based on the acceleration of filings in the most recent 12-month period.`
  },
  risk: {
    title: 'Risk — FTO & Litigation Prevention',
    subtitle: 'Infringement analysis, claim mapping, Freedom to Operate (FTO)',
    body: `Perform a high-stakes 'Freedom to Operate' (FTO) and Intellectual Property Risk Assessment for our upcoming product launch: a [High-Efficiency Heat Pump utilizing R-290 Refrigerant]. This product will be marketed in the [European Union and North America], so your search must prioritize EPO and USPTO jurisdictions.

Your primary task is to identify 'Killer Patents'—active patents with broad independent claims that could reasonably be asserted against a device with [Feature X, Feature Y, and Feature Z]. Use your 'Claim-Level Analysis' engine to map our specific product specifications against the 'Independent Claims' of the top 50 most relevant results. Do not just look at the abstract; I need you to analyze the specific 'Legal Scope' of the claims.

Categorize the identified risks into three levels:
• Red (High Risk): Direct overlap with active, broad claims. Provide the specific patent numbers and highlight the exact claim text that poses the threat.
• Amber (Medium Risk): Patents with pending applications or claims that could be interpreted to cover our tech via the 'Doctrine of Equivalents.'
• Green (Low Risk): Expired patents or those with very narrow, easily-circumvented claims.

For every 'Red' risk identified, suggest a 'Design-Around Strategy.' How could our engineers modify the [Specific Component] to move outside the 'Metes and Bounds' of that patent's protection?

Furthermore, check the 'Litigation History' of the assignees of these high-risk patents. Are they 'Non-Practicing Entities' (NPEs/Patent Trolls) or 'Aggressive Competitors' with a history of filing injunctions? Provide a 'Risk Score' (1-100) for our product launch based on the density of active IP and the litigiousness of the key players in this specific geography.`
  },
  trends: {
    title: 'Trends — Future Forecasting',
    subtitle: 'Temporal growth, IPC/CPC shifts, momentum tracking',
    body: `Conduct a 'Macro-to-Micro' Trend Analysis for the [Personalized Medicine and CRISPR-based Therapeutics] market. I am looking for the 'Signal within the Noise'—the subtle shifts in patenting activity that indicate a major technological pivot.

Start by analyzing the 'Global Filing Velocity' over the last 15 years. Is the field in a 'Maturity Phase,' or are we seeing a second 'Exponential Growth Spur'? Break this down by 'Top Filing Countries.' I want to see if [Country A] is losing its lead to [Country B] in terms of 'High-Value' patent filings (those with high forward citations and large family sizes).

Next, drill down into the 'Sub-Technology Trends.' Are we seeing a shift from 'General Gene Editing' toward 'Tissue-Specific Delivery Systems'? Use the IPC/CPC classification data to show which codes are gaining the most momentum in the last 24 months.

Identify the 'Rising Stars'—academic institutions or small biotech firms that have seen a 200% increase in filings in the last year. What specific 'Problem-Solution' pairs are they focusing on?

Finally, cross-reference these patent trends with 'Non-Patent Literature' (NPL) like clinical trial data and VC funding rounds. If patent filings are increasing but VC funding is slowing down, what does that tell us about the 'Commercial Viability' of this trend? Provide a 'Strategic Forecast' for the next 5 years: which specific niche will become the 'Gold Mine' for IP, and which currently 'Hyped' area is showing signs of a 'Patent Plateau' where innovation is stalling.`
  },
  design: {
    title: 'Design — AI-Assisted R&D & CAD',
    subtitle: 'Generative design, engineering requirements, rapid prototyping',
    body: `Assume the role of a Lead Mechanical Engineer and Design Strategist. We are currently in the conceptual phase of developing a [Next-Generation Modular Electric Vehicle Chassis]. Your objective is to use the 'Design' module to collapse our typical 6-month R&D cycle into a single sprint.

Begin by ingesting our natural language design requirements: The chassis must support a dual-motor configuration, maintain a torsional stiffness of [X], and utilize sustainable composite materials that are at least 20% lighter than current aluminum standards.

Use the 'Generative-Predict-Select' pipeline to iterate through 500 potential structural geometries. For every iteration, perform a real-time behavioral simulation to predict performance loss and structural integrity under high-stress loads. I want you to filter these designs through the lens of 'Patentability'—do not suggest geometries that are already claimed by [Competitor X] or [Competitor Y] in their recent 2024/2025 filings.

Once you have identified the 'Pareto Optimal' design, translate the natural language requirements into structured JSON CAD parameters that can be directly imported into our engineering software. Include a detailed 'Change-Response' analysis: if we were to increase the wheelbase by 15% in the future, how would the AI-driven CAD model automatically adjust the interconnect positions and thermal management routing without requiring manual human intervention?

Finally, provide a 'Design Disclosure' report. This report should describe the unique 'Inventive Step' of our AI-generated design in a way that meets the USPTO's non-obviousness criteria. Contrast our proposed design against the 'Prior Art' found in the database, explaining why our specific material distribution and geometric interlocking system represents a significant technical advancement over the current state of the art.`
  },
  classify: {
    title: 'Classify — Intelligent Portfolio Tagging',
    subtitle: 'Automated categorization, AI tagging, ontology management',
    body: `Act as an Intellectual Property Portfolio Manager for a global conglomerate with over 10,000 active patents. We are struggling with 'Data Silos' and inconsistent manual tagging. Your mission is to use the 'Classify' tool to create a unified, AI-driven taxonomy for our entire IP estate.

First, ingest a training set of 100 patents that we have manually categorized into our core business units: [Energy Storage, Wireless Sensing, and Material Science]. Analyze the semantic patterns, CPC codes, and keyword clusters within these gold-standard examples.

Now, extend this logic to the remaining 9,900 patents in the portfolio. I need you to go beyond standard IPC/CPC codes. Create a custom 'Functional Ontology' that tags patents based on their 'Utility' rather than just their technical field. For example, classify patents by 'Low-Power Consumption,' 'High-Temperature Resilience,' or 'Modular Scalability.'

During this classification process, identify 'Orphan Patents'—those that do not fit into our current strategic pillars. Analyze these orphans to see if they form a new, unrecognized cluster that could represent a 'Pivot Opportunity' for the company.

Provide a summary report of the classification results. Include a 'Tagging Confidence' score for each category. If the AI is less than 80% confident in a classification, flag it for 'Human-in-the-Loop' review. Furthermore, compare our internal classification distribution against the top 3 competitors in the market. Are they classifying more patents under 'Sustainability' tags while we are still focused on 'Legacy Efficiency'? Give me a visual representation of the 'Classification Gap' between our strategy and the market's current trajectory.`
  },
  competitor: {
    title: 'Competitor — Rival Benchmarking & Intelligence',
    subtitle: 'Benchmarking, M&A targeting, rivalry tracking',
    body: `Act as a Corporate Strategy and Competitive Intelligence Lead. We need a deep-dive forensic analysis of [Competitor Name]'s R&D trajectory to determine if they are preparing to exit the [Market A] space and pivot toward [Market B].

Use the 'Competitor' module to benchmark [Competitor Name] against our own portfolio across four key dimensions:

1. Innovation Momentum: Compare the filing velocity of both companies over the last 24 months. Who is accelerating their research in [Emerging Tech]?

2. Portfolio Quality: Use 'Forward Citation' counts and 'Geographic Coverage' to determine which company holds more 'High-Value' assets. A company with 50 high-impact patents is more dangerous than one with 500 low-quality filings.

3. Talent Migration: Analyze the 'Key Inventor' data. Have any of their top 5 inventors recently stopped filing for them? Check if those inventors are now filing for startups or academic institutions, which could signal a brain drain.

4. Collaboration Networks: Identify who their primary co-assignees are. Are they increasingly partnering with software companies, suggesting a move toward 'Software-as-a-Medical-Device' (SaMD)?

Beyond the benchmarking, identify their 'Vulnerable Points.' Find areas where their patents are nearing expiration or where their 'Claims' are so narrow that we can easily design around them.

Finally, identify three 'M&A Targets' for us. These should be small, agile companies or startups whose patent portfolios would 'Plug the Gap' in our current competition with [Competitor Name]. Explain exactly how acquiring [Target Company X] would create a 'Patent Shield' against [Competitor Name]'s most aggressive litigation threats.`
  },
  blueprint: {
    title: 'Blueprint — Roadmap & Strategy Execution',
    subtitle: 'High-level roadmapping, R&D alignment, executive planning',
    body: `Assume the role of the Chief Innovation Officer. We need to develop a 5-year 'Innovation Blueprint' for our [Hydrogen Fuel Cell] division that aligns our R&D efforts with global regulatory shifts and competitor movements.

First, use the Blueprint tool to integrate three distinct data streams: current global patent filings, the latest peer-reviewed scientific literature from Synapse, and the most recent [Country/Region] government policy announcements regarding 'Green Hydrogen' subsidies.

Based on this data, construct a temporal roadmap. In Year 1, what 'Foundation Technologies' must we secure? In Year 3, which 'Integration Milestones' (like solid-state storage or high-pressure valves) will become the primary competitive bottlenecks?

Your blueprint must address 'Resource Allocation.' Based on the 'Trends' and 'Landscape' data we've already gathered, should we divert 20% of our budget from 'Alkaline Electrolysis' into 'Anion Exchange Membranes'? Justify this shift by showing the 'Investment Heatmap' of Venture Capital firms in this space—if the money is moving to AEM, our blueprint should reflect that.

Identify the 'Critical Path' for our IP strategy. Which specific patents must be granted for our blueprint to remain viable? If those patents are rejected, what is our 'Contingency Blueprint'?

Conclude by generating an 'Executive Briefing' that summarizes the entire 5-year plan on a single page. It should include a 'Risk vs. Reward' matrix for each major technological milestone and a list of 'Key Performance Indicators' (KPIs) that our R&D team can use to track their progress against the blueprint every quarter. Ensure the blueprint is 'Living'—explain how it will automatically update when a major competitor files a 'Disruptive Patent' in our core area.`
  }
};

// Which panels have a textarea we can fill vs. need a modal preview
const STRATEGIC_PROMPT_TARGETS = {
  classify: 'classifyInput',
  risk:     'riskInput',
  agent:    'agentInput',
  design:   'designInput'
};

function showStrategicPrompt(feat){
  const p = STRATEGIC_PROMPTS[feat];
  if(!p) return;
  const targetId = STRATEGIC_PROMPT_TARGETS[feat];

  // Remove any existing modal
  const existing = document.getElementById('spModal');
  if(existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'spModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,sans-serif';
  modal.innerHTML = `
    <div style="background:var(--card,#fff);border:1px solid var(--border,#ddd);border-radius:12px;max-width:720px;width:100%;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)">
      <div style="padding:20px 24px;border-bottom:1px solid var(--border,#eee);display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div>
          <div style="font-family:'Playfair Display',serif;font-size:1.25rem;font-weight:700;color:var(--text,#111);margin-bottom:4px">${esc(p.title)}</div>
          <div style="font-size:.75rem;color:var(--muted,#666);text-transform:uppercase;letter-spacing:.5px;font-family:'IBM Plex Mono',monospace">${esc(p.subtitle)}</div>
        </div>
        <button id="spClose" style="background:none;border:none;font-size:1.6rem;cursor:pointer;color:var(--muted,#666);line-height:1;padding:0 4px">×</button>
      </div>
      <div style="padding:20px 24px;overflow-y:auto;flex:1">
        <pre id="spBody" style="white-space:pre-wrap;word-wrap:break-word;font-family:'Inter',sans-serif;font-size:.85rem;line-height:1.6;color:var(--text,#222);margin:0;background:var(--bg2,#f8f6f1);padding:16px;border-radius:8px;border:1px solid var(--border,#eee)">${esc(p.body)}</pre>
        <p style="font-size:.72rem;color:var(--muted,#888);margin-top:12px;font-style:italic">💡 Replace bracketed placeholders like [Target Industry] with your specifics before using.</p>
      </div>
      <div style="padding:16px 24px;border-top:1px solid var(--border,#eee);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button id="spCopy" style="padding:8px 16px;border:1px solid var(--border2,#ccc);background:none;border-radius:6px;font-size:.8rem;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">📋 Copy</button>
        ${targetId ? `<button id="spLoad" style="padding:8px 16px;border:none;background:var(--text,#111);color:var(--bg,#fff);border-radius:6px;font-size:.8rem;font-weight:600;cursor:pointer;font-family:Inter,sans-serif">↓ Load into Input</button>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.addEventListener('click', e => { if(e.target === modal) closeModal(); });
  document.getElementById('spClose').addEventListener('click', closeModal);

  document.getElementById('spCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(p.body);
      const btn = document.getElementById('spCopy');
      const orig = btn.textContent;
      btn.textContent = '✓ Copied';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    } catch {
      alert('Copy failed. Select the text manually.');
    }
  });

  if(targetId){
    document.getElementById('spLoad').addEventListener('click', () => {
      const el = document.getElementById(targetId);
      if(el){ el.value = p.body; el.focus(); }
      closeModal();
    });
  }
}

// Wire up all 8 strategic prompt buttons
['blueprint','classify','trends','risk','competitor','agent','landscape','design'].forEach(feat => {
  const btn = document.getElementById(feat + 'PromptBtn');
  if(btn) btn.addEventListener('click', () => showStrategicPrompt(feat));
});


// ═══════════════════════════════════════════════════════════════
// AI SEARCH PIPELINE (the "Hiro" / "Kairo" experience)
// Append this to static/app.js — it's self-contained.
// ═══════════════════════════════════════════════════════════════

const AI_STEPS = [
  { id: 'analyze',  label: 'Analyzing your invention',     detail: 'Extracting keywords and technical field' },
  { id: 'keyword',  label: 'Keyword search',               detail: 'Searching 200,798 HK patents' },
  { id: 'semantic', label: 'Semantic search',              detail: 'Finding conceptually related patents' },
  { id: 'merge',    label: 'Merging candidates',           detail: 'Deduplicating and ranking' },
  { id: 'judge',    label: 'AI relevance judgement',       detail: 'Gemini scores the top matches' },
];

let _aiState = {};

function openAiSearch() {
  const modal = document.getElementById('aiSearchModal');
  if (!modal) return;
  modal.style.display = 'flex';
  document.getElementById('aiDescInput').focus();
  _resetAiPipeline();
}

function closeAiSearch() {
  const modal = document.getElementById('aiSearchModal');
  if (modal) modal.style.display = 'none';
}

function _resetAiPipeline() {
  _aiState = { description: '', analysis: null, candidates: [], judgements: [], tStart: 0 };
  const stagesEl = document.getElementById('aiStages');
  if (!stagesEl) return;
  stagesEl.innerHTML = AI_STEPS.map((s, i) => `
    <div class="ai-stage" id="ai-stage-${s.id}" data-i="${i + 1}">
      <div class="ai-stage-dot"><span class="num">${i + 1}</span><span class="check" style="display:none">✓</span><span class="spin" style="display:none"></span></div>
      <div class="ai-stage-body">
        <div class="ai-stage-label">${s.label}</div>
        <div class="ai-stage-detail">${s.detail}</div>
      </div>
      <div class="ai-stage-meta"></div>
    </div>`).join('');
  document.getElementById('aiResults').innerHTML = '';
  document.getElementById('aiSummary').style.display = 'none';
  document.getElementById('aiSubmit').disabled = false;
  document.getElementById('aiSubmit').textContent = '✨ Run AI analysis';
}

function _setStage(id, status, meta) {
  const el = document.getElementById(`ai-stage-${id}`);
  if (!el) return;
  const dot = el.querySelector('.ai-stage-dot');
  el.classList.remove('pending', 'active', 'done', 'error');
  el.classList.add(status);
  dot.querySelector('.num').style.display   = (status === 'pending') ? '' : 'none';
  dot.querySelector('.spin').style.display  = (status === 'active')  ? '' : 'none';
  dot.querySelector('.check').style.display = (status === 'done')    ? '' : 'none';
  if (meta !== undefined) el.querySelector('.ai-stage-meta').textContent = meta;
}

async function runAiSearch() {
  const desc = document.getElementById('aiDescInput').value.trim();
  if (!desc || desc.length < 15) {
    alert('Please describe your invention in at least a sentence or two.');
    return;
  }
  _aiState.description = desc;
  _aiState.tStart = Date.now();

  const btn = document.getElementById('aiSubmit');
  btn.disabled = true; btn.textContent = 'Running…';

  // Mark all pending
  AI_STEPS.forEach(s => _setStage(s.id, 'pending'));

  try {
    // Step 1 — analyze
    _setStage('analyze', 'active');
    const analysis = await fetch('/api/ai-search/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: desc }),
    }).then(r => r.json());
    _aiState.analysis = analysis;
    const kwCount = (analysis.keywords || []).length;
    const qCount  = (analysis.search_queries || []).length;
    _setStage('analyze', 'done', `${kwCount} keywords · ${qCount} queries · ${(analysis.ipc_codes || []).length} IPC hints`);

    // Step 2 — keyword search (run each query, merge)
    _setStage('keyword', 'active');
    const queries = analysis.search_queries || [analysis.keywords?.slice(0, 3).join(' ')].filter(Boolean);
    const kwResults = new Map();
    for (const q of queries.slice(0, 5)) {
      const r = await fetch('/api/search?q=' + encodeURIComponent(q)).then(x => x.json());
      (r.results || []).forEach(p => { if (!kwResults.has(p.patent_number)) kwResults.set(p.patent_number, p); });
    }
    _setStage('keyword', 'done', `${kwResults.size} candidates found`);

    // Step 3 — semantic rerank using the full description
    _setStage('semantic', 'active');
    const semRes = await fetch('/api/semantic-search?q=' + encodeURIComponent(desc) + '&limit=50').then(r => r.json());
    const semMap = new Map();
    (semRes.results || []).forEach(p => semMap.set(p.patent_number, p._similarity || 0));
    _setStage('semantic', 'done', `${semMap.size} semantic matches`);

    // Step 4 — merge & score
    _setStage('merge', 'active');
    const merged = [];
    // Combine everything kw found + everything semantic found
    const allPns = new Set([...kwResults.keys(), ...semMap.keys()]);
    for (const pn of allPns) {
      const patent = kwResults.get(pn) || (semRes.results || []).find(p => p.patent_number === pn);
      if (!patent) continue;
      const semScore = semMap.get(pn) || 0;
      const kwHit    = kwResults.has(pn) ? 1 : 0;
      // Combined score: semantic similarity weighted heavier, keyword presence as bonus
      patent._combined = semScore * 0.7 + kwHit * 30;
      merged.push(patent);
    }
    merged.sort((a, b) => b._combined - a._combined);
    _aiState.candidates = merged.slice(0, 20);
    _setStage('merge', 'done', `${merged.length} unique · top 20 sent to AI`);

    // Step 5 — Gemini judgement
    _setStage('judge', 'active');
    const judged = await fetch('/api/ai-search/judge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        description: desc,
        candidates: _aiState.candidates.map(c => ({
          patent_number: c.patent_number,
          title: c.title,
          abstract: c.abstract,
        })),
      }),
    }).then(r => r.json());
    _aiState.judgements = judged.judgements || [];
    const avgRel = _aiState.judgements.length
      ? Math.round(_aiState.judgements.reduce((s, j) => s + (j.relevance || 0), 0) / _aiState.judgements.length)
      : 0;
    _setStage('judge', 'done', `${_aiState.judgements.length} patents rated · avg relevance ${avgRel}`);

    _renderAiResults();
  } catch (err) {
    console.error(err);
    const running = document.querySelector('.ai-stage.active');
    if (running) {
      const id = running.id.replace('ai-stage-', '');
      _setStage(id, 'error', 'Failed: ' + (err.message || err));
    }
    btn.disabled = false; btn.textContent = '↻ Retry';
  }
}

function _renderAiResults() {
  const dt = ((Date.now() - _aiState.tStart) / 1000).toFixed(1);
  const summ = document.getElementById('aiSummary');
  summ.style.display = 'block';
  summ.innerHTML = `
    <div style="display:flex;gap:24px;padding:16px;background:var(--panel, #fafafa);border-radius:8px;margin-bottom:16px">
      <div><div style="font-size:1.4rem;font-weight:700">${_aiState.judgements.length}</div>
           <div style="font-size:.7rem;color:var(--muted)">Patents analyzed</div></div>
      <div><div style="font-size:1.4rem;font-weight:700">${dt}s</div>
           <div style="font-size:.7rem;color:var(--muted)">Time spent</div></div>
      <div><div style="font-size:1.4rem;font-weight:700;color:#0a8556">~7 hrs</div>
           <div style="font-size:.7rem;color:var(--muted)">Time saved vs manual</div></div>
    </div>`;

  // Merge judgement reasons back into candidates, sort by relevance
  const jMap = new Map(_aiState.judgements.map(j => [j.patent_number, j]));
  const ranked = _aiState.candidates
    .map(c => ({ ...c, _j: jMap.get(c.patent_number) || { relevance: 0, reason: '' } }))
    .sort((a, b) => b._j.relevance - a._j.relevance);

  const html = ranked.map(p => {
    const score = p._j.relevance || 0;
    const color = score >= 70 ? '#d13b3b' : score >= 40 ? '#d18f00' : '#6b7076';
    const bar   = Math.max(2, score);
    return `
      <div style="padding:14px 16px;border:1px solid var(--border2);border-radius:8px;margin-bottom:10px;background:var(--bg2)">
        <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:6px">
          <div style="flex:1">
            <div style="font-weight:600;font-size:.95rem">${p.title || p.patent_number}</div>
            <div style="font-size:.72rem;color:var(--muted);margin-top:2px">${p.patent_number}${p.assignee ? ' · ' + p.assignee : ''}</div>
          </div>
          <div style="text-align:right;min-width:70px">
            <div style="font-size:1.15rem;font-weight:700;color:${color}">${score}</div>
            <div style="font-size:.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:.03em">relevance</div>
          </div>
        </div>
        <div style="height:3px;background:var(--border2);border-radius:2px;margin:4px 0 10px">
          <div style="height:100%;width:${bar}%;background:${color};border-radius:2px"></div>
        </div>
        ${p._j.reason ? `<div style="font-size:.78rem;color:var(--text);line-height:1.5">${p._j.reason}</div>` : ''}
      </div>`;
  }).join('');
  document.getElementById('aiResults').innerHTML = html;

  const btn = document.getElementById('aiSubmit');
  btn.disabled = false; btn.textContent = '↻ Run again with new description';
}

// Keyboard shortcut: Ctrl+K or Cmd+K
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openAiSearch(); }
  if (e.key === 'Escape') closeAiSearch();
});

