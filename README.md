# Protein Secondary Structure Predictor

A research-grade web tool that predicts protein secondary structure (H / E / C) from an amino-acid sequence and overlays predictions on the 3-D PDB viewer. Multi-chain PDB support, Q3 agreement scoring vs. experimental DSSP, 1-click export, and URL-shareable state.

> **Scientific honesty notice** – The shipped predictor uses a Chou–Fasman propensity baseline, **not** a trained neural network. Scores labelled "Q3" compare the baseline to experimental DSSP; they are not a published benchmark result.

---

## Table of Contents
1. [Quick start](#quick-start)
2. [Development setup](#development-setup)
3. [New features vs. baseline](#new-features-vs-baseline)
4. [Architecture overview](#architecture-overview)
5. [Running tests](#running-tests)
6. [Environment variables](#environment-variables)
7. [Scientific limits](#scientific-limits)
8. [Contributing](#contributing)

---

## Quick start

```powershell
# 1 — Backend (FastAPI, port 8000)
Set-Location ss-predictor\backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\uvicorn app.main:app --reload --port 8000

# 2 — Frontend (Vite + React, port 5173, proxies /api to :8000)
Set-Location ss-predictor\frontend
npm install
npm run dev
```

Then open **http://localhost:5173**.

---

## Deploy on Render

This repository includes a Render Blueprint and a multi-stage Dockerfile that builds the frontend and serves it with the FastAPI backend from one service.

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint**, connect `KiranKumarKM666/Bio-project`, and apply the `render.yaml` configuration.
3. Wait for the service health check at `/api/health` to pass; Render will provide the public URL.

The free web-service plan may spin down when idle, so the first request after inactivity can take longer.

---

## Development setup

### Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Python | 3.11 | Used for FastAPI backend |
| Node.js | 20 LTS | Required for Vite 7 |
| npm | 10 | Comes with Node 20 |

### Backend (FastAPI)

```powershell
Set-Location ss-predictor\backend

# Create virtual environment (one-time)
python -m venv .venv

# Install dependencies
.\.venv\Scripts\pip install -r requirements.txt

# Start dev server (auto-reload)
.\.venv\Scripts\uvicorn app.main:app --reload --port 8000

# Start production server
.\.venv\Scripts\uvicorn app.main:app --port 8000 --workers 4
```

**Backend environment** – copy `.env.example` to `.env` and edit:
```powershell
Copy-Item .env.example .env
notepad .env
```

### Frontend (Vite + React + TypeScript)

```powershell
Set-Location ss-predictor\frontend

# Install (first time or after package.json changes)
npm install

# Dev server with HMR (proxies /api → localhost:8000)
npm run dev

# Type-check only (no emit)
npx tsc --noEmit

# Production build (output → dist/)
npm run build

# Preview production build (also proxies /api → :8000)
npm run preview
```

---

## New features vs. baseline

| Feature | Baseline | Current |
|---------|----------|---------|
| Multi-chain PDB | ✗ single chain | ✅ all chains, dropdown selector |
| Experimental SS overlay | ✗ | ✅ parses HELIX/SHEET records; Q3 badge |
| Q3 agreement score | ✗ | ✅ residue-level agreement vs. experimental DSSP |
| Keyboard navigation in track | ✗ | ✅ roving tabindex, Arrow/Enter/Space |
| URL-shareable state | ✗ | ✅ `?pdb=1UBQ&chain=A&mode=predicted&res=12` |
| Draft sequence persistence | ✗ | ✅ localStorage (survives page reload) |
| Recent predictions | ✗ | ✅ Last 20 PDB/sequence predictions, stored locally and restorable |
| Protein context | ✗ | ✅ RCSB entry facts, UniProt function, families, and sequence-similar entries |
| Viewer explanations | ✗ | ✅ Legends for secondary-structure colors, score heatmap, atom views, surfaces, and ligands |
| Export panel | ✗ | ✅ PDF explanation report, PDB/mmCIF coordinates, CSV, FASTA, and JSON |
| Scientific limits notice | ✗ | ✅ `LimitsNotice` card, inline on result |
| Session caching | ✗ | ✅ sessionStorage for PDB + prediction; avoids duplicate requests |
| Rate limiting | ✗ | ✅ 60 requests/min/IP via backend middleware |
| Security headers | ✗ | ✅ CSP, HSTS, X-Content-Type-Options etc. |
| Request size limit | ✗ | ✅ 64 KB hard limit on /api/predict |
| Uniform error envelopes | partial | ✅ `{"error": "...", "request_id": "..."}` on all errors |
| Backend tests | 7 | 20 (validation, security headers, rate limit, context, coordinate formats) |
| npm vulnerabilities | 2 (esbuild, vite) | 0 (Vite 7, esbuild override) |

### Structure context and coordinate downloads

| Endpoint | Purpose |
|----------|---------|
| `POST /api/structure/context` | Accepts a PDB ID, chain, and protein sequence; returns sourced RCSB/UniProt facts and sequence-search matches. Optional annotation failures are returned as warnings. |
| `GET /api/pdb/{pdb_id}?format=pdb` | Download the PDB coordinate file. |
| `GET /api/pdb/{pdb_id}?format=cif` | Download the mmCIF coordinate file, recommended for modern structures and larger atom/residue identifiers. |

Recent predictions are held in browser localStorage (up to 20 entries). “Clear Saved Data” removes history, drafts, and session caches.

---

## Architecture overview

```
ss-predictor/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app — security middleware, routes
│   │   ├── predictor.py     # Pluggable Predictor interface + Chou–Fasman impl
│   │   ├── structure_context.py # RCSB / UniProt context aggregation
│   │   └── schemas.py       # Pydantic v2 request/response models
│   ├── tests/
│   │   └── test_api.py      # 20 pytest tests
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── App.tsx           # Root component, URL sync, task management
    │   ├── api.ts            # /api/predict wrapper, session cache, AbortSignal
    │   ├── pdb.ts            # PDB fetch, multi-chain parse, exp-SS, Q3
    │   ├── types.ts          # Shared TypeScript interfaces
    │   ├── styles.css        # Design-token CSS variables, accessible styles
    │   └── components/
    │       ├── StructureViewer.tsx   # 3Dmol.js wrapper, multi-chain coloring
    │       ├── Track.tsx             # Residue track, roving keyboard, exp row
    │       ├── ConfidenceChart.tsx   # SVG chart, Q3 badge
    │       ├── ExportPanel.tsx       # PDF, coordinate, and data exports
    │       ├── ProteinKnowledge.tsx  # Sourced entry facts and similar structures
    │       ├── StructureVisualGuide.tsx # Viewer and color explanations
    │       └── LimitsNotice.tsx      # Scientific honesty notice card
    ├── e2e/
    │   ├── predictor.spec.ts        # Playwright E2E spec (5 flows)
    │   └── playwright.config.ts
    ├── vite.config.ts
    └── package.json
```

### Pluggable predictor

To swap in a trained model, implement `Predictor` in `backend/app/predictor.py`:

```python
class MyModel(Predictor):
    def predict_proba(self, sequence: str) -> list[tuple[float, float, float]]:
        # Returns list of (P_H, P_E, P_C) per residue, summing to 1.
        ...

PREDICTOR = MyModel()   # Set this in main.py
```

---

## Running tests

### Backend (pytest)

```powershell
Set-Location ss-predictor\backend
.\.venv\Scripts\pytest.exe -v
# Expected: 20 passed
```

### Frontend (type-check + build)

```powershell
Set-Location ss-predictor\frontend
npx tsc --noEmit   # Must produce no errors
npm run build      # Must produce dist/ with 0 errors
```

### Frontend (E2E — Playwright)

> **Status:** E2E spec exists at `frontend/e2e/predictor.spec.ts` but could not be executed in this environment due to a Node.js 26 / `@playwright/test` compatibility issue (`utilsBundle.yauzl` undefined — `yauzl` moved to `zipBundle.js` in some builds). Manual browser verification is the current fallback.

To attempt E2E when Playwright is fixed:
```powershell
Set-Location ss-predictor\frontend
# Start backend in a separate terminal first
npx playwright test
```

### Security audits

```powershell
# Python
Set-Location ss-predictor\backend
.\.venv\Scripts\pip-audit -s osv --timeout 60
# Expected: No known vulnerabilities found

# npm
Set-Location ss-predictor\frontend
npm audit
# Expected: found 0 vulnerabilities
```

---

## Environment variables

Backend reads from `.env` (copy from `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins |
| `RATE_LIMIT_PER_MINUTE` | `60` | Max prediction requests per IP per minute |
| `MAX_REQUEST_BYTES` | `65536` | Hard body-size limit (bytes) |
| `LOG_LEVEL` | `INFO` | Python log level |

Sequences are **never logged** (research IP protection).

---

## Scientific limits

| Claim | Reality |
|-------|---------|
| "Predicts structure" | Predicts **secondary** structure (H/E/C), not 3-D coordinates |
| Q3 score shown | Comparison of Chou–Fasman baseline to experimental DSSP. **Not** a published benchmark. No training/test split applied. |
| 3-D structure | Coordinates fetched from RCSB PDB; entries may be experimental or computational. The tool does not predict coordinates. |
| Assigned-state score | Normalized propensity output; useful for comparing model scores, but not calibrated confidence or prediction accuracy. |
| Multi-chain | All chains parsed; predictions mapped to each chain independently |
| Long sequences | Input capped at 5,000 amino-acid residues (server-side 64 KB limit on request body) |

For published Q3 baselines see: Rost (1999) doi:10.1093/protein/12.2.85 and Klausen et al. (2019) NetSurf-2.0.

---

## Contributing

1. One logical change per branch.
2. Run `pytest` (backend) and `tsc --noEmit` (frontend) before pushing.
3. Add a row to the changelog in `ANTIGRAVITY_BUILD_GUIDE.md`.
4. Scientific claims must cite a named dataset and measured evaluation — no invented numbers.
5. No secrets in code, commits, or logs.
