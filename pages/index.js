// pages/index.js
import { useState, useRef } from 'react';
import Head from 'next/head';
import { jsPDF } from 'jspdf';

// ─── Lightweight markdown renderer (bold, italic, paragraphs) ───
function renderMarkdown(text) {
  if (!text) return null;
  return text
    .split(/\n\n+/)
    .filter(p => p.trim())
    .map((para, i) => {
      // Parse inline: **bold** and *italic*
      const parts = [];
      const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
      let last = 0, match;
      while ((match = regex.exec(para)) !== null) {
        if (match.index > last) parts.push(para.slice(last, match.index));
        if (match[1]) parts.push(<strong key={match.index}>{match[1]}</strong>);
        else if (match[2]) parts.push(<em key={match.index}>{match[2]}</em>);
        last = match.index + match[0].length;
      }
      if (last < para.length) parts.push(para.slice(last));
      return (
        <p key={i} style={{ margin: i === 0 ? 0 : '12px 0 0', lineHeight: 1.85 }}>
          {parts}
        </p>
      );
    });
}

// ─── Shared constants ────────────────────────────────────────
const CV_CHAR_LIMIT = 6000;

// ─── Screening Status logic (composite scoring, adaptive) ────────
// Formula adapts based on whether NtH is configured:
//
// NtH NOT configured (empty array):
//   Score = (passed/total) × 100 − (BLOCKER × 50)
//   → purely mandatory-based, max 100 pts
//
// NtH configured:
//   Score = (passed/total) × 60 + (NtH score × 40/100) − (BLOCKER × 50)
//   → 60 pts from mandatory + 40 pts from NtH, max 100 pts
//
// Shortlist    : score ≥ 70
// Consider     : score ≥ 45
// Review Gap   : score ≥ 20
// Not Qualified: score < 20
function getScreeningStatus(mandatoryItems, niceToHaveTotal, gapAnalysis, niceToHaveItems) {
  // Count from actual arrays — never trust Claude's mandatory_summary.total
  const mandatory = mandatoryItems || [];
  const passed    = mandatory.filter(m => m.pass === true).length;
  const total     = mandatory.length;
  const gaps      = gapAnalysis || [];
  const nthConfigured = niceToHaveItems && niceToHaveItems.length > 0;

  const blockerCount   = gaps.filter(g => g.severity === 'BLOCKER').length;
  const blockerPenalty = blockerCount * 50;

  let compositeScore;
  if (!nthConfigured) {
    compositeScore = total > 0 ? (passed / total) * 100 - blockerPenalty : 0;
  } else {
    const mandatoryBase   = total > 0 ? (passed / total) * 60 : 0;
    const nthContribution = (niceToHaveTotal || 0) * (40 / 100);
    compositeScore = mandatoryBase + nthContribution - blockerPenalty;
  }

  if (compositeScore >= 70) return 'Shortlist';
  if (compositeScore >= 45) return 'Consider';
  if (compositeScore >= 20) return 'Review Gap';
  return 'Not Qualified';
}

// ─── Helper: compute mandatory counts from actual array ──────────
function getMandatoryCounts(mandatoryItems) {
  const items  = mandatoryItems || [];
  const passed = items.filter(m => m.pass === true).length;
  return { passed, total: items.length };
}

