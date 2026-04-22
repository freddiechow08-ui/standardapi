// ═══════════════════════════════
// SEARCH MODE (3-WAY: Keyword / Semantic / Visual)
// Replaces the existing section around line 159-180 in app.js
// ═══════════════════════════════
let _searchMode = 'keyword'; // 'keyword' | 'semantic' | 'visual'
let _visualQueryImage = null; // holds the uploaded File while in visual mode

const MODE_CONFIG = {
  keyword: {
    label:       '🔤 Keyword',
    placeholder: 'e.g. gear motor, TechHK Ltd, Chan Tai Man …',
  },
  semantic: {
    label:       '🧠 Semantic',
    placeholder: 'Describe what you\'re looking for… e.g. "device that helps people walk"',
  },
  visual: {
    label:       '🖼️ Visual',
    placeholder: 'Describe a shape or drop an image… e.g. "gear mechanism" or drag a blueprint here',
  },
};

function _applySearchMode() {
  const btn = document.getElementById('searchModeBtn');
  const inp = document.getElementById('searchInput');
  const cfg = MODE_CONFIG[_searchMode];
  btn.textContent = cfg.label;
  inp.placeholder = cfg.placeholder;

  // Visual mode gets the accent styling; others match original look
  if (_searchMode !== 'keyword') {
    btn.style.background   = 'var(--text)';
    btn.style.color        = 'var(--bg)';
    btn.style.borderColor  = 'var(--text)';
  } else {
    btn.style.background   = 'none';
    btn.style.color        = 'var(--muted)';
    btn.style.borderColor  = 'var(--border2)';
  }

  // Show / hide the image upload controls next to the search box
  const upWrap = document.getElementById('visualUploadWrap');
  if (upWrap) upWrap.style.display = (_searchMode === 'visual') ? 'inline-flex' : 'none';

  // Clear staged image when leaving visual mode
  if (_searchMode !== 'visual') _clearVisualImage();
}

function toggleSearchMode() {
  // Cycle: keyword -> semantic -> visual -> keyword
  _searchMode = (_searchMode === 'keyword')  ? 'semantic'
              : (_searchMode === 'semantic') ? 'visual'
                                             : 'keyword';
  _applySearchMode();
}

// Initial paint
_applySearchMode();


// ═══════════════════════════════
// VISUAL SEARCH: image upload + drag/drop
// ═══════════════════════════════
function _onVisualFilePicked(file) {
  if (!file || !file.type.startsWith('image/')) return;
  _visualQueryImage = file;
  // Switch to visual mode automatically if user dropped an image
  if (_searchMode !== 'visual') { _searchMode = 'visual'; _applySearchMode(); }
  const prev = document.getElementById('visualPreview');
  if (prev) {
    const url = URL.createObjectURL(file);
    prev.innerHTML = `<img src="${url}" alt="query" style="height:32px;width:32px;object-fit:cover;border-radius:6px;border:1px solid var(--border2)"> <span style="font-size:.7rem;color:var(--muted)">${file.name}</span> <button onclick="_clearVisualImage()" style="border:none;background:none;cursor:pointer;color:var(--muted);font-size:.9rem">✕</button>`;
    prev.style.display = 'inline-flex';
  }
}

function _clearVisualImage() {
  _visualQueryImage = null;
  const prev = document.getElementById('visualPreview');
  if (prev) { prev.innerHTML = ''; prev.style.display = 'none'; }
  const inp = document.getElementById('visualFileInput');
  if (inp) inp.value = '';
}

// Wire up the hidden <input type="file"> and a drop zone (the search input itself)
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('visualFileInput');
  if (fileInput) {
    fileInput.addEventListener('change', e => _onVisualFilePicked(e.target.files[0]));
  }

  // Drag & drop anywhere on the search input
  const searchBox = document.getElementById('searchInput');
  if (searchBox) {
    ['dragenter','dragover'].forEach(ev =>
      searchBox.addEventListener(ev, e => { e.preventDefault(); searchBox.style.borderColor = 'var(--accent)'; }));
    ['dragleave','drop'].forEach(ev =>
      searchBox.addEventListener(ev, e => { e.preventDefault(); searchBox.style.borderColor = ''; }));
    searchBox.addEventListener('drop', e => {
      const f = e.dataTransfer?.files?.[0];
      if (f) _onVisualFilePicked(f);
    });
    // Also accept pasted images
    searchBox.addEventListener('paste', e => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith('image/')) {
          _onVisualFilePicked(it.getAsFile());
          e.preventDefault();
          break;
        }
      }
    });
  }
});


// ═══════════════════════════════
// doSearch() — replaces the existing function (around line 270)
// ═══════════════════════════════
function doSearch() {
  const q = document.getElementById('searchInput').value.trim();

  // Visual-image branch: no text required if a file is staged
  if (_searchMode === 'visual' && _visualQueryImage) {
    _q = q || `[image: ${_visualQueryImage.name}]`;
    _addRecent(_q);
    document.getElementById('taBox').style.display = 'none';
    const sb = document.getElementById('statusBar'), ra = document.getElementById('resultsArea');
    sb.innerHTML = '<div class="spinner"></div> Visual search…'; ra.innerHTML = '';

    const fd = new FormData();
    fd.append('image', _visualQueryImage);

    fetch('/api/blueprint-search', { method: 'POST', body: fd })
      .then(r => r.json())
      .then(_handleSearchResponse)
      .catch(_handleSearchError);
    return;
  }

  // All other modes require text
  if (!q) return;
  _q = q; _addRecent(q);
  document.getElementById('taBox').style.display = 'none';
  const sb = document.getElementById('statusBar'), ra = document.getElementById('resultsArea');
  sb.innerHTML = '<div class="spinner"></div> Searching…'; ra.innerHTML = '';

  let url;
  if (_searchMode === 'visual')        url = '/api/blueprint-search?q=' + encodeURIComponent(q);
  else if (_searchMode === 'semantic') url = '/api/semantic-search?q='  + encodeURIComponent(q);
  else                                 url = '/api/search?q='           + encodeURIComponent(q);

  fetch(url).then(r => r.json()).then(_handleSearchResponse).catch(_handleSearchError);
}

function _handleSearchResponse(d) {
  // Normalize: blueprint-search returns 'similarity', other endpoints return '_similarity'
  (d.results || []).forEach(r => {
    if (r.similarity != null && r._similarity == null) r._similarity = r.similarity;
  });
  _allRes = d.results || [];
  _syncYearRange(_allRes);
  _buildAss(_allRes);
  document.getElementById('filterSidebar').classList.add('show');
  document.getElementById('resultsInner').classList.add('has-sidebar');
  _render();
}

function _handleSearchError() {
  document.getElementById('statusBar').textContent = '';
  document.getElementById('resultsArea').innerHTML =
    '<div class="state-msg"><div class="ico">⚠️</div><h3>Cannot connect</h3><p>Run <code>python app.py</code> first</p></div>';
}
