// =============================================
//  QR Attendance — Supabase as single source of truth
//  localStorage = offline cache only
// =============================================

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let db = { sections: [], students: [], attendance: {} };
let syncQueue = [];
let isOnline = navigator.onLine;
let fetchTimer = null;

// ---- Local cache ----------------------------
function saveLocal() {
  try {
    localStorage.setItem('qratt_v2', JSON.stringify({ db, syncQueue }));
  } catch(e) {}
}
function loadLocal() {
  try {
    const raw = localStorage.getItem('qratt_v2');
    if (raw) { const p = JSON.parse(raw); db = p.db || db; syncQueue = p.syncQueue || []; }
    // migrate old format
    else {
      const old = localStorage.getItem('qratt_db');
      if (old) { const p = JSON.parse(old); db = p; }
    }
  } catch(e) {}
}

// ---- Connection status ----------------------
function setOnline(val) {
  isOnline = val;
  const dot = document.getElementById('dot');
  const lbl = document.getElementById('conn-lbl');
  if (dot) dot.style.background = val ? '#3B6D11' : '#A32D2D';
  if (lbl) lbl.textContent = val ? 'Online' : 'Offline';
}

window.addEventListener('online',  () => { setOnline(true);  fetchAll(); flushQueue(); });
window.addEventListener('offline', () => { setOnline(false); });

// ---- Fetch ALL from Supabase ----------------
// This is the ONLY way data gets into db.sections and db.students
// Called: on load, every 10s, on tab switch
async function fetchAll() {
  if (!isOnline) return;
  try {
    const [secRes, stuRes] = await Promise.all([
      sb.from('sections').select('*').order('name'),
      sb.from('students').select('*').order('name'),
    ]);
    if (secRes.error || stuRes.error) throw (secRes.error || stuRes.error);

    db.sections = secRes.data || [];
    db.students = stuRes.data || [];

    // attendance: last 90 days
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const attRes = await sb.from('attendance').select('*').gte('date', since.toISOString().slice(0,10));
    if (!attRes.error && attRes.data) {
      db.attendance = {};
      attRes.data.forEach(r => {
        const k = r.section_id + '|' + r.date;
        if (!db.attendance[k]) db.attendance[k] = {};
        db.attendance[k][r.student_id] = r.time_in || 'Present';
      });
    }
    saveLocal();
    refreshUI();
  } catch(e) {
    console.warn('fetchAll failed:', e?.message || e);
  }
}

// Refresh all visible UI after a fetch
function refreshUI() {
  fillSelects();
  renderSectionChips();
  renderStudentList();
  updateScanStats();
  const activeId = document.querySelector('.page.active')?.id;
  if (activeId === 'page-history')  renderHistory();
  if (activeId === 'page-report')   renderReport();
  if (activeId === 'page-qrcodes')  renderQRPage();
}

// Poll every 10 seconds so all devices stay in sync
function startPolling() {
  if (fetchTimer) clearInterval(fetchTimer);
  fetchTimer = setInterval(() => { if (isOnline) fetchAll(); }, 10000);
}

// ---- Offline queue --------------------------
async function flushQueue() {
  if (!isOnline || !syncQueue.length) return;
  const failed = [];
  for (const op of syncQueue) {
    try {
      if (op.type === 'ins_section')  await sb.from('sections').upsert(op.data, { onConflict: 'name' });
      if (op.type === 'ins_student')  await sb.from('students').upsert(op.data);
      if (op.type === 'ins_att')      await sb.from('attendance').upsert(op.data, { onConflict: 'student_id,date' });
      if (op.type === 'del_section')  await sb.from('sections').delete().eq('id', op.id);
      if (op.type === 'del_student')  await sb.from('students').delete().eq('id', op.id);
    } catch(e) { failed.push(op); }
  }
  syncQueue = failed;
  saveLocal();
  if (!failed.length) fetchAll(); // refresh after flush
}

