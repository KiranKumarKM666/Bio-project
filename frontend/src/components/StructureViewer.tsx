import { useEffect, useRef, useState, useCallback } from 'react';
import * as $3Dmol from '3dmol';
import type { GLViewer } from '3dmol/build/types/GLViewer';
import type { AtomSpec } from '3dmol/build/types/specs';
import { SS_COLOR, SS_NAME, type Residue, type SS } from '../types';

export type ColorMode = 'predicted' | 'experimental';
export type RenderStyle = 'cartoon' | 'allAtom' | 'surface' | 'trace' | 'sidechains';
export type ColorScheme = 'secondary' | 'confidence' | 'rainbow' | 'hydrophobicity';

interface Props {
  pdb: string | null;
  chain: string | null;
  resNums: number[];
  residues: Residue[] | null;
  expSS?: (SS | null)[];
  mode: ColorMode;
  selected: number | null;
  onSelectResidue?: (index: number | null) => void;
  pdbId?: string | null;
}

const hexToNum = (hex: string) => parseInt(hex.replace('#', ''), 16);

// Hydrophobicity classifications (Kyte-Doolittle inspired)
const HYDROPHOBIC_RESIDUES = new Set(['I', 'V', 'L', 'F', 'C', 'M', 'A', 'W']);
const POLAR_RESIDUES = new Set(['G', 'T', 'S', 'Y', 'P', 'H', 'N', 'Q']);
const POSITIVE_RESIDUES = new Set(['K', 'R']);
const NEGATIVE_RESIDUES = new Set(['D', 'E']);
const RESIDUE_ONE_LETTER: Record<string, string> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E',
  GLY: 'G', HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F',
  PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
};

