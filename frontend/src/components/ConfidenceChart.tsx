import { SS_COLOR, SS_NAME, type PredictResponse, type SS, type AgreementStats } from '../types';

interface Props {
  data: PredictResponse;
  agreement?: AgreementStats | null;
}

export default function ConfidenceChart({ data, agreement }: Props) {
  const n = data.residues.length;
  if (n === 0) return null;

  const states: SS[] = ['H', 'E', 'C'];

  return (
    <div className="confidence-chart-section">
      <div className="chart-header">
        <h3 className="subheading">Per-Residue Assigned-State Scores</h3>
        {agreement && (
          <div className="agreement-badge" title="Percentage of residues where predicted secondary structure matches the PDB crystallographic record">
            <span className="agreement-label">Experimental Agreement (Q₃):</span>
            <span className="agreement-value">{agreement.percentage}%</span>
            <span className="agreement-detail">({agreement.matched}/{agreement.totalWithExp} residues)</span>
          </div>
        )}
      </div>

      <div className="svg-chart-wrapper">
        <svg
          className="chart"
          viewBox={`0 0 ${n} 100`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Heuristic secondary structure assigned-state score chart per residue"
        >
          {data.residues.map((r) => {
            const h = Math.max(2, r.confidence * 100);
            return (
              <rect
                key={r.index}
                x={r.index}
                width={1}
                y={100 - h}
                height={h}
                fill={SS_COLOR[r.label]}
              >
                <title>{`${r.aa}${r.index + 1}: ${SS_NAME[r.label]} assigned-state score ${(r.confidence * 100).toFixed(0)}%`}</title>
              </rect>
            );
          })}
          {/* 33.3% coin-toss threshold */}
          <line
            x1={0}
            x2={n}
            y1={66.7}
            y2={66.7}
            stroke="#16232E"
            strokeWidth={0.8}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <p className="hint">
        Bar height is the normalized propensity score for the assigned state. The dashed line marks 33.3% (equal values across three states), not a calibrated accuracy threshold.
      </p>

      <div className="composition-block">
        <h4 className="subheading">Predicted Secondary Structure Composition</h4>
        <div className="stack" aria-label="Secondary structure composition proportions">
          {states.map((k) => (
            <div
              key={k}
              style={{
                flex: Math.max(data.counts[k], 0.0001),
                backgroundColor: SS_COLOR[k],
              }}
              title={`${SS_NAME[k]}: ${data.counts[k]} residues (${((data.counts[k] / n) * 100).toFixed(1)}%)`}
            />
          ))}
        </div>

        <ul className="legend">
          {states.map((k) => {
            const count = data.counts[k] || 0;
            const pct = ((count / n) * 100).toFixed(1);
            return (
              <li key={k} className="legend-item">
                <span className="legend-swatch" style={{ backgroundColor: SS_COLOR[k] }} aria-hidden="true" />
                <span className="legend-name">{SS_NAME[k]}</span>
                <span className="legend-stat">{count} ({pct}%)</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
