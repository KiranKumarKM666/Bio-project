import type { StructureContext } from '../types';

interface Props {
  context: StructureContext | null;
  loading: boolean;
  error: string | null;
  onOpenStructure: (pdbId: string) => void;
}

export default function ProteinKnowledge({ context, loading, error, onOpenStructure }: Props) {
  if (loading) {
    return (
      <div className="pk-card pk-loading" role="status">
        <span className="spinner" aria-hidden="true" />
        <span>Loading protein context from RCSB &amp; UniProt…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pk-card pk-error" role="status">
        <strong>Protein annotations unavailable:</strong> {error}
        <p>The structure viewer and sequence prediction remain available.</p>
      </div>
    );
  }

  if (!context) return null;

  return (
    <div className="pk-card" role="region" aria-labelledby="pk-heading">
      <div className="pk-header">
        <span className="pk-kicker">PROTEIN KNOWLEDGE &amp; ANNOTATIONS</span>
        <h3 id="pk-heading" className="pk-title">
          {context.protein_name || context.title}
        </h3>
        {context.protein_name && context.title !== context.protein_name && (
          <p className="pk-subtitle">{context.title}</p>
        )}
      </div>

      {/* Metadata Badges */}
      <div className="pk-badges">
        {context.organism && (
          <span className="pk-badge pk-badge-org" title="Source organism">
            🧬 {context.organism}
          </span>
        )}
        {context.method && (
          <span className="pk-badge pk-badge-method" title="Experimental method">
            🔬 {context.method}
          </span>
        )}
        {context.resolution_angstrom != null && (
          <span className="pk-badge pk-badge-res" title="Resolution">
            📏 {context.resolution_angstrom.toFixed(2)} Å
          </span>
        )}
        {context.classification && (
          <span className="pk-badge pk-badge-class" title="RCSB classification">
            🏷️ {context.classification}
          </span>
        )}
        {context.uniprot_id && (
          <a
            className="pk-badge pk-badge-link"
            href={context.sources.uniprot ?? `https://www.uniprot.org/uniprotkb/${context.uniprot_id}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in UniProt"
          >
            🔗 UniProt: {context.uniprot_id}
          </a>
        )}
      </div>

      {/* Biological Function */}
      {context.function && (
        <div className="pk-section">
          <h4 className="pk-section-title">Function &amp; research relevance</h4>
          <p className="pk-function-text">{context.function}</p>
        </div>
      )}

      {/* Protein Families */}
      {context.families.length > 0 && (
        <div className="pk-section">
          <h4 className="pk-section-title">Structural Families &amp; Domains</h4>
          <div className="pk-families">
            {context.families.map((f) => (
              <span key={f} className="pk-family-chip">{f}</span>
            ))}
          </div>
        </div>
      )}

      {/* Similar Structures */}
      {context.similar.length > 0 && (
        <div className="pk-section">
          <h4 className="pk-section-title">Sequence-similar structures</h4>
          <div className="pk-similar-list">
            {context.similar.map((s) => (
              <button
                key={s.pdb_id}
                className="pk-similar-card"
                type="button"
                onClick={() => onOpenStructure(s.pdb_id)}
                title={`Load ${s.pdb_id} in the 3D viewer`}
              >
                <span className="pk-sim-id">{s.pdb_id}</span>
                <span className="pk-sim-title">{s.title}</span>
                <span className="pk-sim-score">search score {s.score.toFixed(2)}</span>
              </button>
            ))}
          </div>
          <p className="pk-similarity-note">
            RCSB sequence-search score; it is not a percent-identity value.
          </p>
        </div>
      )}

      {/* Source Links */}
      <div className="pk-sources">
        <a href={context.sources.rcsb} target="_blank" rel="noopener noreferrer" className="pk-source-link">
          View on RCSB PDB →
        </a>
        {context.sources.uniprot && (
          <a href={context.sources.uniprot} target="_blank" rel="noopener noreferrer" className="pk-source-link">
            View on UniProt →
          </a>
        )}
      </div>

      {/* Warnings */}
      {context.warnings.length > 0 && (
        <div className="pk-warnings">
          {context.warnings.map((w, i) => (
            <p key={i} className="pk-warning-text">⚠ {w}</p>
          ))}
        </div>
      )}
    </div>
  );
}
