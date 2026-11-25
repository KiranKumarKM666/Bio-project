export default function LimitsNotice() {
  return (
    <div className="limits-card" role="note" aria-label="Methodology and model limitations">
      <div className="limits-header">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <strong>Methodology &amp; Model Limitations</strong>
      </div>
      <ul className="limits-list">
        <li>
          <strong>Baseline Predictor:</strong> The default model is a transparent, windowed Chou-Fasman propensity baseline, not a trained deep neural network. This application does not provide a validated accuracy estimate for each protein.
        </li>
        <li>
          <strong>No 3D Prediction:</strong> This tool predicts 1D secondary structure states (H, E, C) from sequence. Coordinates are fetched from the selected RCSB PDB entry and may be experimental or computational; the secondary-structure prediction does not generate them.
        </li>
        <li>
          <strong>Score Interpretation:</strong> Per-residue values are normalized propensity scores, not calibrated probabilities of correctness. A score of 33.3% indicates equal values across the three states, not measured random-guess accuracy.
        </li>
      </ul>
    </div>
  );
}
