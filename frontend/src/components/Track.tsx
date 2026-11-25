import React, { useRef } from 'react';
import { SS_COLOR, SS_NAME, type Residue, type SS } from '../types';

interface Props {
  residues: Residue[];
  selected: number | null;
  onSelect: (index: number | null) => void;
  expSS?: (SS | null)[];
}

export default function Track({ residues, selected, onSelect, expSS }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Group residues into 10-residue blocks for clean visual chunking
  const blocks: Residue[][] = [];
  for (let i = 0; i < residues.length; i += 10) {
    blocks.push(residues.slice(i, i + 10));
  }

  // Handle keyboard navigation across the residue track
  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
    let nextIndex: number | null = null;

    if (e.key === 'ArrowRight') {
      nextIndex = Math.min(residues.length - 1, currentIndex + 1);
    } else if (e.key === 'ArrowLeft') {
      nextIndex = Math.max(0, currentIndex - 1);
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = residues.length - 1;
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onSelect(selected === currentIndex ? null : currentIndex);
      return;
    }

    if (nextIndex !== null && nextIndex !== currentIndex) {
      e.preventDefault();
      onSelect(nextIndex);
      // Focus target element
      const targetBtn = containerRef.current?.querySelector<HTMLButtonElement>(`button[data-index="${nextIndex}"]`);
      targetBtn?.focus();
    }
  };

  return (
    <div className="track-container" ref={containerRef}>
      <div className="track-legend-bar">
        <span className="track-legend-item">
          <span className="swatch helix-swatch" aria-hidden="true">H</span> Helix (H)
        </span>
        <span className="track-legend-item">
          <span className="swatch strand-swatch" aria-hidden="true">E</span> Beta-Strand (E)
        </span>
        <span className="track-legend-item">
          <span className="swatch coil-swatch" aria-hidden="true">C</span> Coil (C)
        </span>
        <span className="track-hint">
          (Use <strong>Arrow Keys</strong> to navigate residues, <strong>Enter/Space</strong> to locate in 3D)
        </span>
      </div>

      <div className="track" role="region" aria-label="Per-residue secondary structure track">
        {blocks.map((block) => {
          const firstRes = block[0];
          return (
            <div className="block" key={firstRes.index}>
              <span className="block-num" aria-hidden="true">
                {firstRes.index + 1}
              </span>
              <div className="cells" role="group" aria-label={`Residues ${firstRes.index + 1} to ${block[block.length - 1].index + 1}`}>
                {block.map((r) => {
                  const isSelected = selected === r.index;
                  const exp = expSS ? expSS[r.index] : null;
                  const matchStatus = exp ? (r.label === exp ? ' [Matches experimental]' : ` [Exp: ${SS_NAME[exp]}]`) : '';

                  const ariaLabel = `Residue ${r.index + 1} ${r.aa}: Predicted ${SS_NAME[r.label]}, assigned-state score ${(r.confidence * 100).toFixed(0)}%${matchStatus}`;
                  const title = `${r.aa}${r.index + 1}: ${SS_NAME[r.label]} (assigned-state score ${(r.confidence * 100).toFixed(0)}%)\nP(H): ${(r.probs.H * 100).toFixed(0)}% | P(E): ${(r.probs.E * 100).toFixed(0)}% | P(C): ${(r.probs.C * 100).toFixed(0)}%${matchStatus}`;

                  return (
                    <button
                      key={r.index}
                      type="button"
                      data-index={r.index}
                      className={`cell cell--${r.label.toLowerCase()}${isSelected ? ' on' : ''}`}
                      style={{
                        backgroundColor: SS_COLOR[r.label],
                        opacity: Math.max(0.45, 0.35 + 0.65 * r.confidence),
                      }}
                      tabIndex={selected === r.index || (selected === null && r.index === 0) ? 0 : -1}
                      aria-pressed={isSelected}
                      aria-label={ariaLabel}
                      title={title}
                      onClick={() => onSelect(isSelected ? null : r.index)}
                      onKeyDown={(e) => handleKeyDown(e, r.index)}
                    >
                      <span className="cell-aa">{r.aa}</span>
                      <span className="cell-ss">{r.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Optional Experimental Row if PDB data has experimental secondary structure */}
              {expSS && (
                <div className="exp-cells" title="Experimental secondary structure from PDB records" aria-hidden="true">
                  {block.map((r) => {
                    const exp = expSS[r.index];
                    return (
                      <span
                        key={`exp-${r.index}`}
                        className={`exp-indicator exp--${exp ? exp.toLowerCase() : 'none'}`}
                        style={{ backgroundColor: exp ? SS_COLOR[exp] : '#E2E8F0' }}
                      >
                        {exp ?? '-'}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