// ---- Helpers --------------------------------
function todayStr() { return new Date().toISOString().slice(0,10); }
function attKey(secId, date) { return secId + '|' + date; }
function getScanned(secId, date) { return db.attendance[attKey(secId, date)] || {}; }
function getSectionId() { return document.getElementById('scan-class')?.value || ''; }
function getStudents(secId) { return db.students.filter(s => s.section_id === secId); }
function getSectionById(id) { return db.sections.find(s => s.id === id); }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2); }

const COLORS = [['#E6F1FB','#0C447C'],['#E1F5EE','#085041'],['#FAEEDA','#633806'],
                ['#FBEAF0','#72243E'],['#EAF3DE','#27500A'],['#EEEDFE','#3C3489'],['#FAECE7','#712B13']];
function colorFor(n) { return COLORS[(n||'').charCodeAt(0) % COLORS.length]; }
function initials(n) { return (n||'').split(' ').map(w=>w[0]||'').join('').toUpperCase().slice(0,2)||'?'; }

// ---- QR Code generation ---------------------
function generateQRDataURL(text) {
  return new Promise(resolve => {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
    document.body.appendChild(div);
    try {
      new QRCode(div, { text, width:180, height:180, colorDark:'#000', colorLight:'#fff', correctLevel: QRCode.CorrectLevel.M });
    } catch(e) { document.body.removeChild(div); resolve(''); return; }
    setTimeout(() => {
      const canvas = div.querySelector('canvas');
      const img    = div.querySelector('img');
      let src = '';
      if (canvas) try { src = canvas.toDataURL('image/png'); } catch(e) {}
      if (!src && img?.src) src = img.src;
      document.body.removeChild(div);
      resolve(src);
    }, 400);
  });
}

async function renderQRPage() {
  const secId    = document.getElementById('qr-class')?.value;
  const students = getStudents(secId);
  const grid     = document.getElementById('qr-grid');
  if (!grid) return;
  if (!students.length) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><i class="ti ti-qrcode" aria-hidden="true"></i>No students in this section</div>';
    return;
  }
  grid.innerHTML = students.map(s => `
    <div class="qr-card">
      <div id="qrwrap-${s.id}" style="width:120px;height:120px;background:#f0f0f0;border-radius:6px;margin:0 auto;display:flex;align-items:center;justify-content:center;">
        <span style="font-size:11px;color:#999">Generating…</span>
      </div>
      <div class="qr-name">${s.name}</div>
      <div class="qr-sub">${s.student_id||''}</div>
    </div>`).join('');
  for (const s of students) {
    const wrap = document.getElementById('qrwrap-'+s.id);
    if (!wrap) continue;
    wrap.innerHTML = '';
    try {
      new QRCode(wrap, { text:s.id, width:120, height:120, colorDark:'#000', colorLight:'#fff', correctLevel: QRCode.CorrectLevel.M });
    } catch(e) { wrap.innerHTML = '<span style="font-size:10px;color:red">Error</span>'; }
  }
}

async function printQRs() {
  const secId    = document.getElementById('qr-class')?.value;
  const students = getStudents(secId);
  const sec      = getSectionById(secId);
  if (!students.length) { showToast('No students to print', 'warn'); return; }
  showToast('Generating QR codes...', 'warn');
  const qrMap = {};
  for (const s of students) qrMap[s.id] = await generateQRDataURL(s.id);
  const win = window.open('','_blank');
  if (!win) { showToast('Allow popups to print', 'err'); return; }
  win.document.write(`<!DOCTYPE html><html><head><title>QR Codes</title><style>
    body{font-family:sans-serif;padding:20px;background:#fff}
    h2{margin-bottom:4px;font-size:18px}.date{font-size:12px;color:#888;margin-bottom:20px}
    .grid{display:flex;flex-wrap:wrap;gap:14px}
    .card{border:1.5px solid #ccc;border-radius:10px;padding:14px 12px;text-align:center;width:170px;page-break-inside:avoid}
    .name{font-size:13px;font-weight:700;margin-top:8px;word-break:break-word}
    .sub{font-size:11px;color:#888;margin-top:2px}.sec{font-size:10px;color:#bbb;margin-top:4px}
    @media print{@page{margin:1cm}}
  </style></head><body>`);
  win.document.write(`<h2>${sec?.name||''} — QR Attendance Cards</h2>`);
  win.document.write(`<div class="date">Printed: ${new Date().toLocaleDateString()}</div><div class="grid">`);
  for (const s of students) {
    if (!qrMap[s.id]) continue;
    win.document.write(`<div class="card"><img src="${qrMap[s.id]}" width="150" height="150">
      <div class="name">${s.name}</div><div class="sub">${s.student_id||''}</div>
      <div class="sec">${sec?.name||''}</div></div>`);
  }
  win.document.write('</div></body></html>');
  win.document.close();
  showToast('Print window ready!', 'ok');
  setTimeout(() => win.print(), 900);
}

