import type { Properties } from '../types';

export default function Formula({ p }: { p: Properties }) {
  return (
    <div>
      {p.formula ? (
        <p className="formula" aria-label={`Molecular formula ${p.formula}`}>
          {Object.entries(p.atoms).map(([el, n]) => (
            <span key={el}>
              {el}
              {n > 1 && <sub>{n}</sub>}
            </span>
          ))}
        </p>
      ) : (
        <p className="hint">No formula: the sequence has no standard residues.</p>
      )}
      <dl className="facts">
        <div><dt>Residues</dt><dd>{p.length}</dd></div>
        <div><dt>Average mass</dt><dd>{p.mass ? `${p.mass.toLocaleString()} Da` : 'n/a'}</dd></div>
        {p.unknown > 0 && <div><dt>Unknown (X)</dt><dd>{p.unknown}, left out of formula</dd></div>}
      </dl>
      <p className="hint">Formula = sum of residue formulas plus one water for the chain termini.</p>
      <div className="comp">
        {Object.entries(p.composition).map(([aa, n]) => (
          <span key={aa}><b>{aa}</b>{n}</span>
        ))}
      </div>
    </div>
  );
}
