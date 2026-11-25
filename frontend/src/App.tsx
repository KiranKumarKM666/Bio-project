import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchStructureContext, predict } from './api';
import { fetchPdb, parsePdbData, isValidPdbId, calculateAgreement } from './pdb';
import type { PredictResponse, PdbData, ChainInfo, AgreementStats, SS, StructureContext } from './types';
import StructureViewer, { type ColorMode } from './components/StructureViewer';
import Track from './components/Track';
import ConfidenceChart from './components/ConfidenceChart';
import Formula from './components/Formula';
import ExportPanel from './components/ExportPanel';
import LimitsNotice from './components/LimitsNotice';
import RecentHistory, { type HistoryItem } from './components/RecentHistory';
import StructureExplanation from './components/StructureExplanation';
import StructureVisualGuide from './components/StructureVisualGuide';
import ProteinKnowledge from './components/ProteinKnowledge';

const SAMPLES = [
  { id: '1UBQ', name: 'Ubiquitin', desc: 'Mixed α/β benchmark' },
  { id: '1MBN', name: 'Myoglobin', desc: 'All-α globin fold' },
  { id: '1TEN', name: 'Tenascin', desc: 'All-β fibronectin type III' },
  { id: '2HHB', name: 'Hemoglobin', desc: 'Heterotetramer (α & β chains)' },
];

const STORAGE_KEY_DRAFT = 'ssp:v1:draft';
const STORAGE_KEY_HISTORY = 'ssp:v1:history';
const MAX_HISTORY_ITEMS = 20;

function isHistoryItem(value: unknown): value is HistoryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<HistoryItem>;
  const counts = item.counts;
  return typeof item.id === 'string'
    && item.id.length <= 80
    && Number.isFinite(item.timestamp)
    && (item.type === 'pdb' || item.type === 'sequence')
    && typeof item.sequence === 'string'
    && item.sequence.length > 0
    && item.sequence.length <= 5000
    && /^[ACDEFGHIKLMNPQRSTVWYX]+$/.test(item.sequence)
    && typeof item.length === 'number'
    && Number.isInteger(item.length)
    && item.length === item.sequence.length
    && typeof counts === 'object'
    && counts !== null
    && ['H', 'E', 'C'].every((key) => Number.isInteger(counts[key as 'H' | 'E' | 'C']) && counts[key as 'H' | 'E' | 'C'] >= 0)
    && typeof item.meanConfidence === 'number'
    && Number.isFinite(item.meanConfidence)
    && item.meanConfidence >= 0
    && item.meanConfidence <= 1
    && (item.type !== 'pdb' || (typeof item.pdbId === 'string' && isValidPdbId(item.pdbId) && typeof item.chain === 'string' && item.chain.length <= 4));
}

function readHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isHistoryItem).slice(0, MAX_HISTORY_ITEMS) : [];
  } catch {
    return [];
  }
}

function isValidDraft(value: string): boolean {
  if (value.length > 5000) return false;
  const compact = value
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('>'))
    .join('')
    .replace(/\s+/g, '')
    .toUpperCase();
  return compact.length > 0 && /^[ACDEFGHIKLMNPQRSTVWYX]+$/.test(compact);
}