// ─── Excel export via SheetJS ────────────────────────────────────
async function exportToExcel(records) {
  // Lazy-load SheetJS from CDN
  if (!window.XLSX) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const XLSX = window.XLSX;

  const rows = records.map(r => ({
    'Date':              r.date,
    'Candidate Name':    r.candidateName,
    'Role':              r.role,
    'Mandatory Passed':  r.mandatoryPassed,
    'Mandatory Total':   r.mandatoryTotal,
    'NtH Score':         r.nthScore,
    'Top Gap':           r.topGap,
    'Screening Status':  r.screeningStatus,
    'HR Notes':          '',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);

  // Column widths
  ws['!cols'] = [
    { wch: 12 }, { wch: 25 }, { wch: 30 }, { wch: 16 }, { wch: 14 },
    { wch: 10 }, { wch: 35 }, { wch: 16 }, { wch: 30 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CV Screening Results');
  XLSX.writeFile(wb, `CV-Screening-Results_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ─── jsPDF export ────────────────────────────────────────────────
function generatePDF(result, parsedJD, niceToHaveItems, screeningStatus, compositeScore) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210, PH = 297;
  const ML = 18, MR = 18, MT = 22, MB = 18;
  const CW = PW - ML - MR;
  const BOTTOM = PH - MB - 8;
  let y = MT;

  const C = {
    primary: [26, 35, 126], pass: [22, 163, 74], fail: [220, 38, 38],
    warn: [217, 119, 6], text: [13, 27, 42], muted: [90, 104, 128],
    border: [210, 218, 232], subtle: [246, 248, 252],
    accent: [255, 107, 43], white: [255, 255, 255],
  };

  // ── Sanitize text ──────────────────────────────────────────────
  function san(s) {
    return (s || '')
      .replace(/\*\*/g, '').replace(/\*/g, '')
      .replace(/→|>/g, '->').replace(/–|—/g, '-')
      .replace(/[""]/g, '"').replace(/['']/g, "'")
      .replace(/[^\x00-\x7E]/g, '');
  }

  // ── Set color helper ──────────────────────────────────────────
  function sc(rgb, t) {
    if (t === 'f') doc.setFillColor(...rgb);
    else if (t === 'd') { doc.setDrawColor(...rgb); doc.setLineWidth(0.25); }
    else doc.setTextColor(...rgb);
  }

  // ── Measure text height accurately ───────────────────────────
  function measureH(text, maxW, fs) {
    doc.setFontSize(fs);
    const lines = doc.splitTextToSize(san(text), maxW);
    return lines.length * (fs * 0.42 + 1.0);
  }

  // ── Check page break — keeps title+content together ──────────
  function needPage(h) {
    if (y + h > BOTTOM) { doc.addPage(); y = MT; }
  }

  // ── Draw rounded rect ─────────────────────────────────────────
  function box(x, by, w, h, fill, draw, r = 2) {
    if (fill) sc(fill, 'f');
    if (draw) sc(draw, 'd');
    doc.roundedRect(x, by, w, h, r, r, fill && draw ? 'FD' : fill ? 'F' : 'D');
  }

  // ── Render text lines (left-aligned, reliable) ───────────────
  function renderLines(text, x, startY, maxW, fs, style, color) {
    doc.setFontSize(fs); doc.setFont('helvetica', style); sc(color);
    const lines = doc.splitTextToSize(san(text), maxW);
    lines.forEach((l, i) => doc.text(l, x, startY + i * (fs * 0.42 + 1.0)));
    return lines.length * (fs * 0.42 + 1.0);
  }

  // ── Section header with left accent bar ──────────────────────
  function sectionHead(title, subtitle) {
    const needed = subtitle ? 20 : 14;
    needPage(needed);
    sc(C.primary, 'f'); doc.rect(ML, y, 3, subtitle ? 12 : 8, 'F');
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); sc(C.text);
    doc.text(san(title), ML + 6, y + 6.5);
    y += 8;
    if (subtitle) {
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); sc(C.muted);
      doc.text(san(subtitle), ML + 6, y);
      y += 5;
    }
    y += 4;
  }

  // ── Generic card renderer ─────────────────────────────────────
  // Pre-calculates height so box always fits content
  function renderCard(opts) {
    const {
      fill, border, leftBar, barColor,
      col1, col1fs = 9, col1bold = true,
      col2, col2right = false, col2color,
      col3, col3right = false,
      body, bodyfs = 8, bodyIndent = 5,
    } = opts;

    const bodyW = CW - bodyIndent - 4;
    const bodyH = body ? measureH(body, bodyW, bodyfs) : 0;
    const headerH = 11;
    const PAD = 5;
    const cardH = headerH + bodyH + PAD;

    needPage(cardH + 3);
    box(ML, y, CW, cardH, fill, border);
    if (leftBar) { sc(barColor || C.primary, 'f'); doc.rect(ML, y, 2.5, cardH, 'F'); }

    const textX = ML + (leftBar ? 6 : bodyIndent);
    const textY = y + 7;

    // Col1 — main label
    doc.setFontSize(col1fs);
    doc.setFont('helvetica', col1bold ? 'bold' : 'normal');
    sc(opts.col1color || C.text);
    doc.text(san(col1), textX, textY);

    // Col2 — right-side label (e.g. type · confidence)
    if (col2 !== undefined) {
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      sc(col2color || C.muted);
      if (col2right) {
        doc.text(san(String(col2)), PW - MR - 3, textY, { align: 'right' });
      } else {
        doc.text(san(String(col2)), textX, textY);
      }
    }

    // Col3 — far right label (e.g. score)
    if (col3 !== undefined) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      sc(opts.col3color || C.pass);
      if (col3right) {
        doc.text(san(String(col3)), PW - MR - 3, textY, { align: 'right' });
      }
    }

    // Body text
    if (body) {
      const bodyY = y + headerH;
      renderLines(body, ML + bodyIndent, bodyY, bodyW, bodyfs, 'normal', C.muted);
    }

    y += cardH + 2;
  }

  // ══════════════════════════════════════════════════
  // HEADER
  // ══════════════════════════════════════════════════
  const { passed, total } = getMandatoryCounts(result.mandatory);
  const nthOn = niceToHaveItems && niceToHaveItems.length > 0;
  const cName = (result.candidate_name || 'Unknown').toUpperCase();

  box(ML, y, CW, 28, C.primary, null, 3);

  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); sc([180,200,240]);
  doc.text('CANDIDATE', ML + 5, y + 7);
  doc.setFontSize(15); doc.setFont('helvetica', 'bold'); sc(C.white);
  doc.text(cName, ML + 5, y + 19);

  // Two score columns — fixed positions, no overlap
  const S1X = PW - MR - 52, S2X = PW - MR - 22;

  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); sc([180,200,240]);
  doc.text('MANDATORY', S1X, y + 7, { align: 'center' });
  doc.setFontSize(14); doc.setFont('helvetica', 'bold'); sc(C.white);
  doc.text(`${passed}/${total}`, S1X, y + 19, { align: 'center' });

  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); sc([180,200,240]);
  doc.text('NICE-TO-HAVE', S2X, y + 7, { align: 'center' });
  doc.setFontSize(nthOn ? 12 : 14); doc.setFont('helvetica', 'bold'); sc(C.white);
  doc.text(nthOn ? `${result.nicetohave_total}/100` : '-', S2X, y + 19, { align: 'center' });

  y += 32;

  // ══════════════════════════════════════════════════
  // SCREENING STATUS
  // ══════════════════════════════════════════════════
  const sdMap = {
    'Shortlist':     { fill:[240,253,244], border:C.pass,   label:C.pass   },
    'Consider':      { fill:[255,251,235], border:C.warn,   label:C.warn   },
    'Review Gap':    { fill:[255,237,213], border:C.accent, label:C.accent },
    'Not Qualified': { fill:[255,245,245], border:C.fail,   label:C.fail   },
  };
  const sd = sdMap[screeningStatus] || sdMap['Consider'];
  const sdDesc = {
    'Shortlist':     nthOn ? 'Strong mandatory pass rate and nice-to-have score. No critical blockers. Recommended for next stage.'
                           : 'Strong mandatory pass rate. No critical blockers. Recommended for next stage.',
    'Consider':      'Meets most requirements with manageable gaps. Worth evaluating further.',
    'Review Gap':    'Has critical blocker or weak mandatory performance. Review before proceeding.',
    'Not Qualified': 'Multiple critical blockers or insufficient mandatory coverage.',
  }[screeningStatus] || '';

  const descW = CW - 55;
  doc.setFontSize(8);
  const descLines = doc.splitTextToSize(san(sdDesc), descW);
  const sH = Math.max(18, descLines.length * (8 * 0.42 + 1.0) + 10);
  needPage(sH + 4);
  box(ML, y, CW, sH, sd.fill, sd.border);

  doc.setFontSize(7); doc.setFont('helvetica', 'bold'); sc(C.muted);
  doc.text('SCREENING STATUS', ML + 5, y + 5.5);
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); sc(sd.label);
  doc.text(screeningStatus, ML + 5, y + 13);

  const descStartY = y + (sH - descLines.length * (8 * 0.42 + 1.0)) / 2 + 4;
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); sc(C.muted);
  descLines.forEach((l, i) => doc.text(l, PW - MR - 3, descStartY + i * (8 * 0.42 + 1.0), { align: 'right' }));
  y += sH + 5;

  // ══════════════════════════════════════════════════
  // STANDOUT OBSERVATION
  // ══════════════════════════════════════════════════
  if (result.standout_observation) {
    const soText = san(result.standout_observation);
    const soH = measureH(soText, CW - 12, 9) + 14;
    needPage(soH + 4);
    box(ML, y, CW, soH, [235,240,255], C.primary);
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); sc(C.primary);
    doc.text('STANDOUT OBSERVATION', ML + 5, y + 6);
    renderLines(soText, ML + 5, y + 11, CW - 12, 9, 'italic', C.text);
    y += soH + 5;
  }

  // ══════════════════════════════════════════════════
  // RECRUITER SUMMARY — inside a card for consistency
  // ══════════════════════════════════════════════════
  const sumText = san(result.recruiter_summary || '');
  const sumH = measureH(sumText, CW - 10, 9.5) + 16;
  needPage(Math.min(sumH, 40)); // don't hold entire summary on one page
  box(ML, y, CW, sumH, C.subtle, C.border);
  sc(C.primary, 'f'); doc.rect(ML, y, 3, sumH, 'F');
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); sc(C.text);
  doc.text('RECRUITER SUMMARY', ML + 7, y + 7);
  renderLines(sumText, ML + 7, y + 12, CW - 12, 9.5, 'normal', C.text);
  y += sumH + 5;

  // ══════════════════════════════════════════════════
  // MANDATORY
  // ══════════════════════════════════════════════════
  sectionHead(`MANDATORY REQUIREMENTS - ${passed}/${total} PASSED`);

  (result.mandatory || []).forEach(item => {
    const ev = san(item.evidence || '');
    const evH = measureH(ev, CW - 12, 8);
    const cardH = evH + 14;
    const fill = item.pass ? [240,253,244] : [255,245,245];
    const border = item.pass ? C.pass : C.fail;
    needPage(cardH + 3);
    box(ML, y, CW, cardH, fill, border);

    // PASS/FAIL badge
    doc.setFontSize(7.5); doc.setFont('helvetica', 'bold');
    sc(item.pass ? C.pass : C.fail);
    doc.text(item.pass ? 'PASS' : 'FAIL', ML + 4, y + 7);

    // Skill name — leave room for right badge
    const skillMaxW = CW - 55;
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); sc(C.text);
    const skillLines = doc.splitTextToSize(san(item.skill), skillMaxW);
    skillLines.forEach((l, i) => doc.text(l, ML + 16, y + 7 + i * 4.5));

    // type · confidence — right aligned on first line
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); sc(C.muted);
    doc.text(`${item.type || ''} · ${item.confidence || ''}`, PW - MR - 3, y + 7, { align: 'right' });

    // Evidence
    renderLines(ev, ML + 4, y + 12, CW - 10, 8, 'normal', C.muted);
    y += cardH + 2;
  });
  y += 4;

  // ══════════════════════════════════════════════════
  // NICE-TO-HAVE
  // ══════════════════════════════════════════════════
  sectionHead(`NICE-TO-HAVE SCORE - ${nthOn ? `${result.nicetohave_total}/100` : 'NOT CONFIGURED'}`);

  if (!nthOn) {
    renderLines('No nice-to-have criteria were defined. Scoring was based entirely on mandatory requirements.', ML, y, CW, 9, 'italic', C.muted);
    y += 12;
  } else {
    needPage(8);
    sc(C.border, 'f'); doc.rect(ML, y, CW, 3.5, 'F');
    const barC = result.nicetohave_total >= 70 ? C.pass : result.nicetohave_total >= 40 ? C.warn : C.fail;
    sc(barC, 'f'); doc.rect(ML, y, CW * (result.nicetohave_total / 100), 3.5, 'F');
    y += 7;

    (result.nicetohave || []).forEach(item => {
      const ev = san(item.evidence || '');
      const evH = measureH(ev, CW - 12, 8);
      const cardH = evH + 14;
      needPage(cardH + 3);
      box(ML, y, CW, cardH, C.subtle, C.border);

      // Skill name — leave room for right side
      const skillMaxW = CW - 50;
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); sc(C.text);
      const skillLines = doc.splitTextToSize(san(item.skill), skillMaxW);
      skillLines.forEach((l, i) => doc.text(l, ML + 5, y + 7 + i * 4.5));

      // Score — far right
      doc.setFontSize(8.5); doc.setFont('helvetica', 'bold');
      sc(item.score > 0 ? C.pass : C.muted);
      doc.text(`+${item.score}`, PW - MR - 3, y + 7, { align: 'right' });

      // weight · confidence — second line right
      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); sc(C.muted);
      doc.text(`weight: ${item.weight}  ·  ${item.confidence || ''}`, PW - MR - 3, y + 11.5, { align: 'right' });

      renderLines(ev, ML + 5, y + 13, CW - 10, 8, 'normal', C.muted);
      y += cardH + 2;
    });
  }
  y += 4;

  // ══════════════════════════════════════════════════
  // QUALITATIVE SIGNALS
  // ══════════════════════════════════════════════════
  const rC = { STRONG: C.pass, MODERATE: C.warn, WEAK: C.fail };

  sectionHead('QUALITATIVE SIGNALS', '5 standard dimensions - beyond keyword matching');
  (result.qualitative_signals || []).forEach(item => {
    const ev = san(item.evidence || '');
    const evH = measureH(ev, CW - 14, 8);
    const cardH = evH + 14;
    const rc = rC[item.rating] || C.muted;
    needPage(cardH + 3);
    box(ML, y, CW, cardH, C.subtle, C.border);
    sc(rc, 'f'); doc.rect(ML, y, 2.5, cardH, 'F');
    doc.setFontSize(9); doc.setFont('helvetica', 'bold'); sc(C.text);
    doc.text(san(item.dimension), ML + 6, y + 7);
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); sc(rc);
    doc.text(item.rating, PW - MR - 3, y + 7, { align: 'right' });
    renderLines(ev, ML + 6, y + 12, CW - 12, 8, 'normal', C.muted);
    y += cardH + 2;
  });
  y += 4;

  // ══════════════════════════════════════════════════
  // ADDITIONAL REQUIREMENTS
  // ══════════════════════════════════════════════════
  if (result.additional_signals?.length > 0) {
    sectionHead('ADDITIONAL REQUIREMENTS', 'Based on additional context provided');
    result.additional_signals.forEach(item => {
      const ev = san(item.evidence || '');
      const evH = measureH(ev, CW - 14, 8);
      const cardH = evH + 14;
      const rc = rC[item.rating] || C.muted;
      needPage(cardH + 3);
      box(ML, y, CW, cardH, [255,240,232], C.accent);
      sc(C.accent, 'f'); doc.rect(ML, y, 2.5, cardH, 'F');
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); sc(C.text);
      doc.text(san(item.dimension), ML + 6, y + 7);
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); sc(rc);
      doc.text(item.rating, PW - MR - 3, y + 7, { align: 'right' });
      renderLines(ev, ML + 6, y + 12, CW - 12, 8, 'normal', C.muted);
      y += cardH + 2;
    });
    y += 4;
  }

  // ══════════════════════════════════════════════════
  // GAP ANALYSIS
  // ══════════════════════════════════════════════════
  if (result.gap_analysis?.length > 0) {
    sectionHead('GAP ANALYSIS');
    const sevMap = {
      'BLOCKER': { fill:[255,245,245], border:C.fail,   text:C.fail  },
      'RAMP-UP': { fill:[255,251,235], border:C.warn,   text:C.warn  },
      'MINOR':   { fill:[240,253,244], border:C.pass,   text:C.pass  },
    };
    result.gap_analysis.forEach(item => {
      const note = san(item.note || '');
      const noteH = measureH(note, CW - 12, 8);
      const cardH = noteH + 14;
      const sv = sevMap[item.severity] || sevMap['MINOR'];
      needPage(cardH + 3);
      box(ML, y, CW, cardH, sv.fill, sv.border);
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); sc(C.text);
      doc.text(san(item.skill), ML + 5, y + 7);
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); sc(sv.text);
      doc.text(item.severity, PW - MR - 3, y + 7, { align: 'right' });
      renderLines(note, ML + 5, y + 12, CW - 10, 8, 'normal', C.muted);
      y += cardH + 2;
    });
    y += 4;
  }

  // ══════════════════════════════════════════════════
  // INTERVIEW QUESTIONS
  // ══════════════════════════════════════════════════
  if (result.interview_questions?.length > 0) {
    sectionHead('SUGGESTED INTERVIEW QUESTIONS', 'Based on gaps and areas needing verification');
    result.interview_questions.forEach((q, i) => {
      const qText = san(q);
      const qH = measureH(qText, CW - 16, 9);
      const cardH = qH + 12;
      needPage(cardH + 3);
      box(ML, y, CW, cardH, C.subtle, C.border);

      const cx = ML + 7.5, cy = y + cardH / 2;
      sc(C.primary, 'f'); doc.circle(cx, cy, 4, 'F');
      doc.setFontSize(8); doc.setFont('helvetica', 'bold'); sc(C.white);
      doc.text(String(i + 1), cx, cy + 2.8, { align: 'center' });

      renderLines(qText, ML + 14, y + 7, CW - 18, 9, 'normal', C.text);
      y += cardH + 2;
    });
    y += 4;
  }

  // ══════════════════════════════════════════════════
  // TOKEN USAGE
  // ══════════════════════════════════════════════════
  if (result._usage) {
    needPage(22);
    sc(C.border, 'd'); doc.line(ML, y, PW - MR, y); y += 4;
    box(ML, y, CW, 17, C.subtle, C.border);
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); sc(C.muted);
    doc.text('TOKEN USAGE & COST', ML + 5, y + 5.5);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); sc(C.text);
    doc.text(`${result._usage.input_tokens.toLocaleString()} in  ·  ${result._usage.output_tokens.toLocaleString()} out  ·  ${result._usage.total_tokens.toLocaleString()} total`, ML + 5, y + 12);
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); sc(C.primary);
    doc.text(`Actual (Haiku): $${result._usage.cost_usd.toFixed(4)}`, PW - MR - 5, y + 6, { align: 'right' });
    const sc2 = ((result._usage.input_tokens/1e6*3)+(result._usage.output_tokens/1e6*15)).toFixed(4);
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); sc(C.muted);
    doc.text(`Est. (Sonnet): $${sc2}`, PW - MR - 5, y + 12, { align: 'right' });
    y += 21;
    const { passed: fp, total: ft } = getMandatoryCounts(result.mandatory);
    doc.setFontSize(7.5); sc(C.muted);
    doc.text(`Score: mandatory(${fp}/${ft}) x ${nthOn?60:100} + ${nthOn?'NtH x 40/100':'NtH not configured'} - blockers x 50 = ${Math.round(compositeScore)} pts`, ML, y);
    y += 5;
  }

  // ══════════════════════════════════════════════════
  // HEADER + FOOTER on every page
  // ══════════════════════════════════════════════════
  const pageCount = doc.getNumberOfPages();
  const dateStr = new Date().toISOString().slice(0,10);
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    sc(C.primary, 'd'); doc.setLineWidth(0.4);
    doc.line(ML, 14, PW - MR, 14);
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); sc(C.primary);
    doc.text('CV Screening Assistant', ML, 11);
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); sc(C.muted);
    doc.text('by M Irfan Avianto  ·  Astro Personal AI Challenge', ML + 46, 11);
    doc.text(`${dateStr}  ·  ${cName}`, PW - MR, 11, { align: 'right' });
    sc(C.border, 'd'); doc.setLineWidth(0.2);
    doc.line(ML, PH - 12, PW - MR, PH - 12);
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); sc(C.muted);
    doc.text('AI outputs are recommendations, not final decisions.  ·  CONFIDENTIAL  ·  For internal use only.', ML, PH - 8);
    doc.text(`${i} / ${pageCount}`, PW - MR, PH - 8, { align: 'right' });
  }

  const nameStr = cName.replace(/\s+/g, '-');
  doc.save(`${dateStr}_${nameStr}_CV-Analysis.pdf`);
}


// ─── localStorage helpers ─────────────────────────────────────────
const LS_KEY = 'astro_cv_screening_records';

function saveRecord(result, jobTitle) {
  const { passed: mPassed, total: mTotal } = getMandatoryCounts(result.mandatory);
  const status = getScreeningStatus(result.mandatory, result.nicetohave_total, result.gap_analysis, result.nicetohave);
  const topGap = result.gap_analysis?.find(g => g.severity === 'BLOCKER')?.skill
    || result.gap_analysis?.find(g => g.severity === 'RAMP-UP')?.skill
    || result.gap_analysis?.[0]?.skill
    || '—';

  const record = {
    date:             new Date().toISOString().slice(0, 10),
    candidateName:    result.candidate_name || 'Unknown',
    role:             jobTitle || 'Unknown Role',
    mandatoryPassed:  mPassed,
    mandatoryTotal:   mTotal,
    nthScore:         result.nicetohave_total ?? 0,
    topGap,
    screeningStatus:  status,
  };

  try {
    const existing = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    existing.push(record);
    localStorage.setItem(LS_KEY, JSON.stringify(existing));
  } catch {
    // localStorage unavailable — silent fail
  }
  return record;
}

function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
}

// ─── PDF text extraction (client-side via pdf.js) ──────────────
async function extractTextFromPDF(file) {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(' ') + '\n';
  }
  return text.trim();
}

// ─── Sub-components ────────────────────────────────────────────

function ThemeToggle({ theme, toggleTheme }) {
  return (
    <button className="btn btn-ghost" onClick={toggleTheme} title="Toggle theme">
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
}

function StepIndicator({ current }) {
  const steps = [
    { n: 1, label: 'Job Description' },
    { n: 2, label: 'Hiring Criteria' },
    { n: 3, label: 'Upload CV' },
    { n: 4, label: 'Results' },
  ];
  return (
    <div className="steps">
      {steps.map((s, i) => (
        <>
          <div
            key={s.n}
            className={`step ${current === s.n ? 'active' : current > s.n ? 'done' : ''}`}
          >
            <div className="step-num">
              {current > s.n ? '✓' : s.n}
            </div>
            <span>{s.label}</span>
          </div>
          {i < steps.length - 1 && <div className="step-line" key={`line-${i}`} />}
        </>
      ))}
    </div>
  );
}

function ConfidenceBadge({ level }) {
  return (
    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: `var(--conf-${level}, var(--text-faint))` }}>
      <span className={`conf-dot conf-${level}`} />
      {level}
    </span>
  );
}

function MandatoryCard({ item }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '14px 16px',
        borderRadius: 'var(--radius-sm)',
        background: item.pass ? 'var(--pass-bg)' : 'var(--fail-bg)',
        border: `1px solid ${item.pass ? 'var(--pass)' : 'var(--fail)'}`,
        marginBottom: 10,
      }}
    >
      <div style={{ fontSize: '1.1rem', marginTop: 1 }}>{item.pass ? '✅' : '❌'}</div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <strong style={{ fontSize: '0.9rem', flex: 1, marginRight: 12 }}>{item.skill}</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span
              style={{
                fontSize: '0.7rem',
                padding: '1px 7px',
                borderRadius: 99,
                background: 'var(--bg-subtle)',
                color: 'var(--text-muted)',
              }}
            >
              {item.type}
            </span>
            <ConfidenceBadge level={item.confidence} />
          </div>
        </div>
        <p style={{ fontSize: '0.82rem', margin: 0 }}>{item.evidence}</p>
      </div>
    </div>
  );
}

function NiceToHaveCard({ item }) {
  const pct = item.weight > 0 ? Math.round((item.score / item.weight) * 100) : 0;
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-subtle)',
        border: '1px solid var(--border)',
        marginBottom: 10,
      }}
    >
      <div className="flex justify-between items-center" style={{ marginBottom: 6 }}>
        <div className="flex items-center gap-2">
          <strong style={{ fontSize: '0.9rem' }}>{item.skill}</strong>
          <span
            style={{
              fontSize: '0.7rem',
              padding: '1px 7px',
              borderRadius: 99,
              background: 'var(--bg-card)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >
            {item.type}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ConfidenceBadge level={item.confidence} />
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            weight: <strong style={{ color: 'var(--text)' }}>{item.weight}</strong>
          </span>
          <span style={{ fontWeight: 700, color: item.score > 0 ? 'var(--pass)' : 'var(--text-faint)' }}>
            +{item.score}
          </span>
        </div>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%`, background: item.score > 0 ? 'var(--pass)' : 'var(--border)' }} />
      </div>
      <p style={{ fontSize: '0.78rem', marginTop: 6, marginBottom: 0 }}>{item.evidence}</p>
    </div>
  );
}

function QualitativeCard({ item }) {
  const color = { STRONG: 'var(--strong)', MODERATE: 'var(--moderate)', WEAK: 'var(--weak)' }[item.rating];
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-subtle)',
        border: '1px solid var(--border)',
        marginBottom: 8,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div className="flex justify-between items-center" style={{ marginBottom: 4 }}>
        <strong style={{ fontSize: '0.88rem' }}>{item.dimension}</strong>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color }}>{item.rating}</span>
      </div>
      <p style={{ fontSize: '0.82rem', margin: 0 }}>{item.evidence}</p>
    </div>
  );
}

