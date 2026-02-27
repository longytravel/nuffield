#!/usr/bin/env node
/**
 * Nuffield Health Consultant Gap Analysis — reads from local CSVs
 * Inputs:  nuffield_consultants.csv  +  nuffield_procedures.csv (if available)
 * Outputs: nuffield_gap_analysis.csv + nuffield_gap_analysis.html
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCsv(text) {
  const lines = [];
  let i = 0, field = '', inQuote = false;
  const fields = [];
  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i+1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { inQuote = false; i++; continue; }
      field += ch; i++;
    } else {
      if (ch === '"') { inQuote = true; i++; continue; }
      if (ch === ',') { fields.push(field); field = ''; i++; continue; }
      if (ch === '\n') { fields.push(field); field = ''; lines.push(fields.splice(0)); i++; continue; }
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

// ─── Load procedures map: id → treatments string ─────────────────────────────

function loadProcedures() {
  if (!existsSync('nuffield_procedures.csv')) return new Map();
  const rows = csvToObjects(readFileSync('nuffield_procedures.csv', 'utf8'));
  const map = new Map();
  for (const r of rows) {
    if (r.id && r.treatments && !r.treatments.startsWith('ERROR')) {
      map.set(r.id, r.treatments);
    }
  }
  return map;
}

// ─── Photo classification ─────────────────────────────────────────────────────

const PLACEHOLDER_PATTERNS = ['placeholder','no-image','default-consultant','silhouette','generic'];

function classifyPhoto(imageUrl) {
  if (!imageUrl || imageUrl.trim() === '') return 'missing';
  const afterUrl = imageUrl.split('url=')[1] || imageUrl;
  const lower = afterUrl.toLowerCase();
  for (const pat of PLACEHOLDER_PATTERNS) if (lower.includes(pat)) return 'placeholder';
  return 'real';
}

function norm(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return (s === 'null' || s === 'undefined') ? '' : s;
}

// ─── Gap analysis ─────────────────────────────────────────────────────────────

function analyse(c, proceduresMap) {
  const photoStatus = classifyPhoto(norm(c.image));
  const specialties = norm(c.specialties);
  const quals       = norm(c.professionalQualifications);
  const languages   = norm(c.languages);
  const hospitals   = norm(c.hospitals);
  const gmc         = norm(c.gmcNumber);
  const bookable    = norm(c.bookable).toLowerCase() === 'true';
  const gender      = norm(c.gender);
  const gpRef       = norm(c.gpReferralRequired);
  const treatments  = proceduresMap.size > 0 ? (proceduresMap.get(norm(c.id)) || '') : '';
  const hasProceduresData = proceduresMap.size > 0;

  const flags = [];
  if (photoStatus === 'missing')                         flags.push('NO_PHOTO');
  if (photoStatus === 'placeholder')                     flags.push('PLACEHOLDER_PHOTO');
  if (!specialties)                                      flags.push('NO_SPECIALTIES');
  if (!quals)                                            flags.push('NO_QUALIFICATIONS');
  if (!gmc)                                              flags.push('NO_GMC');
  if (!languages)                                        flags.push('NO_LANGUAGES');
  if (!hospitals)                                        flags.push('NO_HOSPITAL');
  if (!bookable)                                         flags.push('NOT_BOOKABLE');
  if (!gender || gender.toLowerCase() === 'unspecified') flags.push('GENDER_UNSPECIFIED');
  if (hasProceduresData && !treatments)                  flags.push('NO_TREATMENTS');

  return {
    id:              norm(c.id),
    fullname:        norm(c.fullname),
    url:             norm(c.url),
    photo_status:    photoStatus,
    specialties,
    qualifications:  quals,
    gmc_number:      gmc,
    languages,
    hospitals,
    bookable:        bookable ? 'Yes' : 'No',
    gender,
    gp_referral:     gpRef,
    days_until_appt: norm(c.daysUntilNextAppointment),
    treatments,
    missing_count:   flags.length,
    flags:           flags.join(' | '),
    flag_no_photo:            flags.includes('NO_PHOTO') ? 1 : 0,
    flag_placeholder_photo:   flags.includes('PLACEHOLDER_PHOTO') ? 1 : 0,
    flag_no_specialties:      flags.includes('NO_SPECIALTIES') ? 1 : 0,
    flag_no_qualifications:   flags.includes('NO_QUALIFICATIONS') ? 1 : 0,
    flag_no_gmc:              flags.includes('NO_GMC') ? 1 : 0,
    flag_no_languages:        flags.includes('NO_LANGUAGES') ? 1 : 0,
    flag_no_hospital:         flags.includes('NO_HOSPITAL') ? 1 : 0,
    flag_not_bookable:        flags.includes('NOT_BOOKABLE') ? 1 : 0,
    flag_gender_unspecified:  flags.includes('GENDER_UNSPECIFIED') ? 1 : 0,
    flag_no_treatments:       flags.includes('NO_TREATMENTS') ? 1 : 0,
  };
}

// ─── CSV writer ───────────────────────────────────────────────────────────────

function esc(v) {
  const s = String(v ?? '');
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(records) {
  const keys = Object.keys(records[0]);
  return [keys.join(','), ...records.map(r => keys.map(k => esc(r[k])).join(','))].join('\n');
}

// ─── Top treatments list ──────────────────────────────────────────────────────

function topTreatments(records, n = 30) {
  const counts = {};
  for (const r of records) {
    if (!r.treatments) continue;
    for (const t of r.treatments.split(' | ')) {
      const k = t.trim();
      if (k) counts[k] = (counts[k] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

// ─── HTML report ──────────────────────────────────────────────────────────────

function buildHtml(records, hasProceduresData) {
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
    no_treatments:      records.filter(r => r.flag_no_treatments).length,
    fully_complete:     records.filter(r => r.missing_count === 0).length,
  };

  const pct = n => ((n / total) * 100).toFixed(1) + '%';
  const bar = n => {
    const w = ((n / total) * 100).toFixed(1);
    return '<div class="bar-wrap"><div class="bar" style="width:' + w + '%"></div><span>' + n + ' (' + pct(n) + ')</span></div>';
  };

  const sorted = [...records].sort((a, b) => b.missing_count - a.missing_count);

  const topT = topTreatments(records, 40);

  // Row data for client-side JS
  const rowData = sorted.map(r => ({
    name:           r.fullname,
    url:            r.url,
    gaps:           r.missing_count,
    flags:          r.flags,
    specialties:    r.specialties,
    qualifications: r.qualifications,
    gmc:            r.gmc_number,
    bookable:       r.bookable,
    photo:          r.photo_status,
    hospitals:      r.hospitals,
    languages:      r.languages,
    gender:         r.gender,
    treatments:     r.treatments,
  }));

  // Safe JSON embed — replace </script> to avoid breaking the tag
  const rawJson = JSON.stringify(rowData).replace(/<\/script>/gi, '<\\/script>');
  const topJson = JSON.stringify(topT).replace(/<\/script>/gi, '<\\/script>');

  const treatmentsStatCard = hasProceduresData
    ? '<div class="stat orange clickable" onclick="setFlagFilter(\'NO_TREATMENTS\')" title="Click to filter table"><h3>No Treatments Listed &#x25BE;</h3><div class="number">' + counts.no_treatments + '</div>' + bar(counts.no_treatments) + '</div>'
    : '<div class="stat orange"><h3>No Treatments Listed</h3><div class="number">N/A</div><div class="pct">Run procedures scraper first</div></div>';

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Nuffield Health \u2014 Consultant Gap Analysis</title>\n<style>\n*{box-sizing:border-box;margin:0;padding:0}\nbody{font-family:\'Segoe UI\',Arial,sans-serif;background:#f8fafc;color:#1e293b;font-size:14px}\nh1{padding:24px 32px 4px;font-size:22px;color:#0f172a}\n.subtitle{padding:0 32px 20px;color:#64748b;font-size:13px}\n.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;padding:0 32px 24px}\n.stat{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;border-left:4px solid #3b82f6}\n.stat.red{border-color:#ef4444}.stat.orange{border-color:#f97316}.stat.yellow{border-color:#eab308}.stat.purple{border-color:#a855f7}.stat.green{border-color:#22c55e}.stat.pink{border-color:#ec4899}.stat.teal{border-color:#14b8a6}\n.stat h3{font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}\n.stat .number{font-size:28px;font-weight:700;line-height:1}\n.stat .pct{font-size:12px;color:#94a3b8;margin-top:4px}\n.bar-wrap{display:flex;align-items:center;gap:8px;height:20px;margin-top:6px}\n.bar{background:#3b82f6;height:10px;border-radius:4px;min-width:2px}\n.clickable{cursor:pointer;transition:transform .1s,box-shadow .1s}\n.clickable:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.1)}\n.clickable.active{outline:2px solid #2563eb;outline-offset:2px}\n.filters{padding:0 32px 16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}\n.filters input[type=text]{padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#fff;width:200px}\n.filters select{padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#fff}\n.count-label{font-size:13px;color:#64748b;margin-left:auto}\n.table-wrap{padding:0 32px 24px;overflow-x:auto}\ntable{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:13px}\nth{background:#f1f5f9;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;padding:10px 12px;text-align:left;cursor:pointer;white-space:nowrap;user-select:none}\nth:hover{background:#e2e8f0}th.sorted-asc::after{content:" \u25b2"}th.sorted-desc::after{content:" \u25bc"}\ntd{padding:7px 12px;border-top:1px solid #f1f5f9;vertical-align:top}\ntd a{color:#2563eb;text-decoration:none;font-weight:500}td a:hover{text-decoration:underline}\ntr.high td{background:#fff5f5}tr.ok td{background:#f0fdf4}\n.badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;color:#fff;margin:1px 2px;white-space:nowrap}\n.complete{color:#16a34a;font-weight:600;font-size:12px}\n.na{color:#cbd5e1}\n.center{text-align:center}\n.summary-bar{background:#1e293b;color:#f8fafc;padding:14px 32px;font-size:13px;display:flex;gap:32px;flex-wrap:wrap;align-items:center}\n.summary-bar .item{display:flex;flex-direction:column;gap:2px}\n.summary-bar .val{font-size:22px;font-weight:700}\n.summary-bar .lbl{font-size:11px;opacity:.6;text-transform:uppercase;letter-spacing:.5px}\n.export-btn{margin-left:auto;background:#3b82f6;color:#fff;border:none;padding:7px 16px;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600}\n.export-btn:hover{background:#2563eb}\n.section-title{padding:20px 32px 8px;font-size:13px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:.5px}\n.treatments-cell{max-width:340px;line-height:1.6}\n.treat-tag{display:inline-block;background:#e0f2fe;color:#0369a1;border-radius:4px;padding:1px 6px;font-size:11px;margin:1px 2px;white-space:nowrap}\n.top-treatments{padding:0 32px 24px;display:flex;flex-wrap:wrap;gap:8px}\n.tt{background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:5px 14px;font-size:13px;cursor:pointer;transition:background .15s}\n.tt:hover,.tt.selected{background:#2563eb;color:#fff;border-color:#2563eb}\n.tt .cnt{font-size:11px;opacity:.7;margin-left:4px}\n</style>\n</head>\n<body>\n<h1>Nuffield Health \u2014 Consultant Profile Gap Analysis</h1>\n<p class="subtitle">Generated ' + new Date().toLocaleString('en-GB') + ' \u00b7 ' + total.toLocaleString() + ' consultants</p>\n\n<div class="summary-bar">\n  <div class="item"><span class="val">' + total.toLocaleString() + '</span><span class="lbl">Total consultants</span></div>\n  <div class="item"><span class="val">' + counts.fully_complete.toLocaleString() + '</span><span class="lbl">Fully complete (' + pct(counts.fully_complete) + ')</span></div>\n  <div class="item"><span class="val">' + (total - counts.fully_complete).toLocaleString() + '</span><span class="lbl">Have \u22651 gap (' + pct(total - counts.fully_complete) + ')</span></div>\n  <button class="export-btn" onclick="exportCsv()">&#8593; Export filtered CSV</button>\n</div>\n\n<div class="section-title">Gap Summary \u2014 click a card to filter the list</div>\n<div class="stats-grid">\n  <div class="stat red clickable" onclick="setFlagFilter(\'NO_PHOTO\')" title="Click to filter"><h3>No Real Photo &#x25BE;</h3><div class="number">' + (counts.no_photo + counts.placeholder_photo) + '</div>' + bar(counts.no_photo + counts.placeholder_photo) + '<div class="pct">' + counts.no_photo + ' missing \u00b7 ' + counts.placeholder_photo + ' placeholder</div></div>\n  <div class="stat yellow clickable" onclick="setFlagFilter(\'NO_SPECIALTIES\')" title="Click to filter"><h3>No Specialties &#x25BE;</h3><div class="number">' + counts.no_specialties + '</div>' + bar(counts.no_specialties) + '</div>\n  <div class="stat purple clickable" onclick="setFlagFilter(\'NO_QUALIFICATIONS\')" title="Click to filter"><h3>No Qualifications &#x25BE;</h3><div class="number">' + counts.no_qualifications + '</div>' + bar(counts.no_qualifications) + '</div>\n  <div class="stat pink clickable" onclick="setFlagFilter(\'NO_GMC\')" title="Click to filter"><h3>No GMC Number &#x25BE;</h3><div class="number">' + counts.no_gmc + '</div>' + bar(counts.no_gmc) + '</div>\n  <div class="stat clickable" onclick="setFlagFilter(\'NO_LANGUAGES\')" title="Click to filter"><h3>No Languages &#x25BE;</h3><div class="number">' + counts.no_languages + '</div>' + bar(counts.no_languages) + '</div>\n  <div class="stat clickable" onclick="setFlagFilter(\'NOT_BOOKABLE\')" title="Click to filter"><h3>Not Bookable &#x25BE;</h3><div class="number">' + counts.not_bookable + '</div>' + bar(counts.not_bookable) + '</div>\n  <div class="stat clickable" onclick="setFlagFilter(\'NO_HOSPITAL\')" title="Click to filter"><h3>No Hospital &#x25BE;</h3><div class="number">' + counts.no_hospital + '</div>' + bar(counts.no_hospital) + '</div>\n  <div class="stat clickable" onclick="setFlagFilter(\'GENDER_UNSPECIFIED\')" title="Click to filter"><h3>Gender Unspecified &#x25BE;</h3><div class="number">' + counts.gender_unspecified + '</div>' + bar(counts.gender_unspecified) + '</div>\n  ' + treatmentsStatCard + '\n  <div class="stat green clickable" onclick="clearAllFilters()" title="Show all"><h3>Fully Complete &#x25BE;</h3><div class="number">' + counts.fully_complete + '</div>' + bar(counts.fully_complete) + '</div>\n</div>\n\n<div class="section-title">Search by Procedure / Treatment</div>\n<div style="padding:0 32px 8px;color:#64748b;font-size:12px">Click a treatment to see all consultants who offer it, or type in the search box below.</div>\n<div class="top-treatments" id="topTreatments"></div>\n\n<div class="section-title">All Consultants</div>\n<div class="filters">\n  <input type="text" id="searchBox" placeholder="Search name\u2026" oninput="applyFilters()">\n  <input type="text" id="treatmentSearch" placeholder="Search treatment e.g. hip replacement\u2026" oninput="applyFilters()" style="width:260px">\n  <select id="flagFilter" onchange="applyFilters()">\n    <option value="">All consultants</option>\n    <option value="gaps">Has any gap</option>\n    <option value="NO_PHOTO">No photo</option>\n    <option value="PLACEHOLDER_PHOTO">Placeholder photo</option>\n    <option value="NO_SPECIALTIES">No specialties</option>\n    <option value="NO_QUALIFICATIONS">No qualifications</option>\n    <option value="NO_GMC">No GMC number</option>\n    <option value="NO_LANGUAGES">No languages</option>\n    <option value="NO_HOSPITAL">No hospital</option>\n    <option value="NOT_BOOKABLE">Not bookable</option>\n    <option value="GENDER_UNSPECIFIED">Gender unspecified</option>\n    <option value="NO_TREATMENTS">No treatments listed</option>\n  </select>\n  <select id="gapCount" onchange="applyFilters()">\n    <option value="">Any gap count</option>\n    <option value="0">0 gaps (complete)</option>\n    <option value="1">1 gap</option>\n    <option value="2">2 gaps</option>\n    <option value="3+">3+ gaps (high priority)</option>\n  </select>\n  <span class="count-label" id="countLabel"></span>\n</div>\n\n<div class="table-wrap">\n  <table id="mainTable">\n    <thead>\n      <tr>\n        <th data-sort="name" onclick="sortBy(this.dataset.sort)">Consultant</th>\n        <th class="center sorted-desc" data-sort="gaps" onclick="sortBy(this.dataset.sort)">Gaps</th>\n        <th>Missing Components</th>\n        <th data-sort="specialties" onclick="sortBy(this.dataset.sort)">Specialty</th>\n        <th>Treatments / Procedures</th>\n        <th>GMC #</th>\n        <th>Bookable</th>\n        <th>Photo</th>\n      </tr>\n    </thead>\n    <tbody id="tableBody"></tbody>\n  </table>\n</div>\n\n<script>\nconst FLAG_LABELS = {\n  NO_PHOTO:           {label:\'No Photo\',color:\'#ef4444\'},\n  PLACEHOLDER_PHOTO:  {label:\'Placeholder Photo\',color:\'#f97316\'},\n  NO_SPECIALTIES:     {label:\'No Specialties\',color:\'#eab308\'},\n  NO_QUALIFICATIONS:  {label:\'No Qualifications\',color:\'#a855f7\'},\n  NO_GMC:             {label:\'No GMC #\',color:\'#ec4899\'},\n  NO_LANGUAGES:       {label:\'No Languages\',color:\'#6366f1\'},\n  NO_HOSPITAL:        {label:\'No Hospital\',color:\'#0ea5e9\'},\n  NOT_BOOKABLE:       {label:\'Not Bookable\',color:\'#64748b\'},\n  GENDER_UNSPECIFIED: {label:\'Gender Unspecified\',color:\'#94a3b8\'},\n  NO_TREATMENTS:      {label:\'No Treatments\',color:\'#f97316\'},\n};\n\nconst RAW = ' + rawJson + ';\nconst TOP_TREATMENTS = ' + topJson + ';\n\nlet sortField = \'gaps\', sortDir = -1;\nlet selectedTreatment = \'\';\n\n// Render top treatments chips (uses data-name + event delegation — no inline onclick)\nfunction renderTopTreatments() {\n  const container = document.getElementById(\'topTreatments\');\n  container.innerHTML = TOP_TREATMENTS.map(t => {\n    const safe = t.name.replace(/&/g,\'&amp;\').replace(/</g,\'&lt;\').replace(/"/g,\'&quot;\');\n    return \'<span class="tt" data-name="\' + safe + \'">\' + safe + \'<span class="cnt">\' + t.count + \'</span></span>\';\n  }).join(\'\');\n  container.addEventListener(\'click\', function(e) {\n    const el = e.target.closest(\'.tt\');\n    if (el) selectTreatment(el, el.dataset.name);\n  });\n}\n\nfunction selectTreatment(el, name) {\n  if (selectedTreatment === name) {\n    selectedTreatment = \'\';\n    document.querySelectorAll(\'.tt\').forEach(t => t.classList.remove(\'selected\'));\n  } else {\n    selectedTreatment = name;\n    document.querySelectorAll(\'.tt\').forEach(t => t.classList.remove(\'selected\'));\n    el.classList.add(\'selected\');\n  }\n  document.getElementById(\'treatmentSearch\').value = \'\';\n  applyFilters();\n  document.getElementById(\'mainTable\').scrollIntoView({behavior:\'smooth\',block:\'start\'});\n}\n\nfunction flagBadges(flagStr) {\n  if (!flagStr) return \'<span class="complete">&#10003; Complete</span>\';\n  return flagStr.split(\' | \').map(f => {\n    const m = FLAG_LABELS[f] || {label:f,color:\'#999\'};\n    return \'<span class="badge" style="background:\' + m.color + \'">\' + m.label + \'</span>\';\n  }).join(\' \');\n}\n\nfunction treatmentTags(treatStr, highlight) {\n  if (!treatStr) return \'<span class="na">\u2014</span>\';\n  return treatStr.split(\' | \').map(t => {\n    const hl = highlight && t.toLowerCase().includes(highlight.toLowerCase());\n    return \'<span class="treat-tag\' + (hl ? \'" style="background:#fef08a;color:#713f12\': \'\') + \'">\' + t + \'</span>\';\n  }).join(\'\');\n}\n\nfunction renderTable(data) {\n  const highlight = (document.getElementById(\'treatmentSearch\').value || selectedTreatment).toLowerCase();\n  const tbody = document.getElementById(\'tableBody\');\n  tbody.innerHTML = data.map(r => {\n    const cls = r.gaps >= 3 ? \'high\' : r.gaps === 0 ? \'ok\' : \'\';\n    return \'<tr class="\' + cls + \'">\'\n      + \'<td><a href="\' + r.url + \'" target="_blank">\' + r.name + \'</a></td>\'\n      + \'<td class="center">\' + r.gaps + \'</td>\'\n      + \'<td>\' + flagBadges(r.flags) + \'</td>\'\n      + \'<td>\' + (r.specialties || \'<span class="na">\u2014</span>\') + \'</td>\'\n      + \'<td class="treatments-cell">\' + treatmentTags(r.treatments, highlight) + \'</td>\'\n      + \'<td>\' + (r.gmc || \'<span class="na">\u2014</span>\') + \'</td>\'\n      + \'<td>\' + r.bookable + \'</td>\'\n      + \'<td>\' + r.photo + \'</td>\'\n      + \'</tr>\';\n  }).join(\'\');\n  document.getElementById(\'countLabel\').textContent = \'Showing \' + data.length.toLocaleString() + \' of \' + RAW.length.toLocaleString();\n}\n\nfunction applyFilters() {\n  const q         = document.getElementById(\'searchBox\').value.toLowerCase();\n  const tq        = (document.getElementById(\'treatmentSearch\').value || selectedTreatment).toLowerCase();\n  const flag      = document.getElementById(\'flagFilter\').value;\n  const gc        = document.getElementById(\'gapCount\').value;\n\n  // If user types in treatment box, clear chip selection\n  if (document.getElementById(\'treatmentSearch\').value) {\n    selectedTreatment = \'\';\n    document.querySelectorAll(\'.tt\').forEach(t => t.classList.remove(\'selected\'));\n  }\n\n  let data = RAW.filter(r => {\n    if (q && !r.name.toLowerCase().includes(q)) return false;\n    if (tq && !r.treatments.toLowerCase().includes(tq)) return false;\n    if (flag === \'gaps\' && r.gaps === 0) return false;\n    if (flag && flag !== \'gaps\' && !r.flags.includes(flag)) return false;\n    if (gc === \'0\' && r.gaps !== 0) return false;\n    if (gc === \'1\' && r.gaps !== 1) return false;\n    if (gc === \'2\' && r.gaps !== 2) return false;\n    if (gc === \'3+\' && r.gaps < 3) return false;\n    return true;\n  });\n\n  data = [...data].sort((a,b) => {\n    let av = a[sortField], bv = b[sortField];\n    if (typeof av === \'string\') { av = av.toLowerCase(); bv = bv.toLowerCase(); }\n    return av < bv ? -sortDir : av > bv ? sortDir : 0;\n  });\n\n  renderTable(data);\n}\n\nfunction sortBy(field) {\n  if (sortField === field) { sortDir *= -1; } else { sortField = field; sortDir = -1; }\n  document.querySelectorAll(\'th[data-sort]\').forEach(th => {\n    th.classList.remove(\'sorted-asc\',\'sorted-desc\');\n    if (th.dataset.sort === field) th.classList.add(sortDir === 1 ? \'sorted-asc\' : \'sorted-desc\');\n  });\n  applyFilters();\n}\n\nfunction setFlagFilter(flag) {\n  document.getElementById(\'flagFilter\').value = flag || \'\';\n  document.querySelectorAll(\'.clickable\').forEach(el => el.classList.remove(\'active\'));\n  if (flag) {\n    const el = document.querySelector(\'[onclick*="\' + flag + \'"]\');\n    if (el) el.classList.add(\'active\');\n  }\n  applyFilters();\n  document.getElementById(\'mainTable\').scrollIntoView({behavior:\'smooth\',block:\'start\'});\n}\n\nfunction clearAllFilters() {\n  document.getElementById(\'searchBox\').value = \'\';\n  document.getElementById(\'treatmentSearch\').value = \'\';\n  document.getElementById(\'flagFilter\').value = \'\';\n  document.getElementById(\'gapCount\').value = \'\';\n  selectedTreatment = \'\';\n  document.querySelectorAll(\'.tt,.clickable\').forEach(el => el.classList.remove(\'selected\',\'active\'));\n  sortField = \'gaps\'; sortDir = -1;\n  applyFilters();\n}\n\nfunction exportCsv() {\n  const headers = [\'Name\',\'URL\',\'Gaps\',\'Flags\',\'Specialties\',\'Qualifications\',\'GMC\',\'Bookable\',\'Photo\',\'Hospitals\',\'Languages\',\'Gender\',\'Treatments\'];\n  const visible = Array.from(document.querySelectorAll(\'#tableBody tr\')).filter(r => r.style.display !== \'none\').map(row => {\n    const cells = row.querySelectorAll(\'td\');\n    return [\n      cells[0].textContent.trim(),\n      cells[0].querySelector(\'a\').href,\n      cells[1].textContent.trim(),\n      cells[2].textContent.trim(),\n      cells[3].textContent.trim(),\n      \'\',\'\',\n      cells[6].textContent.trim(),\n      cells[7].textContent.trim(),\n      \'\',\'\',\'\',\n      cells[4].textContent.trim(),\n    ];\n  });\n  const csvStr = [headers, ...visible].map(row =>\n    row.map(v => { const s=String(v); return (s.includes(\',\')||s.includes(\'"\')) ? \'"\'+s.replace(/"/g,\'""\')+\'"\' : s; }).join(\',\')\n  ).join(String.fromCharCode(13,10));\n  const a = document.createElement(\'a\');\n  a.href = \'data:text/csv;charset=utf-8,\' + encodeURIComponent(csvStr);\n  a.download = \'nuffield_gap_filtered.csv\';\n  a.click();\n}\n\nrenderTopTreatments();\napplyFilters();\n</script>\n</body>\n</html>';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const consultants    = csvToObjects(readFileSync('nuffield_consultants.csv', 'utf8'));
const proceduresMap  = loadProcedures();

console.log(`Loaded ${consultants.length} consultants`);
console.log(`Procedures data: ${proceduresMap.size > 0 ? proceduresMap.size + ' consultants' : 'not yet available (run nuffield_procedures_scraper.mjs first)'}`);

const analysed = consultants.map(c => analyse(c, proceduresMap));

const total = analysed.length;
const pct   = n => ((n / total) * 100).toFixed(1) + '%';
const pad   = (s, n) => String(s).padStart(n);
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
  no_treatments:      analysed.filter(r => r.flag_no_treatments).length,
  fully_complete:     analysed.filter(r => r.missing_count === 0).length,
};

console.log('\n── Gap Summary ─────────────────────────────────────');
console.log(`  No photo (missing entirely):    ${pad(counts.no_photo, 4)}  (${pct(counts.no_photo)})`);
console.log(`  Placeholder/generic photo:      ${pad(counts.placeholder_photo, 4)}  (${pct(counts.placeholder_photo)})`);
console.log(`  No specialties listed:          ${pad(counts.no_specialties, 4)}  (${pct(counts.no_specialties)})`);
console.log(`  No qualifications listed:       ${pad(counts.no_qualifications, 4)}  (${pct(counts.no_qualifications)})`);
console.log(`  No GMC number:                  ${pad(counts.no_gmc, 4)}  (${pct(counts.no_gmc)})`);
console.log(`  No languages listed:            ${pad(counts.no_languages, 4)}  (${pct(counts.no_languages)})`);
console.log(`  No hospital listed:             ${pad(counts.no_hospital, 4)}  (${pct(counts.no_hospital)})`);
console.log(`  Not bookable online:            ${pad(counts.not_bookable, 4)}  (${pct(counts.not_bookable)})`);
console.log(`  Gender unspecified:             ${pad(counts.gender_unspecified, 4)}  (${pct(counts.gender_unspecified)})`);
if (proceduresMap.size > 0)
  console.log(`  No treatments listed:           ${pad(counts.no_treatments, 4)}  (${pct(counts.no_treatments)})`);
console.log('  ───────────────────────────────────────────────────');
console.log(`  Fully complete profiles:        ${pad(counts.fully_complete, 4)}  (${pct(counts.fully_complete)})`);

writeFileSync('nuffield_gap_analysis.csv',  toCsv(analysed),                       'utf8');
writeFileSync('nuffield_gap_analysis.html', buildHtml(analysed, proceduresMap.size > 0), 'utf8');
console.log('\nCSV  saved: nuffield_gap_analysis.csv');
console.log('HTML saved: nuffield_gap_analysis.html');
console.log(`\nDone — ${new Date().toISOString()}`);
