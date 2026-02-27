#!/usr/bin/env node
/**
 * Nuffield Health Consultant Gap Analysis
 * Fetches all consultants and flags missing key components.
 * Outputs: nuffield_gap_analysis.csv + nuffield_gap_analysis.html
 */

import { writeFileSync } from 'fs';

const SWIFTYPE_URL = 'https://search-api.swiftype.com/api/v1/public/engines/search.json';
const ENGINE_KEY = 'sR_cCweEaptts3ExMPzv';
const PER_PAGE = 100;

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchPage(pageNum) {
  const res = await fetch(SWIFTYPE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      engine_key: ENGINE_KEY,
      per_page: PER_PAGE,
      page: pageNum,
      sort_direction: { page: 'availabilityRank' },
      sort_field: { page: 'availabilityRank' },
      q: '',
      filters: { page: { type: { type: 'and', values: ['Consultant'] } } }
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on page ${pageNum}`);
  return res.json();
}

function normalise(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join('; ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).trim();
}

// ─── Photo classification ────────────────────────────────────────────────────

const PLACEHOLDER_FILENAMES = [
  'consultant-portrait',
  'placeholder',
  'no-image',
  'default-consultant',
  'silhouette',
];

function classifyPhoto(imageUrl) {
  if (!imageUrl) return 'missing';
  const afterUrl = imageUrl.split('url=')[1] || '';
  if (!afterUrl || afterUrl.trim() === '') return 'missing';
  const lower = afterUrl.toLowerCase();
  for (const pat of PLACEHOLDER_FILENAMES) {
    if (lower.includes(pat)) return 'placeholder';
  }
  return 'real';
}

// ─── Gap checks ─────────────────────────────────────────────────────────────

function analyseConsultant(c) {
  const photoStatus = classifyPhoto(c.image);

  const specialties = normalise(c.specialties);
  const quals = normalise(c.professionalQualifications);
  const languages = normalise(c.languages);
  const hospitals = normalise(c.hospitals);
  const gmc = normalise(c.gmcNumber);
  const bookable = String(c.bookable) === 'true';
  const gender = normalise(c.gender);
  const gpRef = normalise(c.gpReferralRequired);

  const flags = [];
  if (photoStatus === 'missing')     flags.push('NO_PHOTO');
  if (photoStatus === 'placeholder') flags.push('PLACEHOLDER_PHOTO');
  if (!specialties)                  flags.push('NO_SPECIALTIES');
  if (!quals)                        flags.push('NO_QUALIFICATIONS');
  if (!gmc)                          flags.push('NO_GMC');
  if (!languages)                    flags.push('NO_LANGUAGES');
  if (!hospitals)                    flags.push('NO_HOSPITAL');
  if (!bookable)                     flags.push('NOT_BOOKABLE');
  if (gender === 'Unspecified' || !gender) flags.push('GENDER_UNSPECIFIED');

  return {
    id: c.id || '',
    fullname: c.fullname || '',
    url: c.url || '',
    photo_status: photoStatus,
    specialties,
    qualifications: quals,
    gmc_number: gmc,
    languages,
    hospitals,
    bookable: bookable ? 'Yes' : 'No',
    gender,
    gp_referral: gpRef,
    days_until_appt: normalise(c.daysUntilNextAppointment),
    missing_count: flags.length,
    flags: flags.join(' | '),
    // Individual flag columns for easy filtering
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

// ─── CSV writer ──────────────────────────────────────────────────────────────

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

// ─── HTML report ─────────────────────────────────────────────────────────────

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

  function pct(n) { return ((n / total) * 100).toFixed(1) + '%'; }
  function bar(n) {
    const w = ((n / total) * 100).toFixed(1);
    return `<div class="bar-wrap"><div class="bar" style="width:${w}%"></div><span>${n} (${pct(n)})</span></div>`;
  }

  // Sort: most flags first
  const sorted = [...records].sort((a, b) => b.missing_count - a.missing_count);

  const FLAG_LABELS = {
    NO_PHOTO:           { label: 'No Photo',          color: '#ef4444' },
    PLACEHOLDER_PHOTO:  { label: 'Placeholder Photo', color: '#f97316' },
    NO_SPECIALTIES:     { label: 'No Specialties',    color: '#eab308' },
    NO_QUALIFICATIONS:  { label: 'No Qualifications', color: '#a855f7' },
    NO_GMC:             { label: 'No GMC#',           color: '#ec4899' },
    NO_LANGUAGES:       { label: 'No Languages',      color: '#6366f1' },
    NO_HOSPITAL:        { label: 'No Hospital',       color: '#0ea5e9' },
    NOT_BOOKABLE:       { label: 'Not Bookable',      color: '#64748b' },
    GENDER_UNSPECIFIED: { label: 'Gender Unspecified',color: '#94a3b8' },
  };

  function flagBadges(flagStr) {
    if (!flagStr) return '<span class="complete">✓ Complete</span>';
    return flagStr.split(' | ').map(f => {
      const meta = FLAG_LABELS[f] || { label: f, color: '#999' };
      return `<span class="badge" style="background:${meta.color}">${meta.label}</span>`;
    }).join(' ');
  }

  const tableRows = sorted.map(r => `
    <tr class="${r.missing_count >= 3 ? 'high' : r.missing_count >= 1 ? 'low' : 'ok'}">
      <td><a href="${r.url}" target="_blank">${r.fullname}</a></td>
      <td class="center">${r.missing_count}</td>
      <td>${flagBadges(r.flags)}</td>
      <td>${r.specialties || '<em class="na">—</em>'}</td>
      <td>${r.gmc_number || '<em class="na">—</em>'}</td>
      <td>${r.bookable}</td>
      <td>${r.photo_status}</td>
    </tr>`).join('\n');

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
  .stat.red{border-color:#ef4444}
  .stat.orange{border-color:#f97316}
  .stat.yellow{border-color:#eab308}
  .stat.purple{border-color:#a855f7}
  .stat.green{border-color:#22c55e}
  .stat h3{font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
  .stat .number{font-size:28px;font-weight:700;line-height:1}
  .stat .pct{font-size:12px;color:#94a3b8;margin-top:4px}
  .bar-wrap{display:flex;align-items:center;gap:8px;height:20px}
  .bar{background:#3b82f6;height:10px;border-radius:4px;min-width:2px;transition:width .3s}
  .filters{padding:0 32px 16px;display:flex;gap:12px;flex-wrap:wrap}
  .filters select,.filters input{padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;background:#fff}
  .filters label{font-size:13px;color:#475569;display:flex;align-items:center;gap:6px}
  .table-wrap{padding:0 32px 40px;overflow-x:auto}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
  th{background:#f1f5f9;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.5px;padding:10px 14px;text-align:left;cursor:pointer;white-space:nowrap}
  th:hover{background:#e2e8f0}
  td{padding:8px 14px;border-top:1px solid #f1f5f9;vertical-align:middle}
  td a{color:#2563eb;text-decoration:none;font-weight:500}
  td a:hover{text-decoration:underline}
  tr.high td{background:#fff5f5}
  tr.ok td{background:#f0fdf4}
  .badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:600;color:#fff;margin:1px 2px}
  .complete{color:#16a34a;font-weight:600;font-size:12px}
  .na{color:#cbd5e1;font-style:italic}
  .center{text-align:center}
  .summary-bar{background:#1e293b;color:#f8fafc;padding:12px 32px;font-size:13px;display:flex;gap:24px;flex-wrap:wrap}
  .summary-bar span{opacity:.7}
  .summary-bar strong{opacity:1}
</style>
</head>
<body>
<h1>Nuffield Health — Consultant Profile Gap Analysis</h1>
<p class="subtitle">Generated ${new Date().toLocaleString('en-GB')} · ${total.toLocaleString()} consultants analysed</p>

<div class="summary-bar">
  <div><strong>${counts.fully_complete.toLocaleString()}</strong> <span>fully complete (${pct(counts.fully_complete)})</span></div>
  <div><strong>${(total - counts.fully_complete).toLocaleString()}</strong> <span>have ≥1 gap (${pct(total - counts.fully_complete)})</span></div>
</div>

<div style="padding:20px 32px 8px;font-size:13px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:.5px">Gap Summary</div>
<div class="stats-grid">
  <div class="stat red"><h3>No Real Photo</h3><div class="number">${counts.no_photo + counts.placeholder_photo}</div>${bar(counts.no_photo + counts.placeholder_photo)}<div class="pct">${counts.no_photo} missing entirely, ${counts.placeholder_photo} using placeholder</div></div>
  <div class="stat yellow"><h3>No Specialties</h3><div class="number">${counts.no_specialties}</div>${bar(counts.no_specialties)}</div>
  <div class="stat purple"><h3>No Qualifications</h3><div class="number">${counts.no_qualifications}</div>${bar(counts.no_qualifications)}</div>
  <div class="stat orange"><h3>No GMC Number</h3><div class="number">${counts.no_gmc}</div>${bar(counts.no_gmc)}</div>
  <div class="stat"><h3>No Languages Listed</h3><div class="number">${counts.no_languages}</div>${bar(counts.no_languages)}</div>
  <div class="stat"><h3>Not Bookable Online</h3><div class="number">${counts.not_bookable}</div>${bar(counts.not_bookable)}</div>
  <div class="stat"><h3>No Hospital Listed</h3><div class="number">${counts.no_hospital}</div>${bar(counts.no_hospital)}</div>
  <div class="stat"><h3>Gender Unspecified</h3><div class="number">${counts.gender_unspecified}</div>${bar(counts.gender_unspecified)}</div>
  <div class="stat green"><h3>Fully Complete</h3><div class="number">${counts.fully_complete}</div>${bar(counts.fully_complete)}</div>
</div>

<div class="filters">
  <input type="text" id="searchBox" placeholder="Search consultant name…" oninput="filterTable()">
  <label><input type="checkbox" id="filterGaps" onchange="filterTable()"> Show only consultants with gaps</label>
  <label><input type="checkbox" id="filterPhoto" onchange="filterTable()"> Missing / placeholder photo only</label>
  <label><input type="checkbox" id="filterGmc" onchange="filterTable()"> Missing GMC only</label>
  <select id="sortSelect" onchange="sortTable(this.value)">
    <option value="gaps_desc">Sort: most gaps first</option>
    <option value="gaps_asc">Sort: fewest gaps first</option>
    <option value="name_asc">Sort: name A–Z</option>
  </select>
</div>

<div class="table-wrap">
  <table id="mainTable">
    <thead>
      <tr>
        <th>Consultant</th>
        <th class="center">Gaps</th>
        <th>Missing Components</th>
        <th>Specialties</th>
        <th>GMC #</th>
        <th>Bookable</th>
        <th>Photo</th>
      </tr>
    </thead>
    <tbody id="tableBody">
${tableRows}
    </tbody>
  </table>
</div>

<script>
  const allRows = Array.from(document.querySelectorAll('#tableBody tr'));

  function filterTable() {
    const q = document.getElementById('searchBox').value.toLowerCase();
    const gapsOnly = document.getElementById('filterGaps').checked;
    const photoOnly = document.getElementById('filterPhoto').checked;
    const gmcOnly = document.getElementById('filterGmc').checked;

    allRows.forEach(row => {
      const name = row.cells[0].textContent.toLowerCase();
      const gaps = parseInt(row.cells[1].textContent);
      const flags = row.cells[2].textContent;
      const photo = row.cells[6].textContent.trim();
      const gmc = row.cells[4].textContent.trim();

      let show = true;
      if (q && !name.includes(q)) show = false;
      if (gapsOnly && gaps === 0) show = false;
      if (photoOnly && !flags.includes('Photo') && photo === 'real') show = false;
      if (gmcOnly && gmc !== '—') show = false;

      row.style.display = show ? '' : 'none';
    });
  }

  function sortTable(mode) {
    const tbody = document.getElementById('tableBody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    rows.sort((a, b) => {
      if (mode === 'gaps_desc') return parseInt(b.cells[1].textContent) - parseInt(a.cells[1].textContent);
      if (mode === 'gaps_asc') return parseInt(a.cells[1].textContent) - parseInt(b.cells[1].textContent);
      if (mode === 'name_asc') return a.cells[0].textContent.localeCompare(b.cells[0].textContent);
      return 0;
    });
    rows.forEach(r => tbody.appendChild(r));
  }
</script>
</body>
</html>`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Nuffield Consultant Gap Analysis — ${new Date().toISOString()}`);
  console.log('Fetching all consultant data...\n');

  const firstPage = await fetchPage(1);
  const total = firstPage.info.page.total_result_count;
  const numPages = firstPage.info.page.num_pages;
  console.log(`Total: ${total} consultants across ${numPages} pages`);

  const allRaw = [...firstPage.records.page];
  process.stdout.write(`  Page 1/${numPages}: ${allRaw.length} records`);

  for (let p = 2; p <= numPages; p++) {
    await sleep(350);
    try {
      const data = await fetchPage(p);
      allRaw.push(...data.records.page);
      process.stdout.write(`\r  Fetched ${allRaw.length}/${total} consultants`);
    } catch (err) {
      console.error(`\n  ERROR page ${p}: ${err.message}`);
      await sleep(2000);
    }
  }

  console.log(`\n\nAnalysing ${allRaw.length} records...`);
  const analysed = allRaw.map(analyseConsultant);

  // Summary
  const counts = {
    no_photo:          analysed.filter(r => r.flag_no_photo).length,
    placeholder_photo: analysed.filter(r => r.flag_placeholder_photo).length,
    no_specialties:    analysed.filter(r => r.flag_no_specialties).length,
    no_qualifications: analysed.filter(r => r.flag_no_qualifications).length,
    no_gmc:            analysed.filter(r => r.flag_no_gmc).length,
    no_languages:      analysed.filter(r => r.flag_no_languages).length,
    no_hospital:       analysed.filter(r => r.flag_no_hospital).length,
    not_bookable:      analysed.filter(r => r.flag_not_bookable).length,
    gender_unspecified:analysed.filter(r => r.flag_gender_unspecified).length,
    fully_complete:    analysed.filter(r => r.missing_count === 0).length,
  };

  console.log('\n── Gap Summary ──────────────────────────────────');
  const pad = (s, n) => String(s).padStart(n);
  const pct = n => ((n / allRaw.length) * 100).toFixed(1) + '%';
  console.log(`  No photo (missing entirely):   ${pad(counts.no_photo, 4)}  (${pct(counts.no_photo)})`);
  console.log(`  Placeholder/generic photo:     ${pad(counts.placeholder_photo, 4)}  (${pct(counts.placeholder_photo)})`);
  console.log(`  No specialties listed:         ${pad(counts.no_specialties, 4)}  (${pct(counts.no_specialties)})`);
  console.log(`  No qualifications listed:      ${pad(counts.no_qualifications, 4)}  (${pct(counts.no_qualifications)})`);
  console.log(`  No GMC number:                 ${pad(counts.no_gmc, 4)}  (${pct(counts.no_gmc)})`);
  console.log(`  No languages listed:           ${pad(counts.no_languages, 4)}  (${pct(counts.no_languages)})`);
  console.log(`  No hospital listed:            ${pad(counts.no_hospital, 4)}  (${pct(counts.no_hospital)})`);
  console.log(`  Not bookable online:           ${pad(counts.not_bookable, 4)}  (${pct(counts.not_bookable)})`);
  console.log(`  Gender unspecified:            ${pad(counts.gender_unspecified, 4)}  (${pct(counts.gender_unspecified)})`);
  console.log('  ────────────────────────────────────────────────');
  console.log(`  Fully complete profiles:       ${pad(counts.fully_complete, 4)}  (${pct(counts.fully_complete)})`);
  console.log(`  Have ≥1 gap:                   ${pad(allRaw.length - counts.fully_complete, 4)}  (${pct(allRaw.length - counts.fully_complete)})`);

  // Write CSV
  const csvFile = 'nuffield_gap_analysis.csv';
  writeFileSync(csvFile, toCsv(analysed), 'utf8');
  console.log(`\nCSV saved: ${csvFile}`);

  // Write HTML
  const htmlFile = 'nuffield_gap_analysis.html';
  writeFileSync(htmlFile, buildHtml(analysed), 'utf8');
  console.log(`HTML report saved: ${htmlFile}`);
  console.log(`\nDone — ${new Date().toISOString()}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
