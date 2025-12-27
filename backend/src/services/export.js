import xlsx from "xlsx";

function safeString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return String(value);
}

function toExcelString(value, maxLen = 32000) {
  const str = safeString(value);
  if (str.length > maxLen) {
    return `${str.slice(0, maxLen - 3)}...`;
  }
  return str;
}

export function buildWorkbook(dataset) {
  const articleRows = dataset.rows.map((row) => {
    const extraction = row.extraction || {};
    const relevance = row.relevance || {};

    return {
      ...row.input,
      extracted_text: toExcelString(extraction.text),
      extraction_status: safeString(extraction.status),
      extraction_method: safeString(extraction.method),
      extraction_notes: toExcelString(extraction.notes, 8000),
      summary: toExcelString(row.summary, 12000),
      summary_structured_json: toExcelString(row.summary_structured_json, 12000),
      coding_relevant: safeString(relevance.coding_relevant),
      relevance_confidence: safeString(relevance.relevance_confidence),
      relevance_reason: toExcelString(relevance.reason, 8000),
      pe_count_estimate: safeString(relevance.pe_count_estimate),
      pe_types: safeString(Array.isArray(relevance.pe_types) ? relevance.pe_types.join("; ") : relevance.pe_types),
      needs_manual_review: safeString(relevance.needs_manual_review),
      notes_for_coder: toExcelString(relevance.notes_for_coder, 8000)
    };
  });

  const workbook = xlsx.utils.book_new();
  const articleSheet = xlsx.utils.json_to_sheet(articleRows);
  xlsx.utils.book_append_sheet(workbook, articleSheet, "Articles");

  const eventRows = [];
  for (const row of dataset.rows) {
    if (!row.summary_structured_json) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(row.summary_structured_json);
    } catch (error) {
      continue;
    }
    const peList = Array.isArray(parsed.pe_list) ? parsed.pe_list : [];
    peList.forEach((pe, index) => {
      eventRows.push({
        "Source ID": row.id,
        "Article URL": row.url,
        "Event Index": index + 1,
        "Event Summary": Array.isArray(parsed.summary_bullets) ? parsed.summary_bullets.join(" | ") : "",
        "Platform Name(s)": Array.isArray(pe.platform_name_targets?.value) ? pe.platform_name_targets.value.join("; ") : safeString(pe.platform_name_targets?.value),
        "Country": safeString(pe.country?.value),
        "City": safeString(pe.site_city_or_town?.value),
        "Exact Date": safeString(pe.exact_date?.value),
        "Duration": safeString(pe.continuous_duration?.value),
        "Type of Action": safeString(pe.type_of_action?.value),
        "Legal Issue": safeString(pe.legal_issue),
        "Actors Types": Array.isArray(pe.actors) ? pe.actors.map((actor) => actor.type).filter(Boolean).join("; ") : "",
        "Actors Names": Array.isArray(pe.actors) ? pe.actors.map((actor) => actor.name).filter(Boolean).join("; ") : "",
        "Issues - Pay": !!pe.issues?.pay,
        "Issues - Working time": !!pe.issues?.working_time,
        "Issues - Employment status": !!pe.issues?.employment_status,
        "Issues - Union representation": !!pe.issues?.union_representation,
        "Issues - Other regulatory": !!pe.issues?.other_regulatory,
        "Issues - Deactivation": !!pe.issues?.deactivation,
        "Issues - Health & safety": !!pe.issues?.health_safety,
        "Issues - Non-pay benefits": !!pe.issues?.non_pay_benefits,
        "Issues - Other working conditions": !!pe.issues?.other_working_conditions,
        "Issues - Other": !!pe.issues?.other,
        "Event Needs Review": row.relevance?.needs_manual_review === true || row.relevance?.needs_manual_review === "TRUE"
      });
    });
  }

  if (eventRows.length) {
    const eventSheet = xlsx.utils.json_to_sheet(eventRows);
    xlsx.utils.book_append_sheet(workbook, eventSheet, "ProtestEvents");
  }

  return workbook;
}

export function writeWorkbookBuffer(workbook) {
  return xlsx.write(workbook, { bookType: "xlsx", type: "buffer" });
}
