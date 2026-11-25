import { useState } from 'react';
import { jsPDF } from 'jspdf';
import { fetchStructureFile } from '../api';
import type { LigandSummary, PredictResponse, StructureContext } from '../types';
import { SS_NAME } from '../types';

interface Props {
  sequence: string;
  result: PredictResponse;
  pdbId?: string | null;
  chainId?: string | null;
  rawPdbText?: string | null;
  structureContext?: StructureContext | null;
  ligands?: LigandSummary[];
}

export default function ExportPanel({
  sequence,
  result,
  pdbId,
  chainId,
  rawPdbText,
  structureContext,
  ligands = [],
}: Props) {
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [downloadingFormat, setDownloadingFormat] = useState<'pdb' | 'cif' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const showCopied = (type: string) => {
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2200);
  };

  const ssString = result.residues.map((r) => r.label).join('');
  const targetLabel = pdbId ? `PDB ${pdbId} (Chain ${chainId ?? 'A'})` : 'Target Sequence';

  // Copy SS string
  const copySsString = async () => {
    try {
      await navigator.clipboard.writeText(ssString);
      showCopied('ss');
    } catch {
      // clipboard fallback
    }
  };

  // Copy FASTA
  const copyFasta = async () => {
    const header = pdbId ? `>PDB:${pdbId}_${chainId ?? 'A'} | Secondary Structure Prediction` : `>Sequence | Secondary Structure Prediction`;
    const fasta = `${header}\n${sequence}\n>Predicted_SS (H=Helix, E=Strand, C=Coil)\n${ssString}\n`;
    try {
      await navigator.clipboard.writeText(fasta);
      showCopied('fasta');
    } catch {
      // clipboard fallback
    }
  };

  // Download CSV
  const downloadCsv = () => {
    const headers = 'Position,Residue,Predicted_SS,Assigned_State_Score,P_Helix,P_Strand,P_Coil\n';
    const rows = result.residues
      .map(
        (r) =>
          `${r.index + 1},${r.aa},${r.label},${r.confidence},${r.probs.H},${r.probs.E},${r.probs.C}`
      )
      .join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pdbId ? `${pdbId}_${chainId ?? 'A'}` : 'prediction'}_secondary_structure.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download JSON
  const downloadJson = () => {
    const payload = {
      target: targetLabel,
      pdbId: pdbId ?? null,
      chainId: chainId ?? null,
      timestamp: new Date().toISOString(),
      sequence,
      prediction: result,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pdbId ? `${pdbId}_${chainId ?? 'A'}` : 'prediction'}_data.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadStructure = async (format: 'pdb' | 'cif') => {
    if (!pdbId) return;
    setDownloadingFormat(format);
    setDownloadError(null);
    try {
      const blob = format === 'pdb' && rawPdbText
        ? new Blob([rawPdbText], { type: 'chemical/x-pdb' })
        : await fetchStructureFile(pdbId, format);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${pdbId}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      setDownloadError(error instanceof Error ? error.message : 'Structure download failed.');
    } finally {
      setDownloadingFormat(null);
    }
  };

  // Download FASTA file
  const downloadFastaFile = () => {
    const header = pdbId ? `>PDB:${pdbId}_${chainId ?? 'A'} | Length: ${sequence.length}` : `>Target_Sequence | Length: ${sequence.length}`;
    const fasta = `${header}\n${sequence}\n>Predicted_SS (H/E/C)\n${ssString}\n`;
    const blob = new Blob([fasta], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pdbId ? `${pdbId}_${chainId ?? 'A'}` : 'sequence'}.fasta`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Generate Professional PDF Report using jsPDF
  const downloadPdfReport = async () => {
    setIsGeneratingPdf(true);
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4',
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 40;
      let y = 45;

      // Color Palette
      const primaryColor: [number, number, number] = [14, 35, 48];     // Deep navy
      const accentTeal: [number, number, number] = [42, 157, 143];     // Teal
      const helixColor: [number, number, number] = [200, 55, 75];      // Helix red
      const strandColor: [number, number, number] = [217, 130, 43];    // Strand amber
      const coilColor: [number, number, number] = [107, 122, 136];     // Coil slate
      const darkText: [number, number, number] = [25, 33, 44];
      const lightBg: [number, number, number] = [246, 248, 250];

      // --- HEADER BANNER ---
      doc.setFillColor(...primaryColor);
      doc.rect(0, 0, pageWidth, 75, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('SECONDARY STRUCTURE & BIOPHYSICAL ANALYSIS REPORT', margin, 34);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(170, 205, 215);
      doc.text(`Target: ${targetLabel}  |  Generated: ${new Date().toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })}`, margin, 52);

      y = 100;

      // --- EXECUTIVE SUMMARY SECTION ---
      doc.setTextColor(...darkText);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('1. Executive Structural Summary', margin, y);
      y += 16;

      const n = result.residues.length;
      const hCount = result.counts.H || 0;
      const eCount = result.counts.E || 0;
      const cCount = result.counts.C || 0;
      const meanScore = Math.round((result.residues.reduce((a, b) => a + b.confidence, 0) / n) * 100);

      let composition = 'Mixed H/E/C prediction';
      if ((hCount / n) >= 0.45) composition = 'Helix-rich predicted composition';
      else if ((eCount / n) >= 0.35) composition = 'Strand-rich predicted composition';
      else if ((cCount / n) >= 0.55) composition = 'Coil-rich predicted composition';

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.text(`Total Residues: ${n} amino acids    |    Secondary-structure composition: ${composition}`, margin, y, { maxWidth: pageWidth - margin * 2 });
      y += 14;
      doc.text(`Mean assigned-state score: ${meanScore}% (heuristic, not calibrated)    |    Prediction Engine: ${result.model}`, margin, y, { maxWidth: pageWidth - margin * 2 });
      y += 20;

      // Composition Stats Box
      doc.setFillColor(...lightBg);
      doc.roundedRect(margin, y, pageWidth - margin * 2, 54, 5, 5, 'F');
      doc.setDrawColor(218, 226, 233);
      doc.roundedRect(margin, y, pageWidth - margin * 2, 54, 5, 5, 'S');

      const colW = (pageWidth - margin * 2) / 3;
      
      // Helix Stat
      doc.setTextColor(...helixColor);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(`${((hCount / n) * 100).toFixed(1)}%`, margin + 15, y + 24);
      doc.setFontSize(8.5);
      doc.setTextColor(...darkText);
      doc.setFont('helvetica', 'normal');
      doc.text(`Alpha-Helix (${hCount} residues)`, margin + 15, y + 40);

      // Strand Stat
      doc.setTextColor(...strandColor);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(`${((eCount / n) * 100).toFixed(1)}%`, margin + colW + 15, y + 24);
      doc.setFontSize(8.5);
      doc.setTextColor(...darkText);
      doc.setFont('helvetica', 'normal');
      doc.text(`Beta-Strand (${eCount} residues)`, margin + colW + 15, y + 40);

      // Coil Stat
      doc.setTextColor(...coilColor);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(`${((cCount / n) * 100).toFixed(1)}%`, margin + colW * 2 + 15, y + 24);
      doc.setFontSize(8.5);
      doc.setTextColor(...darkText);
      doc.setFont('helvetica', 'normal');
      doc.text(`Coil & Turns (${cCount} residues)`, margin + colW * 2 + 15, y + 40);

      y += 75;

      // --- PHYSICOCHEMICAL PROPERTIES ---
      if (result.properties) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text('2. Physicochemical & Formula Profile', margin, y);
        y += 16;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        const formulaStr = result.properties.formula || 'N/A';
        const massStr = result.properties.mass ? `${result.properties.mass.toLocaleString()} Da` : 'N/A';
        doc.text(`Molecular Formula: ${formulaStr}    |    Calculated Mass: ${massStr}`, margin, y);
        y += 14;

        const atomDesc = Object.entries(result.properties.atoms || {})
          .map(([k, v]) => `${k}:${v}`)
          .join('  ');
        doc.text(`Elemental Composition: ${atomDesc}`, margin, y);
        y += 24;
      }

      // --- CONTINUOUS MOTIFS IDENTIFIED ---
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('3. Continuous Secondary Structure Motifs', margin, y);
      y += 16;

      // Extract segments
      const segments: { type: string; start: number; end: number; len: number }[] = [];
      let curType = result.residues[0].label;
      let curStart = 0;
      for (let i = 1; i < n; i++) {
        if (result.residues[i].label !== curType) {
          segments.push({ type: curType, start: curStart + 1, end: i, len: i - curStart });
          curType = result.residues[i].label;
          curStart = i;
        }
      }
      segments.push({ type: curType, start: curStart + 1, end: n, len: n - curStart });

      const helices = segments.filter((s) => s.type === 'H');
      const strands = segments.filter((s) => s.type === 'E');

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const helixDesc = helices.length > 0 
        ? helices.map((h, i) => `α${i + 1}(Res ${h.start}-${h.end}, ${h.len}aa)`).join(', ')
        : 'None';
      const strandDesc = strands.length > 0
        ? strands.map((s, i) => `β${i + 1}(Res ${s.start}-${s.end}, ${s.len}aa)`).join(', ')
        : 'None';

      doc.text(`Helices (${helices.length}): ${helixDesc}`, margin, y, { maxWidth: pageWidth - margin * 2 });
      y += 16;
      doc.text(`Strands (${strands.length}): ${strandDesc}`, margin, y, { maxWidth: pageWidth - margin * 2 });
      y += 24;

      const addReportNote = (heading: string, text: string) => {
        if (y > pageHeight - 55) {
          doc.addPage();
          y = 40;
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.text(heading, margin, y);
        y += 12;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        const lines = doc.splitTextToSize(text, pageWidth - margin * 2) as string[];
        for (const line of lines) {
          if (y > pageHeight - 45) {
            doc.addPage();
            y = 40;
          }
          doc.text(line, margin, y);
          y += 11;
        }
        y += 5;
      };

      if (y > pageHeight - 75) {
        doc.addPage();
        y = 40;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('4. Reading the Structure and Its Colors', margin, y);
      y += 16;
      addReportNote(
        'Secondary-structure labels',
        'H denotes alpha-helix, E denotes beta-strand, and C denotes coil/turn. These are prediction labels. Crimson, amber, and slate are display choices for those classes, not intrinsic physical colors. The ribbon geometry comes from the downloaded structure coordinates; a sequence prediction does not create or alter 3D coordinates.'
      );
      addReportNote(
        'Propensity scores',
        'The assigned-state score is derived from normalized Chou-Fasman propensity values. It is useful for comparing ambiguity within this heuristic prediction, but it is not a calibrated probability of correctness or a measure of experimental quality.'
      );
      if (structureContext) {
        const facts = [
          `PDB ${structureContext.pdb_id}, chain ${structureContext.chain}: ${structureContext.title}`,
          structureContext.organism ? `Source organism: ${structureContext.organism}` : '',
          structureContext.method ? `Experimental method: ${structureContext.method}` : '',
          structureContext.resolution_angstrom !== null ? `Reported resolution: ${structureContext.resolution_angstrom} angstrom` : '',
          structureContext.classification ? `RCSB classification: ${structureContext.classification}` : '',
          structureContext.function ? `UniProt function annotation: ${structureContext.function}` : '',
          `Sources: ${structureContext.sources.rcsb}${structureContext.sources.uniprot ? `; ${structureContext.sources.uniprot}` : ''}`,
        ].filter(Boolean);
        addReportNote('Deposited entry and biological context', facts.join('\n'));
        if (structureContext.similar.length > 0) {
          addReportNote(
            'Sequence-similar entries',
            structureContext.similar.map((match) => `${match.pdb_id}: ${match.title} (RCSB sequence-search score ${match.score.toFixed(2)})`).join('\n')
          );
        }
      }
      if (ligands.length > 0) {
        addReportNote(
          'Non-water ligands and components',
          ligands.map((ligand) => `${ligand.id} — ${ligand.name}; chain ${ligand.chain}; residue ${ligand.residue}; ${ligand.atomCount} atoms`).join('\n')
        );
      } else if (pdbId) {
        addReportNote('Non-water ligands and components', 'No non-water, non-standard HETATM components were detected in this PDB file.');
      }

      // --- PER-RESIDUE TABLE HEADER ---
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      if (y > pageHeight - 75) {
        doc.addPage();
        y = 40;
      }
      doc.text('5. Residue Annotation Table (Detailed)', margin, y);
      y += 14;

      const drawTableHeader = (currY: number) => {
        doc.setFillColor(14, 35, 48);
        doc.rect(margin, currY, pageWidth - margin * 2, 18, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text('Pos', margin + 8, currY + 12);
        doc.text('AA', margin + 45, currY + 12);
        doc.text('Structure', margin + 85, currY + 12);
        doc.text('Assigned score', margin + 175, currY + 12);
        doc.text('P(Helix)', margin + 270, currY + 12);
        doc.text('P(Strand)', margin + 355, currY + 12);
        doc.text('P(Coil)', margin + 440, currY + 12);
      };

      drawTableHeader(y);
      y += 18;

      // Print per-residue rows
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);

      for (let i = 0; i < result.residues.length; i++) {
        // Page break if near bottom
        if (y > pageHeight - 50) {
          // Footer
          doc.setFontSize(7.5);
          doc.setTextColor(140, 150, 160);
          doc.text('Page ' + doc.getNumberOfPages() + ' | Protein Secondary Structure Prediction Report', margin, pageHeight - 20);

          doc.addPage();
          y = 40;
          drawTableHeader(y);
          y += 18;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
        }

        const r = result.residues[i];
        if (i % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, y, pageWidth - margin * 2, 14, 'F');
        }

        doc.setTextColor(...darkText);
        doc.text(String(r.index + 1), margin + 8, y + 10);
        doc.text(r.aa, margin + 45, y + 10);

        // State with color indicator
        if (r.label === 'H') doc.setTextColor(...helixColor);
        else if (r.label === 'E') doc.setTextColor(...strandColor);
        else doc.setTextColor(...coilColor);
        doc.text(`${r.label} (${SS_NAME[r.label]})`, margin + 85, y + 10);

        doc.setTextColor(...darkText);
        doc.text(`${(r.confidence * 100).toFixed(1)}%`, margin + 175, y + 10);
        doc.text((r.probs.H * 100).toFixed(1) + '%', margin + 270, y + 10);
        doc.text((r.probs.E * 100).toFixed(1) + '%', margin + 355, y + 10);
        doc.text((r.probs.C * 100).toFixed(1) + '%', margin + 440, y + 10);

        y += 14;
      }

      // Add Final Footer
      doc.setFontSize(7.5);
      doc.setTextColor(140, 150, 160);
      doc.text('Page ' + doc.getNumberOfPages() + ' | Generated by Secondary Structure Predictor  |  Computational heuristics for research and educational use.', margin, pageHeight - 20);

      // Save PDF
      doc.save(`${pdbId ? `${pdbId}_${chainId ?? 'A'}` : 'protein'}_structure_report.pdf`);
    } catch (e) {
      console.error('PDF generation error:', e);
      alert('Failed to generate PDF. You can also use Browser Print to save as PDF.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div className="export-panel" role="region" aria-label="Export and download structure annotations">
      <div className="export-header">
        <div>
          <h3 className="subheading">Download & Export Formats</h3>
          <p className="muted small">
            Export structural annotations, raw coordinates, tabular CSV datasets, and publication-ready PDF reports.
          </p>
        </div>
      </div>

      <div className="export-buttons-grid">
        {/* PDF Comprehensive Report */}
        <button
          type="button"
          className="btn btn--primary btn-pdf-highlight"
          onClick={downloadPdfReport}
          disabled={isGeneratingPdf}
          title="Generate and download a comprehensive multi-page PDF analysis report"
        >
          <span className="btn-icon">📄</span>
          {isGeneratingPdf ? 'Generating PDF...' : 'Download PDF Report'}
        </button>

        {/* Coordinate files */}
        {pdbId && (
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => void downloadStructure('pdb')}
            disabled={downloadingFormat !== null}
            title="Download the PDB coordinate file (.pdb)"
          >
            <span className="btn-icon">📦</span>
            {downloadingFormat === 'pdb' ? 'Preparing PDB…' : 'Download Structure (.pdb)'}
          </button>
        )}
        {pdbId && (
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => void downloadStructure('cif')}
            disabled={downloadingFormat !== null}
            title="Download the modern macromolecular Crystallographic Information File (.cif)"
          >
            <span className="btn-icon">🧬</span>
            {downloadingFormat === 'cif' ? 'Preparing mmCIF…' : 'Download Structure (.mmCIF)'}
          </button>
        )}

        {/* CSV */}
        <button
          type="button"
          className="btn btn--outline"
          onClick={downloadCsv}
          title="Download tabular per-residue predictions and probabilities (.csv)"
        >
          <span className="btn-icon">📊</span>
          Download CSV
        </button>

        {/* FASTA */}
        <button
          type="button"
          className="btn btn--outline"
          onClick={downloadFastaFile}
          title="Download standard bioinformatics FASTA file (.fasta)"
        >
          <span className="btn-icon">🧬</span>
          Download FASTA (.fa)
        </button>

        {/* JSON */}
        <button
          type="button"
          className="btn btn--outline"
          onClick={downloadJson}
          title="Download full programmatic JSON payload (.json)"
        >
          <span className="btn-icon">💻</span>
          Download JSON
        </button>

        {/* Print / Save PDF via Browser */}
        <button
          type="button"
          className="btn btn--outline"
          onClick={() => window.print()}
          title="Print page or save directly as PDF using browser print dialog"
        >
          <span className="btn-icon">🖨️</span>
          Print / Browser PDF
        </button>

        {/* Copy SS String */}
        <button
          type="button"
          className="btn btn--ghost"
          onClick={copySsString}
          aria-label="Copy secondary structure string to clipboard"
        >
          {copiedType === 'ss' ? '✓ Copied String!' : 'Copy SS String (HEC)'}
        </button>

        {/* Copy FASTA */}
        <button
          type="button"
          className="btn btn--ghost"
          onClick={copyFasta}
          aria-label="Copy sequence and prediction in FASTA format"
        >
          {copiedType === 'fasta' ? '✓ Copied FASTA!' : 'Copy FASTA'}
        </button>
      </div>

      {downloadError && <p className="export-error" role="alert">{downloadError}</p>}
    </div>
  );
}
