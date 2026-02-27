#!/usr/bin/env node
/**
 * Nuffield Health Consultant Gap Analysis — reads from local CSV
 * Input:  nuffield_consultants.csv
 * Output: nuffield_gap_analysis.csv + nuffield_gap_analysis.html
 */

import { readFileSync, writeFileSync } from 'fs';

// ─── CSV parser (handles quoted fields with commas/newlines) ──────────────────

function parseCsv(text) {
  const lines = [];
  let i = 0;
  const fields = [];
  let field = '';
  let inQuote = false;

  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { inQuote = false; i++; continue; }
      field += ch; i++;
    } else {
      if (ch === '"') { inQuote = true; i++; continue; }
      if (ch === ',') { fields.push(field); field = ''; i++; continue; }
      if (ch === '\n') {
        fields.push(field); field = '';
        lines.push(fields.splice(0));
        i++; continue;
      }
      if (ch === '\r') { i++; continue; }
      field += ch; i++;
    }
  }
  if (field || fields.length) { fields.push(field); lines.push(fields); }
  return lines;
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).filter(r => r.length > 1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
    return obj;
  });
}

// ─── Photo classification ─────────────────────────────────────────────────────

const PLACEHOLDER_PATTERNS = [
  'consultant-portrait', 'placeholder', 'no-image',
  'default-consultant', 'silhouette', 'generic',
];

function classifyPhoto(imageUrl) {
  if (!imageUrl || imageUrl.trim() === '') return 'missing';
  // URL may contain an inner ?url= encoded URL
  const afterUrl = imageUrl.split('url=')[1] || imageUrl;
  const lower = afterUrl.toLowerCase();
  for (const pat of PLACEHOLDER_PATTERNS) {
    if (lower.includes(pat)) return 'placeholder';
  }
  return 'real';
}

// ─── Normalise cell values ────────────────────────────────────────────────────

function norm(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  if (s === 'null' || s === 'undefined') return '';
  return s;
}

// ─── Gap analysis per consultant ──────────────────────────────────────────────

function analyse(c) {
  const photoStatus = classifyPhoto(norm(c.image));

  const specialties = norm(c.specialties);
  const quals       = norm(c.professionalQualifications);
  const languages   = norm(c.languages);
  const hospitals   = norm(c.hospitals);
  const gmc         = norm(c.gmcNumber);
  const bookable    = norm(c.bookable).toLowerCase() === 'true';
  const gender      = norm(c.gender);
  const gpRef       = norm(c.gpReferralRequired);

  const flags = [];
  if (photoStatus === 'missing')                       flags.push('NO_PHOTO');
  if (photoStatus === 'placeholder')                   flags.push('PLACEHOLDER_PHOTO');
  if (!specialties)                                    flags.push('NO_SPECIALTIES');
  if (!quals)                                          flags.push('NO_QUALIFICATIONS');
  if (!gmc)                                            flags.push('NO_GMC');
  if (!languages)                                      flags.push('NO_LANGUAGES');
  if (!hospitals)                                      flags.push('NO_HOSPITAL');
  if (!bookable)                                       flags.push('NOT_BOOKABLE');
  if (!gender || gender.toLowerCase() === 'unspecified') flags.push('GENDER_UNSPECIFIED');

  return {
    id:               norm(c.id),
    fullname:         norm(c.fullname),
    url:              norm(c.url),
    photo_status:     photoStatus,
    specialties,
    qualifications:   quals,
    gmc_number:       gmc,
    languages,
    hospitals,
    bookable:         bookable ? 'Yes' : 'No',
    gender,
    gp_referral:      gpRef,
    days_until_appt:  norm(c.daysUntilNextAppointment),
    missing_count:    flags.length,
    flags:            flags.join(' | '),
    flag_no_photo:            flags.includes('NO_PHOTO') ? 1 : 0,
    flag_placeholder_photo:   flags.includes('PLACEHOLDER_PHOTO') ? 1 : 0,
    flag_no_specialties:      flags.includes('NO_SPECIALTIES') ? 1 : 0,
    flag_no_qualifications:   flags.includes('NO_QUALIFICATIONS') ? 1 : 0,
    flag_no_gmc:              flags.includes('NO_GMC') ? 1 : 0,
    flag_no_languages:        flags.includes('NO_LANGUAGES') ? 1 : 0,
    flag_no_hospital:         flags.includes('NO_HOSPITAL') ? 1 : 0,
    flag_not_bookable:        flags.includes('NOT_BOOKABLE') ? 1 : 0,
    flag_gender_unspecified:  flags.includes('GENDER_UNSPECIFIED') ? 1 : 0,
  };
}

