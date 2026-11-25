import { useMemo, useState } from 'react';
import type { PredictResponse, SS } from '../types';
import { SS_NAME } from '../types';

interface Props {
  sequence: string;
  result: PredictResponse;
  pdbId?: string | null;
  chainId?: string | null;
  onSelectRange?: (startIdx: number, endIdx: number) => void;
}

interface Segment {
  type: SS;
  start: number;
  end: number;
  length: number;
  seq: string;
}

export default function StructureExplanation({
  sequence,
  result,
  pdbId,
  chainId,
  onSelectRange,
}: Props) {
  const [activeTab, setActiveTab] = useState<'overview' | 'motifs' | 'biochem' | 'education'>('overview');

  const analysis = useMemo(() => {
    const residues = result.residues;
    const n = residues.length;
    if (n === 0) return null;

    const hCount = result.counts.H || 0;
    const eCount = result.counts.E || 0;
    const cCount = result.counts.C || 0;

    const hPct = (hCount / n) * 100;
    const ePct = (eCount / n) * 100;
    const cPct = (cCount / n) * 100;

    let compositionLabel = 'Mixed predicted H/E/C composition';
    const compositionDescription = 'These percentages summarize the sequence-based secondary-structure assignments. They do not determine the protein fold, 3D topology, stability, or disorder.';

    if (hPct >= 45 && ePct < 12) {
      compositionLabel = 'Helix-rich predicted composition';
    } else if (ePct >= 35 && hPct < 12) {
      compositionLabel = 'Strand-rich predicted composition';
    } else if (cPct >= 55) {
      compositionLabel = 'Coil-rich predicted composition';
    }

    // Extract continuous segments
    const segments: Segment[] = [];
    let curType = residues[0].label;
    let curStart = 0;

    for (let i = 1; i < n; i++) {
      if (residues[i].label !== curType) {
        segments.push({
          type: curType,
          start: curStart,
          end: i - 1,
          length: i - curStart,
          seq: sequence.slice(curStart, i),
        });
        curType = residues[i].label;
        curStart = i;
      }
    }
    segments.push({
      type: curType,
      start: curStart,
      end: n - 1,
      length: n - curStart,
      seq: sequence.slice(curStart, n),
    });

    const helixSegments = segments.filter((s) => s.type === 'H');
    const strandSegments = segments.filter((s) => s.type === 'E');
    const coilSegments = segments.filter((s) => s.type === 'C');

    // Biochemical calculations
    const hydrophobicAAs = new Set(['I', 'V', 'L', 'F', 'C', 'M', 'A', 'W']);
    const basicAAs = new Set(['K', 'R']);
    const acidicAAs = new Set(['D', 'E']);

    let hydrophobicCount = 0;
    let basicCount = 0;
    let acidicCount = 0;
    let hisCount = 0;

    for (const char of sequence) {
      if (hydrophobicAAs.has(char)) hydrophobicCount++;
      if (basicAAs.has(char)) basicCount++;
      if (acidicAAs.has(char)) acidicCount++;
      if (char === 'H') hisCount++;
    }

    const hydrophobicPct = Math.round((hydrophobicCount / n) * 100);
    // Estimated net charge at pH 7.4 (approximate)
    const netCharge = Math.round((basicCount + hisCount * 0.1 - acidicCount) * 10) / 10;

    // Assigned-state score summary
    const lowConf = residues.filter((r) => r.confidence < 0.5).length;
    const highConf = residues.filter((r) => r.confidence >= 0.8).length;
    const meanConf = Math.round(
      (residues.reduce((acc, r) => acc + r.confidence, 0) / n) * 100
    );

    return {
      n,
      hPct: hPct.toFixed(1),
      ePct: ePct.toFixed(1),
      cPct: cPct.toFixed(1),
      compositionLabel,
      compositionDescription,
      segments,
      helixSegments,
      strandSegments,
      coilSegments,
      hydrophobicPct,
      netCharge,
      lowConf,
      highConf,
      meanConf,
    };
  }, [sequence, result]);

  if (!analysis) return null;

  return (
    <div className="explanation-card" role="region" aria-labelledby="explanation-heading">
      <div className="explanation-header">
        <div>
          <span className="explanation-kicker">SCIENTIFIC ANALYSIS & COMMENTARY</span>
          <h2 id="explanation-heading" className="explanation-title">
            Secondary-Structure Explanation
          </h2>
          <p className="explanation-subtitle">
            Predicted secondary-structure composition, residue runs, and sequence-derived properties for {pdbId ? `PDB entry ${pdbId} (Chain ${chainId ?? 'A'})` : 'the target sequence'}.
          </p>
        </div>

        {/* Tab Controls */}
        <div className="explanation-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'overview'}
            className={`tab-btn ${activeTab === 'overview' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Composition
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'motifs'}
            className={`tab-btn ${activeTab === 'motifs' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('motifs')}
          >
            Motifs ({analysis.helixSegments.length}α, {analysis.strandSegments.length}β)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'biochem'}
            className={`tab-btn ${activeTab === 'biochem' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('biochem')}
          >
            Sequence Properties
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'education'}
            className={`tab-btn ${activeTab === 'education' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('education')}
          >
            Educational Guide
          </button>
        </div>
      </div>

      <div className="explanation-content">
        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="tab-pane">
            <div className="fold-callout">
              <div className="fold-callout-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </div>
              <div className="fold-callout-body">
                <span className="fold-class-badge">{analysis.compositionLabel}</span>
                <p className="fold-desc-text">{analysis.compositionDescription}</p>
              </div>
            </div>

            <div className="metrics-grid">
              <div className="metric-box">
                <span className="metric-label">Alpha-Helix (H)</span>
                <strong className="metric-val text-helix">{analysis.hPct}%</strong>
                <span className="metric-sub">{result.counts.H} residues in {analysis.helixSegments.length} predicted runs</span>
              </div>
              <div className="metric-box">
                <span className="metric-label">Beta-Strand (E)</span>
                <strong className="metric-val text-strand">{analysis.ePct}%</strong>
                <span className="metric-sub">{result.counts.E} residues in {analysis.strandSegments.length} predicted runs</span>
              </div>
              <div className="metric-box">
                <span className="metric-label">Coil & Turns (C)</span>
                <strong className="metric-val text-coil">{analysis.cPct}%</strong>
                <span className="metric-sub">{result.counts.C} residues in {analysis.coilSegments.length} predicted runs</span>
              </div>
              <div className="metric-box">
                <span className="metric-label">Mean Assigned-State Score</span>
                <strong className="metric-val text-conf">{analysis.meanConf}%</strong>
                <span className="metric-sub">{analysis.highConf} residues scored ≥80%</span>
              </div>
            </div>

            {analysis.lowConf > 0 && (
              <div className="alert-box alert-warning">
                <span className="alert-icon">⚠️</span>
                <div>
                  <strong>Lower assigned-state scores ({analysis.lowConf} residues below 50%):</strong>
                  <p>
                    These values indicate less decisive normalized propensity outputs in this baseline. They do not establish structural disorder, flexibility, or experimental uncertainty.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: CONTINUOUS MOTIFS */}
        {activeTab === 'motifs' && (
          <div className="tab-pane">
            <p className="pane-intro">
              Continuous predicted secondary-structure runs along the sequence. Click a run to inspect its residue range:
            </p>

            <div className="motifs-container">
              {/* Helices */}
              <div className="motif-group">
                <h4 className="motif-group-title text-helix">
                  Predicted alpha-helix runs ({analysis.helixSegments.length})
                </h4>
                {analysis.helixSegments.length === 0 ? (
                  <p className="muted small">                  No predicted alpha-helix runs.</p>
                ) : (
                  <div className="motif-chips-list">
                    {analysis.helixSegments.map((seg, i) => (
                      <button
                        key={i}
                        type="button"
                        className="motif-chip chip-helix"
                        onClick={() => onSelectRange?.(seg.start, seg.end)}
                        title={`Select residues ${seg.start + 1} to ${seg.end + 1}`}
                      >
                        <span className="chip-badge">α{i + 1}</span>
                        <span className="chip-range">Res {seg.start + 1}–{seg.end + 1}</span>
                        <span className="chip-len">({seg.length} aa)</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Beta-Strands */}
              <div className="motif-group">
                <h4 className="motif-group-title text-strand">
                  Predicted beta-strand runs ({analysis.strandSegments.length})
                </h4>
                {analysis.strandSegments.length === 0 ? (
                  <p className="muted small">                  No predicted beta-strand runs.</p>
                ) : (
                  <div className="motif-chips-list">
                    {analysis.strandSegments.map((seg, i) => (
                      <button
                        key={i}
                        type="button"
                        className="motif-chip chip-strand"
                        onClick={() => onSelectRange?.(seg.start, seg.end)}
                        title={`Select residues ${seg.start + 1} to ${seg.end + 1}`}
                      >
                        <span className="chip-badge">β{i + 1}</span>
                        <span className="chip-range">Res {seg.start + 1}–{seg.end + 1}</span>
                        <span className="chip-len">({seg.length} aa)</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Loops & Coils */}
              <div className="motif-group">
                <h4 className="motif-group-title text-coil">
                  Predicted coil runs ({analysis.coilSegments.length})
                </h4>
                <div className="motif-chips-list">
                  {analysis.coilSegments.slice(0, 8).map((seg, i) => (
                    <button
                      key={i}
                      type="button"
                      className="motif-chip chip-coil"
                      onClick={() => onSelectRange?.(seg.start, seg.end)}
                      title={`Select residues ${seg.start + 1} to ${seg.end + 1}`}
                    >
                      <span className="chip-badge">L{i + 1}</span>
                      <span className="chip-range">Res {seg.start + 1}–{seg.end + 1}</span>
                      <span className="chip-len">({seg.length} aa)</span>
                    </button>
                  ))}
                  {analysis.coilSegments.length > 8 && (
                    <span className="motif-chip-more">+{analysis.coilSegments.length - 8} more loops</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: BIOPHYSICAL PROFILE */}
        {activeTab === 'biochem' && (
          <div className="tab-pane">
            <div className="biochem-grid">
              <div className="biochem-card">
                <h4 className="biochem-title">Hydrophobic Residue Fraction</h4>
                <div className="biochem-val">{analysis.hydrophobicPct}%</div>
                <p className="biochem-desc">
                  Fraction of residues classified as hydrophobic by this sequence summary. It does not show whether residues are exposed or buried in the selected structure.
                </p>
              </div>

              <div className="biochem-card">
                <h4 className="biochem-title">Estimated Side-Chain Charge Balance</h4>
                <div className={`biochem-val ${analysis.netCharge > 0 ? 'text-pos' : analysis.netCharge < 0 ? 'text-neg' : ''}`}>
                  {analysis.netCharge > 0 ? `+${analysis.netCharge}` : analysis.netCharge} e
                </div>
                <p className="biochem-desc">
                  Rough side-chain charge balance from Lys, Arg, His, Asp, and Glu counts. It does not account for pKa shifts, termini, or structure and is not an isoelectric-point calculation.
                </p>
              </div>

              {result.properties && (
                <div className="biochem-card">
                  <h4 className="biochem-title">Molecular Mass & Formula</h4>
                  <div className="biochem-val">{result.properties.mass?.toLocaleString() ?? '—'} Da</div>
                  <p className="biochem-desc">
                    <strong>Formula:</strong> <code>{result.properties.formula ?? 'N/A'}</code>
                    <br />
                    Total atoms: {Object.values(result.properties.atoms || {}).reduce((a, b) => a + b, 0)} (polypeptide + 1 terminal water molecule).
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: EDUCATIONAL GUIDE */}
        {activeTab === 'education' && (
          <div className="tab-pane">
            <div className="edu-accordion">
              <div className="edu-card">
                <div className="edu-badge helix-badge">H: Alpha-Helix</div>
                <h4 className="edu-title">The Fundamental Right-Handed Helical Motif</h4>
                <p className="edu-text">
                  The $\alpha$-helix is the most abundant regular secondary structure. It completes one full turn every 3.6 residues with a rise of 1.5 Å per amino acid. The structure is reinforced by a repetitive network of intramolecular hydrogen bonds between the carbonyl oxygen of residue $i$ and the amide hydrogen of residue $i+4$. Helices frequently span lipid bilayers or form amphipathic bundles.
                </p>
              </div>

              <div className="edu-card">
                <div className="edu-badge strand-badge">E: Beta-Strand & Sheet</div>
                <h4 className="edu-title">Extended Pleated Beta-Sheets</h4>
                <p className="edu-text">
                  Beta-strands adopt an almost fully extended zigzag polypeptide conformation (3.5 Å per residue). Individual strands align laterally to form parallel or antiparallel $\beta$-sheets via inter-strand hydrogen bonding. Amino acid sidechains alternate directions above and below the sheet plane, enabling one face to be hydrophobic and the other polar.
                </p>
              </div>

              <div className="edu-card">
                <div className="edu-badge coil-badge">C: Coils, Turns & Loops</div>
                <h4 className="edu-title">Connecting Links and Active Sites</h4>
                <p className="edu-text">
                  Coils and turns connect regular elements and can reverse chain direction. Their specific flexibility or biological role depends on the protein and cannot be inferred from a coil label alone.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
