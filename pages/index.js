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
function getScreeningStatus(mandatorySummary, niceToHaveTotal, gapAnalysis, niceToHaveItems) {
  const { passed, total } = mandatorySummary || { passed: 0, total: 0 };
  const gaps = gapAnalysis || [];
  const nthConfigured = niceToHaveItems && niceToHaveItems.length > 0;

  const blockerCount   = gaps.filter(g => g.severity === 'BLOCKER').length;
  const blockerPenalty = blockerCount * 50;

  let compositeScore;
  if (!nthConfigured) {
    // NtH not set — score purely from mandatory (max 100)
    compositeScore = total > 0 ? (passed / total) * 100 - blockerPenalty : 0;
  } else {
    // NtH configured — 60/40 split
    const mandatoryBase   = total > 0 ? (passed / total) * 60 : 0;
    const nthContribution = (niceToHaveTotal || 0) * (40 / 100);
    compositeScore = mandatoryBase + nthContribution - blockerPenalty;
  }

  if (compositeScore >= 70) return 'Shortlist';
  if (compositeScore >= 45) return 'Consider';
  if (compositeScore >= 20) return 'Review Gap';
  return 'Not Qualified';
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
  const W = 210, H = 297;
  const ml = 20, mr = 20, mt = 20;
  const cw = W - ml - mr; // content width
  let y = mt;
  const colors = {
    primary:  [0, 71, 204],
    pass:     [22, 163, 74],
    fail:     [220, 38, 38],
    warn:     [217, 119, 6],
    text:     [13, 27, 42],
    muted:    [90, 104, 128],
    border:   [221, 227, 238],
    bgSubtle: [245, 247, 250],
    accent:   [255, 107, 43],
  };

  // ── helpers ──
  function setColor(rgb, type = 'text') {
    if (type === 'text') doc.setTextColor(...rgb);
    else if (type === 'fill') doc.setFillColor(...rgb);
    else if (type === 'draw') doc.setDrawColor(...rgb);
  }

  function checkPageBreak(needed = 10) {
    if (y + needed > H - 20) {
      doc.addPage();
      y = mt;
    }
  }

  function drawRect(x, ry, w, h, fillRgb, drawRgb, radius = 2) {
    if (fillRgb) { setColor(fillRgb, 'fill'); }
    if (drawRgb) { setColor(drawRgb, 'draw'); doc.setLineWidth(0.3); }
    const style = fillRgb && drawRgb ? 'FD' : fillRgb ? 'F' : 'D';
    doc.roundedRect(x, ry, w, h, radius, radius, style);
  }

  function sectionHeader(icon, title, subtitle) {
    checkPageBreak(18);
    setColor(colors.primary, 'fill');
    doc.setFontSize(9);
    doc.roundedRect(ml, y, 8, 8, 1, 1, 'F');
    setColor([255,255,255], 'text');
    doc.text(icon, ml + 4, y + 5.5, { align: 'center' });
    setColor(colors.text, 'text');
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(title, ml + 11, y + 5.5);
    y += 10;
    if (subtitle) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      setColor(colors.muted, 'text');
      doc.text(subtitle, ml + 11, y);
      y += 5;
    }
    y += 3;
  }

  function wrappedText(text, x, startY, maxW, fontSize = 9, fontStyle = 'normal', colorRgb = colors.text) {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', fontStyle);
    setColor(colorRgb, 'text');
    const lines = doc.splitTextToSize(String(text || ''), maxW);
    lines.forEach(line => {
      checkPageBreak(5);
      doc.text(line, x, startY);
      startY += fontSize * 0.45;
      y = Math.max(y, startY);
    });
    return startY;
  }

  function divider() {
    checkPageBreak(6);
    setColor(colors.border, 'draw');
    doc.setLineWidth(0.2);
    doc.line(ml, y, W - mr, y);
    y += 4;
  }

  // ════════════════════════════════════════════════
  // HEADER — Candidate name + scores
  // ════════════════════════════════════════════════
  drawRect(ml, y, cw, 28, colors.primary, null, 3);

  // Candidate label
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  setColor([200, 220, 255], 'text');
  doc.text('CANDIDATE', ml + 6, y + 7);

  // Candidate name — large, white, bold
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  setColor([255, 255, 255], 'text');
  doc.text(result.candidate_name || 'Unknown Candidate', ml + 6, y + 17);

  // Scores on right
  const passed = result.mandatory_summary?.passed ?? 0;
  const total = result.mandatory_summary?.total ?? 0;
  const nthConfigured = niceToHaveItems && niceToHaveItems.length > 0;

  // Mandatory score
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  setColor([255,255,255], 'text');
  doc.text(`${passed}/${total}`, W - mr - 52, y + 17);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  setColor([200, 220, 255], 'text');
  doc.text('MANDATORY', W - mr - 52, y + 23);

  // NtH score
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  setColor([255,255,255], 'text');
  doc.text(nthConfigured ? `${result.nicetohave_total}/100` : '—', W - mr - 22, y + 17, { align: 'right' });
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  setColor([200, 220, 255], 'text');
  doc.text('NICE-TO-HAVE', W - mr - 22, y + 23, { align: 'right' });

  y += 32;

  // ════════════════════════════════════════════════
  // STANDOUT OBSERVATION
  // ════════════════════════════════════════════════
  if (result.standout_observation) {
    checkPageBreak(20);
    drawRect(ml, y, cw, 4, null, null);
    const soText = doc.splitTextToSize(`⭐  ${result.standout_observation}`, cw - 12);
    const soH = soText.length * 4.5 + 8;
    drawRect(ml, y, cw, soH, [235, 240, 255], colors.primary, 2);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    setColor(colors.primary, 'text');
    doc.text('STANDOUT OBSERVATION', ml + 6, y + 5);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'italic');
    setColor(colors.text, 'text');
    const soLines = doc.splitTextToSize(result.standout_observation, cw - 12);
    soLines.forEach((line, i) => {
      doc.text(line, ml + 6, y + 10 + i * 4.5);
    });
    y += soH + 4;
  }

  // ════════════════════════════════════════════════
  // RECRUITER SUMMARY
  // ════════════════════════════════════════════════
  sectionHeader('💡', 'Recruiter Summary');
  const summaryClean = (result.recruiter_summary || '').replace(/\*\*/g, '').replace(/\*/g, '');
  const summaryLines = doc.splitTextToSize(summaryClean, cw);
  summaryLines.forEach(line => {
    checkPageBreak(5);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    setColor(colors.text, 'text');
    doc.text(line, ml, y);
    y += 4.5;
  });
  y += 4;

  // ════════════════════════════════════════════════
  // MANDATORY REQUIREMENTS
  // ════════════════════════════════════════════════
  const allPass = passed === total;
  sectionHeader('🔒', `Mandatory Requirements — ${passed}/${total} passed`);

  (result.mandatory || []).forEach(item => {
    const cardBg = item.pass ? [240, 253, 244] : [255, 245, 245];
    const cardBorder = item.pass ? colors.pass : colors.fail;
    const evidenceLines = doc.splitTextToSize(item.evidence || '', cw - 18);
    const cardH = 8 + evidenceLines.length * 4 + 3;
    checkPageBreak(cardH + 3);
    drawRect(ml, y, cw, cardH, cardBg, cardBorder, 2);
    // Icon
    doc.setFontSize(9);
    setColor(item.pass ? colors.pass : colors.fail, 'text');
    doc.text(item.pass ? '✓' : '✗', ml + 4, y + 5.5);
    // Skill name
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    setColor(colors.text, 'text');
    doc.text(item.skill, ml + 9, y + 5.5);
    // Type + confidence badge (right)
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    setColor(colors.muted, 'text');
    doc.text(`${item.type || ''} · ${item.confidence || ''}`, W - mr - 3, y + 5.5, { align: 'right' });
    // Evidence
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    setColor(colors.muted, 'text');
    evidenceLines.forEach((line, i) => {
      doc.text(line, ml + 9, y + 10 + i * 4);
    });
    y += cardH + 2;
  });
  y += 4;

  // ════════════════════════════════════════════════
  // NICE-TO-HAVE
  // ════════════════════════════════════════════════
  sectionHeader('⭐', `Nice-to-Have Score — ${nthConfigured ? `${result.nicetohave_total}/100` : 'Not configured'}`);

  if (!nthConfigured) {
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'italic');
    setColor(colors.muted, 'text');
    doc.text('No nice-to-have criteria were defined. Scoring was based entirely on mandatory requirements.', ml, y);
    y += 8;
  } else {
    // Progress bar
    checkPageBreak(10);
    setColor(colors.border, 'fill');
    doc.rect(ml, y, cw, 3, 'F');
    const barColor = result.nicetohave_total >= 70 ? colors.pass : result.nicetohave_total >= 40 ? colors.warn : colors.fail;
    setColor(barColor, 'fill');
    doc.rect(ml, y, cw * (result.nicetohave_total / 100), 3, 'F');
    y += 6;

    (result.nicetohave || []).forEach(item => {
      const evidenceLines = doc.splitTextToSize(item.evidence || '', cw - 18);
      const cardH = 8 + evidenceLines.length * 4 + 3;
      checkPageBreak(cardH + 3);
      drawRect(ml, y, cw, cardH, colors.bgSubtle, colors.border, 2);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      setColor(colors.text, 'text');
      doc.text(item.skill, ml + 5, y + 5.5);
      // Weight + score right
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      setColor(item.score > 0 ? colors.pass : colors.muted, 'text');
      doc.text(`+${item.score}`, W - mr - 3, y + 5.5, { align: 'right' });
      setColor(colors.muted, 'text');
      doc.text(`weight: ${item.weight}  ·  ${item.confidence || ''}`, W - mr - 12, y + 5.5, { align: 'right' });
      doc.setFontSize(7.5);
      setColor(colors.muted, 'text');
      evidenceLines.forEach((line, i) => {
        doc.text(line, ml + 5, y + 10 + i * 4);
      });
      y += cardH + 2;
    });
  }
  y += 4;

  // ════════════════════════════════════════════════
  // QUALITATIVE SIGNALS
  // ════════════════════════════════════════════════
  sectionHeader('🔍', 'Qualitative Signals', '5 standard dimensions — beyond keyword matching');
  const ratingColors = { STRONG: colors.pass, MODERATE: colors.warn, WEAK: colors.fail };

  (result.qualitative_signals || []).forEach(item => {
    const rc = ratingColors[item.rating] || colors.muted;
    const evidenceLines = doc.splitTextToSize(item.evidence || '', cw - 14);
    const cardH = 8 + evidenceLines.length * 4 + 3;
    checkPageBreak(cardH + 3);
    drawRect(ml, y, cw, cardH, colors.bgSubtle, colors.border, 2);
    // Left accent bar
    setColor(rc, 'fill');
    doc.rect(ml, y, 2, cardH, 'F');
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    setColor(colors.text, 'text');
    doc.text(item.dimension, ml + 6, y + 5.5);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    setColor(rc, 'text');
    doc.text(item.rating, W - mr - 3, y + 5.5, { align: 'right' });
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    setColor(colors.muted, 'text');
    evidenceLines.forEach((line, i) => {
      doc.text(line, ml + 6, y + 10 + i * 4);
    });
    y += cardH + 2;
  });
  y += 4;

  // ════════════════════════════════════════════════
  // ADDITIONAL REQUIREMENTS (if any)
  // ════════════════════════════════════════════════
  if (result.additional_signals?.length > 0) {
    sectionHeader('💬', 'Additional Requirements', 'Based on additional context provided for this role');
    result.additional_signals.forEach(item => {
      const rc = ratingColors[item.rating] || colors.muted;
      const evidenceLines = doc.splitTextToSize(item.evidence || '', cw - 14);
      const cardH = 8 + evidenceLines.length * 4 + 3;
      checkPageBreak(cardH + 3);
      drawRect(ml, y, cw, cardH, [255, 240, 232], colors.accent, 2);
      setColor(colors.accent, 'fill');
      doc.rect(ml, y, 2, cardH, 'F');
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      setColor(colors.text, 'text');
      doc.text(item.dimension, ml + 6, y + 5.5);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      setColor(rc, 'text');
      doc.text(item.rating, W - mr - 3, y + 5.5, { align: 'right' });
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      setColor(colors.muted, 'text');
      evidenceLines.forEach((line, i) => {
        doc.text(line, ml + 6, y + 10 + i * 4);
      });
      y += cardH + 2;
    });
    y += 4;
  }

  // ════════════════════════════════════════════════
  // GAP ANALYSIS
  // ════════════════════════════════════════════════
  if (result.gap_analysis?.length > 0) {
    sectionHeader('⚡', 'Gap Analysis');
    const severityColors = {
      'BLOCKER':  { bg: [255, 245, 245], border: colors.fail,  text: colors.fail },
      'RAMP-UP':  { bg: [255, 251, 235], border: colors.warn,  text: colors.warn },
      'MINOR':    { bg: [240, 253, 244], border: colors.pass,  text: colors.pass },
    };
    result.gap_analysis.forEach(item => {
      const sc = severityColors[item.severity] || severityColors['MINOR'];
      const noteLines = doc.splitTextToSize(item.note || '', cw - 18);
      const cardH = 8 + noteLines.length * 4 + 3;
      checkPageBreak(cardH + 3);
      drawRect(ml, y, cw, cardH, sc.bg, sc.border, 2);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      setColor(colors.text, 'text');
      doc.text(item.skill, ml + 5, y + 5.5);
      // Severity badge
      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      setColor(sc.text, 'text');
      doc.text(item.severity, W - mr - 3, y + 5.5, { align: 'right' });
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      setColor(colors.muted, 'text');
      noteLines.forEach((line, i) => {
        doc.text(line, ml + 5, y + 10 + i * 4);
      });
      y += cardH + 2;
    });
    y += 4;
  }

  // ════════════════════════════════════════════════
  // INTERVIEW QUESTIONS
  // ════════════════════════════════════════════════
  if (result.interview_questions?.length > 0) {
    sectionHeader('🎤', 'Suggested Interview Questions', 'Based on gaps and areas needing verification');
    result.interview_questions.forEach((q, i) => {
      const qLines = doc.splitTextToSize(q, cw - 14);
      const cardH = 6 + qLines.length * 4 + 4;
      checkPageBreak(cardH + 3);
      drawRect(ml, y, cw, cardH, colors.bgSubtle, colors.border, 2);
      // Number circle
      setColor(colors.primary, 'fill');
      doc.circle(ml + 7, y + cardH/2, 3.5, 'F');
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      setColor([255,255,255], 'text');
      doc.text(String(i + 1), ml + 7, y + cardH/2 + 2.5, { align: 'center' });
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      setColor(colors.text, 'text');
      qLines.forEach((line, j) => {
        doc.text(line, ml + 13, y + 6 + j * 4);
      });
      y += cardH + 2;
    });
    y += 4;
  }

  // ════════════════════════════════════════════════
  // SCREENING STATUS + TOKEN USAGE
  // ════════════════════════════════════════════════
  checkPageBreak(40);
  divider();

  // Screening status box
  const statusColors = {
    'Shortlist':     { bg: [240, 253, 244], border: colors.pass,  dot: colors.pass },
    'Consider':      { bg: [255, 251, 235], border: colors.warn,  dot: colors.warn },
    'Review Gap':    { bg: [255, 237, 213], border: colors.accent, dot: colors.accent },
    'Not Qualified': { bg: [255, 245, 245], border: colors.fail,  dot: colors.fail },
  };
  const sc2 = statusColors[screeningStatus] || statusColors['Consider'];
  drawRect(ml, y, cw * 0.48, 22, sc2.bg, sc2.border, 2);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  setColor(colors.muted, 'text');
  doc.text('SCREENING STATUS', ml + 5, y + 6);
  setColor(sc2.dot, 'fill');
  doc.circle(ml + 8, y + 14, 3, 'F');
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  setColor(colors.text, 'text');
  doc.text(screeningStatus, ml + 13, y + 16);

  // Token usage box
  if (result._usage) {
    drawRect(ml + cw * 0.52, y, cw * 0.48, 22, colors.bgSubtle, colors.border, 2);
    const ux = ml + cw * 0.52 + 5;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    setColor(colors.muted, 'text');
    doc.text('TOKEN USAGE & COST', ux, y + 6);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    setColor(colors.text, 'text');
    doc.text(`${result._usage.input_tokens.toLocaleString()} in · ${result._usage.output_tokens.toLocaleString()} out · ${result._usage.total_tokens.toLocaleString()} total`, ux, y + 12);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    setColor(colors.primary, 'text');
    doc.text(`Haiku: $${result._usage.cost_usd.toFixed(4)}`, ux, y + 18);
    const sonnetCost = ((result._usage.input_tokens / 1e6 * 3) + (result._usage.output_tokens / 1e6 * 15)).toFixed(4);
    setColor(colors.muted, 'text');
    doc.setFont('helvetica', 'normal');
    doc.text(`Est. Sonnet: $${sonnetCost}`, ux + 35, y + 18);
  }
  y += 26;

  // Score formula footnote
  const nthLabel = niceToHaveItems?.length > 0 ? `NtH score × 40/100` : 'NtH not configured';
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  setColor(colors.muted, 'text');
  doc.text(`Score basis: mandatory (${result.mandatory_summary?.passed}/${result.mandatory_summary?.total}) × ${niceToHaveItems?.length > 0 ? 60 : 100} + ${nthLabel} − blockers × 50 = ${Math.round(compositeScore)} pts`, ml, y);
  y += 5;

  // ════════════════════════════════════════════════
  // FOOTER on every page
  // ════════════════════════════════════════════════
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    setColor(colors.muted, 'text');
    doc.text('CV Screening Assistant · Astro Technologies Indonesia · AI outputs are recommendations, not decisions.', ml, H - 10);
    doc.text(`${i} / ${pageCount}`, W - mr, H - 10, { align: 'right' });
    // Top border line on every page
    setColor(colors.primary, 'draw');
    doc.setLineWidth(0.5);
    doc.line(ml, 12, W - mr, 12);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    setColor(colors.primary, 'text');
    doc.text('CV Screening Assistant · Astro Internal Tool', ml, 10);
    // Date + candidate on header right
    doc.setFont('helvetica', 'normal');
    setColor(colors.muted, 'text');
    const date = new Date().toISOString().slice(0,10);
    doc.text(`${date} · ${result.candidate_name || 'Candidate'}`, W - mr, 10, { align: 'right' });
  }

  // Save
  const date = new Date().toISOString().slice(0,10);
  const name = (result.candidate_name || 'Candidate').replace(/\s+/g, '-');
  doc.save(`${date}_${name}_CV-Analysis.pdf`);
}

