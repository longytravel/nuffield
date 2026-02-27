#!/usr/bin/env python3
"""
Nuffield Health Consultant Scraper
Fetches all consultants via the Swiftype search API used by the website.
"""

import requests
import csv
import json
import time
import sys
from datetime import datetime

SWIFTYPE_URL = "https://search-api.swiftype.com/api/v1/public/engines/search.json"
ENGINE_KEY = "sR_cCweEaptts3ExMPzv"
PER_PAGE = 100

# Fields to extract from each consultant record
FIELDS = [
    "id", "fullname", "firstname", "lastname", "title",
    "url", "gender", "specialties", "hospitals", "locations",
    "image", "bookable", "gmcNumber", "professionalQualifications",
    "languages", "offersPaediatrics", "roboticAssistedSurgery",
    "gpReferralRequired", "daysUntilNextAppointment", "availabilityRank",
    "popularity", "updated_at"
]


def fetch_page(page_num):
    payload = {
        "engine_key": ENGINE_KEY,
        "per_page": PER_PAGE,
        "page": page_num,
        "sort_direction": {"page": "availabilityRank"},
        "sort_field": {"page": "availabilityRank"},
        "q": "",
        "filters": {
            "page": {
                "type": {"type": "and", "values": ["Consultant"]}
            }
        }
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; research-scraper/1.0)"
    }
    resp = requests.post(SWIFTYPE_URL, json=payload, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.json()


def flatten_value(v):
    """Convert lists/dicts to a JSON string for CSV storage."""
    if isinstance(v, (list, dict)):
        return json.dumps(v)
    return v if v is not None else ""


def main():
    output_file = "nuffield_consultants.csv"
    print(f"Starting Nuffield Health consultant scrape — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # First request to get total count
    print("Fetching page 1 to determine total results...")
    first_page = fetch_page(1)

    total = first_page["info"]["page"]["total_result_count"]
    num_pages = first_page["info"]["page"]["num_pages"]
    print(f"Total consultants: {total}")
    print(f"Total pages (at {PER_PAGE}/page): {num_pages}")

    all_records = first_page["records"]["page"]
    print(f"  Page 1: {len(all_records)} records")

    for page_num in range(2, num_pages + 1):
        time.sleep(0.4)  # polite delay between requests
        try:
            data = fetch_page(page_num)
            records = data["records"]["page"]
            all_records.extend(records)
            print(f"  Page {page_num}/{num_pages}: {len(records)} records (total so far: {len(all_records)})")
        except Exception as e:
            print(f"  ERROR on page {page_num}: {e}", file=sys.stderr)
            # Save what we have and continue
            time.sleep(2)

    print(f"\nTotal records collected: {len(all_records)}")

    # Write CSV
    with open(output_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        writer.writeheader()
        for rec in all_records:
            row = {field: flatten_value(rec.get(field)) for field in FIELDS}
            writer.writerow(row)

    print(f"Saved to: {output_file}")
    print(f"Done — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == "__main__":
    main()