function GapCard({ item }) {
  const colors = {
    BLOCKER: { bg: 'var(--blocker-bg)', border: 'var(--fail)', text: 'var(--fail)' },
    'RAMP-UP': { bg: 'var(--rampup-bg)', border: 'var(--warn)', text: 'var(--warn)' },
    MINOR: { bg: 'var(--minor-bg)', border: 'var(--pass)', text: 'var(--pass)' },
  };
  const c = colors[item.severity] || colors.MINOR;
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 'var(--radius-sm)',
        background: c.bg,
        border: `1px solid ${c.border}`,
        marginBottom: 8,
      }}
    >
      <div className="flex justify-between items-center" style={{ marginBottom: 4 }}>
        <strong style={{ fontSize: '0.88rem' }}>{item.skill}</strong>
        <span
          className="badge"
          style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
        >
          {item.severity}
        </span>
      </div>
      <p style={{ fontSize: '0.82rem', margin: 0 }}>{item.note}</p>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────
export default function Home({ theme, toggleTheme }) {
  const [step, setStep] = useState(1);

  // Step 1 — JD
  const [jdText, setJdText] = useState('');
  const [parsedJD, setParsedJD] = useState(null);
  const [jdLoading, setJdLoading] = useState(false);
  const [jdError, setJdError] = useState('');

  // Step 2 — Criteria
  const [mandatory, setMandatory] = useState([]);
  const [niceToHave, setNiceToHave] = useState([]);
  const [additionalContext, setAdditionalContext] = useState('');
  const [newMandatory, setNewMandatory] = useState({ skill: '', type: 'technical' });
  const [newNice, setNewNice] = useState({ skill: '', type: 'technical', weight: 10 });

  // Step 3 — CV
  const [cvText, setCvText] = useState('');
  const [cvLoading, setCvLoading] = useState(false);
  const [cvReformatting, setCvReformatting] = useState(false);
  const [cvReformatDone, setCvReformatDone] = useState(false);
  const [cvPreviewMode, setCvPreviewMode] = useState(false);
  const [cvFileName, setCvFileName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef();

  // Step 4 — Results
  const [result, setResult] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const [screeningRecords, setScreeningRecords] = useState(() => loadRecords());
  const [currentRecord, setCurrentRecord] = useState(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // ── JD parsing ──
  async function handleExtractCriteria() {
    if (!jdText.trim()) return;
    setJdLoading(true);
    setJdError('');
    try {
      const res = await fetch('/api/parse-jd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: jdText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setParsedJD(data);
      setMandatory(data.mandatory || []);
      setNiceToHave(data.nicetohave || []);
      setStep(2);
    } catch (e) {
      setJdError(e.message || 'Failed to extract criteria. Please try again.');
    } finally {
      setJdLoading(false);
    }
  }

  // ── Criteria editing ──
  function totalWeight() {
    return niceToHave.reduce((s, i) => s + Number(i.weight), 0);
  }

  function addMandatory() {
    if (!newMandatory.skill.trim()) return;
    setMandatory([...mandatory, { ...newMandatory }]);
    setNewMandatory({ skill: '', type: 'technical' });
  }

  function addNiceToHave() {
    if (!newNice.skill.trim()) return;
    setNiceToHave([...niceToHave, { ...newNice, weight: Number(newNice.weight) }]);
    setNewNice({ skill: '', type: 'technical', weight: 10 });
  }

  // ── PDF extraction ──
  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCvFileName(file.name);
    setCvReformatDone(false);
    setCvLoading(true);
    try {
      // Step 1: Extract raw text from PDF (client-side)
      const rawText = await extractTextFromPDF(file);
      setCvText(rawText); // show raw text immediately as fallback
      setCvLoading(false);

      // Step 2: Reformat to markdown via Claude (server-side)
      setCvReformatting(true);
      const res = await fetch('/api/reformat-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawText }),
      });
      const data = await res.json();
      if (data.formatted) setCvText(data.formatted);
    } catch {
      setCvText('');
      alert('Could not extract text from PDF. Please paste the CV manually below.');
    } finally {
      setCvLoading(false);
      setCvReformatting(false);
      setCvReformatDone(true);
    }
  }

  // ── Analysis ──
  async function handleAnalyze() {
    if (!cvText.trim()) return;
    setAnalyzing(true);
    setAnalyzeError('');
    setResult(null);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobDescription: jdText,
          mandatory,
          niceToHave,
          additionalContext,
          cvText,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
      const jdTitle = parsedJD?.job_title || 'Unknown Role';
      const rec = saveRecord(data, jdTitle);
      setCurrentRecord(rec);
      setScreeningRecords(loadRecords());
      setStep(4);
    } catch (e) {
      setAnalyzeError(e.message || 'Analysis failed. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  }

  // ── Render ──
  return (
    <>
      <Head>
        <title>CV Screening Assistant · Astro</title>
        <meta name="description" content="AI-powered CV screening copilot for Astro recruiters" />
      </Head>

      {/* ── Header ── */}
      <header
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-card)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          className="container"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 34, height: 34,
                borderRadius: 9,
                background: 'var(--primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1rem',
              }}
            >
              🚀
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>
                CV Screening Assistant
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Powered by Claude · Astro Internal Tool
              </div>
            </div>
          </div>
          <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
        </div>
      </header>

      {/* ── Main ── */}
      <main className="container" style={{ paddingTop: 40, paddingBottom: 80 }}>
        <StepIndicator current={step} />


        {/* ══ STEP 1 — Job Description ══ */}
        {step === 1 && (
          <div className="card fade-up">
            <div className="section-header">
              <div className="section-icon">📋</div>
              <div>
                <h2>Job Description</h2>
                <p style={{ margin: 0, fontSize: '0.85rem' }}>
                  Copy the full text from any job posting (Kalibrr, LinkedIn, etc.) and paste below.
                  AI will automatically extract the hiring criteria for you.
                </p>
              </div>
            </div>

            <label>Job Description Text</label>
            <textarea
              placeholder={"Paste the full job description here…\n\nTip: On Kalibrr, select all text on the job page (Ctrl+A), copy (Ctrl+C), then paste here."}
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              style={{ minHeight: 220, marginBottom: 16 }}
            />

            {jdError && (
              <div className="warning-banner" style={{ marginBottom: 16 }}>
                ⚠️ {jdError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-primary"
                onClick={handleExtractCriteria}
                disabled={jdLoading || !jdText.trim()}
              >
                {jdLoading ? <><div className="spinner" /> Extracting criteria…</> : '⚡ Extract Criteria'}
              </button>
            </div>
          </div>
        )}


        {/* ══ STEP 2 — Hiring Criteria ══ */}
        {step === 2 && (
          <div className="fade-up">
            {parsedJD && (
              <div
                className="card"
                style={{ marginBottom: 20, background: 'var(--primary-light)', border: '1px solid var(--primary)' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong style={{ color: 'var(--primary)' }}>✓ Criteria extracted from job description</strong>
                    <p style={{ margin: '2px 0 0', fontSize: '0.82rem' }}>
                      {parsedJD.job_title} · {parsedJD.company}
                    </p>
                  </div>
                  <button className="btn btn-ghost" onClick={() => setStep(1)}>← Edit JD</button>
                </div>
              </div>
            )}

            {/* Mandatory */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="section-header">
                <div className="section-icon">🔒</div>
                <div>
                  <h2>Mandatory Requirements</h2>
                  <p style={{ margin: 0, fontSize: '0.85rem' }}>Hard filters — candidate must pass all of these.</p>
                </div>
              </div>

              {mandatory.map((m, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px',
                    background: 'var(--bg-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: 8,
                  }}
                >
                  <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 500 }}>{m.skill}</span>
                  <span
                    style={{
                      fontSize: '0.72rem', padding: '2px 8px', borderRadius: 99,
                      background: 'var(--bg-card)', color: 'var(--text-muted)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {m.type}
                  </span>
                  <button className="btn btn-danger" onClick={() => setMandatory(mandatory.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input
                  type="text"
                  placeholder="Add requirement…"
                  value={newMandatory.skill}
                  onChange={(e) => setNewMandatory({ ...newMandatory, skill: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && addMandatory()}
                  style={{ flex: 1 }}
                />
                <select
                  value={newMandatory.type}
                  onChange={(e) => setNewMandatory({ ...newMandatory, type: e.target.value })}
                  style={{ width: 140 }}
                >
                  <option value="technical">Technical</option>
                  <option value="education">Education</option>
                  <option value="experience">Experience</option>
                </select>
                <button className="btn btn-secondary" onClick={addMandatory}>+ Add</button>
              </div>
            </div>

            {/* Nice-to-Have */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="section-header">
                <div className="section-icon">⭐</div>
                <div>
                  <h2>Nice-to-Have</h2>
                  <p style={{ margin: 0, fontSize: '0.85rem' }}>
                    Weighted preferences. Total weight:{' '}
                    <strong style={{ color: totalWeight() === 100 ? 'var(--pass)' : 'var(--warn)' }}>
                      {totalWeight()}/100
                    </strong>
                    {totalWeight() !== 100 && ' — weights should sum to 100'}
                  </p>
                </div>
              </div>

              {niceToHave.map((n, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px',
                    background: 'var(--bg-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: 8,
                  }}
                >
                  <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 500 }}>{n.skill}</span>
                  <span
                    style={{
                      fontSize: '0.72rem', padding: '2px 8px', borderRadius: 99,
                      background: 'var(--bg-card)', color: 'var(--text-muted)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {n.type}
                  </span>
                  <input
                    type="number"
                    value={n.weight}
                    min={1}
                    max={100}
                    onChange={(e) => {
                      const updated = [...niceToHave];
                      updated[i] = { ...updated[i], weight: Number(e.target.value) };
                      setNiceToHave(updated);
                    }}
                    style={{ width: 84, textAlign: 'center' }}
                  />
                  <button className="btn btn-danger" onClick={() => setNiceToHave(niceToHave.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input
                  type="text"
                  placeholder="Add nice-to-have…"
                  value={newNice.skill}
                  onChange={(e) => setNewNice({ ...newNice, skill: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && addNiceToHave()}
                  style={{ flex: 1 }}
                />
                <select
                  value={newNice.type}
                  onChange={(e) => setNewNice({ ...newNice, type: e.target.value })}
                  style={{ width: 140 }}
                >
                  <option value="technical">Technical</option>
                  <option value="education">Education</option>
                  <option value="experience">Experience</option>
                </select>
                <input
                  type="number"
                  value={newNice.weight}
                  min={1}
                  max={100}
                  onChange={(e) => setNewNice({ ...newNice, weight: Number(e.target.value) })}
                  style={{ width: 84, textAlign: 'center' }}
                />
                <button className="btn btn-secondary" onClick={addNiceToHave}>+ Add</button>
              </div>
            </div>

            {/* Additional Context */}
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="section-header">
                <div className="section-icon">💬</div>
                <div>
                  <h2>Additional Context <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.8rem' }}>(optional)</span></h2>
                  <p style={{ margin: 0, fontSize: '0.85rem' }}>
                    Any qualitative nuance for this hire — e.g. "must be comfortable with ambiguity", "experience with local vendors preferred".
                  </p>
                </div>
              </div>
              <textarea
                placeholder="E.g. We need someone who can work independently and is comfortable with fast-changing priorities…"
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                style={{ minHeight: 80 }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn btn-secondary" onClick={() => setStep(1)}>← Back</button>
              <button
                className="btn btn-primary"
                onClick={() => setStep(3)}
                disabled={mandatory.length === 0}
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ══ STEP 3 — Upload CV ══ */}
        {step === 3 && (
          <div className="card fade-up">
            <div className="section-header">
              <div className="section-icon">📄</div>
              <div>
                <h2>Candidate CV</h2>
                <p style={{ margin: 0, fontSize: '0.85rem' }}>
                  Upload a PDF (ATS-friendly format recommended) or paste the text directly.
                </p>
              </div>
            </div>

            {/* Drop zone — supports click and drag & drop */}
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files?.[0];
                if (file && file.type === 'application/pdf') {
                  handleFileUpload({ target: { files: [file] } });
                } else if (file) {
                  alert('Please drop a PDF file.');
                }
              }}
              style={{
                border: isDragging
                  ? '2px dashed var(--primary)'
                  : cvFileName ? '2px dashed var(--pass)' : '2px dashed var(--border)',
                borderRadius: 'var(--radius)',
                padding: '32px 24px',
                textAlign: 'center',
                cursor: 'pointer',
                marginBottom: 20,
                background: isDragging
                  ? 'var(--primary-light)'
                  : cvFileName ? 'var(--pass-bg)' : 'var(--bg-subtle)',
                transition: 'all 0.15s',
              }}
            >
              {cvLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <div className="spinner" />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Extracting text from PDF…</span>
                </div>
              ) : cvReformatting ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <div className="spinner" />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Formatting CV with AI…</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>Raw text shown below — formatted version coming shortly</span>
                </div>
              ) : isDragging ? (
                <div>
                  <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>📂</div>
                  <strong style={{ fontSize: '0.9rem', color: 'var(--primary)' }}>Drop PDF here</strong>
                </div>
              ) : cvFileName ? (
                <div>
                  <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>✅</div>
                  <strong style={{ fontSize: '0.9rem', color: 'var(--pass)' }}>{cvFileName}</strong>
                  <p style={{ fontSize: '0.8rem', marginTop: 4 }}>Formatted as markdown. Review and edit below if needed.</p>
                  <p style={{ fontSize: '0.75rem', marginTop: 4, color: 'var(--text-faint)' }}>Click or drop a new file to replace</p>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>📎</div>
                  <strong style={{ fontSize: '0.9rem' }}>Drag & drop PDF here</strong>
                  <p style={{ fontSize: '0.8rem', marginTop: 4, color: 'var(--text-muted)' }}>or click to browse · ATS-friendly CVs work best</p>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />
            </div>

            {/* CV text label + char counter + Edit/Preview toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ margin: 0 }}>CV Text — review &amp; edit before analyzing</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono)',
                  color: cvText.length > CV_CHAR_LIMIT ? 'var(--fail)' : cvText.length > CV_CHAR_LIMIT * 0.85 ? 'var(--warn)' : 'var(--text-faint)',
                }}>
                  {cvText.length.toLocaleString()} / {CV_CHAR_LIMIT.toLocaleString()} chars
                </span>
                {cvText.trim() && (
                  <div style={{ display: 'flex', borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden' }}>
                    <button
                      onClick={() => setCvPreviewMode(false)}
                      style={{
                        padding: '3px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        border: 'none',
                        cursor: 'pointer',
                        background: !cvPreviewMode ? 'var(--primary)' : 'var(--bg-subtle)',
                        color: !cvPreviewMode ? '#fff' : 'var(--text-muted)',
                        transition: 'all 0.15s',
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setCvPreviewMode(true)}
                      style={{
                        padding: '3px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        border: 'none',
                        cursor: 'pointer',
                        background: cvPreviewMode ? 'var(--primary)' : 'var(--bg-subtle)',
                        color: cvPreviewMode ? '#fff' : 'var(--text-muted)',
                        transition: 'all 0.15s',
                      }}
                    >
                      Preview
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Edit mode — textarea (three states) */}
            {!cvPreviewMode && (
              <>
                <textarea
                  placeholder={cvReformatting
                    ? "Formatting CV with AI — please wait before editing…"
                    : "Paste CV text or upload PDF above…"
                  }
                  value={cvText}
                  onChange={(e) => {
                    setCvText(e.target.value);
                    if (cvReformatDone) setCvReformatDone(false);
                  }}
                  disabled={cvReformatting}
                  style={{
                    minHeight: 220,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.82rem',
                    borderColor: cvText.length > CV_CHAR_LIMIT
                      ? 'var(--fail)'
                      : cvReformatting
                      ? 'var(--border)'
                      : undefined,
                    background: cvReformatting ? 'var(--bg-subtle)' : undefined,
                    cursor: cvReformatting ? 'not-allowed' : undefined,
                    opacity: cvReformatting ? 0.6 : 1,
                    transition: 'all 0.2s',
                  }}
                />
                {/* State 3 — reformat complete confirmation */}
                {cvReformatDone && !cvReformatting && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 6,
                    fontSize: '0.78rem',
                    color: 'var(--pass)',
                    fontWeight: 600,
                  }}>
                    ✓ AI formatting complete — review and edit before analyzing
                  </div>
                )}
              </>
            )}

            {/* Preview mode — rendered markdown */}
            {cvPreviewMode && cvText.trim() && (
              <div style={{
                minHeight: 220,
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-subtle)',
                border: '1.5px solid var(--border)',
                fontSize: '0.88rem',
                lineHeight: 1.7,
                overflowY: 'auto',
                maxHeight: 420,
              }}>
                {cvText.split('\n').map((line, i) => {
                  if (/^## (.+)/.test(line)) {
                    return <h3 key={i} style={{ fontSize: '0.95rem', fontWeight: 700, margin: '14px 0 4px', color: 'var(--primary)' }}>{line.replace(/^## /, '')}</h3>;
                  }
                  if (/^### (.+)/.test(line)) {
                    return <h4 key={i} style={{ fontSize: '0.88rem', fontWeight: 700, margin: '10px 0 2px' }}>{line.replace(/^### /, '')}</h4>;
                  }
                  if (/^- (.+)/.test(line)) {
                    const text = line.replace(/^- /, '');
                    const parts = [];
                    const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
                    let last = 0, match;
                    while ((match = regex.exec(text)) !== null) {
                      if (match.index > last) parts.push(text.slice(last, match.index));
                      if (match[1]) parts.push(<strong key={match.index}>{match[1]}</strong>);
                      else if (match[2]) parts.push(<em key={match.index}>{match[2]}</em>);
                      last = match.index + match[0].length;
                    }
                    if (last < text.length) parts.push(text.slice(last));
                    return <div key={i} style={{ display: 'flex', gap: 8, margin: '2px 0' }}><span style={{ color: 'var(--primary)', flexShrink: 0 }}>•</span><span>{parts}</span></div>;
                  }
                  if (line.trim() === '') return <div key={i} style={{ height: 6 }} />;
                  // Inline bold/italic for regular lines
                  const parts = [];
                  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
                  let last = 0, match;
                  while ((match = regex.exec(line)) !== null) {
                    if (match.index > last) parts.push(line.slice(last, match.index));
                    if (match[1]) parts.push(<strong key={match.index}>{match[1]}</strong>);
                    else if (match[2]) parts.push(<em key={match.index}>{match[2]}</em>);
                    last = match.index + match[0].length;
                  }
                  if (last < line.length) parts.push(line.slice(last));
                  return <p key={i} style={{ margin: '2px 0' }}>{parts}</p>;
                })}
              </div>
            )}

            {/* Visual limit marker — only shown when over limit */}
            {cvText.length > CV_CHAR_LIMIT && (
              <div style={{
                marginTop: 8,
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--fail-bg)',
                border: '1px solid var(--fail)',
                fontSize: '0.82rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ color: 'var(--fail)', fontWeight: 700 }}>⚠️ CV exceeds {CV_CHAR_LIMIT.toLocaleString()} character limit</span>
                </div>
                <p style={{ margin: 0, color: 'var(--text-muted)' }}>
                  Content after character <strong style={{ fontFamily: 'var(--font-mono)' }}>{CV_CHAR_LIMIT.toLocaleString()}</strong> will not be analyzed.
                  Please trim sections that are less relevant — e.g. early education, unrelated work experience, or duplicate information.
                  The content you keep should prioritize skills, recent experience, and achievements most relevant to this role.
                </p>
                <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--bg-subtle)', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  <span style={{ color: 'var(--text-faint)' }}>Content within limit ends at: </span>
                  <span style={{ color: 'var(--text)' }}>"…{cvText.slice(CV_CHAR_LIMIT - 60, CV_CHAR_LIMIT).trim()}"</span>
                  <span style={{ color: 'var(--fail)', fontWeight: 700 }}> ← limit</span>
                </div>
              </div>
            )}

            {analyzeError && (
              <div className="warning-banner" style={{ marginTop: 12 }}>
                ⚠️ {analyzeError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setStep(2)}>← Back</button>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                {cvReformatting && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Formatting CV… please wait
                  </span>
                )}
                {!cvReformatting && cvText.length > CV_CHAR_LIMIT && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--fail)' }}>
                    Trim {(cvText.length - CV_CHAR_LIMIT).toLocaleString()} characters to enable analysis
                  </span>
                )}
                <button
                  className="btn btn-primary"
                  onClick={handleAnalyze}
                  disabled={analyzing || cvReformatting || !cvText.trim() || cvText.length > CV_CHAR_LIMIT}
                >
                  {analyzing ? <><div className="spinner" /> Analyzing…</> : '🔍 Analyze CV'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══ STEP 4 — Results ══ */}
        {step === 4 && result && (
          <div className="fade-up">
            {/* Header bar */}
            <div
              className="card"
              style={{
                marginBottom: 20,
                background: 'var(--primary)',
                border: 'none',
                color: '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.7, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Candidate
                  </div>
                  <h2 style={{ color: '#fff', fontSize: '1.4rem', margin: 0 }}>
                    {result.candidate_name || 'Unknown Candidate'}
                  </h2>
                  {result.cv_quality === 'INSUFFICIENT' && (
                    <span
                      style={{
                        display: 'inline-block', marginTop: 6,
                        background: 'rgba(255,255,255,0.15)',
                        padding: '3px 10px', borderRadius: 99,
                        fontSize: '0.75rem',
                      }}
                    >
                      ⚠️ CV data insufficient — results may be limited
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 24 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>
                      {(result.mandatory||[]).filter(m=>m.pass).length}/{(result.mandatory||[]).length}
                    </div>
                    <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>MANDATORY</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>
                      {result.nicetohave?.length > 0
                        ? <>{result.nicetohave_total}<span style={{ fontSize: '1rem', opacity: 0.7 }}>/100</span></>
                        : <span style={{ fontSize: '1rem', opacity: 0.6 }}>—</span>
                      }
                    </div>
                    <div style={{ fontSize: '0.72rem', opacity: 0.7 }}>NICE-TO-HAVE</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Screening Status badge */}
            {currentRecord && (
              <div style={{
                padding: '14px 18px',
                borderRadius: 'var(--radius-sm)',
                marginBottom: 20,
                background: {
                  'Shortlist': 'var(--pass-bg)',
                  'Consider': 'var(--warn-bg)',
                  'Review Gap': 'var(--accent-light)',
                  'Not Qualified': 'var(--fail-bg)',
                }[currentRecord.screeningStatus] || 'var(--bg-subtle)',
                border: `1px solid ${{
                  'Shortlist': 'var(--pass)',
                  'Consider': 'var(--warn)',
                  'Review Gap': 'var(--accent)',
                  'Not Qualified': 'var(--fail)',
                }[currentRecord.screeningStatus] || 'var(--border)'}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 3 }}>
                    Screening Status
                  </div>
                  <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>
                    {{
                      'Shortlist': '🟢',
                      'Consider': '🟡',
                      'Review Gap': '🟠',
                      'Not Qualified': '🔴',
                    }[currentRecord.screeningStatus]} {currentRecord.screeningStatus}
                  </div>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'right', maxWidth: 260 }}>
                  {(() => {
                    const nthSet = result.nicetohave?.length > 0;
                    const copy = {
                      'Shortlist':     nthSet
                        ? 'Strong mandatory pass rate and high nice-to-have score. No critical blockers. Recommended for next stage.'
                        : 'Strong mandatory pass rate. No critical blockers. Recommended for next stage.',
                      'Consider':      'Meets most requirements with manageable gaps. Worth evaluating further — check gap analysis for details.',
                      'Review Gap':    'Has at least one critical blocker or weak performance across mandatory requirements. Review before proceeding.',
                      'Not Qualified': 'Multiple critical blockers or insufficient mandatory coverage for this role.',
                    };
                    return copy[currentRecord.screeningStatus] || '';
                  })()}
                </div>
              </div>
            )}


            {/* CV trimmed warning */}
            {(result._truncated || result._cv_trimmed) && (
              <div className="warning-banner" style={{ marginBottom: 20 }}>
                ⚠️ CV text was trimmed to fit the analysis limit. For best results, paste only the relevant sections (Summary, Skills, Experience, Education) and remove any unrelated content.
              </div>
            )}

            {/* Standout Observation */}
            {result.standout_observation && (
              <div style={{
                display: 'flex',
                gap: 12,
                padding: '12px 16px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--primary-light)',
                border: '1px solid var(--primary)',
                marginBottom: 20,
                alignItems: 'flex-start',
              }}>
                <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>⭐</span>
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                    Standout Observation
                  </div>
                  <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text)', fontStyle: 'italic' }}>
                    {result.standout_observation}
                  </p>
                </div>
              </div>
            )}

            {/* Recruiter Summary */}
            <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--primary)' }}>
              <div className="section-header">
                <div className="section-icon">💡</div>
                <h2>Recruiter Summary</h2>
              </div>
              <div style={{ fontSize: '0.95rem', color: 'var(--text)', textAlign: 'justify' }}>
                {renderMarkdown(result.recruiter_summary)}
              </div>
            </div>

            {/* Mandatory */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="section-header">
                <div className="section-icon">🔒</div>
                <h2>
                  Mandatory Requirements —{' '}
                  {(() => {
                    const p = (result.mandatory||[]).filter(m=>m.pass).length;
                    const t = (result.mandatory||[]).length;
                    return <span style={{ color: p === t ? 'var(--pass)' : 'var(--fail)' }}>{p}/{t} passed</span>;
                  })()}
                </h2>
              </div>
              {result.mandatory?.map((m, i) => <MandatoryCard key={i} item={m} />)}
            </div>

            {/* Nice-to-Have */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="section-header">
                <div className="section-icon">⭐</div>
                <h2>
                  Nice-to-Have Score —{' '}
                  {result.nicetohave?.length > 0
                    ? <>{result.nicetohave_total}/100</>
                    : <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: 400 }}>Not configured</span>
                  }
                </h2>
              </div>
              {result.nicetohave?.length > 0 ? (
                <>
                  <div className="progress-bar" style={{ height: 10, marginBottom: 20 }}>
                    <div
                      className="progress-fill"
                      style={{
                        width: `${result.nicetohave_total}%`,
                        background: result.nicetohave_total >= 70
                          ? 'var(--pass)'
                          : result.nicetohave_total >= 40
                          ? 'var(--warn)'
                          : 'var(--fail)',
                      }}
                    />
                  </div>
                  {result.nicetohave.map((n, i) => <NiceToHaveCard key={i} item={n} />)}
                </>
              ) : (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
                  No nice-to-have criteria were defined for this role. Scoring was based entirely on mandatory requirements.
                </p>
              )}
            </div>

            {/* Qualitative Signals — 5 standard dimensions */}
            {result.qualitative_signals?.length > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="section-header">
                  <div className="section-icon">🔍</div>
                  <div>
                    <h2>Qualitative Signals</h2>
                    <p style={{ margin: 0, fontSize: '0.82rem' }}>
                      5 standard dimensions — inferred from how the candidate describes their experience, beyond keyword matching.
                    </p>
                  </div>
                </div>
                {result.qualitative_signals.map((q, i) => <QualitativeCard key={i} item={q} />)}
              </div>
            )}

            {/* Additional Signals — from HR's additional context */}
            {result.additional_signals?.length > 0 && (
              <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--accent)' }}>
                <div className="section-header">
                  <div className="section-icon" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>💬</div>
                  <div>
                    <h2>Additional Requirements</h2>
                    <p style={{ margin: 0, fontSize: '0.82rem' }}>
                      Evaluated based on the additional context you provided for this role.
                    </p>
                  </div>
                </div>
                {result.additional_signals.map((q, i) => <QualitativeCard key={i} item={q} />)}
              </div>
            )}

            {/* Gap Analysis */}
            {result.gap_analysis?.length > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="section-header">
                  <div className="section-icon">⚡</div>
                  <h2>Gap Analysis</h2>
                </div>
                {result.gap_analysis.map((g, i) => <GapCard key={i} item={g} />)}
              </div>
            )}

            {/* Interview Questions */}
            {result.interview_questions?.length > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="section-header">
                  <div className="section-icon">🎤</div>
                  <div>
                    <h2>Suggested Interview Questions</h2>
                    <p style={{ margin: 0, fontSize: '0.82rem' }}>Based on gaps and areas needing verification.</p>
                  </div>
                </div>
                {result.interview_questions.map((q, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex', gap: 12, alignItems: 'flex-start',
                      padding: '12px 16px',
                      background: 'var(--bg-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      marginBottom: 8,
                    }}
                  >
                    <span
                      style={{
                        width: 24, height: 24, borderRadius: '50%',
                        background: 'var(--primary-light)', color: 'var(--primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.75rem', fontWeight: 700, flexShrink: 0,
                      }}
                    >
                      {i + 1}
                    </span>
                    <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text)' }}>{q}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Token usage — Feature 3 */}
            {result._usage && (
              <div style={{
                padding: '12px 16px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border)',
                marginBottom: 20,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>⚡</span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {result._usage.input_tokens.toLocaleString()} in · {result._usage.output_tokens.toLocaleString()} out · {result._usage.total_tokens.toLocaleString()} total tokens
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Actual cost · Haiku
                    </div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                      ${result._usage.cost_usd.toFixed(4)}
                      <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>
                        (~Rp {Math.round(result._usage.cost_usd * 16500).toLocaleString()})
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Est. cost · Sonnet
                    </div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                      ${((result._usage.input_tokens / 1_000_000 * 3) + (result._usage.output_tokens / 1_000_000 * 15)).toFixed(4)}
                      <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-faint)', marginLeft: 4 }}>
                        (~Rp {Math.round(((result._usage.input_tokens / 1_000_000 * 3) + (result._usage.output_tokens / 1_000_000 * 15)) * 16500).toLocaleString()})
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Export + Navigation actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => { setStep(3); setResult(null); setShowExportMenu(false); }}>
                  ← Screen Another CV
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setStep(1);
                    setResult(null);
                    setJdText('');
                    setParsedJD(null);
                    setMandatory([]);
                    setNiceToHave([]);
                    setAdditionalContext('');
                    setCvText('');
                    setCvFileName('');
                    setCurrentRecord(null);
                    setShowExportMenu(false);
                  }}
                >
                  🔄 Start Over
                </button>
              </div>

              {/* Export dropdown */}
              <div style={{ position: 'relative' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowExportMenu(v => !v)}
                >
                  ⬇ Export{screeningRecords.length > 0 ? ` (${screeningRecords.length})` : ''} ▾
                </button>

                {showExportMenu && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '110%',
                      right: 0,
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      boxShadow: 'var(--shadow-lg)',
                      minWidth: 220,
                      zIndex: 50,
                      overflow: 'hidden',
                    }}
                  >
                    {/* Export PDF */}
                    <button
                      onClick={() => {
                        setShowExportMenu(false);
                        const nthItems = result.nicetohave || [];
                        const nthConfigured = nthItems.length > 0;
                        const { passed, total } = getMandatoryCounts(result.mandatory);
                        const blockerCount = (result.gap_analysis || []).filter(g => g.severity === 'BLOCKER').length;
                        const score = nthConfigured
                          ? (total > 0 ? (passed/total)*60 : 0) + (result.nicetohave_total||0)*(40/100) - blockerCount*50
                          : (total > 0 ? (passed/total)*100 : 0) - blockerCount*50;
                        generatePDF(result, parsedJD, nthItems, currentRecord?.screeningStatus || '—', score);
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        width: '100%', padding: '10px 16px',
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: '0.88rem', color: 'var(--text)', textAlign: 'left',
                        borderBottom: '1px solid var(--border)',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-subtle)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <span>📄</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>Export PDF</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Full analysis for this candidate</div>
                      </div>
                    </button>

                    {/* Export Excel */}
                    <button
                      onClick={() => { setShowExportMenu(false); exportToExcel(screeningRecords); }}
                      disabled={screeningRecords.length === 0}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        width: '100%', padding: '10px 16px',
                        background: 'none', border: 'none',
                        cursor: screeningRecords.length === 0 ? 'not-allowed' : 'pointer',
                        fontSize: '0.88rem', color: screeningRecords.length === 0 ? 'var(--text-faint)' : 'var(--text)',
                        textAlign: 'left',
                        borderBottom: '1px solid var(--border)',
                        opacity: screeningRecords.length === 0 ? 0.5 : 1,
                      }}
                      onMouseEnter={e => { if (screeningRecords.length > 0) e.currentTarget.style.background = 'var(--bg-subtle)'; }}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <span>📊</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>Export Excel {screeningRecords.length > 0 ? `(${screeningRecords.length})` : ''}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>All screened candidates</div>
                      </div>
                    </button>

                    {/* Reset & Save Current */}
                    <button
                      onClick={() => {
                        setShowExportMenu(false);
                        const msg = screeningRecords.length > 0
                          ? `Reset all ${screeningRecords.length} record(s) and save only this candidate? This cannot be undone.`
                          : 'No previous records to reset.';
                        if (screeningRecords.length === 0) return;
                        if (window.confirm(msg)) {
                          try { localStorage.removeItem('astro_cv_screening_records'); } catch {}
                          if (currentRecord) {
                            const fresh = [currentRecord];
                            try { localStorage.setItem('astro_cv_screening_records', JSON.stringify(fresh)); } catch {}
                            setScreeningRecords(fresh);
                          } else {
                            setScreeningRecords([]);
                          }
                        }
                      }}
                      disabled={screeningRecords.length === 0}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        width: '100%', padding: '10px 16px',
                        background: 'none', border: 'none',
                        cursor: screeningRecords.length === 0 ? 'not-allowed' : 'pointer',
                        fontSize: '0.88rem',
                        color: screeningRecords.length === 0 ? 'var(--text-faint)' : 'var(--fail)',
                        textAlign: 'left',
                        opacity: screeningRecords.length === 0 ? 0.5 : 1,
                      }}
                      onMouseEnter={e => { if (screeningRecords.length > 0) e.currentTarget.style.background = 'var(--fail-bg)'; }}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <span>🔄</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>Reset & Save Current</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Clear history, keep this result (→ 1)</div>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Close export menu on outside click */}
            {showExportMenu && (
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                onClick={() => setShowExportMenu(false)}
              />
            )}
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer
        style={{
          borderTop: '1px solid var(--border)',
          padding: '16px 0',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'var(--text-faint)',
        }}
      >
        CV Screening Assistant · Internal prototype · Astro Technologies Indonesia · AI outputs are recommendations, not decisions.
      </footer>
    </>
  );
}