export default function StructureViewer({
  pdb,
  chain,
  resNums,
  residues,
  expSS,
  mode,
  selected,
  onSelectResidue,
  pdbId,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const viewer = useRef<GLViewer | null>(null);
  const defaultView = useRef<ReturnType<GLViewer['getView']> | null>(null);

  // 360 Orbit State
  const [isSpinning, setIsSpinning] = useState(false);
  const [spinSpeed, setSpinSpeed] = useState<number>(0.6);
  const [spinAxis, setSpinAxis] = useState<'y' | 'x' | 'z'>('y');

  // Detailing & Representation
  const [style, setStyle] = useState<RenderStyle>('cartoon');
  const [colorScheme, setColorScheme] = useState<ColorScheme>('secondary');
  const [showLigands, setShowLigands] = useState(true);
  const [isOrthographic, setIsOrthographic] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Hover & Info State
  const [hoveredInfo, setHoveredInfo] = useState<{
    resName: string;
    resi: number;
    chain: string;
    label?: SS;
    confidence?: number;
  } | null>(null);

  const [viewerError, setViewerError] = useState<string | null>(null);

  // Initialize 3Dmol viewer instance
  useEffect(() => {
    if (!host.current) return;
    const el = host.current;

    try {
      viewer.current = $3Dmol.createViewer(el, {
        backgroundColor: '#0B1820',
        antialias: true,
      });
    } catch {
      setViewerError('The 3D WebGL viewer could not start. Check hardware acceleration or use the track below.');
    }

    return () => {
      viewer.current?.spin(false);
      viewer.current?.clear();
      viewer.current = null;
      el.innerHTML = '';
    };
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement === stage.current);
    };
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  // Handle Model Loading
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    v.spin(false);
    setIsSpinning(false);
    v.clear();
    defaultView.current = null;

    if (pdb) {
      try {
        v.addModel(pdb, 'pdb');
        v.zoomTo();
        defaultView.current = v.getView();
        setViewerError(null);
      } catch {
        setViewerError('PDB coordinates could not be rendered. Please try another entry.');
      }
    }
    v.render();
  }, [pdb]);

  // Apply Styling, 3D Detailing, and Color Map
  useEffect(() => {
    const v = viewer.current;
    if (!v || !pdb) return;

    // Remove any previous molecular surface
    v.removeAllSurfaces();

    // Map residue numbers to predictions
    const byResNum = new Map<number, { label: SS; confidence: number; aa: string }>();
    if (residues) {
      residues.forEach((r, idx) => {
        if (resNums[idx] !== undefined) {
          byResNum.set(resNums[idx], { label: r.label, confidence: r.confidence, aa: r.aa });
        }
      });
    }

    const expByResNum = new Map<number, SS>();
    if (expSS) {
      expSS.forEach((state, idx) => {
        if (state && resNums[idx] !== undefined) {
          expByResNum.set(resNums[idx], state);
        }
      });
    }

    // Color function based on chosen colorScheme
    const colorfunc = (atom: AtomSpec) => {
      if (chain && atom.chain !== chain) {
        return 0x3d4852; // Muted color for other chains
      }

      if (colorScheme === 'confidence') {
        const pred = byResNum.get(atom.resi ?? -1);
        if (pred) {
          const c = pred.confidence;
          if (c >= 0.8) return 0x2A9D8F; // Higher assigned-state score
          if (c >= 0.5) return 0xE9C46A; // Intermediate assigned-state score
          return 0xE76F51; // Lower assigned-state score
        }
        return 0x6B7A88;
      }

      if (colorScheme === 'hydrophobicity') {
        const resn = atom.resn?.toUpperCase();
        const pred = byResNum.get(atom.resi ?? -1);
        const aa = pred?.aa || (resn ? RESIDUE_ONE_LETTER[resn] : undefined);
        if (!aa) return 0x8D99AE;
        if (HYDROPHOBIC_RESIDUES.has(aa)) return 0xE76F51; // Warm Orange
        if (POLAR_RESIDUES.has(aa)) return 0x2A9D8F; // Cyan / Green
        if (POSITIVE_RESIDUES.has(aa)) return 0x457B9D; // Steel Blue
        if (NEGATIVE_RESIDUES.has(aa)) return 0xE63946; // Crimson
        return 0x8D99AE;
      }

      // Secondary structure coloring (Predicted or Experimental)
      if (mode === 'experimental') {
        const expState = expByResNum.get(atom.resi ?? -1);
        if (expState) return hexToNum(SS_COLOR[expState]);
        if (atom.ss === 'h') return hexToNum(SS_COLOR.H);
        if (atom.ss === 's') return hexToNum(SS_COLOR.E);
      } else {
        const pred = byResNum.get(atom.resi ?? -1);
        if (pred) return hexToNum(SS_COLOR[pred.label]);
      }

      return hexToNum(SS_COLOR.C);
    };

    // 1. Reset Styles
    v.setStyle({}, {});

    // 2. Main Protein Representation Style
    const proteinFilter = { hetflag: false };

    if (style === 'cartoon') {
      v.setStyle(proteinFilter, {
        cartoon: {
          colorfunc,
          arrows: true,
          tubes: false,
          thickness: 0.45,
          opacity: 0.98,
        },
      });
    } else if (style === 'allAtom') {
      v.setStyle(proteinFilter, {
        stick: { radius: 0.16, colorfunc },
        sphere: { scale: 0.28, colorfunc },
      });
    } else if (style === 'trace') {
      v.setStyle(proteinFilter, {
        cartoon: { colorfunc, style: 'trace', thickness: 0.35 },
      });
    } else if (style === 'sidechains') {
      v.setStyle(proteinFilter, {
        cartoon: { colorfunc, arrows: true, opacity: 0.8 },
        stick: { radius: 0.14, colorfunc },
      });
    } else if (style === 'surface') {
      v.setStyle(proteinFilter, {
        cartoon: { colorfunc, arrows: true, opacity: 0.6 },
      });
      void Promise.resolve()
        .then(() => v.addSurface($3Dmol.SurfaceType.SES, {
          opacity: 0.55,
          color: 0x6b8f91,
        }, chain ? { ...proteinFilter, chain } : proteinFilter))
        .catch(() => {
          setViewerError('The molecular surface could not be calculated. Choose Ribbon Cartoon or Cartoon + Sidechains instead.');
        });
    }

    // 3. Ligands & Cofactors Detailing (HETATM)
    if (showLigands) {
      v.setStyle(
        { hetflag: true },
        {
          stick: { radius: 0.28, colorscheme: 'greenCarbon' },
          sphere: { scale: 0.35, colorscheme: 'greenCarbon' },
        }
      );
    }

    // 4. Selected Residue Highlighting
    if (selected !== null && resNums[selected] !== undefined) {
      const selectedResNum = resNums[selected];
      const selSpec = { chain: chain ?? undefined, resi: selectedResNum };
      v.addStyle(selSpec, {
        stick: { radius: 0.35, color: 0xF4A261 },
        sphere: { scale: 0.4, color: 0xE76F51 },
      });
      v.zoomTo(selSpec, 600);
    }

    // 5. Interactive Click & Hover Callbacks
    v.setClickable({ chain: chain ?? undefined, hetflag: false }, true, (atom: AtomSpec) => {
      if (!atom || typeof atom.resi !== 'number') return;
      if (chain && atom.chain !== chain) return;
      const idx = resNums.indexOf(atom.resi);
      if (idx >= 0 && onSelectResidue) {
        onSelectResidue(idx);
      }
    });

    v.setHoverable({ chain: chain ?? undefined, hetflag: false }, true, (atom: AtomSpec) => {
      if (!atom || typeof atom.resi !== 'number') {
        setHoveredInfo(null);
        return;
      }
      if (chain && atom.chain !== chain) {
        setHoveredInfo(null);
        return;
      }
      const pred = byResNum.get(atom.resi);
      setHoveredInfo({
        resName: atom.resn || 'RES',
        resi: atom.resi,
        chain: atom.chain || 'A',
        label: pred?.label,
        confidence: pred?.confidence,
      });
    }, () => {
      setHoveredInfo(null);
    });

    v.render();
  }, [pdb, chain, resNums, residues, expSS, mode, selected, style, colorScheme, showLigands, onSelectResidue]);

  // Handle 360 Spin / Orbit
  const toggleSpin = useCallback(() => {
    const v = viewer.current;
    if (!v) return;
    const next = !isSpinning;
    setIsSpinning(next);
    if (next) {
      v.spin(spinAxis, spinSpeed, true);
    } else {
      v.spin(false);
    }
  }, [isSpinning, spinAxis, spinSpeed]);

  const changeSpinSpeed = (speed: number) => {
    setSpinSpeed(speed);
    const v = viewer.current;
    if (v && isSpinning) {
      v.spin(spinAxis, speed, true);
    }
  };

  const changeSpinAxis = (axis: 'y' | 'x' | 'z') => {
    setSpinAxis(axis);
    const v = viewer.current;
    if (v && isSpinning) {
      v.spin(axis, spinSpeed, true);
    }
  };

  // Preset Views (Front, Top, Side)
  const setPresetView = (preset: 'front' | 'top' | 'side' | 'reset') => {
    const v = viewer.current;
    if (!v) return;
    if (defaultView.current) v.setView(defaultView.current);
    if (preset === 'top') {
      v.rotate(90, 'x');
    } else if (preset === 'side') {
      v.rotate(90, 'y');
    }
    v.render();
  };

  // Toggle Camera Projection (Perspective vs Orthographic)
  const toggleProjection = () => {
    const v = viewer.current;
    if (!v) return;
    const nextOrtho = !isOrthographic;
    setIsOrthographic(nextOrtho);
    v.setCameraParameters({ orthographic: nextOrtho });
    v.render();
  };

  // Export 3D High-Res PNG
  const exportPng = () => {
    const v = viewer.current;
    if (!v) return;
    try {
      const uri = v.pngURI();
      const a = document.createElement('a');
      a.href = uri;
      a.download = `${pdbId ?? 'protein'}_3d_structure.png`;
      a.click();
      setViewerError(null);
    } catch {
      setViewerError('The 3D snapshot could not be exported. Try again after the structure finishes rendering.');
    }
  };

  // Toggle Fullscreen
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await stage.current?.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
      setViewerError(null);
    } catch {
      setViewerError('Full-screen mode is unavailable or was blocked by the browser. The embedded viewer is still usable.');
    }
  };

  const selectedResidue = selected !== null ? residues?.[selected] : null;

  return (
    <div ref={stage} className={`structure-stage ${isFullscreen ? 'stage-fullscreen' : ''}`}>
      <div
        className="viewer-wrap"
        tabIndex={0}
        role="region"
        aria-label={pdb ? `Interactive 3D structure viewer for ${pdbId ?? 'PDB entry'}, chain ${chain ?? 'A'}` : '3D structure viewer'}
      >
        <div
          ref={host}
          className="viewer"
          role="img"
          aria-label={pdb ? `3D molecular representation of protein chain ${chain ?? 'A'}. Drag to orbit in 360°, scroll to zoom.` : 'Empty 3D structure viewer'}
        />

        {pdb && (
          <>
            {/* Top Bar with Live Tag & Quick Actions */}
            <div className="viewer-topline">
              <div className="viewer-badge-group">
                <span className="viewer-live-dot" />
                <span className="viewer-title">3D STRUCTURE 360°</span>
                <span className="viewer-pdb-tag">{pdbId ?? 'PDB'}</span>
                {chain && <span className="viewer-chain-tag">CHAIN {chain}</span>}
              </div>

              {/* Hover HUD Tooltip */}
              {hoveredInfo && (
                <div className="viewer-hover-hud" role="status" aria-live="polite">
                  <span className="hud-aa">{hoveredInfo.resName} {hoveredInfo.resi}</span>
                  <span className="hud-chain">Ch:{hoveredInfo.chain}</span>
                  {hoveredInfo.label && (
                    <span className={`hud-badge hud-${hoveredInfo.label.toLowerCase()}`}>
                      {SS_NAME[hoveredInfo.label]}
                    </span>
                  )}
                  {hoveredInfo.confidence !== undefined && (
                    <span className="hud-conf">Score {(hoveredInfo.confidence * 100).toFixed(0)}%</span>
                  )}
                </div>
              )}

              <div className="viewer-top-actions">
                <button
                  type="button"
                  className="viewer-mini-btn"
                  title="Export high-res 3D PNG snapshot"
                  onClick={exportPng}
                >
                  📷 PNG
                </button>
                <button
                  type="button"
                  className="viewer-mini-btn"
                  title={isFullscreen ? 'Exit full screen' : 'View full screen'}
                  onClick={toggleFullscreen}
                >
                  {isFullscreen ? '⤢' : '⛶'}
                </button>
              </div>
            </div>

            {/* Bottom 360 Control Bar & Detailing Toolbar */}
            <div className="viewer-toolbar" role="group" aria-label="3D structure controls">
              <div className="toolbar-section">
                {/* 360 Spin / Orbit Toggle */}
                <button
                  type="button"
                  className={`viewer-ctrl-btn viewer-spin-btn ${isSpinning ? 'is-active' : ''}`}
                  aria-pressed={isSpinning}
                  onClick={toggleSpin}
                >
                  <span aria-hidden="true">{isSpinning ? '⏸' : '↻'}</span>
                  <span>{isSpinning ? 'Pause 360°' : '360° Orbit'}</span>
                </button>

                {/* Orbit Speed Selector */}
                {isSpinning && (
                  <div className="orbit-controls-pill">
                    <span className="pill-label">Speed:</span>
                    <button
                      type="button"
                      className={`pill-btn ${spinSpeed === 0.3 ? 'is-active' : ''}`}
                      aria-pressed={spinSpeed === 0.3}
                      onClick={() => changeSpinSpeed(0.3)}
                    >
                      0.5x
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${spinSpeed === 0.6 ? 'is-active' : ''}`}
                      aria-pressed={spinSpeed === 0.6}
                      onClick={() => changeSpinSpeed(0.6)}
                    >
                      1.0x
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${spinSpeed === 1.2 ? 'is-active' : ''}`}
                      aria-pressed={spinSpeed === 1.2}
                      onClick={() => changeSpinSpeed(1.2)}
                    >
                      2.0x
                    </button>

                    <span className="pill-divider" />
                    <button
                      type="button"
                      className={`pill-btn ${spinAxis === 'y' ? 'is-active' : ''}`}
                      aria-pressed={spinAxis === 'y'}
                      title="Rotate around vertical Y-axis"
                      onClick={() => changeSpinAxis('y')}
                    >
                      Y
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${spinAxis === 'x' ? 'is-active' : ''}`}
                      aria-pressed={spinAxis === 'x'}
                      title="Rotate around horizontal X-axis"
                      onClick={() => changeSpinAxis('x')}
                    >
                      X
                    </button>
                    <button
                      type="button"
                      className={`pill-btn ${spinAxis === 'z' ? 'is-active' : ''}`}
                      aria-pressed={spinAxis === 'z'}
                      title="Rotate around depth Z-axis"
                      onClick={() => changeSpinAxis('z')}
                    >
                      Z
                    </button>
                  </div>
                )}
              </div>

              {/* View Angles & Projection */}
              <div className="toolbar-section">
                <div className="toolbar-btn-group">
                  <button
                    type="button"
                    className="viewer-ctrl-btn"
                    title="Front camera view"
                    onClick={() => setPresetView('front')}
                  >
                    Front
                  </button>
                  <button
                    type="button"
                    className="viewer-ctrl-btn"
                    title="Top camera view"
                    onClick={() => setPresetView('top')}
                  >
                    Top
                  </button>
                  <button
                    type="button"
                    className="viewer-ctrl-btn"
                    title="Side camera view"
                    onClick={() => setPresetView('side')}
                  >
                    Side
                  </button>
                  <button
                    type="button"
                    className="viewer-ctrl-btn"
                    title="Reset view and camera center"
                    onClick={() => setPresetView('reset')}
                  >
                    Reset
                  </button>
                </div>

                <button
                  type="button"
                  className={`viewer-ctrl-btn ${isOrthographic ? 'is-active' : ''}`}
                  aria-pressed={isOrthographic}
                  title="Toggle between Perspective and Orthographic technical projection"
                  onClick={toggleProjection}
                >
                  {isOrthographic ? 'Ortho' : 'Persp'}
                </button>
              </div>

              {/* Detailing Representation Selector */}
              <div className="toolbar-section toolbar-options">
                <select
                  className="viewer-select"
                  value={style}
                  onChange={(e) => setStyle(e.target.value as RenderStyle)}
                  aria-label="3D representation style"
                  title="Choose 3D detailing representation"
                >
                  <option value="cartoon">Ribbon Cartoon</option>
                  <option value="allAtom">Ball & Stick (All-Atom)</option>
                  <option value="sidechains">Cartoon + Sidechains</option>
                  <option value="surface">Molecular Surface (SES)</option>
                  <option value="trace">Backbone Trace</option>
                </select>

                {/* Color Scheme Selector */}
                <select
                  className="viewer-select"
                  value={colorScheme}
                  onChange={(e) => setColorScheme(e.target.value as ColorScheme)}
                  aria-label="Color scheme"
                  title="Choose coloring scheme"
                >
                  <option value="secondary">Color: Secondary Structure</option>
                  <option value="confidence">Color: Assigned-State Score</option>
                  <option value="hydrophobicity">Color: Hydrophobicity</option>
                </select>

                {/* Ligands Toggle */}
                <button
                  type="button"
                  className={`viewer-ctrl-btn ${showLigands ? 'is-active' : ''}`}
                  aria-pressed={showLigands}
                  title="Show/hide cofactors, ligands, and metal ions (HETATM)"
                  onClick={() => setShowLigands(!showLigands)}
                >
                  {showLigands ? 'Ligands: ON' : 'Ligands: OFF'}
                </button>
              </div>
            </div>
          </>
        )}

        {!pdb && (
          <div className="viewer-empty">
            <div className="viewer-empty-content">
              <svg width="58" height="58" viewBox="0 0 48 48" fill="none" aria-hidden="true">
                <path d="M24 4 6 14v20l18 10 18-10V14L24 4Z" stroke="currentColor" strokeWidth="1.25" />
                <path d="m6 14 18 10 18-10M24 24v20M14 9.5l18 10M34 9.5 16 19.5" stroke="currentColor" strokeWidth="1.25" />
                <circle cx="24" cy="24" r="3" fill="currentColor" />
              </svg>
              <span className="viewer-empty-kicker">3D 360° MOLECULAR INSPECTOR</span>
              <p className="empty-title">Protein Structure in Full 360° Dimensions</p>
              <p className="empty-desc">
                Load a 4-letter PDB entry (e.g. <strong>1UBQ</strong>, <strong>1MBN</strong>, <strong>2HHB</strong>) to inspect its deposited coordinates with all-atom detailing, continuous 360° orbit, and secondary-structure mapping.
              </p>
            </div>
          </div>
        )}
      </div>

      {viewerError && <p className="viewer-error" role="alert">{viewerError}</p>}

      {pdb && selectedResidue ? (
        <div className="residue-readout" aria-live="polite">
          <span className="readout-position">RESIDUE {selectedResidue.index + 1}</span>
          <strong className="readout-amino">{selectedResidue.aa}</strong>
          <span className="readout-state">
            <i className={`readout-state-dot state-${selectedResidue.label.toLowerCase()}`} aria-hidden="true" />
            {SS_NAME[selectedResidue.label]}
          </span>
          <span className="readout-confidence">
            {(selectedResidue.confidence * 100).toFixed(0)}% assigned-state score
          </span>
          <span className="readout-probabilities" aria-label="State propensity probabilities">
            P(H) {(selectedResidue.probs.H * 100).toFixed(0)}%
            <span aria-hidden="true"> / </span>
            P(E) {(selectedResidue.probs.E * 100).toFixed(0)}%
            <span aria-hidden="true"> / </span>
            P(C) {(selectedResidue.probs.C * 100).toFixed(0)}%
          </span>
        </div>
      ) : (
        <p className="viewer-caption">
          {pdb ? (
            <>
              Click any residue to focus in 3D & sequence <span aria-hidden="true">·</span> Drag to orbit 360° <span aria-hidden="true">·</span> Scroll to zoom <span aria-hidden="true">·</span> Switch representation & color modes above
            </>
          ) : (
            <>PDB coordinates appear here in full 3D and may be experimental or computational. Sequence-only runs show secondary predictions below.</>
          )}
        </p>
      )}
    </div>
  );
}