// ─── CSV writer ───────────────────────────────────────────────────────────────

function esc(v) {
  const s = String(v ?? '');
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

function toCsv(records) {
  const keys = Object.keys(records[0]);
  const rows = [keys.join(',')];
  for (const r of records) rows.push(keys.map(k => esc(r[k])).join(','));
  return rows.join('\n');
}

// ─── HTML report ──────────────────────────────────────────────────────────────

function buildHtml(records) {
  const total = records.length;

  const counts = {
    no_photo:           records.filter(r => r.flag_no_photo).length,
    placeholder_photo:  records.filter(r => r.flag_placeholder_photo).length,
    no_specialties:     records.filter(r => r.flag_no_specialties).length,
    no_qualifications:  records.filter(r => r.flag_no_qualifications).length,
    no_gmc:             records.filter(r => r.flag_no_gmc).length,
    no_languages:       records.filter(r => r.flag_no_languages).length,
    no_hospital:        records.filter(r => r.flag_no_hospital).length,
    not_bookable:       records.filter(r => r.flag_not_bookable).length,
    gender_unspecified: records.filter(r => r.flag_gender_unspecified).length,
    fully_complete:     records.filter(r => r.missing_count === 0).length,
  };

  const pct  = n => ((n / total) * 100).toFixed(1) + '%';
  const bar  = n => {
    const w = ((n / total) * 100).toFixed(1);
    return `<div class="bar-wrap"><div class="bar" style="width:${w}%"></div><span>${n} (${pct(n)})</span></div>`;
  };

  const sorted = [...records].sort((a, b) => b.missing_count - a.missing_count);

  const FLAG_LABELS = {
    NO_PHOTO:           { label: 'No Photo',            color: '#ef4444' },
    PLACEHOLDER_PHOTO:  { label: 'Placeholder Photo',   color: '#f97316' },
    NO_SPECIALTIES:     { label: 'No Specialties',      color: '#eab308' },
    NO_QUALIFICATIONS:  { label: 'No Qualifications',   color: '#a855f7' },
    NO_GMC:             { label: 'No GMC #',            color: '#ec4899' },
    NO_LANGUAGES:       { label: 'No Languages',        color: '#6366f1' },
    NO_HOSPITAL:        { label: 'No Hospital',         color: '#0ea5e9' },
    NOT_BOOKABLE:       { label: 'Not Bookable',        color: '#64748b' },
    GENDER_UNSPECIFIED: { label: 'Gender Unspecified',  color: '#94a3b8' },
  };

  function flagBadges(flagStr) {
    if (!flagStr) return '<span class="complete">&#10003; Complete</span>';
    return flagStr.split(' | ').map(f => {
      const meta = FLAG_LABELS[f] || { label: f, color: '#999' };
      return `<span class="badge" style="background:${meta.color}">${meta.label}</span>`;
    }).join(' ');
  }

  // Embed all row data as JSON for client-side filtering/sorting
  const rowData = sorted.map(r => ({
    name: r.fullname,
    url: r.url,
    gaps: r.missing_count,
    flags: r.flags,
    specialties: r.specialties,
    gmc: r.gmc_number,
    bookable: r.bookable,
    photo: r.photo_status,
    qualifications: r.qualifications,
    hospitals: r.hospitals,
    languages: r.languages,
    gender: r.gender,
  }));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nuffield Health — Consultant Profile Gap Analysis</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;color:#1e293b;font-size:14px}
  h1{padding:24px 32px 4px;font-size:22px;color:#0f172a}
  .subtitle{padding:0 32px 20px;color:#64748b;font-size:13px}
  .stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;padding:0 32px 24px}
  .stat{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;border-left:4px solid #3b82f6}
  .stat.red{border-color:#ef4444} .stat.orange{border-color:#f97316}
  .stat.yellow{border-color:#eab308} .stat.purple{border-color:#a855f7}
  .stat.green{border-color:#22c55e} .stat.pink{border-color:#ec4899}
  .stat h3{font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
  .stat .number{font-size:28px;font-weight:700;line-height:1}
  .stat .pct{font-size:12px;color:#94a3b8;margin-top:4px}
  .bar-wrap{display:flex;align-items:center;gap:8px;height:20px;margin-top:6px}
  .bar{background:#3b82f6;height:10px;border-radius:4px;min-width:2px}
  .filters{padding:0 32px 16px;display:flex;gap:12px;flex-wrap:wrap;align-items:center}
  .filters input[type=text]{padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#fff;width:220px}
  .filters select{padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#fff}
  .filters label{font-size:13px;color:#475569;display:flex;align-items:center;gap:5px;cursor:pointer}
  .count-label{font-size:13px;color:#64748b;margin-left:auto}
  .table-wrap{padding:0 32px 40px;overflow-x:auto}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:13px}
  th{background:#f1f5f9;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;padding:10px 12px;text-align:left;cursor:pointer;white-space:nowrap;user-select:none}
  th:hover{background:#e2e8f0} th.sorted-asc::after{content:' ▲'} th.sorted-desc::after{content:' ▼'}
  td{padding:8px 12px;border-top:1px solid #f1f5f9;vertical-align:middle}
  td a{color:#2563eb;text-decoration:none;font-weight:500} td a:hover{text-decoration:underline}
  tr.high td{background:#fff5f5} tr.ok td{background:#f0fdf4}
  .badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;color:#fff;margin:1px 2px;white-space:nowrap}
  .complete{color:#16a34a;font-weight:600;font-size:12px}
  .na{color:#cbd5e1}
  .center{text-align:center}
  .summary-bar{background:#1e293b;color:#f8fafc;padding:14px 32px;font-size:13px;display:flex;gap:32px;flex-wrap:wrap;align-items:center}
  .summary-bar .item{display:flex;flex-direction:column;gap:2px}
  .summary-bar .val{font-size:22px;font-weight:700}
  .summary-bar .lbl{font-size:11px;opacity:.6;text-transform:uppercase;letter-spacing:.5px}
  .export-btn{margin-left:auto;background:#3b82f6;color:#fff;border:none;padding:7px 16px;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600}
  .export-btn:hover{background:#2563eb}
  .section-title{padding:20px 32px 8px;font-size:13px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:.5px}
  .clickable{cursor:pointer;transition:transform .1s,box-shadow .1s}
  .clickable:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.1)}
  .clickable.active{outline:2px solid #2563eb}
</style>
</head>
<body>
<h1>Nuffield Health &mdash; Consultant Profile Gap Analysis</h1>
<p class="subtitle">Generated ${new Date().toLocaleString('en-GB')} &middot; ${total.toLocaleString()} consultants analysed from local data</p>

<div class="summary-bar">
  <div class="item"><span class="val">${total.toLocaleString()}</span><span class="lbl">Total consultants</span></div>
  <div class="item"><span class="val">${counts.fully_complete.toLocaleString()}</span><span class="lbl">Fully complete (${pct(counts.fully_complete)})</span></div>
  <div class="item"><span class="val">${(total - counts.fully_complete).toLocaleString()}</span><span class="lbl">Have &ge;1 gap (${pct(total - counts.fully_complete)})</span></div>
  <button class="export-btn" onclick="exportCsv()">&#8593; Export CSV</button>
</div>

<div class="section-title">Gap Summary</div>
<div class="stats-grid">
  <div class="stat red clickable" onclick="setFlagFilter('NO_PHOTO')" title="Click to filter table"><h3>No Real Photo &#x25BE;</h3><div class="number">${counts.no_photo + counts.placeholder_photo}</div>${bar(counts.no_photo + counts.placeholder_photo)}<div class="pct">${counts.no_photo} missing entirely &middot; ${counts.placeholder_photo} placeholder</div></div>
  <div class="stat yellow clickable" onclick="setFlagFilter('NO_SPECIALTIES')" title="Click to filter table"><h3>No Specialties &#x25BE;</h3><div class="number">${counts.no_specialties}</div>${bar(counts.no_specialties)}</div>
  <div class="stat purple clickable" onclick="setFlagFilter('NO_QUALIFICATIONS')" title="Click to filter table"><h3>No Qualifications &#x25BE;</h3><div class="number">${counts.no_qualifications}</div>${bar(counts.no_qualifications)}</div>
  <div class="stat pink clickable" onclick="setFlagFilter('NO_GMC')" title="Click to filter table"><h3>No GMC Number &#x25BE;</h3><div class="number">${counts.no_gmc}</div>${bar(counts.no_gmc)}</div>
  <div class="stat clickable" onclick="setFlagFilter('NO_LANGUAGES')" title="Click to filter table"><h3>No Languages Listed &#x25BE;</h3><div class="number">${counts.no_languages}</div>${bar(counts.no_languages)}</div>
  <div class="stat orange clickable" onclick="setFlagFilter('NOT_BOOKABLE')" title="Click to filter table"><h3>Not Bookable Online &#x25BE;</h3><div class="number">${counts.not_bookable}</div>${bar(counts.not_bookable)}</div>
  <div class="stat clickable" onclick="setFlagFilter('NO_HOSPITAL')" title="Click to filter table"><h3>No Hospital Listed &#x25BE;</h3><div class="number">${counts.no_hospital}</div>${bar(counts.no_hospital)}</div>
  <div class="stat clickable" onclick="setFlagFilter('GENDER_UNSPECIFIED')" title="Click to filter table"><h3>Gender Unspecified &#x25BE;</h3><div class="number">${counts.gender_unspecified}</div>${bar(counts.gender_unspecified)}</div>
  <div class="stat green clickable" onclick="setFlagFilter('')" title="Click to show all"><h3>Fully Complete &#x25BE;</h3><div class="number">${counts.fully_complete}</div>${bar(counts.fully_complete)}</div>
</div>

<div class="section-title">All Consultants</div>
<div class="filters">
  <input type="text" id="searchBox" placeholder="Search consultant name&hellip;" oninput="applyFilters()">
  <select id="flagFilter" onchange="applyFilters()">
    <option value="">All consultants</option>
    <option value="gaps">Has any gap</option>
    <option value="NO_PHOTO">No photo</option>
    <option value="PLACEHOLDER_PHOTO">Placeholder photo</option>
    <option value="NO_SPECIALTIES">No specialties</option>
    <option value="NO_QUALIFICATIONS">No qualifications</option>
    <option value="NO_GMC">No GMC number</option>
    <option value="NO_LANGUAGES">No languages</option>
    <option value="NO_HOSPITAL">No hospital</option>
    <option value="NOT_BOOKABLE">Not bookable</option>
    <option value="GENDER_UNSPECIFIED">Gender unspecified</option>
  </select>
  <select id="gapCount" onchange="applyFilters()">
    <option value="">Any gap count</option>
    <option value="0">0 gaps (complete)</option>
    <option value="1">1 gap</option>
    <option value="2">2 gaps</option>
    <option value="3+">3+ gaps (high priority)</option>
  </select>
  <span class="count-label" id="countLabel"></span>
</div>

<div class="table-wrap">
  <table id="mainTable">
    <thead>
      <tr>
        <th data-sort="name" onclick="sortBy(this.dataset.sort)">Consultant</th>
        <th class="center sorted-desc" data-sort="gaps" onclick="sortBy(this.dataset.sort)">Gaps</th>
        <th>Missing Components</th>
        <th data-sort="specialties" onclick="sortBy(this.dataset.sort)">Specialties</th>
        <th>Qualifications</th>
        <th>GMC #</th>
        <th>Bookable</th>
        <th>Photo</th>
      </tr>
    </thead>
    <tbody id="tableBody"></tbody>
  </table>
</div>

<script>
const FLAG_LABELS = {
  NO_PHOTO:           { label:'No Photo',           color:'#ef4444' },
  PLACEHOLDER_PHOTO:  { label:'Placeholder Photo',  color:'#f97316' },
  NO_SPECIALTIES:     { label:'No Specialties',     color:'#eab308' },
  NO_QUALIFICATIONS:  { label:'No Qualifications',  color:'#a855f7' },
  NO_GMC:             { label:'No GMC #',           color:'#ec4899' },
  NO_LANGUAGES:       { label:'No Languages',       color:'#6366f1' },
  NO_HOSPITAL:        { label:'No Hospital',        color:'#0ea5e9' },
  NOT_BOOKABLE:       { label:'Not Bookable',       color:'#64748b' },
  GENDER_UNSPECIFIED: { label:'Gender Unspecified', color:'#94a3b8' },
};

const RAW = ${JSON.stringify(rowData)};

let currentData = [...RAW];
let sortField = 'gaps';
let sortDir = -1;

function flagBadges(flagStr) {
  if (!flagStr) return '<span class="complete">&#10003; Complete</span>';
  return flagStr.split(' | ').map(f => {
    const m = FLAG_LABELS[f] || { label:f, color:'#999' };
    return '<span class="badge" style="background:'+m.color+'">'+m.label+'</span>';
  }).join(' ');
}

function renderTable(data) {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = data.map(r => {
    const cls = r.gaps >= 3 ? 'high' : r.gaps === 0 ? 'ok' : '';
    return '<tr class="'+cls+'">'
      + '<td><a href="'+r.url+'" target="_blank">'+r.name+'</a></td>'
      + '<td class="center">'+r.gaps+'</td>'
      + '<td>'+flagBadges(r.flags)+'</td>'
      + '<td>'+(r.specialties||'<span class="na">—</span>')+'</td>'
      + '<td>'+(r.qualifications||'<span class="na">—</span>')+'</td>'
      + '<td>'+(r.gmc||'<span class="na">—</span>')+'</td>'
      + '<td>'+r.bookable+'</td>'
      + '<td>'+r.photo+'</td>'
      + '</tr>';
  }).join('');
  document.getElementById('countLabel').textContent = 'Showing ' + data.length.toLocaleString() + ' of ' + RAW.length.toLocaleString();
}

function applyFilters() {
  const q    = document.getElementById('searchBox').value.toLowerCase();
  const flag = document.getElementById('flagFilter').value;
  const gc   = document.getElementById('gapCount').value;

  let filtered = RAW.filter(r => {
    if (q && !r.name.toLowerCase().includes(q)) return false;
    if (flag === 'gaps' && r.gaps === 0) return false;
    if (flag && flag !== 'gaps' && !r.flags.includes(flag)) return false;
    if (gc === '0' && r.gaps !== 0) return false;
    if (gc === '1' && r.gaps !== 1) return false;
    if (gc === '2' && r.gaps !== 2) return false;
    if (gc === '3+' && r.gaps < 3) return false;
    return true;
  });

  filtered = applySortToData(filtered);
  currentData = filtered;
  renderTable(filtered);
}

function applySortToData(data) {
  return [...data].sort((a,b) => {
    let av = a[sortField], bv = b[sortField];
    if (typeof av === 'string') av = av.toLowerCase(), bv = bv.toLowerCase();
    if (av < bv) return -sortDir;
    if (av > bv) return sortDir;
    return 0;
  });
}

function sortBy(field) {
  if (sortField === field) { sortDir *= -1; } else { sortField = field; sortDir = -1; }
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.classList.remove('sorted-asc','sorted-desc');
    if (th.dataset.sort === field) {
      th.classList.add(sortDir === 1 ? 'sorted-asc' : 'sorted-desc');
    }
  });
  applyFilters();
}

function exportCsv() {
  const headers = ['Name','URL','Gaps','Flags','Specialties','Qualifications','GMC','Bookable','Photo','Hospitals','Languages','Gender'];
  const rows = currentData.map(r => [r.name,r.url,r.gaps,r.flags,r.specialties,r.qualifications,r.gmc,r.bookable,r.photo,r.hospitals,r.languages,r.gender]
    .map(v => { const s=String(v??''); return (s.includes(',') || s.includes('"') || s.includes(String.fromCharCode(10)) || s.includes(String.fromCharCode(13))) ? '"'+s.replace(/"/g,'""')+'"' : s; }).join(','));
  const csv = [headers.join(','), ...rows].join('\\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'nuffield_gap_filtered.csv';
  a.click();
}

function setFlagFilter(flag) {
  document.getElementById('flagFilter').value = flag || 'gaps';
  if (!flag) document.getElementById('flagFilter').value = '';
  document.querySelectorAll('.clickable').forEach(el => el.classList.remove('active'));
  if (flag) {
    const el = document.querySelector('[onclick*="' + flag + '"]');
    if (el) el.classList.add('active');
  }
  applyFilters();
  document.getElementById('mainTable').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Initial render
applyFilters();
</script>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const csvText = readFileSync('nuffield_consultants.csv', 'utf8');
const consultants = csvToObjects(csvText);
console.log(`Loaded ${consultants.length} consultants from CSV`);

const analysed = consultants.map(analyse);

// Print summary
const total = analysed.length;
const pct = n => ((n / total) * 100).toFixed(1) + '%';
const pad = (s, n) => String(s).padStart(n);

const counts = {
  no_photo:           analysed.filter(r => r.flag_no_photo).length,
  placeholder_photo:  analysed.filter(r => r.flag_placeholder_photo).length,
  no_specialties:     analysed.filter(r => r.flag_no_specialties).length,
  no_qualifications:  analysed.filter(r => r.flag_no_qualifications).length,
  no_gmc:             analysed.filter(r => r.flag_no_gmc).length,
  no_languages:       analysed.filter(r => r.flag_no_languages).length,
  no_hospital:        analysed.filter(r => r.flag_no_hospital).length,
  not_bookable:       analysed.filter(r => r.flag_not_bookable).length,
  gender_unspecified: analysed.filter(r => r.flag_gender_unspecified).length,
  fully_complete:     analysed.filter(r => r.missing_count === 0).length,
};

console.log('\n── Gap Summary ──────────────────────────────────────');
console.log(`  No photo (missing entirely):    ${pad(counts.no_photo, 4)}  (${pct(counts.no_photo)})`);
console.log(`  Placeholder/generic photo:      ${pad(counts.placeholder_photo, 4)}  (${pct(counts.placeholder_photo)})`);
console.log(`  No specialties listed:          ${pad(counts.no_specialties, 4)}  (${pct(counts.no_specialties)})`);
console.log(`  No qualifications listed:       ${pad(counts.no_qualifications, 4)}  (${pct(counts.no_qualifications)})`);
console.log(`  No GMC number:                  ${pad(counts.no_gmc, 4)}  (${pct(counts.no_gmc)})`);
console.log(`  No languages listed:            ${pad(counts.no_languages, 4)}  (${pct(counts.no_languages)})`);
console.log(`  No hospital listed:             ${pad(counts.no_hospital, 4)}  (${pct(counts.no_hospital)})`);
console.log(`  Not bookable online:            ${pad(counts.not_bookable, 4)}  (${pct(counts.not_bookable)})`);
console.log(`  Gender unspecified:             ${pad(counts.gender_unspecified, 4)}  (${pct(counts.gender_unspecified)})`);
console.log('  ──────────────────────────────────────────────────');
console.log(`  Fully complete profiles:        ${pad(counts.fully_complete, 4)}  (${pct(counts.fully_complete)})`);
console.log(`  Have ≥1 gap:                    ${pad(total - counts.fully_complete, 4)}  (${pct(total - counts.fully_complete)})`);

// Write CSV
writeFileSync('nuffield_gap_analysis.csv', toCsv(analysed), 'utf8');
console.log('\nCSV saved: nuffield_gap_analysis.csv');

// Write HTML
writeFileSync('nuffield_gap_analysis.html', buildHtml(analysed), 'utf8');
console.log('HTML report saved: nuffield_gap_analysis.html');
console.log(`\nDone — ${new Date().toISOString()}`);
