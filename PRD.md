# Product Requirements Document: Foldspace Protein Structure Explorer

**Status:** Shipped  
**Document date:** 2026-11-26  
**Production website:** https://bio-project-production.up.railway.app/  
**Product name:** Foldspace / Lab — Protein structure explorer

## 1. Product summary

Foldspace is a browser-based research and education tool for exploring protein secondary-structure predictions alongside deposited Protein Data Bank (PDB) coordinates. A visitor can submit an amino-acid sequence or load a PDB entry, inspect predicted helix, beta-strand, and coil states, and connect residue-level results to an interactive 3D structure when coordinates are available.

The application is a React and TypeScript frontend backed by a FastAPI service. Its shipped predictor is a transparent, windowed Chou-Fasman propensity baseline. It is not a trained neural network and does not predict 3D coordinates.

## 2. Problem and opportunity

Protein researchers, students, and curious users need a quick way to inspect sequence-level secondary-structure hypotheses and relate them to a known structure. Existing tools often separate prediction, coordinate viewing, sequence annotations, and exports. Foldspace brings these activities into one browser workflow while making the model's scientific limits visible.

## 3. Goals

1. Accept a pasted amino-acid sequence or a four-character PDB accession.
2. Return an H/E/C prediction for each supported sequence residue.
3. Make sequence, prediction, score, and (when available) PDB residue mappings inspectable together.
4. Provide understandable composition, sequence-property, and structure-context summaries.
5. Support repeatable sharing, local history, and useful research-data exports.
6. Clearly distinguish normalized propensity scores from calibrated accuracy or experimental certainty.
7. Keep prediction and core sequence analysis usable when optional external structure annotations are unavailable.

## 4. Non-goals

- Predicting atomic coordinates or a protein's complete 3D fold.
- Replacing experimental structure determination or a specialist bioinformatics pipeline.
- Claiming clinical, diagnostic, or therapeutic suitability.
- Claiming a trained deep-learning model, published accuracy result, or calibrated per-residue confidence.
- Creating user accounts, a server-side database, cloud-synchronized history, or team collaboration.
- Treating a sequence-similarity search score as percent identity.

## 5. Users and primary jobs

### Researcher or bioinformatics practitioner

- Submit a sequence or known PDB accession.
- Inspect residue predictions and compare them with deposited PDB secondary-structure annotations.
- Export residue-level results or coordinates for follow-up analysis.

### Student or educator

- Learn the meanings of helix (H), beta-strand (E), and coil/turn (C).
- Explore predicted runs, basic sequence properties, and a known 3D structure.
- Understand what the baseline can and cannot claim.

### General scientific user

- Load a sample structure, inspect it interactively, and obtain an approachable summary without installing local software.

## 6. Core user journeys

### A. Predict a sequence

1. Paste a sequence or FASTA record into the sequence field.
2. Select **Predict sequence**.
3. The frontend submits the input to `POST /api/predict`.
4. The backend strips FASTA header lines and whitespace, uppercases the sequence, checks supported residues and length, and calculates prediction and sequence properties.
5. The page shows residue-level H/E/C states, assigned-state scores, composition, molecular properties, explanation tabs, and export controls.

### B. Explore a PDB entry

1. Enter a PDB accession or choose a sample (1UBQ, 1MBN, 1TEN, or 2HHB).
2. The frontend requests coordinates through `GET /api/pdb/{pdb_id}`.
3. The frontend parses protein chains, residue numbering, deposited HELIX/SHEET annotations, and ligand summaries.
4. The user chooses a chain when the entry has multiple chains; the selected chain is sent to the predictor.
5. The page links prediction residues to the selected chain in the 3D viewer and track.
6. RCSB/UniProt context is loaded as optional supplemental information.

### C. Inspect and share a result

1. Click or keyboard-focus a residue in the sequence track or 3D viewer.
2. Review its identity, position, state, and normalized propensity values.
3. Choose a viewer representation/color scheme or inspect the explanation tabs.
4. For PDB-backed results, use the URL query parameters to restore entry, chain, view mode, and residue selection.
5. Download or copy a report, coordinates, FASTA, CSV, or JSON.

