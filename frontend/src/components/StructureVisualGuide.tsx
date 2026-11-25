import { useState } from 'react';
import type { LigandSummary } from '../types';

/**
 * StructureVisualGuide – Interactive decoded anatomy of the 3D viewer
 * and the Chou-Fasman prediction pipeline. Explains every visual element
 * the user sees: dots, ribbons, cylinders, colors, ligands, and how the
 * algorithm converts a sequence into a structure prediction.
 */
export default function StructureVisualGuide({
  ligands = [],
  hasStructure = false,
}: {
  ligands?: LigandSummary[];
  hasStructure?: boolean;
}) {
  const [openSection, setOpenSection] = useState<string | null>('elements');

  const toggle = (key: string) =>
    setOpenSection((prev) => (prev === key ? null : key));

  return (
    <div className="visual-guide" role="region" aria-labelledby="vg-heading">
      <div className="vg-header">
        <span className="vg-kicker">DECODED VISUAL ANATOMY</span>
        <h3 id="vg-heading" className="vg-title">
          Understanding the 3D Structure
        </h3>
        <p className="vg-subtitle">
          A concise key to the viewer controls, display colors, and structure-file components.
          Display choices are conventions; they do not represent physical colors.
        </p>
      </div>

      {/* ── 1. VISUAL ELEMENTS ── */}
      <button
        type="button"
        className={`vg-accordion-btn ${openSection === 'elements' ? 'is-open' : ''}`}
        onClick={() => toggle('elements')}
        aria-expanded={openSection === 'elements'}
      >
        <span className="vg-acc-icon">🔬</span>
        <span>Visual Elements — What You See</span>
        <span className="vg-chevron" aria-hidden="true">{openSection === 'elements' ? '▾' : '▸'}</span>
      </button>
      {openSection === 'elements' && (
        <div className="vg-accordion-body">
          <div className="vg-element-grid">
            <div className="vg-element-card">
              <div className="vg-el-icon" style={{ color: '#c8374b' }}>
                <svg viewBox="0 0 32 32" width="28" height="28"><path d="M5 28 Q16 2 27 28" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round"/></svg>
              </div>
              <h4>Ribbons &amp; Helical Coils</h4>
              <p>
                The cartoon traces the <strong>protein backbone</strong>: helical ribbons indicate helices, arrows indicate
                strands, and thinner traces indicate loops. Their geometry comes from the loaded structure file. Switching
                between predicted and experimental color modes changes the overlay colors, not the 3D coordinates or shape.
              </p>
            </div>
            <div className="vg-element-card">
              <div className="vg-el-icon" style={{ color: '#2a9d8f' }}>
                <svg viewBox="0 0 32 32" width="28" height="28"><circle cx="16" cy="16" r="8" fill="currentColor" opacity="0.7"/><circle cx="16" cy="16" r="4" fill="currentColor"/></svg>
              </div>
              <h4>Spheres &amp; Dots (Atoms)</h4>
              <p>
                In <em>Ball &amp; Stick</em>, spheres show individual atoms and sticks show their rendered connections.
                Protein atoms use the selected residue-color scheme; coordinates are those distributed with the PDB entry
                and may be experimental or computational.
              </p>
            </div>
            <div className="vg-element-card">
              <div className="vg-el-icon" style={{ color: '#d9822b' }}>
                <svg viewBox="0 0 32 32" width="28" height="28"><line x1="6" y1="26" x2="26" y2="6" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
              </div>
              <h4>Sticks &amp; Cylinders (Bonds)</h4>
              <p>
                Sticks make local atom connectivity easier to inspect. This rendering is not a bond-order diagram:
                stick thickness or appearance should not be used to infer electron sharing, bond order, or measured
                bond lengths.
              </p>
            </div>
            <div className="vg-element-card">
              <div className="vg-el-icon" style={{ color: '#22c55e' }}>
                <svg viewBox="0 0 32 32" width="28" height="28"><polygon points="16,4 28,28 4,28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/><circle cx="16" cy="20" r="3" fill="currentColor"/></svg>
              </div>
              <h4>Ligands &amp; Heteroatoms</h4>
              <p>
                HETATM records can represent <strong>non-protein components</strong> such as cofactors, ions, solvent,
                substrates, or bound compounds. The viewer uses a green-carbon color scheme to distinguish these records;
                green is a display choice, not a ligand property. The list below excludes water and standard amino acids.
              </p>
            </div>
            <div className="vg-element-card">
              <div className="vg-el-icon" style={{ color: '#8b5cf6' }}>
                <svg viewBox="0 0 32 32" width="28" height="28"><ellipse cx="16" cy="16" rx="14" ry="10" fill="currentColor" opacity="0.2" stroke="currentColor" strokeWidth="1.5"/></svg>
              </div>
              <h4>Molecular Surface</h4>
              <p>
                The translucent teal envelope is a <strong>Solvent-Excluded Surface (SES)</strong> calculated around
                the loaded atoms. In this viewer the surface has a fixed color; it does not display electrostatic
                potential or identify binding sites by itself.
              </p>
            </div>
            {ligands.length > 0 ? (
              <div className="vg-ligand-list">
                <h4>Components detected in this PDB entry ({ligands.length})</h4>
                <ul>
                  {ligands.slice(0, 8).map((ligand) => (
                    <li key={`${ligand.id}:${ligand.chain}:${ligand.residue}`}>
                      <strong>{ligand.id}</strong> — {ligand.name}; chain {ligand.chain}, residue {ligand.residue}, {ligand.atomCount} atoms
                    </li>
                  ))}
                </ul>
                {ligands.length > 8 && <p>Showing 8 of {ligands.length} detected components.</p>}
              </div>
            ) : (
              <p className="vg-ligand-list">
                {hasStructure
                  ? 'No non-water, non-standard HETATM components were detected in this entry.'
                  : 'Load a PDB entry to list its detected non-water components.'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── 2. COLOR CODING ── */}
      <button
        type="button"
        className={`vg-accordion-btn ${openSection === 'colors' ? 'is-open' : ''}`}
        onClick={() => toggle('colors')}
        aria-expanded={openSection === 'colors'}
      >
        <span className="vg-acc-icon">🎨</span>
        <span>Color Coding — Why Each Color</span>
        <span className="vg-chevron" aria-hidden="true">{openSection === 'colors' ? '▾' : '▸'}</span>
      </button>
      {openSection === 'colors' && (
        <div className="vg-accordion-body">
          <table className="vg-color-table" role="table">
            <thead>
              <tr>
                <th>Color</th>
                <th>Meaning</th>
                <th>Why This Color</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="vg-swatch" style={{ background: '#C8374B' }} /> Crimson</td>
                <td><strong>Alpha-Helix (H)</strong></td>
                <td>This app uses crimson for visual separation. The color itself does not indicate stability, packing, or energy.</td>
              </tr>
              <tr>
                <td><span className="vg-swatch" style={{ background: '#D9822B' }} /> Amber</td>
                <td><strong>Beta-Strand (E)</strong></td>
                <td>This app uses amber to distinguish strands from helices; it is a display convention.</td>
              </tr>
              <tr>
                <td><span className="vg-swatch" style={{ background: '#6B7A88' }} /> Slate</td>
                <td><strong>Coil / Loop (C)</strong></td>
                <td>This app uses slate for coil/turn assignments. A coil label alone does not establish disorder or flexibility.</td>
              </tr>
              <tr>
                <td><span className="vg-swatch" style={{ background: '#2a9d8f' }} /> Teal</td>
                <td><strong>Higher assigned-state score</strong></td>
                <td>In score heatmap mode, teal means the assigned state's propensity score is at least 0.80. It is not calibrated certainty.</td>
              </tr>
              <tr>
                <td><span className="vg-swatch" style={{ background: '#E76F51' }} /> Coral / <span className="vg-swatch" style={{ background: '#E9C46A' }} /> gold</td>
                <td><strong>Lower assigned-state score</strong></td>
                <td>Coral marks scores below 0.50; gold marks 0.50–0.79. These thresholds describe the heuristic output, not accuracy.</td>
              </tr>
              <tr>
                <td>
                  <span className="vg-swatch" style={{ background: '#E76F51' }} />
                  <span className="vg-swatch" style={{ background: '#2A9D8F' }} />
                  <span className="vg-swatch" style={{ background: '#457B9D' }} />
                  <span className="vg-swatch" style={{ background: '#E63946' }} />
                </td>
                <td><strong>Residue chemistry classes</strong></td>
                <td>In hydrophobicity mode, orange = hydrophobic, teal = polar, blue = basic, crimson = acidic, and slate = unclassified. This is a residue class map, not a solvent-accessibility measurement.</td>
              </tr>
              <tr>
                <td><span className="vg-swatch" style={{ background: '#22c55e' }} /> Green</td>
                <td><strong>Ligand carbon atoms</strong></td>
                <td>The green-carbon scheme helps distinguish HETATM components; atom colors do not encode biological function.</td>
              </tr>
              <tr>
                <td><span className="vg-swatch" style={{ background: '#F4A261' }} /> Orange</td>
                <td><strong>Selected residue</strong></td>
                <td>The currently selected residue is highlighted to connect the sequence track with its 3D position.</td>
              </tr>
              <tr>
                <td><span className="vg-swatch" style={{ background: '#2a9d8f' }} /> Teal surface</td>
                <td><strong>SES surface</strong></td>
                <td>The surface uses a fixed teal color; it is not an electrostatic-potential map.</td>
              </tr>
              <tr>
                <td><span className="vg-swatch" style={{ background: '#2a9d8f' }} /> Green dot</td>
                <td><strong>Viewer status</strong></td>
                <td>The small pulsing dot is an interface status indicator, not a feature of the protein.</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ── 3. PREDICTION PIPELINE ── */}
      <button
        type="button"
        className={`vg-accordion-btn ${openSection === 'pipeline' ? 'is-open' : ''}`}
        onClick={() => toggle('pipeline')}
        aria-expanded={openSection === 'pipeline'}
      >
        <span className="vg-acc-icon">⚙️</span>
        <span>How It Works — Prediction Pipeline</span>
        <span className="vg-chevron" aria-hidden="true">{openSection === 'pipeline' ? '▾' : '▸'}</span>
      </button>
      {openSection === 'pipeline' && (
        <div className="vg-accordion-body">
          <p className="vg-pipeline-intro">
            The Chou-Fasman baseline converts a sequence into heuristic per-residue propensities. Its score is
            useful for comparing assignments within this run, not as calibrated probability of correctness.
          </p>

          <div className="vg-pipeline">
            <div className="vg-pipe-step">
              <div className="vg-pipe-num">1</div>
              <div className="vg-pipe-content">
                <h4>Input Sequence</h4>
                <p>Your amino acid single-letter codes (e.g. MQIFVKTLTG…) are parsed. FASTA headers are stripped; only valid residue codes are retained.</p>
              </div>
            </div>
            <div className="vg-pipe-arrow" aria-hidden="true">↓</div>

            <div className="vg-pipe-step">
              <div className="vg-pipe-num">2</div>
              <div className="vg-pipe-content">
                <h4>Propensity Lookup (Pα, Pβ, Pt)</h4>
                <p>Each amino acid is looked up for helix, strand, and turn propensities in the baseline's parameter table.</p>
              </div>
            </div>
            <div className="vg-pipe-arrow" aria-hidden="true">↓</div>

            <div className="vg-pipe-step">
              <div className="vg-pipe-num">3</div>
              <div className="vg-pipe-content">
                <h4>Window Averaging</h4>
                <p>Sliding windows average helix propensities over 7 residues and strand/turn propensities over 5 residues.</p>
              </div>
            </div>
            <div className="vg-pipe-arrow" aria-hidden="true">↓</div>

            <div className="vg-pipe-step">
              <div className="vg-pipe-num">4</div>
              <div className="vg-pipe-content">
                <h4>Softmax Normalization</h4>
                <p>A softmax normalizes the three values so P(H), P(E), and P(C) sum to 1. The output is heuristic and not calibrated against prediction accuracy; short helix/strand runs may then be changed to coil by minimum-length rules.</p>
              </div>
            </div>
            <div className="vg-pipe-arrow" aria-hidden="true">↓</div>

            <div className="vg-pipe-step">
              <div className="vg-pipe-num">5</div>
              <div className="vg-pipe-content">
                <h4>Segment Smoothing → 3D Mapping</h4>
                <p>The final H/E/C labels are aligned to the selected sequence. In a PDB view, they color corresponding residues; the prediction does not generate or modify the structure coordinates.</p>
              </div>
            </div>
          </div>

          <div className="vg-disclaimer">
            <strong>Limitations:</strong> This propensity-based baseline is not a validated substitute for modern
            structure prediction or experimental evidence. PDB entries can contain experimental or computational
            coordinates; this app displays the coordinates supplied for the selected entry.
          </div>
        </div>
      )}
    </div>
  );
}
