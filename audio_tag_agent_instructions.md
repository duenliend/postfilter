# Local Agent Playbook (React 19): News → Text Extraction → Batch Summaries → **Leeds Index PE Relevance** → Excel  
**Codebook integrated:** *Leeds Index Codebook – Labour Unrest in the Platform Economy (Version Two)*.

## 1) Objective
Build a local (localhost) web application with a **React 19** UI (runs in the browser) and a **local backend** (Node and/or Python) that:

1. Ingests a CSV/XLSX table containing news article URLs (your example uses column **`Article URL`**).
2. Extracts the *main article text* using a **maximal fallback chain** (strongest first, then many fallbacks), supporting **all languages** (language-agnostic extraction).
3. If extraction fails for any row, the pipeline **pauses** and prompts the user to **paste the text manually** for the failed items, then continues.
4. Once texts exist for all rows, uses **OpenAI Batch API** to:
   - produce **summaries** (added as a new column), and
   - classify **coding relevance** according to the **Codebook definition of a Protest Event (PE)**.
5. Outputs an **Excel (.xlsx)** file for download containing the original table plus enrichment columns.

---

## 2) Why a local backend is mandatory (practical reality)
A “pure browser” app cannot reliably fetch arbitrary news URLs because of:
- CORS restrictions,
- paywalls / bot protection,
- cookies/consent flows,
- JS-rendered pages.

**Therefore:** Keep the UX in the browser, but do **fetching + rendering + extraction** in a **local backend** that your React UI calls via HTTP.

---

## 3) Input/Output contract

### 3.1 Input
- Accept `.csv` and `.xlsx`.
- Default URL column: **`Article URL`** (from your example).
- Provide a dropdown to override the URL column if needed.

### 3.2 Output (Excel)
Add at least these columns to the original sheet:

**Extraction**
- `extracted_text`
- `extraction_status` = `OK | FAILED | MANUAL`
- `extraction_method` (e.g., `trafilatura`, `readability`, `mercury`, `jsonld`, `custom_clean`)
- `extraction_notes` (brief error/diagnostic)

**Summarisation**
- `summary` (human-readable bullets)
- `summary_structured_json` (stringified JSON; see §6)

**Leeds Index Relevance (Codebook-based)**
- `coding_relevant` = `TRUE | FALSE`
- `relevance_confidence` (0–1)
- `relevance_reason` (short, criteria-based)
- `pe_count_estimate` (integer, 0..N)
- `pe_types` (e.g., `strike; demonstration`)
- `needs_manual_review` (TRUE if evidence is insufficient or ambiguous)
- `notes_for_coder`

**Recommended enhancement (high value):** Write a **second sheet** `ProtestEvents` where each detected PE becomes one row (event-level table), with fields aligned to the Codebook variable list. This makes downstream coding substantially easier.

---

## 4) Extraction pipeline (strongest first; maximal fallbacks)

### 4.1 Fetch / render stage (produce HTML)
Attempt in order:

1. **Direct HTTP fetch** (fast path)
   - Use `undici` (Node 18+) or `got`.
   - Set realistic headers (`User-Agent`, `Accept`, `Accept-Language`), follow redirects.
   - Retry (2–3) with exponential backoff.
   - Detect “soft blocks” (CAPTCHA HTML, bot-challenge, paywall/login).

2. **AMP fallback**
   - If HTML contains `<link rel="amphtml" href="…">`, fetch AMP and prefer it.

3. **Headless render fallback (Playwright)**
   - Load URL, wait for `networkidle` or a main-article selector.
   - Obtain rendered HTML via `page.content()`.
   - Use sparingly (slow); only when direct fetch yields insufficient text or block indicators.

### 4.2 Extraction stage (produce main text from HTML)
Run extractors in a strict order. Stop at the first result that passes quality gates.

**Quality gates (example; tuneable)**
- word_count ≥ 200
- at least one paragraph with ≥ 100 chars
- low boilerplate ratio (cookie banners / nav)
- not mostly duplicated lines

**Tier A (primary)**
1. Python `trafilatura` (against HTML when possible)

**Tier B**
2. Mozilla `Readability.js` (`@mozilla/readability`) via DOM (`jsdom` or Playwright DOM)

**Tier C**
3. `@extractus/article-extractor`
4. `@postlight/mercury-parser`
5. `unfluff` / `node-unfluff`
6. Schema.org JSON-LD: parse `articleBody` if present
7. AMP-body parsing (if AMP HTML)

**Tier D (last resort)**
8. Custom boilerplate removal: `html-to-text` + aggressive cleaning rules
9. Optional LLM extraction (only if explicitly allowed/cost-acceptable)