// ---- Sections -------------------------------
async function addSection() {
  const inp  = document.getElementById('new-cls-inp');
  const name = inp.value.trim();
  if (!name) return;
  if (db.sections.find(s => s.name === name)) { showToast('Section already exists', 'err'); return; }
  const rec = { id: uid(), name, created_at: new Date().toISOString() };
  inp.value = '';
  if (isOnline) {
    const { error } = await sb.from('sections').upsert(rec, { onConflict: 'name' });
    if (error) { showToast('Error: ' + error.message, 'err'); return; }
    await fetchAll(); // pull fresh from Supabase — all devices get this
    showToast(name + ' added!', 'ok');
  } else {
    db.sections.push(rec);
    syncQueue.push({ type: 'ins_section', data: rec });
    saveLocal(); fillSelects(); renderSectionChips();
    showToast('Saved offline — will sync when online', 'warn');
  }
}

async function deleteSection(id) {
  const sec = db.sections.find(s => s.id === id);
  if (!sec || !confirm('Delete "' + sec.name + '"? All students and records will be removed.')) return;
  if (isOnline) {
    await sb.from('sections').delete().eq('id', id);
    await fetchAll();
  } else {
    db.sections = db.sections.filter(s => s.id !== id);
    db.students = db.students.filter(s => s.section_id !== id);
    Object.keys(db.attendance).filter(k => k.startsWith(id+'|')).forEach(k => delete db.attendance[k]);
    syncQueue.push({ type: 'del_section', id });
    saveLocal(); fillSelects(); renderSectionChips(); renderStudentList();
  }
}

// ---- Students -------------------------------
async function addStudent() {
  const name  = document.getElementById('new-sname').value.trim();
  const sid   = document.getElementById('new-sid').value.trim();
  const secId = document.getElementById('new-scls').value;
  if (!name)  { showToast('Enter student name', 'err'); return; }
  if (!secId) { showToast('Select a section first', 'err'); return; }
  const rec = { id: uid(), name, student_id: sid, section_id: secId, created_at: new Date().toISOString() };
  document.getElementById('new-sname').value = '';
  document.getElementById('new-sid').value   = '';
  if (isOnline) {
    const { error } = await sb.from('students').insert(rec);
    if (error) { showToast('Error: ' + error.message, 'err'); return; }
    await fetchAll(); // all devices see new student
    showToast(name + ' added!', 'ok');
  } else {
    db.students.push(rec);
    syncQueue.push({ type: 'ins_student', data: rec });
    saveLocal(); renderStudentList();
    showToast('Saved offline — will sync when online', 'warn');
  }
}

async function deleteStudent(id) {
  const s = db.students.find(x => x.id === id);
  if (!s || !confirm('Remove ' + s.name + '?')) return;
  if (isOnline) {
    await sb.from('students').delete().eq('id', id);
    await fetchAll();
  } else {
    db.students = db.students.filter(x => x.id !== id);
    syncQueue.push({ type: 'del_student', id });
    saveLocal(); renderStudentList();
  }
}

// ---- CSV Import -----------------------------
let csvParsed = [];