export default function App() {
  const [pdbIdInput, setPdbIdInput] = useState('');
  const [sequenceInput, setSequenceInput] = useState('');
  
  const [pdbData, setPdbData] = useState<PdbData | null>(null);
  const [selectedChainId, setSelectedChainId] = useState<string>('A');
  const [result, setResult] = useState<PredictResponse | null>(null);
  
  const [colorMode, setColorMode] = useState<ColorMode>('predicted');
  const [selectedResidueIndex, setSelectedResidueIndex] = useState<number | null>(null);
  
  const [isBusy, setIsBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [structureContext, setStructureContext] = useState<StructureContext | null>(null);
  const [isContextLoading, setIsContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);

  const activeAbortController = useRef<AbortController | null>(null);
  const contextAbortController = useRef<AbortController | null>(null);
  const isInitialMount = useRef(true);

  useEffect(() => () => {
    activeAbortController.current?.abort();
    contextAbortController.current?.abort();
  }, []);

  // Active chain data derived from PdbData
  const activeChain: ChainInfo | null = pdbData && pdbData.chains[selectedChainId]
    ? pdbData.chains[selectedChainId]
    : null;

  // Agreement stats between predicted and experimental secondary structure
  const agreementStats: AgreementStats | null = (result && activeChain?.expSS)
    ? calculateAgreement(result.residues, activeChain.expSS)
    : null;

  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>(readHistory);
  const historyItemsRef = useRef(historyItems);

  const saveToHistory = useCallback((item: Omit<HistoryItem, 'id' | 'timestamp'>) => {
    const filtered = historyItemsRef.current.filter((previous) => {
      if (item.type === 'pdb' && previous.type === 'pdb') {
        return !(previous.pdbId === item.pdbId && previous.chain === item.chain);
      }
      if (item.type === 'sequence' && previous.type === 'sequence') {
        return previous.sequence !== item.sequence;
      }
      return true;
    });
    const newItem: HistoryItem = {
      ...item,
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
    };
    const updated = [newItem, ...filtered].slice(0, MAX_HISTORY_ITEMS);
    historyItemsRef.current = updated;
    setHistoryItems(updated);
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(updated));
    } catch {
      setErrorMessage('Prediction completed, but browser storage could not save it to Recent History.');
    }
  }, []);

  const requestStructureContext = useCallback((pdbId: string, chain: string, sequence: string) => {
    contextAbortController.current?.abort();
    const controller = new AbortController();
    contextAbortController.current = controller;
    setStructureContext(null);
    setContextError(null);
    setIsContextLoading(true);

    void fetchStructureContext(pdbId, chain, sequence, controller.signal)
      .then((context) => {
        if (!controller.signal.aborted) setStructureContext(context);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setContextError(error instanceof Error ? error.message : 'Protein annotations could not be loaded.');
      })
      .finally(() => {
        if (contextAbortController.current === controller) {
          setIsContextLoading(false);
          contextAbortController.current = null;
        }
      });
  }, []);

  const deleteHistoryItem = (id: string) => {
    const updated = historyItemsRef.current.filter((item) => item.id !== id);
    historyItemsRef.current = updated;
    setHistoryItems(updated);
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(updated));
    } catch {
      setErrorMessage('History changed for this session, but browser storage could not save the update.');
    }
  };

  const clearHistory = () => {
    historyItemsRef.current = [];
    setHistoryItems([]);
    try {
      localStorage.removeItem(STORAGE_KEY_HISTORY);
    } catch {
      setErrorMessage('History was cleared for this session, but browser storage could not remove the saved copy.');
    }
  };

  // Safe localStorage helper
  const saveDraft = (text: string) => {
    try {
      if (text) {
        localStorage.setItem(STORAGE_KEY_DRAFT, text);
      } else {
        localStorage.removeItem(STORAGE_KEY_DRAFT);
      }
    } catch {
      // storage unavailable or full
    }
  };

  // Sync state to URL query parameters
  const updateUrlParams = useCallback((
    pdbId: string | null,
    chain: string | null,
    mode: ColorMode,
    resIndex: number | null
  ) => {
    try {
      const url = new URL(window.location.href);
      if (pdbId && isValidPdbId(pdbId)) {
        url.searchParams.set('pdb', pdbId.toUpperCase());
        if (chain) url.searchParams.set('chain', chain);
        url.searchParams.set('mode', mode);
        if (resIndex !== null) {
          url.searchParams.set('res', String(resIndex + 1));
        } else {
          url.searchParams.delete('res');
        }
      } else {
        url.searchParams.delete('pdb');
        url.searchParams.delete('chain');
        url.searchParams.delete('mode');
        url.searchParams.delete('res');
      }
      window.history.replaceState({}, '', url.toString());
    } catch {
      // Fallback
    }
  }, []);

  // Execute a task with automatic cancellation of prior in-flight requests
  const executeTask = useCallback(async (
    statusText: string,
    action: (signal: AbortSignal) => Promise<void>
  ) => {
    if (activeAbortController.current) {
      activeAbortController.current.abort();
    }
    const controller = new AbortController();
    activeAbortController.current = controller;

    setIsBusy(true);
    setStatusMessage(statusText);
    setErrorMessage(null);

    try {
      await action(controller.signal);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Ignored aborted network request
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      if (activeAbortController.current === controller) {
        setIsBusy(false);
        setStatusMessage(null);
        activeAbortController.current = null;
      }
    }
  }, []);

  // Load PDB structure and predict the selected chain
  const loadPdbEntry = useCallback((
    id: string,
    targetChain?: string,
    initialMode: ColorMode = 'predicted',
    initialRes: number | null = null
  ) => {
    const cleanId = id.trim().toUpperCase();
    if (!isValidPdbId(cleanId)) {
      setErrorMessage(`"${cleanId}" is not a valid 4-character PDB accession (e.g. 1UBQ).`);
      return;
    }

    setPdbIdInput(cleanId);
    contextAbortController.current?.abort();
    setStructureContext(null);
    setContextError(null);
    setIsContextLoading(false);

    executeTask(`Downloading ${cleanId} from RCSB...`, async (signal) => {
      const text = await fetchPdb(cleanId, signal);
      const parsed = parsePdbData(text, cleanId);

      if (parsed.chainList.length === 0) {
        throw new Error(`No protein chains found in PDB entry ${cleanId}.`);
      }

      // Choose designated chain or first available
      const chainToUse = targetChain && parsed.chains[targetChain]
        ? targetChain
        : parsed.chainList[0];

      const chainInfo = parsed.chains[chainToUse];
      setStatusMessage(`Predicting secondary structure for Chain ${chainToUse}...`);
      const pred = await predict(chainInfo.sequence, signal);
      const safeInitialRes = initialRes !== null
        ? Math.max(0, Math.min(initialRes, pred.residues.length - 1))
        : null;

      setPdbData(parsed);
      setSelectedChainId(chainToUse);
      setSequenceInput(chainInfo.sequence);
      setResult(pred);
      setColorMode(initialMode);
      setSelectedResidueIndex(safeInitialRes);

      updateUrlParams(cleanId, chainToUse, initialMode, safeInitialRes);

      saveToHistory({
        type: 'pdb',
        pdbId: cleanId,
        chain: chainToUse,
        sequence: chainInfo.sequence,
        length: chainInfo.sequence.length,
        counts: pred.counts,
        meanConfidence: pred.residues.reduce((a, b) => a + b.confidence, 0) / pred.residues.length,
      });
      requestStructureContext(cleanId, chainToUse, chainInfo.sequence);
    });
  }, [executeTask, updateUrlParams, saveToHistory, requestStructureContext]);

  // Handle chain switch on loaded PDB
  const handleChainChange = useCallback((newChainId: string) => {
    if (!pdbData || !pdbData.chains[newChainId]) return;

    contextAbortController.current?.abort();
    setIsContextLoading(false);
    const chainInfo = pdbData.chains[newChainId];
    setSelectedChainId(newChainId);
    setSelectedResidueIndex(null);
    setStructureContext(null);
    setContextError(null);

    executeTask(`Predicting secondary structure for Chain ${newChainId}...`, async (signal) => {
      const pred = await predict(chainInfo.sequence, signal);
      setSequenceInput(chainInfo.sequence);
      setResult(pred);
      updateUrlParams(pdbData.id, newChainId, colorMode, null);

      saveToHistory({
        type: 'pdb',
        pdbId: pdbData.id,
        chain: newChainId,
        sequence: chainInfo.sequence,
        length: chainInfo.sequence.length,
        counts: pred.counts,
        meanConfidence: pred.residues.reduce((a, b) => a + b.confidence, 0) / pred.residues.length,
      });
      requestStructureContext(pdbData.id, newChainId, chainInfo.sequence);
    });
  }, [pdbData, colorMode, executeTask, updateUrlParams, saveToHistory, requestStructureContext]);

  // Predict custom pasted sequence
  const handlePredictSequence = useCallback(() => {
    const clean = sequenceInput.trim();
    if (!clean) {
      setErrorMessage('Please paste or type an amino acid sequence first.');
      return;
    }

    saveDraft(clean);

    contextAbortController.current?.abort();
    setStructureContext(null);
    setContextError(null);
    setIsContextLoading(false);
    executeTask('Predicting secondary structure...', async (signal) => {
      const pred = await predict(clean, signal);
      setPdbData(null);
      setSelectedResidueIndex(null);
      setResult(pred);
      updateUrlParams(null, null, 'predicted', null);

      saveToHistory({
        type: 'sequence',
        sequence: clean,
        length: clean.length,
        counts: pred.counts,
        meanConfidence: pred.residues.reduce((a, b) => a + b.confidence, 0) / pred.residues.length,
      });
    });
  }, [sequenceInput, executeTask, updateUrlParams, saveToHistory]);

  const handleSelectHistoryItem = useCallback((item: HistoryItem) => {
    if (item.type === 'pdb' && item.pdbId) {
      loadPdbEntry(item.pdbId, item.chain, 'predicted', null);
    } else {
      contextAbortController.current?.abort();
      setStructureContext(null);
      setContextError(null);
      setIsContextLoading(false);
      setSequenceInput(item.sequence);
      setPdbData(null);
      executeTask('Predicting secondary structure...', async (signal) => {
        const pred = await predict(item.sequence, signal);
        setSelectedResidueIndex(null);
        setResult(pred);
        updateUrlParams(null, null, 'predicted', null);
      });
    }
  }, [loadPdbEntry, executeTask, updateUrlParams]);

  // Handle initial page load & URL query restoration (Requirement 5.1)
  useEffect(() => {
    if (!isInitialMount.current) return;
    isInitialMount.current = false;

    try {
      const params = new URLSearchParams(window.location.search);
      const urlPdb = params.get('pdb');
      const urlChain = params.get('chain');
      const urlMode = params.get('mode') === 'experimental' ? 'experimental' : 'predicted';
      const urlResRaw = params.get('res');
      const urlRes = urlResRaw ? parseInt(urlResRaw, 10) - 1 : null;

      if (urlPdb && isValidPdbId(urlPdb)) {
        loadPdbEntry(urlPdb, urlChain || undefined, urlMode, urlRes);
        return;
      }

      // If no PDB in URL, check localStorage for draft sequence
      const draft = localStorage.getItem(STORAGE_KEY_DRAFT);
      if (draft && isValidDraft(draft)) {
        setSequenceInput(draft);
      }
    } catch {
      // Ingestion fallback
    }
  }, [loadPdbEntry]);

  // Clear all saved user data
  const handleClearSavedData = () => {
    let storageClearFailed = false;
    activeAbortController.current?.abort();
    activeAbortController.current = null;
    contextAbortController.current?.abort();
    contextAbortController.current = null;
    try {
      localStorage.removeItem(STORAGE_KEY_DRAFT);
      localStorage.removeItem(STORAGE_KEY_HISTORY);
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith('ssp:v1:')) sessionStorage.removeItem(key);
      }
    } catch {
      storageClearFailed = true;
    }
    try {
      const url = new URL(window.location.href);
      url.search = '';
      window.history.replaceState({}, '', url.pathname);
    } catch {
      storageClearFailed = true;
    }
    setHistoryItems([]);
    historyItemsRef.current = [];
    setIsHistoryOpen(false);
    setPdbData(null);
    setResult(null);
    setSequenceInput('');
    setPdbIdInput('');
    setSelectedResidueIndex(null);
    setErrorMessage(null);
    setStructureContext(null);
    setIsContextLoading(false);
    setContextError(null);
    setIsBusy(false);
    setStatusMessage(storageClearFailed
      ? 'Some saved data could not be cleared because browser storage is unavailable.'
      : 'All saved local data, drafts, and caches cleared.');
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleCancelTask = () => {
    activeAbortController.current?.abort();
    activeAbortController.current = null;
    setIsBusy(false);
    setStatusMessage(null);
  };

  const handleSelectResidue = useCallback((index: number | null) => {
    setSelectedResidueIndex(index);
    if (pdbData) {
      updateUrlParams(pdbData.id, selectedChainId, colorMode, index);
    }
  }, [pdbData, selectedChainId, colorMode, updateUrlParams]);

  const handleColorModeChange = (newMode: ColorMode) => {
    setColorMode(newMode);
    if (pdbData) {
      updateUrlParams(pdbData.id, selectedChainId, newMode, selectedResidueIndex);
    }
  };

  return (
    <div className="app-layout">
      <header className="app-header" role="banner">
        <div className="header-container">
          <div className="header-titles">
            <div className="brand-lockup" aria-label="Foldspace Protein Structure Explorer">
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 32 32" fill="none">
                  <path d="M7 6.5 24.5 25M25 7 7.5 25" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="7" cy="6.5" r="3" fill="currentColor" />
                  <circle cx="25" cy="7" r="3" fill="currentColor" />
                  <circle cx="7.5" cy="25" r="3" fill="currentColor" />
                  <circle cx="24.5" cy="25" r="3" fill="currentColor" />
                  <circle cx="16" cy="16" r="3.5" fill="#F2B766" />
                </svg>
              </span>
              <div>
                <span className="brand-name">FOLDSPACE <span> / LAB</span></span>
                <h1 className="app-title">Protein structure explorer</h1>
              </div>
            </div>
          </div>
          <div className="header-actions">
            <span className="model-badge"><span aria-hidden="true">●</span> CHOU–FASMAN BASELINE</span>
            <button
              type="button"
              className="btn btn--subtle btn-history-trigger"
              onClick={() => setIsHistoryOpen(true)}
              title="Open saved recent predictions history"
            >
              🕒 History {historyItems.length > 0 ? `(${historyItems.length})` : ''}
            </button>
            <button
              type="button"
              className="btn btn--subtle"
              onClick={handleClearSavedData}
              title="Clear recent history, drafts, session caches, and URL parameters"
              aria-label="Clear all saved data and reset"
            >
              Clear Saved Data
            </button>
          </div>
        </div>
      </header>

      <main className="main-content" role="main">
        <div className="hero-band">
          <div className="hero-copy">
            <p className="eyebrow">SEQUENCE TO STRUCTURE · 01</p>
            <h2>Every residue has a place.</h2>
            <p>Explore secondary-structure propensities alongside PDB coordinates. Select a residue to connect the sequence to its position in the model.</p>
          </div>
          <div className="hero-index" aria-label="Three secondary structure states: helix, beta strand, coil">
            <span>THREE STATES</span>
            <strong><i>H</i><i>E</i><i>C</i></strong>
            <small>helix · strand · coil</small>
          </div>
        </div>

        {statusMessage && (
          <div className="alert alert--info" role="status" aria-live="polite">
            {isBusy && <span className="spinner" aria-hidden="true" />}
            <span>{statusMessage}</span>
            {isBusy && <button type="button" className="load-cancel" onClick={handleCancelTask}>Cancel</button>}
          </div>
        )}

        {errorMessage && (
          <div className="alert alert--error" role="alert">
            <strong>Error:</strong> {errorMessage}
          </div>
        )}

        <div className="workspace-grid">
          {/* Left Column: 3D Visualization */}
          <section className="card visualizer-card" aria-labelledby="heading-3d">
            <div className="card-header">
              <div>
                <p className="panel-kicker">SPATIAL INSPECTOR</p>
                <h2 id="heading-3d" className="card-title">Structure viewer</h2>
              </div>
              
              {pdbData && (
                <div className="viewer-controls">
                  {pdbData.chainList.length > 1 && (
                    <label className="chain-selector-label">
                      <span>Chain:</span>
                      <select
                        className="select-input"
                        value={selectedChainId}
                        onChange={(e) => handleChainChange(e.target.value)}
                        disabled={isBusy}
                        aria-label="Select protein chain"
                      >
                        {pdbData.chainList.map((c) => (
                          <option key={c} value={c}>
                            Chain {c} ({pdbData.chains[c].sequence.length} aa)
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <div className="seg-control" role="group" aria-label="Color visualization mode">
                    <button
                      type="button"
                      className={`seg-btn ${colorMode === 'predicted' ? 'active' : ''}`}
                      aria-pressed={colorMode === 'predicted'}
                      onClick={() => handleColorModeChange('predicted')}
                    >
                      Predicted SS
                    </button>
                    <button
                      type="button"
                      className={`seg-btn ${colorMode === 'experimental' ? 'active' : ''}`}
                      aria-pressed={colorMode === 'experimental'}
                      onClick={() => handleColorModeChange('experimental')}
                    >
                      Experimental (PDB)
                    </button>
                  </div>
                </div>
              )}
            </div>

            <StructureViewer
              pdb={pdbData?.rawText ?? null}
              chain={selectedChainId}
              resNums={activeChain?.resNums ?? []}
              residues={result?.residues ?? null}
              expSS={activeChain?.expSS}
              mode={colorMode}
              selected={selectedResidueIndex}
              onSelectResidue={handleSelectResidue}
              pdbId={pdbData?.id}
            />

            {pdbData && (
              <p className="caption-hint">
                Chain <strong>{selectedChainId}</strong><span aria-hidden="true"> · </span>
                {activeChain?.sequence.length ?? 0} residues<span aria-hidden="true"> · </span>
                <span className="text-helix">H helix</span><span aria-hidden="true"> / </span>
                <span className="text-strand">E strand</span><span aria-hidden="true"> / </span>
                <span className="text-coil">C coil</span>
              </p>
            )}

            {pdbData && activeChain && (
              <ProteinKnowledge
                context={structureContext}
                loading={isContextLoading}
                error={contextError}
                onOpenStructure={(id) => loadPdbEntry(id)}
              />
            )}
          </section>

          {/* Right Column: Input Controls & Sequence Panel */}
          <aside className="sidebar-column" aria-label="Input and configuration panel">
            <section className="card input-card">
              <p className="panel-kicker">START WITH AN ENTRY OR SEQUENCE</p>
              <h2 className="card-title">Bring a protein into view</h2>
              <form
                className="input-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (pdbIdInput.trim()) loadPdbEntry(pdbIdInput);
                }}
              >
                <div className="input-group">
                  <label htmlFor="pdb-input" className="input-label">PDB ACCESSION</label>
                  <div className="input-row">
                    <input
                      id="pdb-input"
                      type="text"
                      className="text-input pdb-field"
                      placeholder="e.g. 1UBQ"
                      maxLength={4}
                      autoCapitalize="characters"
                      value={pdbIdInput}
                      onChange={(e) => setPdbIdInput(e.target.value.toUpperCase())}
                      disabled={isBusy}
                      aria-label="4-character PDB accession code"
                    />
                    <button
                      type="submit"
                      className="btn btn--primary"
                      disabled={isBusy || !pdbIdInput.trim()}
                    >
                      {isBusy ? 'Loading…' : 'Load structure'}
                    </button>
                  </div>
                </div>

                <div className="sample-chips">
                  <span className="chips-label">TRY A STRUCTURE</span>
                  {SAMPLES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`chip ${pdbData?.id === s.id ? 'chip--active' : ''}`}
                      disabled={isBusy}
                      onClick={() => loadPdbEntry(s.id)}
                      title={`${s.name} (${s.desc})`}
                    >
                      {s.id}
                    </button>
                  ))}
                </div>
              </form>

              <hr className="divider" />

              <form
                className="input-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handlePredictSequence();
                }}
              >
                <div className="input-group">
                  <label htmlFor="seq-input" className="input-label">OR PASTE A SEQUENCE / FASTA</label>
                  <textarea
                    id="seq-input"
                    className="textarea-input"
                    rows={5}
                    placeholder="e.g. MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG"
                    value={sequenceInput}
                    onChange={(e) => {
                      setSequenceInput(e.target.value);
                      saveDraft(e.target.value);
                    }}
                    disabled={isBusy}
                    aria-label="Amino acid single-letter sequence or FASTA format text"
                  />
                  <div className="seq-footer">
                    <span className="char-count">{sequenceInput.replace(/[^A-Za-z]/g, '').length} residues</span>
                    <button
                      type="submit"
                      className="btn btn--secondary"
                      disabled={isBusy || !sequenceInput.trim()}
                    >
                      Predict sequence
                    </button>
                  </div>
                </div>
              </form>
            </section>

            {result && (
              <section className="card properties-card" aria-labelledby="heading-formula">
                <h2 id="heading-formula" className="card-title">Physicochemical Properties</h2>
                <Formula p={result.properties} />
              </section>
            )}

            <LimitsNotice />
          </aside>
        </div>

        {/* Prediction Results Section */}
        {result && (
          <section className="card results-card" aria-labelledby="heading-results">
            <div className="card-header">
              <div>
                <div>
                  <p className="panel-kicker">SEQUENCE ANNOTATION</p>
                  <h2 id="heading-results" className="card-title">Residue-by-residue view</h2>
                </div>
                <p className="card-subtitle">
                  Model: <strong>{result.model}</strong>. Fainter residue cells indicate lower assigned-state propensity scores (not calibrated certainty). Hover or focus for the score and state propensities.
                </p>
              </div>
            </div>

            <Track
              residues={result.residues}
              selected={selectedResidueIndex}
              onSelect={handleSelectResidue}
              expSS={activeChain?.expSS}
            />

            <hr className="divider" />

            <ConfidenceChart
              data={result}
              agreement={agreementStats}
            />

            <hr className="divider" />

            <StructureExplanation
              sequence={activeChain ? activeChain.sequence : sequenceInput}
              result={result}
              pdbId={pdbData?.id}
              chainId={selectedChainId}
              onSelectRange={(start) => handleSelectResidue(start)}
            />

            <hr className="divider" />

            <StructureVisualGuide ligands={pdbData?.ligands ?? []} hasStructure={pdbData !== null} />

            <hr className="divider" />

            <ExportPanel
              sequence={activeChain ? activeChain.sequence : sequenceInput}
              result={result}
              pdbId={pdbData?.id}
              chainId={selectedChainId}
              rawPdbText={pdbData?.rawText}
              structureContext={structureContext}
              ligands={pdbData?.ligands}
            />
          </section>
        )}
      </main>

      <RecentHistory
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        items={historyItems}
        onSelect={handleSelectHistoryItem}
        onDelete={deleteHistoryItem}
        onClear={clearHistory}
      />

      <footer className="app-footer" role="contentinfo">
        <p>
          Protein Secondary Structure Predictor &bull; Built with React, TypeScript, Vite, 3Dmol.js, and FastAPI.
        </p>
      </footer>
    </div>
  );
}
