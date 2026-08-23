"use client";

import React, { useRef, useState } from "react";
import { askJSON } from "@/lib/ai";
import { today } from "@/lib/seed";

/* "＋ Import statement" — drop a credit-card/bank CSV (or paste statement
 * text) and Vault extracts the transactions: name, amount, date, and time
 * when present. Clean CSVs parse locally in the browser — nothing leaves the
 * machine. Messy pasted text falls back to the AI model when one is set up.
 * The user always reviews a preview and unticks rows before anything saves. */

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/* Category guesses for common statement merchants; AI path returns its own. */
const CAT_RULES = [
  [/uber|lyft|taxi|metro|transit|fuel|gas station|parking/i, "Transport"],
  [/grocer|market|supermarket|food|restaurant|cafe|coffee|pizza|burger|deliver/i, "Food"],
  [/netflix|spotify|cinema|movie|game|steam|playstation|concert/i, "Fun"],
  [/pharmacy|clinic|hospital|doctor|gym|fitness/i, "Health"],
  [/electric|water|internet|phone|mobile|utility|insurance|rent/i, "Bills"],
  [/amazon|store|shop|mall|clothing|apparel/i, "Shopping"],
];
const guessCat = (name) => (CAT_RULES.find(([re]) => re.test(name)) || [null, "Other"])[1];

/* tolerant date parsing: ISO, dd/mm/yyyy, mm/dd/yyyy, "12 Aug 2026", "Aug 12" */
function parseDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = `20${y}`;
    let day = +a, mon = +b;
    if (mon > 12 && day <= 12) [day, mon] = [mon, day];   // mm/dd fallback
    if (mon > 12) return null;
    return `${y}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?\s*(\d{4})?/) || t.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s*(\d{4})?/);
  if (m) {
    const dayFirst = /^\d/.test(t);
    const day = +(dayFirst ? m[1] : m[2]);
    const mon = MONTHS[(dayFirst ? m[2] : m[1]).slice(0, 3).toLowerCase()];
    if (mon === undefined || !day) return null;
    const y = m[3] || String(new Date().getFullYear());
    return `${y}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}
const parseTime = (s) => (String(s || "").match(/\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)\b/i) || [])[1] || "";
const parseAmount = (s) => {
  const m = String(s || "").replace(/[,\s]/g, "").match(/-?\d+(?:\.\d{1,2})?/);
  return m ? Math.abs(parseFloat(m[0])) : null;
};

/* split a CSV line respecting quotes */
const splitCSV = (line) => {
  const out = []; let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim().replace(/^"|"$/g, ""));
};

/* local CSV parse. Real bank exports open with preamble lines (bank name,
 * account, period) before the header row, so hunt for the header anywhere in
 * the first 20 lines; failing that, sniff the first parsable data row. The
 * Debit column is preferred over a generic Amount so credits aren't imported
 * as spending. */