### D. Revisit or clear local history

1. Open **History** to restore or delete one of the most recent 20 predictions.
2. Use **Clear All** in the history dialog to remove saved prediction history.
3. Use **Clear Saved Data** in the header to clear history, draft, session caches, and PDB-related URL state.

## 7. Functional requirements and shipped behavior

### 7.1 Header and workspace

- Brand the application as Foldspace / Lab and identify the Chou-Fasman baseline.
- Provide History and Clear Saved Data actions.
- Present a short product introduction and the H/E/C legend.
- Arrange the interactive structure inspector and input/results controls as a responsive workspace.

### 7.2 Sequence and PDB inputs

- Accept a plain sequence or FASTA text. FASTA header lines beginning with `>` and whitespace are removed by the API before prediction.
- Accept only standard amino-acid single-letter symbols plus `X` for an unknown residue.
- Limit the prediction sequence to 5,000 residues and the HTTP request body to 64 KiB by default.
- Validate PDB accession syntax: four alphanumeric characters beginning with a digit.
- Offer sample PDB entries: 1UBQ, 1MBN, 1TEN, and 2HHB.
- Allow chain selection for entries with multiple parsed protein chains.
- Display loading progress, support cancellation for active frontend requests, and show actionable error messages.

### 7.3 Prediction and sequence properties

- Return one result per input residue with zero-based index, amino-acid letter, H/E/C label, normalized assigned-state score, and H/E/C propensity values.
- Return H/E/C counts and derived properties, including sequence length, unknown-X count, residue composition, formula, atoms, and estimated mass when available.
- Use a transparent Chou-Fasman baseline. Propensities are window-averaged (7 residues for helix; 5 for strand and turn), normalized with softmax, and short helix/strand runs are smoothed to coil.
- Never describe the normalized assigned-state score as a calibrated probability of correctness.

### 7.4 Interactive structure viewer

- Render PDB coordinates with 3Dmol.js when a PDB entry is loaded.
- Support direct pointer orbit, zoom, optional automatic 360-degree rotation with speed/axis controls, front/top/side/reset views, and perspective/orthographic projection.
- Offer ribbon cartoon, all-atom ball-and-stick, cartoon plus sidechains, solvent-excluded surface, and backbone trace representations.
- Offer secondary-structure, assigned-state-score, and hydrophobicity color schemes.
- Allow ligand/cofactor visibility toggling, full-screen mode, and a PNG snapshot.
- Highlight the selected chain and connect selected residues with the sequence track and residue readout.
- Keep sequence-only prediction available when no coordinate file is loaded or the 3D viewer cannot start.

### 7.5 Track, chart, and scientific explanations

- Show every residue as a letter/state cell with state color and opacity scaled to assigned-state score.
- Provide pointer and keyboard navigation: left/right arrows, Home, End, Enter, and Space.
- When PDB HELIX/SHEET records exist, show an experimental annotation row and calculate Q3 agreement over residues that have an experimental annotation.
- Show per-residue assigned-state scores and H/E/C composition counts/percentages.
- Present Composition, Motifs, Sequence Properties, and Educational Guide tabs.
- Explain the scientific meaning and caveats of the H/E/C labels and derived metrics.

### 7.6 Protein annotations

- For PDB-backed results, request optional sourced entry context from RCSB and UniProt through `POST /api/structure/context`.
- Display available protein name/title, organism, method, resolution, classification, UniProt identifier, function, families/domains, and similar structures.
- Link users to source records and allow loading a similar PDB entry.
- Treat context as optional: annotation service failures must not hide an already-loaded structure or prediction.
- Label RCSB search scores accurately; they are not percent-identity values.

### 7.7 History, local persistence, and URL state

- Store sequence draft and up to 20 recent predictions in browser localStorage.
- Store PDB coordinates, predictions, and context responses in browser sessionStorage to reduce repeated requests in the same tab/session.
- Do not create user accounts or store user sequence history in the backend.
- For PDB-backed views, support URL parameters `pdb`, `chain`, `mode`, and one-based `res`.
- Clear Saved Data removes local history, draft, application session caches, and PDB URL parameters.

### 7.8 Exports