function previewCSV(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('csv-filename').textContent = file.name;
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    let startIdx = 0;
    const first = lines[0]?.split(',') || [];
    if (/name|student|lrn|id/i.test(lines[0])) startIdx = 1;
    csvParsed = [];
    for (let i = startIdx; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g,''));
      if (cols[0]) csvParsed.push({ name: cols[0], lrn: cols[1]||'' });
    }
    document.getElementById('csv-preview').style.display = 'block';
    document.getElementById('csv-preview-label').textContent = csvParsed.length + ' students found:';
    document.getElementById('csv-preview-list').innerHTML = csvParsed.map((r,i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg);border-radius:var(--radius);font-size:13px">
        <span style="color:var(--text-3);font-size:11px;min-width:20px;text-align:right">${i+1}</span>
        <span style="flex:1;font-weight:500">${r.name}</span>
        <span style="color:var(--text-2);font-size:11px">${r.lrn||'—'}</span>
      </div>`).join('');
  };
  reader.readAsText(file);
}

async function importCSV() {
  const secId = document.getElementById('import-cls')?.value;
  if (!secId) { showToast('Select a section first', 'err'); return; }
  if (!csvParsed.length) { showToast('No students to import', 'warn'); return; }
  showToast('Importing...', 'warn');
  const toInsert = [];
  for (const row of csvParsed) {
    const exists = db.students.find(s => s.name.toLowerCase()===row.name.toLowerCase() && s.section_id===secId);
    if (exists) continue;
    toInsert.push({ id: uid(), name: row.name, student_id: row.lrn, section_id: secId, created_at: new Date().toISOString() });
  }
  const skipped = csvParsed.length - toInsert.length;
  if (isOnline && toInsert.length) {
    const { error } = await sb.from('students').insert(toInsert);
    if (error) { showToast('Error: ' + error.message, 'err'); return; }
    await fetchAll();
    showToast(`✅ Imported ${toInsert.length} students${skipped ? ', skipped '+skipped+' duplicates':''}!`, 'ok');
  } else if (toInsert.length) {
    toInsert.forEach(rec => { db.students.push(rec); syncQueue.push({ type:'ins_student', data:rec }); });
    saveLocal(); renderStudentList();
    showToast(`Saved offline: ${toInsert.length} students. Will sync when online.`, 'warn');
  } else {
    showToast('No new students to import (all duplicates)', 'warn');
  }
  cancelImport();
}

function cancelImport() {
  csvParsed = [];
  document.getElementById('csv-preview').style.display = 'none';
  document.getElementById('csv-filename').textContent = 'No file chosen';
  document.getElementById('csv-file-input').value = '';
}

// ---- Attendance / Scanning ------------------
let scanning = false, stream = null, raf = null;
const lastScan = {};

async function toggleScan() { scanning ? stopScan() : startScan(); }

async function startScan() {
  if (!getSectionId()) { showToast('Select a section first', 'err'); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' }, audio:false });
    const vid = document.getElementById('video');
    vid.srcObject = stream; vid.style.display = 'block';
    document.getElementById('cam-placeholder').style.display = 'none';
    document.getElementById('scan-overlay').style.display = 'block';
    document.getElementById('btn-scan-toggle').classList.add('btn-stop');
    document.getElementById('scan-btn-lbl').textContent = 'Stop Scanning';
    scanning = true;
    vid.onloadedmetadata = () => { vid.play(); scanLoop(); };
  } catch(e) { showToast('Camera not available — check permissions', 'err'); }
}

function stopScan() {
  scanning = false;
  if (raf) cancelAnimationFrame(raf);
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  const vid = document.getElementById('video');
  vid.srcObject = null; vid.style.display = 'none';
  document.getElementById('cam-placeholder').style.display = 'flex';
  document.getElementById('scan-overlay').style.display = 'none';
  document.getElementById('btn-scan-toggle').classList.remove('btn-stop');
  document.getElementById('scan-btn-lbl').textContent = 'Start Scanning';
}

function scanLoop() {
  if (!scanning) return;
  const vid = document.getElementById('video');
  if (vid.readyState === vid.HAVE_ENOUGH_DATA) {
    const tmp = document.getElementById('qr-tmp');
    tmp.width = vid.videoWidth; tmp.height = vid.videoHeight;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(vid, 0, 0);
    const img = ctx.getImageData(0, 0, tmp.width, tmp.height);
    if (img.width > 0 && typeof jsQR !== 'undefined') {
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts:'dontInvert' });
      if (code?.data) {
        const now = Date.now();
        if (!lastScan[code.data] || now - lastScan[code.data] > 3000) {
          lastScan[code.data] = now;
          processScan(code.data);
        }
      }
    }
  }
  raf = requestAnimationFrame(scanLoop);
}

async function processScan(qrData) {
  const secId   = getSectionId();
  const date    = document.getElementById('scan-date')?.value || todayStr();
  const student = db.students.find(s => s.id === qrData && s.section_id === secId);
  const scanned = getScanned(secId, date);
  if (!student) {
    showToast('❌ Unknown QR code!', 'err');
    addRecentRow({ name:'Unknown', student_id:'' }, 'unk', '--:--'); return;
  }
  if (scanned[student.id]) {
    showToast('⚠️ ' + student.name + ' already scanned!', 'warn');
    addRecentRow(student, 'dup', scanned[student.id]); return;
  }
  const timeIn = new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
  if (!db.attendance[attKey(secId,date)]) db.attendance[attKey(secId,date)] = {};
  db.attendance[attKey(secId,date)][student.id] = timeIn;
  saveLocal(); updateScanStats();
  addRecentRow(student, 'ok', timeIn);
  showToast('✅ ' + student.name + ' — Present! (' + timeIn + ')', 'ok');
  const attRec = { id:uid(), student_id:student.id, section_id:secId, date, time_in:timeIn, status:'present', created_at:new Date().toISOString() };
  if (isOnline) {
    const { error } = await sb.from('attendance').upsert(attRec, { onConflict:'student_id,date' });
    if (error) { syncQueue.push({ type:'ins_att', data:attRec }); saveLocal(); }
  } else { syncQueue.push({ type:'ins_att', data:attRec }); saveLocal(); }
}

function updateScanStats() {
  const secId = getSectionId();
  const date  = document.getElementById('scan-date')?.value || todayStr();
  const cnt   = Object.keys(getScanned(secId, date)).length;
  const all   = getStudents(secId).length;
  const pEl = document.getElementById('s-present');
  const aEl = document.getElementById('s-absent');
  const cEl = document.getElementById('scan-live-cnt');
  if (pEl) pEl.textContent = cnt;
  if (aEl) aEl.textContent = Math.max(0, all - cnt);
  if (cEl) cEl.textContent = cnt + ' scanned';
}

function addRecentRow(student, badge, time) {
  const list = document.getElementById('recent-scans'); if (!list) return;
  const [bg,fg] = colorFor(student.name);
  const bl = badge==='ok' ? '<span class="badge badge-ok">Present ✓</span>'
           : badge==='dup' ? '<span class="badge badge-dup">Already in</span>'
           : '<span class="badge badge-unk">Unknown</span>';
  const row = document.createElement('div');
  row.className = 'scan-result-row';
  row.innerHTML = `<div class="scan-avatar" style="background:${bg};color:${fg}">${initials(student.name)}</div>
    <div class="scan-info"><div class="scan-name">${student.name}</div>
    <div class="scan-meta">${student.student_id||'—'} · ${time}</div></div>${bl}`;
  list.querySelector('.empty')?.remove();
  list.insertBefore(row, list.firstChild);
}

// ---- History --------------------------------
function renderHistory() {
  const secId    = document.getElementById('hist-class')?.value;
  const students = getStudents(secId);
  const dates    = Object.keys(db.attendance)
    .filter(k => k.startsWith(secId+'|')).map(k => k.slice(secId.length+1)).sort().reverse();
  const body = document.getElementById('history-body'); if (!body) return;
  if (!dates.length) { body.innerHTML='<div class="empty"><i class="ti ti-calendar-off" aria-hidden="true"></i>No records yet</div>'; return; }
  body.innerHTML = dates.map(date => {
    const rec = getScanned(secId, date);
    const cnt = Object.keys(rec).length;
    const fmt = new Date(date+'T00:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
    const rows = students.map(s => {
      const t = rec[s.id];
      return `<div class="hist-row"><span>${s.name}</span><span class="${t?'badge badge-ok':'badge badge-unk'}">${t||'Absent'}</span></div>`;
    }).join('');
    return `<div class="hist-item">
      <div class="hist-head" onclick="this.nextElementSibling.classList.toggle('open');this.querySelector('.chev').style.transform=this.nextElementSibling.classList.contains('open')?'rotate(180deg)':''">
        <span>${fmt}</span>
        <span style="display:flex;align-items:center;gap:6px">
          <span class="hist-meta">${cnt}/${students.length}</span>
          <i class="ti ti-chevron-down chev" aria-hidden="true" style="font-size:16px;color:var(--text-2)"></i>
        </span>
      </div>
      <div class="hist-rows">${rows}</div>
    </div>`;
  }).join('');
}

// ---- Report ---------------------------------
function renderReport() {
  const secId    = document.getElementById('rep-class')?.value;
  const students = getStudents(secId);
  const dates    = Object.keys(db.attendance).filter(k => k.startsWith(secId+'|')).map(k => k.slice(secId.length+1));
  const stats = document.getElementById('rep-stats');
  const tbl   = document.getElementById('rep-table');
  if (!stats||!tbl) return;
  if (!dates.length||!students.length) { stats.innerHTML=''; tbl.innerHTML='<div class="empty"><i class="ti ti-chart-bar" aria-hidden="true"></i>No data yet</div>'; return; }
  let totP = 0;
  const rows = students.map(s => {
    let p=0; dates.forEach(d => { if (getScanned(secId,d)[s.id]) p++; }); totP+=p;
    const rate  = dates.length ? Math.round(p/dates.length*100) : 0;
    const color = rate>=80?'#27500A':rate>=60?'#633806':'#791F1F';
    return `<div class="hist-row"><span>${s.name}</span>
      <span style="display:flex;align-items:center;gap:6px"><span>${p}/${dates.length}</span>
      <span style="font-weight:600;color:${color}">${rate}%</span></span></div>`;
  }).join('');
  const overall = students.length&&dates.length ? Math.round(totP/(students.length*dates.length)*100) : 0;
  const oc = overall>=80?'#27500A':overall>=60?'#633806':'#791F1F';
  stats.innerHTML = `
    <div class="stat-box"><div class="stat-num">${dates.length}</div><div class="stat-lbl">Sessions</div></div>
    <div class="stat-box"><div class="stat-num">${students.length}</div><div class="stat-lbl">Students</div></div>
    <div class="stat-box"><div class="stat-num green">${Math.round(totP/Math.max(dates.length,1))}</div><div class="stat-lbl">Avg present/day</div></div>
    <div class="stat-box"><div class="stat-num" style="color:${oc}">${overall}%</div><div class="stat-lbl">Overall rate</div></div>`;
  tbl.innerHTML = rows;
}

// ---- Export CSV -----------------------------
function exportCSV() {
  const secId    = document.getElementById('rep-class')?.value;
  const sec      = getSectionById(secId);
  const students = getStudents(secId);
  const dates    = Object.keys(db.attendance).filter(k=>k.startsWith(secId+'|')).map(k=>k.slice(secId.length+1)).sort();
  if (!dates.length||!students.length) { showToast('No data to export','warn'); return; }
  let csv = 'Name,LRN/ID,'+dates.join(',')+',Days Present,Rate\n';
  students.forEach(s => {
    let p=0;
    const cols = dates.map(d => { const t=getScanned(secId,d)[s.id]; if(t)p++; return t||'Absent'; });
    csv += `"${s.name}","${s.student_id||''}",${cols.join(',')},${p},${dates.length?Math.round(p/dates.length*100):0}%\n`;
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download = (sec?.name||'section').replace(/\s+/g,'_')+'_attendance.csv';
  a.click();
  showToast('CSV downloaded!','ok');
}

// ---- UI helpers -----------------------------
function fillSelects() {
  ['scan-class','qr-class','hist-class','new-scls','view-cls','rep-class','import-cls'].forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    const prev = el.value;
    el.innerHTML = db.sections.length
      ? db.sections.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')
      : '<option value="">— No sections yet —</option>';
    if (db.sections.find(s=>s.id===prev)) el.value = prev;
  });
  updateScanStats();
}

function renderSectionChips() {
  const el = document.getElementById('section-chips'); if (!el) return;
  el.innerHTML = db.sections.map(s =>
    `<span class="class-chip">${s.name}<button class="btn-del" onclick="deleteSection('${s.id}')" aria-label="Delete ${s.name}"><i class="ti ti-x" aria-hidden="true" style="font-size:13px"></i></button></span>`
  ).join('');
}

function renderStudentList() {
  const secId = document.getElementById('view-cls')?.value;
  const list  = getStudents(secId);
  const el    = document.getElementById('student-list'); if (!el) return;
  if (!list.length) { el.innerHTML='<div class="empty"><i class="ti ti-users" aria-hidden="true"></i>No students in this section</div>'; return; }
  el.innerHTML = list.map(s => {
    const [bg,fg] = colorFor(s.name);
    return `<div class="student-row">
      <div class="scan-avatar" style="background:${bg};color:${fg};width:32px;height:32px;font-size:11px;flex-shrink:0">${initials(s.name)}</div>
      <span>${s.name}${s.student_id?' <span style="opacity:.5;font-size:11px">('+s.student_id+')</span>':''}</span>
      <button class="btn-del" onclick="deleteStudent('${s.id}')" aria-label="Delete"><i class="ti ti-trash" aria-hidden="true"></i></button>
    </div>`;
  }).join('');
}

// ---- Tab navigation -------------------------
function goTab(t) {
  document.querySelectorAll('.tab').forEach((el,i) =>
    el.classList.toggle('active',['scan','qrcodes','history','students','report'][i]===t));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+t).classList.add('active');
  if (isOnline) fetchAll(); // always fetch fresh on tab switch
  else {
    fillSelects();
    if (t==='history')  renderHistory();
    if (t==='students') { renderSectionChips(); renderStudentList(); }
    if (t==='report')   renderReport();
    if (t==='qrcodes')  renderQRPage();
  }
  if (t!=='scan') stopScan();
}

// ---- Toast ----------------------------------
function showToast(msg, type) {
  const t = document.getElementById('toast-scan'); if (!t) return;
  t.textContent = msg;
  t.style.background = type==='ok'?'#EAF3DE':type==='err'?'#FCEBEB':type==='warn'?'#FAEEDA':'#1a1a1a';
  t.style.color      = type==='ok'?'#27500A' :type==='err'?'#791F1F' :type==='warn'?'#633806' :'#fff';
  t.classList.add('show');
  clearTimeout(t._to);
  t._to = setTimeout(()=>t.classList.remove('show'), 2800);
}

function clearData() {
  if (!confirm('Clear local cache? Cloud data in Supabase will NOT be deleted.')) return;
  localStorage.removeItem('qratt_v2');
  localStorage.removeItem('qratt_db');
  db = { sections:[], students:[], attendance:{} };
  syncQueue = [];
  if (isOnline) fetchAll(); else refreshUI();
}

// ---- Init -----------------------------------
loadLocal();
document.addEventListener('DOMContentLoaded', () => {
  const dateEl = document.getElementById('scan-date');
  if (dateEl) {
    dateEl.value = todayStr();
    dateEl.addEventListener('change', updateScanStats);
  }
  document.getElementById('scan-class')?.addEventListener('change', () => {
    document.getElementById('recent-scans').innerHTML =
      '<div class="empty"><i class="ti ti-qrcode" aria-hidden="true"></i>No scans yet</div>';
    updateScanStats();
  });

  setOnline(navigator.onLine);
  fillSelects();
  renderSectionChips();
  updateScanStats();

  // Load from local cache first (instant UI), then fetch fresh from Supabase
  refreshUI();
  if (isOnline) { fetchAll(); flushQueue(); }
  startPolling(); // 10-second sync for real-time cross-device updates
});
