import React from 'react';

export interface HistoryItem {
  id: string;
  timestamp: number;
  type: 'pdb' | 'sequence';
  pdbId?: string;
  chain?: string;
  sequence: string;
  length: number;
  counts: { H: number; E: number; C: number };
  meanConfidence: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  items: HistoryItem[];
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

export default function RecentHistory({
  isOpen,
  onClose,
  items,
  onSelect,
  onDelete,
  onClear,
}: Props) {
  if (!isOpen) return null;

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = Date.now();
    const diffMin = Math.round((now - ts) / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.round(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="history-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="history-title">
      <div className="history-modal" onClick={(e) => e.stopPropagation()}>
        <div className="history-header">
          <div className="history-header-left">
            <h2 id="history-title" className="history-title">
              Recent Predictions
            </h2>
            <span className="history-count-badge">{items.length} saved</span>
          </div>
          <div className="history-header-actions">
            {items.length > 0 && (
              <button
                type="button"
                className="btn-history-clear"
                onClick={onClear}
                title="Clear all stored predictions"
              >
                Clear All
              </button>
            )}
            <button
              type="button"
              className="btn-history-close"
              onClick={onClose}
              aria-label="Close history modal"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="history-body">
          {items.length === 0 ? (
            <div className="history-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <p className="history-empty-title">No recent predictions yet</p>
              <p className="history-empty-desc">
                Predictions for PDB structures or pasted sequences will automatically be saved here so you can revisit them anytime.
              </p>
            </div>
          ) : (
            <div className="history-list">
              {items.map((item) => {
                const total = item.length || 1;
                const hPct = Math.round((item.counts.H / total) * 100);
                const ePct = Math.round((item.counts.E / total) * 100);
                const cPct = Math.round((item.counts.C / total) * 100);

                return (
                  <div key={item.id} className="history-card">
                    <div className="history-card-top">
                      <div className="history-card-info">
                        {item.type === 'pdb' ? (
                          <div className="history-card-title-group">
                            <span className="history-type-badge pdb">PDB</span>
                            <strong className="history-item-title">{item.pdbId}</strong>
                            {item.chain && <span className="history-chain-tag">Chain {item.chain}</span>}
                          </div>
                        ) : (
                          <div className="history-card-title-group">
                            <span className="history-type-badge seq">SEQ</span>
                            <strong className="history-item-title">
                              {item.sequence.slice(0, 12)}...
                            </strong>
                          </div>
                        )}
                        <span className="history-time">{formatDate(item.timestamp)}</span>
                      </div>

                      <div className="history-card-actions">
                        <button
                          type="button"
                          className="btn-history-load"
                          onClick={() => {
                            onSelect(item);
                            onClose();
                          }}
                          title="Restore and inspect this prediction"
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          className="btn-history-del"
                          onClick={() => onDelete(item.id)}
                          aria-label={`Delete prediction ${item.pdbId || 'sequence'}`}
                          title="Delete from history"
                        >
                          🗑
                        </button>
                      </div>
                    </div>

                    <div className="history-card-meta">
                      <span>{item.length} residues</span>
                      <span>·</span>
                      <span>Mean score: {(item.meanConfidence * 100).toFixed(0)}%</span>
                      <span>·</span>
                      <span>H:{hPct}% E:{ePct}% C:{cPct}%</span>
                    </div>

                    {/* Mini Secondary Structure Distribution Bar */}
                    <div className="history-mini-bar" title={`Helix: ${hPct}%, Strand: ${ePct}%, Coil: ${cPct}%`}>
                      <div className="mini-seg helix" style={{ width: `${hPct}%` }} />
                      <div className="mini-seg strand" style={{ width: `${ePct}%` }} />
                      <div className="mini-seg coil" style={{ width: `${cPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