- Provide a generated analysis PDF report and browser print-to-PDF option.
- Provide CSV with residue position, amino acid, predicted state, assigned-state score, and H/E/C propensity values.
- Provide FASTA with sequence and predicted H/E/C string.
- Provide JSON with target metadata, timestamp, sequence, and prediction payload.
- For PDB-backed results, provide `.pdb` and `.cif` coordinate downloads.
- Allow copying the prediction state string and sequence-plus-prediction FASTA text.

## 8. API and system boundary

| Route | Purpose |
|---|---|
| `GET /health` | Lightweight Railway process health check. |
| `GET /api/health` | API status, version, and active predictor name. |
| `POST /api/predict` | Validate a sequence and return residues, counts, and properties. |
| `POST /api/v1/predict` | Versioned alias for prediction. |
| `GET /api/pdb/{pdb_id}?format=pdb\|cif` | Return cached or RCSB-fetched coordinates. |
| `POST /api/structure/context` | Return optional sourced RCSB/UniProt context and sequence-search matches. |
| `GET /api/docs` | FastAPI interactive API documentation. |

The Vite development server proxies `/api` to FastAPI. In production, the FastAPI service serves the built frontend and API from one origin. PDB coordinate retrieval and optional structure context depend on external RCSB/UniProt services; those services are not controlled by this application.

## 9. Reliability, security, and privacy requirements

- Validate inputs server-side; reject unsupported characters, oversized sequences, oversized request bodies, invalid PDB IDs, and unknown JSON fields.
- Apply process-local per-IP rate limiting (60 requests per minute by default) to prediction, structure-context, and PDB endpoints.
- Return structured API error responses with request IDs and security headers.
- Do not log submitted sequences or request bodies.
- Use same-origin browser API requests; backend services perform upstream coordinate and annotation requests.
- PDB downloads have a 10 MB limit. Upstream calls have finite timeouts; upstream failures must surface as errors rather than fabricated data.
- History/drafts are local to the visitor's browser. Structure-context sequence searches are sent to RCSB; users should not submit confidential sequences when using that feature.
- Production is deployed on Railway from the GitHub repository. The active public URL is listed at the top of this document.

## 10. Scientific constraints and user-facing disclaimers

1. The predictor estimates 1D secondary-structure states; it does not calculate atomic coordinates.
2. The active implementation is a propensity-based baseline, not a trained network.
3. Assigned-state values are normalized model outputs, not calibrated correctness probabilities.
4. Q3 is a descriptive match against parsed deposited HELIX/SHEET annotations when available; it is not a benchmark claim.
5. Coil labels alone do not establish disorder, flexibility, or biological function.
6. Hydrophobic fraction and side-chain charge are simplified sequence-derived summaries, not solvent exposure or pI calculations.
7. PDB structures can be experimental or computational and remain the source of the displayed coordinates.

## 11. Success criteria and acceptance checks

- A valid sequence of up to 5,000 supported residues produces exactly one output residue per input residue.
- Invalid/empty sequence and invalid PDB identifiers produce explicit validation errors.
- The frontend can reach the backend through its configured same-origin API proxy.
- A PDB-backed prediction maps the selected chain to the viewer and sequence track.
- Optional metadata failure does not erase the core structure or sequence result.
- Exports contain the selected sequence/prediction and use appropriate file formats.
- Local history, draft persistence, deep-link restoration, and clear-data behavior work in the browser.
- Backend tests pass and the frontend type-check/build succeeds before release.
- Production website, health endpoint, and a live prediction request respond successfully after deployment.

## 12. Current limitations and future considerations

- Prediction history is browser-local and is not synchronized across devices or browsers.
- Rate limiting is process-local; a multi-replica deployment would need shared rate-limit state or an upstream gateway.
- Structure-context and uncached coordinate availability depends on external upstream services and network access.
- The 3D view requires browser WebGL support and can vary with device performance.
- The baseline is intentionally modest; replacing it with a trained model would require documented training data, evaluation, reproducibility, and calibration evidence before changing scientific claims.

## 13. Related documentation

- [Website usage and implementation guide (PDF)](WEBSITE_GUIDE.pdf)
- [Repository README](README.md)
