/**
 * ZipTree — app.js (Universal libarchivejs version)
 */

'use strict';

/* ===========================
   State
   =========================== */

let treeData = null;
let fileName = '';
let charMode = 'unicode';

const CHARS = {
  unicode: { PIPE: '│   ', TEE: '├── ', ELB: '└── ', BLANK: '    ' },
  ascii:   { PIPE: '|   ', TEE: '|-- ', ELB: '`-- ', BLANK: '    ' },
};

/* ===========================
   Element refs
   =========================== */

const $  = id => document.getElementById(id);
const dz = $('dropzone');

/* ===========================
   Format detection
   =========================== */

function detectFormat(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.match(/\.(tar\.gz|tgz|gz)$/)) return 'gz';
  if (lower.match(/\.(tar\.bz2|tbz2|bz2)$/)) return 'bz2';
  if (lower.match(/\.(tar\.xz|txz|xz)$/)) return 'xz';
  if (lower.endsWith('.tar')) return 'tar';
  if (lower.endsWith('.rar')) return 'rar';
  if (lower.endsWith('.7z')) return '7z';
  return 'archive'; // Generic fallback
}

function formatLabel(fmt) {
  const map = { zip: 'ZIP', tar: 'TAR', gz: 'TAR.GZ', bz2: 'TAR.BZ2', xz: 'TAR.XZ', rar: 'RAR', '7z': '7-ZIP', archive: 'ARCHIVE' };
  return map[fmt] || fmt.toUpperCase();
}

/* ===========================
   Logic & Tree (Bleibt weitgehend gleich)
   =========================== */

function getIgnored() {
  const patterns = [];
  if ($('ig-nm').checked)   patterns.push('node_modules');
  if ($('ig-git').checked)  patterns.push('.git');
  if ($('ig-ds').checked)   patterns.push('.DS_Store');
  if ($('ig-py').checked)   patterns.push('__pycache__');
  if ($('ig-idea').checked) patterns.push('.idea');
  if ($('ig-vsc').checked)  patterns.push('.vscode');
  return patterns;
}

function isIgnored(part, ignored) {
  return ignored.some(p => part === p || part.startsWith(p + '/'));
}

function makeNode(name) {
  return { name, children: {}, files: [], isDir: true };
}

function insertPath(root, path, isDir, size) {
  const ignored = getIgnored();
  const parts = path.split('/').filter(Boolean);
  
  if (parts.some(p => isIgnored(p, ignored))) return;

  let node = root;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;

    if (!isLast || (isLast && isDir)) {
      if (!node.children[part]) {
        node.children[part] = makeNode(part);
      }
      node = node.children[part];
    } else {
      // Es ist eine Datei
      node.files.push({ name: part, size: size || 0 });
    }
  }
}

/* ===========================
   UNIVERSAL PARSER (libarchive.js)
   =========================== */

async function parseWithLibarchive(file) {
  if (typeof Archive === 'undefined') {
    throw new Error('libarchive.js not loaded. Check your script tags.');
  }

  // Initialisierung (Pfade zu den Build-Dateien anpassen!)
  Archive.init({ 
    workerUrl: 'lib/worker-bundle.js' 
  });

  const archive = await Archive.open(file);
  // Wir nutzen getFilesArray für eine flache Liste aller Pfade
  const entries = await archive.getFilesArray();
  const root = makeNode('');

  entries.forEach(entry => {
    // libarchivejs liefert File-Objekte. Wenn size 0 ist und Pfad auf / endet -> Directory
    const isDir = entry.file.size === 0 && entry.path.endsWith('/');
    insertPath(root, entry.path, isDir, entry.file.size || 0);
  });

  return root;
}

/* ===========================
   Main file processor (Umschreibung auf Universal)
   =========================== */

async function processFile(file) {
  if (!file) return;

  hideError();
  fileName = file.name;
  const fmt = detectFormat(fileName);

  $('file-name-chip').textContent = fileName;
  showProgress(`Opening ${formatLabel(fmt)}…`, 20);

  try {
    // Hier nutzen wir jetzt NUR NOCH libarchivejs für alles
    showProgress('Reading archive structure…', 50);
    const root = await parseWithLibarchive(file);

    treeData = root;

    const counts = countEntries(root);
    $('stats-label').textContent = `${counts.files} files · ${counts.dirs} folders`;
    setFormatBadge(fmt);

    showProgress('Rendering…', 90);

    setTimeout(() => {
      hideProgress();
      dz.classList.add('hidden');
      $('output-area').classList.add('active');
      $('reset-btn').style.display = 'block';
      redraw();
    }, 200);

  } catch (err) {
    hideProgress();
    console.error('Archive Error:', err);
    showError(err.message || 'Error reading archive. Is it encrypted or corrupted?');
  }
}

/* ===========================
   UI & Helpers (Unverändert)
   =========================== */

function getIcon(name, isDir) {
  if (!$('tog-icons').checked) return '';
  if (isDir) return '📁 ';
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    js:'📜', ts:'📜', jsx:'⚛️', tsx:'⚛️', py:'🐍', html:'🌐', css:'🎨', 
    json:'📋', yaml:'⚙️', md:'📄', png:'🖼️', zip:'📦', tar:'📦', rar:'📦', '7z':'📦'
  };
  return (map[ext] || '📄') + ' ';
}

function getColorClass(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['png','jpg','svg','gif'].includes(ext)) return 'c-img';
  if (['js','ts','py','html','css'].includes(ext)) return 'c-code';
  return 'c-file';
}