// ─── localStorage helpers ─────────────────────────────────────────
const LS_KEY = 'astro_cv_screening_records';

function saveRecord(result, jobTitle) {
  const status = getScreeningStatus(result.mandatory_summary, result.nicetohave_total, result.gap_analysis, result.nicetohave);
  const topGap = result.gap_analysis?.find(g => g.severity === 'BLOCKER')?.skill
    || result.gap_analysis?.find(g => g.severity === 'RAMP-UP')?.skill
    || result.gap_analysis?.[0]?.skill
    || '—';

  const record = {
    date:             new Date().toISOString().slice(0, 10),
    candidateName:    result.candidate_name || 'Unknown',
    role:             jobTitle || 'Unknown Role',
    mandatoryPassed:  result.mandatory_summary?.passed ?? 0,
    mandatoryTotal:   result.mandatory_summary?.total ?? 0,
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
                      {result.mandatory_summary?.passed}/{result.mandatory_summary?.total}
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

            {/* CV trimmed warning */}
            {(result._truncated || result._cv_trimmed) && (
              <div className="warning-banner" style={{ marginBottom: 20 }}>
                ⚠️ CV text was trimmed to fit the analysis limit. For best results, paste only the relevant sections (Summary, Skills, Experience, Education) and remove any unrelated content.
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
                  <span
                    style={{
                      color:
                        result.mandatory_summary?.passed === result.mandatory_summary?.total
                          ? 'var(--pass)'
                          : 'var(--fail)',
                    }}
                  >
                    {result.mandatory_summary?.passed}/{result.mandatory_summary?.total} passed
                  </span>
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
                  {{
                    'Shortlist':     'Strong mandatory pass rate and high nice-to-have score. No critical blockers. Recommended for next stage.',
                    'Consider':      'Meets most requirements with manageable gaps. Worth evaluating further — check gap analysis for details.',
                    'Review Gap':    'Has at least one critical blocker or weak performance across both mandatory and nice-to-have. Review before proceeding.',
                    'Not Qualified': 'Multiple critical blockers or insufficient mandatory coverage for this role.',
                  }[currentRecord.screeningStatus]}
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
                        const passed = result.mandatory_summary?.passed ?? 0;
                        const total = result.mandatory_summary?.total ?? 0;
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
