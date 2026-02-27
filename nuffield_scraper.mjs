#!/usr/bin/env node
/**
 * Nuffield Health Consultant Scraper
 * Fetches all consultants via the Swiftype search API used by the website.
 */

import { writeFileSync, createWriteStream } from 'fs';

const SWIFTYPE_URL = 'https://search-api.swiftype.com/api/v1/public/engines/search.json';
const ENGINE_KEY = 'sR_cCweEaptts3ExMPzv';
const PER_PAGE = 100;

const FIELDS = [
  'id', 'fullname', 'firstname', 'lastname', 'title',
  'url', 'gender', 'specialties', 'hospitals', 'locations',
  'image', 'bookable', 'gmcNumber', 'professionalQualifications',
  'languages', 'offersPaediatrics', 'roboticAssistedSurgery',
  'gpReferralRequired', 'daysUntilNextAppointment', 'availabilityRank',
  'popularity', 'updated_at'
];

function flattenValue(v) {
  if (Array.isArray(v) || (typeof v === 'object' && v !== null)) {
    return JSON.stringify(v);
  }
  return v != null ? String(v) : '';
}

function escapeCsv(val) {
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsvRow(record) {
  return FIELDS.map(f => escapeCsv(flattenValue(record[f]))).join(',');
}

async function fetchPage(pageNum) {
  const payload = {
    engine_key: ENGINE_KEY,
    per_page: PER_PAGE,
    page: pageNum,
    sort_direction: { page: 'availabilityRank' },
    sort_field: { page: 'availabilityRank' },
    q: '',
    filters: {
      page: { type: { type: 'and', values: ['Consultant'] } }
    }
  };

  const res = await fetch(SWIFTYPE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; research-scraper/1.0)'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} on page ${pageNum}`);
  return res.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const outputFile = 'nuffield_consultants.csv';
  console.log(`Starting Nuffield Health consultant scrape — ${new Date().toISOString()}`);

  console.log('Fetching page 1 to determine total results...');
  const firstPage = await fetchPage(1);

  const total = firstPage.info.page.total_result_count;
  const numPages = firstPage.info.page.num_pages;
  console.log(`Total consultants: ${total}`);
  console.log(`Total pages (at ${PER_PAGE}/page): ${numPages}`);

  const allRecords = [...firstPage.records.page];
  console.log(`  Page 1/${numPages}: ${firstPage.records.page.length} records`);

  for (let pageNum = 2; pageNum <= numPages; pageNum++) {
    await sleep(400); // polite delay
    try {
      const data = await fetchPage(pageNum);
      const records = data.records.page;
      allRecords.push(...records);
      process.stdout.write(`\r  Page ${pageNum}/${numPages}: collected ${allRecords.length} records so far`);
    } catch (err) {
      console.error(`\n  ERROR on page ${pageNum}: ${err.message}`);
      await sleep(2000);
    }
  }

  console.log(`\n\nTotal records collected: ${allRecords.length}`);

  // Write CSV
  const lines = [FIELDS.join(',')];
  for (const rec of allRecords) {
    lines.push(toCsvRow(rec));
  }
  writeFileSync(outputFile, lines.join('\n'), 'utf8');

  console.log(`Saved to: ${outputFile}`);
  console.log(`Done — ${new Date().toISOString()}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