function parseCSV(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const hi = lines.findIndex((l, i) => i < 20 && /date/i.test(l) && /(amount|debit|value|paid out|withdraw)/i.test(l) && l.includes(","));
  let iDate = -1, iDesc = -1, iAmt = -1, iTime = -1, rows = [];
  let amtIsDebit = false;
  const timeLike = (s) => /^\d{1,2}:\d{2}/.test(String(s || "").trim());
  if (hi >= 0) {
    const header = splitCSV(lines[hi]).map((h) => h.toLowerCase());
    /* try synonyms IN ORDER (so Debit truly beats a generic Amount) and skip
       already-claimed columns (so "Value Date" can't become the amount) */
    const findCol = (names, taken) => {
      for (const n of names) {
        const i = header.findIndex((h, idx) => !taken.includes(idx) && h.includes(n));
        if (i >= 0) return i;
      }
      return -1;
    };
    iDate = findCol(["date"], []);
    iDesc = findCol(["desc", "narrat", "detail", "merchant", "name", "payee"], [iDate]);
    iAmt = findCol(["debit", "paid out", "withdraw", "amount", "value"], [iDate, iDesc]);
    amtIsDebit = iAmt >= 0 && /debit|paid out|withdraw/.test(header[iAmt]);
    iTime = findCol(["time"], [iDate, iDesc, iAmt]);
    rows = lines.slice(hi + 1);
  } else {
    const probeIdx = lines.findIndex((l) => { const c = splitCSV(l); return c.length >= 2 && c.some((x) => parseDate(x)); });
    if (probeIdx < 0) return [];
    const probe = splitCSV(lines[probeIdx]);
    iDate = probe.findIndex((c) => parseDate(c));
    /* a bare "14:32" parses as 14 — never let a time cell become the amount */
    iAmt = probe.findIndex((c, i) => i !== iDate && !timeLike(c) && parseAmount(c) !== null && !parseDate(c));
    iDesc = probe.findIndex((c, i) => i !== iDate && i !== iAmt && /[A-Za-z]{3,}/.test(c));
    rows = lines.slice(probeIdx);
  }
  if (iDate < 0 || iAmt < 0) return [];
  return rows.map(splitCSV).map((cols) => {
    const date = parseDate(cols[iDate]);
    const raw = String(cols[iAmt] ?? "");
    /* in a signed Amount column, negatives are credits/refunds — skip them
       rather than importing them as positive spending */
    if (!amtIsDebit && /-|\(/.test(raw)) return null;
    const amount = parseAmount(raw);
    const name = (iDesc >= 0 ? cols[iDesc] : "") || "Transaction";
    if (!date || !amount) return null;
    return { name, amount, date, time: iTime >= 0 ? parseTime(cols[iTime]) : parseTime(cols.join(" ")), cat: guessCat(name) };
  }).filter(Boolean).slice(0, 500);
}

/* which bank / card issued this statement — banks put their name in the first
 * few preamble lines, before the transaction table starts */
function detectSource(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 6);
  for (const l of lines) {
    if (/date/i.test(l) && l.includes(",")) break;           // hit the header row
    const first = splitCSV(l)[0]?.replace(/["']/g, "").trim();
    if (first && /[A-Za-z]{3,}/.test(first) && !parseDate(first) && first.length <= 60) {
      return first.replace(/\s*\((fictional|sample|test)[^)]*\)\s*/i, "").trim();
    }
  }
  return "";
}

export default function StatementImport({ open, onClose, onImport, categories, cur, aiReady }) {
  const fileRef = useRef(null);
  const [rows, setRows] = useState(null);     // parsed transactions with .use flag
  const [source, setSource] = useState("");   // which bank / card this came from
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  /* the ✕ promises "Close (Esc)" — honor it */
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const finish = (parsed, via) => {
    if (!parsed.length) { setErr("No transactions found — try the paste box, or check the file has date and amount columns."); return; }
    setErr("");
    setRows(parsed.map((r) => ({ ...r, use: true, via })));
  };

  const aiParse = async (text) => {
    const out = await askJSON(
      `Today is ${today()}. Extract every transaction from this credit-card / bank statement text. ` +
      `For each: the merchant/name, the amount as a positive number, the ISO date, the time of day if shown (else empty), and the best category.\n\nSTATEMENT:\n${text.slice(0, 12000)}`,
      {
        type: "object",
        properties: {
          transactions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                amount: { type: "number" },
                date: { type: "string", format: "date" },
                time: { type: "string" },
                category: { type: "string", enum: categories },
              },
              required: ["name", "amount", "date"],
              additionalProperties: false,
            },
          },
        },
        required: ["transactions"],
        additionalProperties: false,
      },
      { maxTokens: 8000 }
    );
    /* the model's dates go through the same tolerant parser as CSV cells —
       schema enforcement is best-effort on some AI paths */
    return (out.transactions || [])
      .map((t) => ({ ...t, date: parseDate(t.date) }))
      .filter((t) => t.amount > 0 && t.date)
      .map((t) => ({ name: t.name, amount: t.amount, date: t.date, time: parseTime(t.time) || "", cat: t.category || guessCat(t.name) })).slice(0, 500);
  };

  const onFile = async (f) => {
    if (!f) return;
    setBusy(true); setErr("");
    try {
      const text = await f.text();
      setSource(detectSource(text));
      const local = parseCSV(text);
      if (local.length) finish(local, "csv");
      else if (aiReady) finish(await aiParse(text), "ai");
      else setErr("Couldn't read that as a CSV. Export your statement as CSV, or set up an AI model in Settings to parse other formats.");
    } catch (e) { setErr(e.message || "Couldn't read that file."); }
    setBusy(false);
  };

  const onPaste = async () => {
    if (!pasted.trim()) return;
    setBusy(true); setErr("");
    try {
      setSource(detectSource(pasted));
      const local = parseCSV(pasted);
      if (local.length >= 1) finish(local, "csv");
      else if (aiReady) finish(await aiParse(pasted), "ai");
      else setErr("Set up an AI model in Settings to parse pasted statement text, or paste CSV rows.");
    } catch (e) { setErr(e.message || "Couldn't parse that."); }
    setBusy(false);
  };

  const chosen = (rows || []).filter((r) => r.use);
  const doImport = () => { onImport(chosen, source.trim()); onClose(); setRows(null); setPasted(""); setSource(""); };
  const reset = () => { setRows(null); setErr(""); setSource(""); };

  return (
    <div className="pal-overlay" onClick={onClose} role="dialog" aria-label="Import statement">
      <div className="pal stmtdlg" onClick={(e) => e.stopPropagation()}>
        <div className="cd-head">
          <h3 className="display" style={{ margin: 0, fontSize: 18 }}>＋ Import a statement</h3>
          <button className="kbtn" style={{ marginLeft: "auto" }} onClick={onClose} title="Close (Esc)">✕</button>
        </div>
        <div className="cd-body">
          {!rows && (
            <>
              <p className="stmt-lead">Drop in a credit-card or bank statement and Vault pulls out every transaction — name, amount, date and time. CSV files are read right here in your browser; nothing is uploaded.</p>
              <button className="stmt-drop" onClick={() => fileRef.current?.click()} disabled={busy}>
                <span className="stmt-plus" aria-hidden="true">＋</span>
                {busy ? "Reading…" : "Choose a statement file"}
                <small>.csv from your bank or card app{aiReady ? " · other text formats via your AI" : ""}</small>
              </button>
              <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" hidden
                onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
              <div className="stmt-or mono">or paste the transactions</div>
              <textarea className="stmt-paste" rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)}
                placeholder={"12/08/2026  14:32  COFFEE HOUSE  4.50\n13/08/2026  GROCERY MART  82.40\n…"} aria-label="Paste statement text" />
              <button className="btn sm" onClick={onPaste} disabled={busy || !pasted.trim()}>{busy ? "Parsing…" : "Parse"}</button>
              {err && <div className="smartmsg err">⚠ {err}</div>}
            </>
          )}
          {rows && (
            <>
              <div className="stmt-summary">
                Found <b>{rows.length}</b> transaction{rows.length === 1 ? "" : "s"}
                {rows[0]?.via === "ai" ? " (parsed by your AI)" : " (read locally — nothing left your browser)"}.
                Untick any you don't want, then import.
              </div>
              <div className="stmt-source">
                <label htmlFor="stmt-src">Statement from</label>
                <input id="stmt-src" value={source} onChange={(e) => setSource(e.target.value)}
                  placeholder="e.g. Meridian Bank · Visa ····4821" />
                <small>{source ? "Every imported transaction is tagged with this card / bank." : "Name the bank or card so you can tell these transactions apart later."}</small>
              </div>
              <div className="stmt-tablewrap">
                <table className="av-table stmt-table">
                  <thead><tr><th></th><th>Name</th><th>Amount</th><th>Date</th><th>Time</th><th>Category</th></tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className={r.use ? "" : "stmt-off"}>
                        <td><input type="checkbox" checked={r.use} aria-label={`Include ${r.name}`}
                          onChange={() => setRows((rs) => rs.map((x, j) => j === i ? { ...x, use: !x.use } : x))} /></td>
                        <td className="stmt-name">{r.name}</td>
                        <td className="mono">{cur}{r.amount.toFixed(2)}</td>
                        <td className="mono">{r.date}</td>
                        <td className="mono">{r.time || "—"}</td>
                        <td>
                          <select value={r.cat} aria-label="Category"
                            onChange={(e) => setRows((rs) => rs.map((x, j) => j === i ? { ...x, cat: e.target.value } : x))}>
                            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="stmt-actions">
                <button className="btn ghost sm" onClick={reset}>← Different file</button>
                <button className="btn sm" onClick={doImport} disabled={!chosen.length}>
                  Import {chosen.length} transaction{chosen.length === 1 ? "" : "s"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