### 4.3 Manual intervention rule (mandatory)
If no method passes gates:
- set `extraction_status = FAILED`
- **pause** and show a UI list of failed URLs with a paste field per row
- after paste: set `extraction_status = MANUAL`, store pasted text, resume

---

## 5) Codebook integration: the “Protest Event” decision rules

This section is the **core** of the relevance classification logic and must be implemented faithfully.

### 5.1 Coding unit: a Protest Event (PE)
An event qualifies as a PE only if **all four criteria** are evidenced:

1. **Involvement of platform workers**
2. **Identifiable site (place)**
3. **Continuous duration (no interruption)**
4. **Type of action** is present

**Event boundary rules**
- A **demonstration** and a **strike** on the same day/city/issue are **two separate PEs** (different action types).
- A strike in the same city lasting **five continuous days** is **one PE** (continuous duration, single geographic site).

### 5.2 Announcements vs. occurred events
- An article announcing a protest **will happen** in the future is **not sufficient** to code a PE.
- The agent should seek evidence that the event **did happen** (e.g., reported as having occurred, or verified by other coverage).
- In this app’s binary relevance decision, “announcement only” should default to:
  - `coding_relevant = FALSE`, and
  - `needs_manual_review = TRUE` (if it looks plausible but unverified).

### 5.3 Round-up articles (multiple events mentioned)
- Articles sometimes list several protests across locations.
- Only treat as PE evidence if there is enough detail per event to satisfy PE criteria.
- If multiple PEs are present, the structured output should return **a list of PEs** (`pe_list`) and mark:
  - `pe_count_estimate > 1`
  - `needs_manual_review = TRUE` if details are thin.

### 5.4 “Grievance only” is not a PE
- Pure expression of dissatisfaction without *concerted action* is **not** a PE.

---

## 6) Codebook categories to extract (for structured summarisation and PE table)

### 6.1 Type of Action (Codebook)
1. **Strike / log-offs**: collective refusal to work; in tethered platform work may be described as “log-offs”.
2. **Demonstration**: public protest (march, rally, gathering); must have target and demands.  
   - Online gatherings can qualify **only** if they are public and stand alone as a PE (not merely part of strike action/solidarity).
3. **Legal action**: only when **platform workers** (or their representative bodies) initiate/participate.  
   - Court city = location; date = case commencement date or date workers are reported as involved.  
   - **Appeals are separate cases**.  
   - Also capture `legal_issue`.
4. **Institutionalisation**: building a new institution (e.g., new union, works council).  
   - Do **not** code “workers launch their own platform company” as institutionalisation.
99. **Other**: rare; e.g., open letter, petition. Use sparingly.

### 6.2 Actors (Codebook)
- **Mainstream trade union**
- **Grassroots / independent trade union**
- **Workers’ collective**
- **Informal group of workers**
  - If it appears to be a *sole individual* bringing a case without clear membership, still code as “informal group”.
- **Other** (NGOs, campaigning groups, company-led “unions”, etc.)
- **Law firm** (important for legal action cases where workers are the initiators/participants)

### 6.3 Issues (Codebook)
Extract the **central** issue(s) evidenced, prioritising the primary driver:
- Pay
- Working time
- Employment status
- Union representation/recognition
- Other regulatory issues
- Deactivation
- Health & safety
- Non-pay benefits
- Other working conditions
- Other

### 6.4 Additional instructions relevant for automated classification
- Distinguish **publication date** vs. **event date**.
- Prefer multi-source verification; single-source coding should be treated as more fragile.
- Secondary sources may clarify missing fields but must be the **same event** and must be handled cautiously.

---

## 7) Batch Summarisation (OpenAI Batch API)

### 7.1 Two outputs per article
You will produce both:
1. `summary` (short bullets)
2. `summary_structured_json` aligned to Codebook variables and PE criteria (for automation + Excel “ProtestEvents” sheet)

### 7.2 Structured summary JSON schema (recommended)
Store this as JSON (string) in `summary_structured_json`:

```json
{
  "article_language": "auto",
  "publication_date_if_stated": null,
  "pe_present": false,
  "pe_count_estimate": 0,
  "pe_list": [
    {
      "pe_occured_or_reported_as_happened": false,
      "platform_workers_involved": {"value": null, "evidence": []},
      "site_city_or_town": {"value": null, "evidence": []},
      "country": {"value": null, "evidence": []},
      "exact_date": {"value": null, "evidence": []},
      "continuous_duration": {"value": null, "evidence": []},
      "type_of_action": {"value": null, "evidence": []},
      "platform_name_targets": {"value": [], "evidence": []},
      "actors": [{"type": null, "name": null, "evidence": []}],
      "issues": {
        "pay": false,
        "working_time": false,
        "employment_status": false,
        "union_representation": false,
        "other_regulatory": false,
        "deactivation": false,
        "health_safety": false,
        "non_pay_benefits": false,
        "other_working_conditions": false,
        "other": false
      },
      "legal_issue": null,
      "participant_count_text": null,
      "notes": null
    }
  ],
  "summary_bullets": ["..."]
}
```

**Evidence discipline:** For each key field, include 1–2 short evidence snippets (verbatim) from the article text if available. If you cannot evidence it, set `value = null` (do **not** infer).

### 7.3 Summarisation prompt (Batch request template)
System message (illustrative; adapt):
- You are extracting structured protest-event information **strictly from the given text**.
- Apply the four PE criteria (platform workers, site, continuous duration, action type).
- Treat future announcements as **not occurred** unless clearly reported as having happened.
- If multiple PEs are described, return a `pe_list`.
- Do not invent locations/dates/platform names; use `null` when missing.
- Output **valid JSON** matching the schema.

User message:
- Provide extracted text.

---

## 8) Batch Classification: “Coding relevance” decision

### 8.1 Decision rule (binary)
Set `coding_relevant = TRUE` if and only if:
- At least one PE in `pe_list` has:
  - `pe_occured_or_reported_as_happened = true`, AND
  - sufficient evidence to satisfy the **four PE criteria** (workers, site, continuous duration, action type).

Otherwise:
- `coding_relevant = FALSE`
- If the text looks like an announcement, round-up, or otherwise plausible but under-specified: `needs_manual_review = TRUE`.

### 8.2 Classification output JSON (recommended)
```json
{
  "coding_relevant": false,
  "relevance_confidence": 0.0,
  "reason": "Criteria-based justification.",
  "pe_count_estimate": 0,
  "pe_types": [],
  "needs_manual_review": true,
  "notes_for_coder": ""
}
```

### 8.3 Classification prompt inputs
To reduce cost while preserving auditability:
- Input the `summary_structured_json` and the human `summary` (not the full text).
- If you need more evidence, include up to the first ~1,500–2,000 characters of `extracted_text`.

---

## 9) Building the Excel output

### 9.1 Sheet 1: Articles (original + enrichment)
Write the enriched columns in-place, preserving the original table structure.

### 9.2 Sheet 2 (recommended): ProtestEvents (exploded)
If `pe_count_estimate > 0`, explode each PE into one event-level row with fields matching the Codebook variable list, for example:
- `Event ID` (leave blank or generate placeholder)
- `Event Summary`
- `Platform Name(s)`
- `Country`
- `City`
- `Exact Date`
- `Duration`
- `Type of work` (only if evidenced; otherwise blank)
- `Type of Action`
- `Legal Issue` (if action=legal action)
- `Type of Actor(s)`
- `Name of Actor(s)`
- `Issue flags (Pay, Working time, …)`
- `Evidence` (optional: compact evidence snippets)

If event-level details are missing, leave fields blank and set an `event_needs_review` flag.

---

## 10) Minimal UI requirements (React 19)

1. **Upload**
   - CSV/XLSX dropzone
   - Column mapping for URL column (default `Article URL`)
2. **Run**
   - Table grid with per-row pipeline status
   - Progress indicators and logs
3. **Manual paste**
   - Failure list + paste fields
4. **Export**
   - Download `.xlsx`

---

## 11) Operational hardening (must implement)
- Cache per URL (HTML + extracted text) by hash to avoid repeated scraping.
- Concurrency limits:
  - direct fetch: 8–16
  - Playwright: 2–4
  - Python extraction: 4–8
- Timeouts:
  - fetch: 20–30s
  - Playwright: 45–60s
- Persist row-level logs: attempts, method selected, word counts, errors.

---

## 12) Acceptance tests (definition of “done”)
1. CSV with `Article URL` processes end-to-end; Excel download opens cleanly.
2. Mixed static + JS-rendered pages: at least one fallback succeeds for reachable pages.
3. Extraction failures pause and are recoverable via manual paste.
4. Batch summary merges back correctly via stable `custom_id`.
5. Relevance classification matches Codebook PE criteria and flags ambiguous cases for manual review.

---

## 13) Implementation note: stable identifiers
Do not join by URL. Always create a stable `custom_id` per input row (row index or UUID) and carry it through:
- extraction
- batch summary
- batch relevance
- Excel merge