function fmtSize(bytes) {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderNode(node, opts, prefix, depth) {
  const { maxDepth, dirsFirst, flatEmpty, showSize, chars } = opts;
  const { PIPE, TEE, ELB, BLANK } = chars;

  if (maxDepth > 0 && depth >= maxDepth) return '';

  let html = '';
  const dirs  = Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  const items = dirsFirst ? [...dirs, ...files] : [...dirs, ...files].sort((a, b) => a.name.localeCompare(b.name));

  items.forEach((item, i) => {
    const isLast = i === items.length - 1;
    const connector = isLast ? ELB : TEE;
    const childPrefix = prefix + (isLast ? BLANK : PIPE);

    if (item.isDir) {
      let displayName = item.name + '/';
      let renderTarget = item;
      if (flatEmpty) {
        let cur = item;
        let chain = item.name;
        while (Object.keys(cur.children).length === 1 && cur.files.length === 0) {
          const child = Object.values(cur.children)[0];
          if (!child.isDir) break;
          chain += '/' + child.name;
          cur = child;
        }
        displayName = chain + '/';
        renderTarget = cur;
      }
      const icon = getIcon(item.name, true);
      html += `<span class="c-pipe">${escHtml(prefix + connector)}</span><span class="c-folder">${icon}${escHtml(displayName)}</span>\n`;
      html += renderNode(renderTarget, opts, childPrefix, depth + 1);
    } else {
      const icon = getIcon(item.name, false);
      const cls = getColorClass(item.name);
      const sizeStr = showSize && item.size ? fmtSize(item.size) : '';
      const sizeHtml = sizeStr ? ` <span class="c-size">(${sizeStr})</span>` : '';
      html += `<span class="c-pipe">${escHtml(prefix + connector)}</span><span class="${cls}">${icon}${escHtml(item.name)}</span>${sizeHtml}\n`;
    }
  });
  return html;
}

function redraw() {
  if (!treeData) return;
  const opts = {
    maxDepth: parseInt($('depth-slider').value) || 0,
    dirsFirst: $('tog-dirf').checked,
    flatEmpty: $('tog-flat').checked,
    showSize: $('tog-sizes').checked,
    chars: CHARS[charMode],
  };
  const rootIcon = $('tog-icons').checked ? '📦 ' : '';
  $('tree-out').innerHTML = `<span class="c-folder">${rootIcon}${escHtml(fileName)}</span>\n` + renderNode(treeData, opts, '', 0);
}

function countEntries(node) {
  let files = node.files.length;
  let dirs = Object.keys(node.children).length;
  for (const child of Object.values(node.children)) {
    const sub = countEntries(child);
    files += sub.files;
    dirs += sub.dirs;
  }
  return { files, dirs };
}

function reset() {
  treeData = null;
  fileName = '';
  $('output-area').classList.remove('active');
  dz.classList.remove('hidden');
  $('reset-btn').style.display = 'none';
  $('file-input').value = '';
  $('tree-out').innerHTML = '';
  hideError();
}

/* ===========================
   Event Listeners (Beibehalten)
   =========================== */
dz.addEventListener('click', () => $('file-input').click());
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', e => {
  e.preventDefault();
  dz.classList.remove('drag');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
});
$('file-input').addEventListener('change', e => {
  if (e.target.files[0]) processFile(e.target.files[0]);
});
$('reset-btn').addEventListener('click', reset);
$('error-close').addEventListener('click', hideError);

document.querySelectorAll('.seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    charMode = btn.dataset.v;
    redraw();
  });
});

$('depth-slider').addEventListener('input', () => {
  const v = parseInt($('depth-slider').value);
  $('depth-val').textContent = v === 0 ? '∞' : String(v);
  redraw();
});

['tog-icons', 'tog-sizes', 'tog-flat', 'tog-dirf', 'ig-nm', 'ig-git', 'ig-ds', 'ig-py', 'ig-idea', 'ig-vsc'].forEach(id => {
  $(id).addEventListener('change', () => { if (treeData) redraw(); });
});

// UI Progress Helpers
function showProgress(label, pct) {
  $('progress-wrap').classList.add('show');
  $('progress-label').textContent = label;
  $('progress-fill').style.width = pct + '%';
}
function hideProgress() { $('progress-wrap').classList.remove('show'); }
function showError(msg) { $('error-text').textContent = msg; $('error-banner').style.display = 'flex'; }
function hideError() { $('error-banner').style.display = 'none'; }
function setFormatBadge(fmt) {
  const badge = $('format-badge');
  badge.textContent = formatLabel(fmt);
  badge.className = `format-badge fmt-${fmt}`;
}

window.addEventListener('load', async () => {
  const statusDot = document.querySelector('#lib-status .fmt-dot');
  const statusText = document.getElementById('lib-status-text');

  try {
      if (typeof Archive !== 'undefined') {
          statusDot.className = 'fmt-dot fmt-ok';
          statusText.textContent = 'Engine Ready';
      } else {
          const { Archive: ImportedArchive } = await import('./lib/libarchive.js');
          if (ImportedArchive) {
              window.Archive = ImportedArchive;
              statusDot.className = 'fmt-dot fmt-ok';
              statusText.textContent = 'Engine Ready (Imported)';
          }
      }
  } catch (e) {
      console.error("Libarchive Load Error:", e);
      statusDot.className = 'fmt-dot fmt-warn';
      statusText.textContent = 'Engine Error';
  }
});