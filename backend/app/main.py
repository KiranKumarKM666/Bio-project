import os
import re
import time
import uuid
import logging
from pathlib import Path
from collections import Counter, defaultdict
from typing import Dict, Any, Literal

import httpx
from fastapi import FastAPI, Request, Response, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ConfigDict, field_validator

from .predictor import ChouFasmanBaseline, Predictor, predict
from .properties import analyze
from .structure_context import get_structure_context

# Configure logging (Never log sequences or request bodies!)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("api")

PREDICTOR: Predictor = ChouFasmanBaseline()  # Pluggable Predictor interface
MAX_LEN = 5000
MAX_BODY_BYTES = 65536  # 64 KB limit
ALLOWED = set("ACDEFGHIKLMNPQRSTVWYX")

app = FastAPI(
    title="Secondary Structure API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

ENVIRONMENT = os.environ.get("ENVIRONMENT", "development").strip().lower()

# CORS Configuration from Environment
cors_origins_env = os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173")
allowed_origins = [orig.strip() for orig in cors_origins_env.split(",") if orig.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)

# In-memory Rate Limiting State (60 requests per minute per IP)
RATE_LIMIT_MAX = 60
RATE_LIMIT_WINDOW = 60  # seconds
ip_request_timestamps: Dict[str, list[float]] = defaultdict(list)


# --- Middlewares ---

@app.middleware("http")
async def security_and_tracing_middleware(request: Request, call_next):
    # 1. Enforce payload size limit
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_BODY_BYTES:
                return JSONResponse(
                    status_code=getattr(status, "HTTP_413_CONTENT_TOO_LARGE", 413),
                    content={"error": "PayloadTooLarge", "detail": f"Request body exceeds {MAX_BODY_BYTES} bytes."},
                )
        except ValueError:
            pass

    # 2. Rate limiting for /api/predict
    if request.url.path.endswith("/predict") and request.method == "POST":
        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        window_start = now - RATE_LIMIT_WINDOW
        
        # Prune old timestamps
        timestamps = [ts for ts in ip_request_timestamps[client_ip] if ts > window_start]
        if len(timestamps) >= RATE_LIMIT_MAX:
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"error": "TooManyRequests", "detail": "Rate limit exceeded. Maximum 60 requests per minute."},
                headers={"Retry-After": "60"},
            )
        timestamps.append(now)
        ip_request_timestamps[client_ip] = timestamps

    # 3. Request ID & Tracing
    req_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    start_time = time.perf_counter()

    try:
        response: Response = await call_next(request)
    except Exception as exc:
        logger.error(f"req_id={req_id} method={request.method} path={request.url.path} error=UnhandledException")
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "InternalServerError", "detail": "An unexpected server error occurred."},
            headers={
                "X-Request-ID": req_id,
                "X-Content-Type-Options": "nosniff",
            },
        )

    duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
    # Never log request body or sequence to protect confidential research IP!
    logger.info(f"req_id={req_id} method={request.method} path={request.url.path} status={response.status_code} duration_ms={duration_ms}")

    # 4. Defensive Security Headers
    response.headers["X-Request-ID"] = req_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store, max-age=0"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    response.headers["Permissions-Policy"] = "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
    if ENVIRONMENT == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

    return response


# --- Exception Handlers for Uniform Error Shape ---

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    msg = errors[0].get("msg", "Invalid request input.") if errors else "Validation error."
    msg = re.sub(r"^Value error, ", "", msg)
    return JSONResponse(
        status_code=getattr(status, "HTTP_422_UNPROCESSABLE_CONTENT", 422),
        content={"error": "ValidationError", "detail": msg},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": "HTTPException", "detail": exc.detail},
    )


# --- Request & Response Models ---

class PredictRequest(BaseModel):
    sequence: str = Field(..., min_length=1, max_length=MAX_LEN)

    # Disallow unknown / unexpected JSON fields
    model_config = ConfigDict(extra="forbid")

    @field_validator("sequence")
    @classmethod
    def clean(cls, v: str) -> str:
        # Strip FASTA header lines and interior whitespace
        lines = [ln for ln in v.strip().splitlines() if not ln.startswith(">")]
        seq = re.sub(r"\s+", "", "".join(lines)).upper()
        if not seq:
            raise ValueError("Sequence is empty. Paste amino-acid letters or a FASTA record.")
        if len(seq) > MAX_LEN:
            raise ValueError(f"Sequence has {len(seq)} residues; the limit is {MAX_LEN}.")
        bad = sorted(set(seq) - ALLOWED)
        if bad:
            raise ValueError(
                f"Unsupported characters: {', '.join(bad)}. Use standard amino-acid letters (X for unknown)."
            )
        return seq


class StructureContextRequest(BaseModel):
    pdb_id: str = Field(..., min_length=4, max_length=4)
    chain: str = Field(..., min_length=1, max_length=4)
    sequence: str = Field(..., min_length=1, max_length=MAX_LEN)

    model_config = ConfigDict(extra="forbid")

    @field_validator("pdb_id")
    @classmethod
    def clean_pdb_id(cls, value: str) -> str:
        clean_id = value.strip().upper()
        if not PDB_REGEX.fullmatch(clean_id):
            raise ValueError("PDB ID must be four characters and start with a digit.")
        return clean_id

    @field_validator("chain")
    @classmethod
    def clean_chain(cls, value: str) -> str:
        clean_chain = value.strip()
        if not clean_chain or len(clean_chain) > 4 or not clean_chain.isprintable():
            raise ValueError("Chain must contain 1 to 4 printable characters.")
        return clean_chain

    @field_validator("sequence")
    @classmethod
    def clean_structure_sequence(cls, value: str) -> str:
        sequence = re.sub(r"\s+", "", value).upper()
        if not sequence:
            raise ValueError("Sequence is empty.")
        bad = sorted(set(sequence) - ALLOWED)
        if bad:
            raise ValueError(f"Unsupported amino-acid characters: {', '.join(bad)}.")
        return sequence


# --- API Routes ---

@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "model": PREDICTOR.name,
        "version": "1.0.0",
    }


@app.get("/api/predict")
@app.post("/api/predict")
@app.post("/api/v1/predict")
def predict_endpoint(req: PredictRequest) -> dict:
    residues = predict(req.sequence, PREDICTOR)
    counts = Counter(r["label"] for r in residues)
    return {
        "model": PREDICTOR.name,
        "residues": residues,
        "counts": {k: counts.get(k, 0) for k in "HEC"},
        "properties": analyze(req.sequence),
    }


PDB_REGEX = re.compile(r"^[0-9][0-9A-Za-z]{3}$")
PDB_CACHE_DIR = Path(__file__).resolve().parent.parent / "cache" / "pdb"


@app.get("/api/pdb/{pdb_id}")
async def get_pdb_file(
    pdb_id: str,
    file_format: Literal["pdb", "cif"] = Query(default="pdb", alias="format"),
):
    clean_id = pdb_id.strip().upper()
    if not PDB_REGEX.match(clean_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid PDB ID format: '{pdb_id}'. Must be 4 alphanumeric characters starting with a digit (e.g. 1UBQ).",
        )

    PDB_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = PDB_CACHE_DIR / f"{clean_id}.{file_format}"
    if cache_file.exists():
        try:
            return PlainTextResponse(
                content=cache_file.read_text(encoding="utf-8"),
                media_type="chemical/x-pdb" if file_format == "pdb" else "chemical/x-cif",
                headers={"Content-Disposition": f'attachment; filename="{clean_id}.{file_format}"'},
            )
        except Exception:
            pass

    rcsb_url = f"https://files.rcsb.org/download/{clean_id}.{file_format}"
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(rcsb_url)
            if resp.status_code == 404:
                raise HTTPException(status_code=404, detail=f"PDB structure '{clean_id}' was not found on RCSB.")
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=f"RCSB returned error code {resp.status_code}")
            pdb_content = resp.text
            if len(resp.content) > 10_000_000:
                raise HTTPException(status_code=413, detail="Structure file exceeds 10 MB limit.")
            cache_file.write_text(pdb_content, encoding="utf-8")
            return PlainTextResponse(
                content=pdb_content,
                media_type="chemical/x-pdb" if file_format == "pdb" else "chemical/x-cif",
                headers={"Content-Disposition": f'attachment; filename="{clean_id}.{file_format}"'},
            )
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch PDB from RCSB: {str(exc)}")


@app.post("/api/structure/context")
async def structure_context(req: StructureContextRequest) -> dict:
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=False) as client:
            return await get_structure_context(client, req.pdb_id, req.chain, req.sequence)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail=f"RCSB metadata for '{req.pdb_id}' was not found.")
        logger.warning("RCSB structure context unavailable: upstream_status=%s", exc.response.status_code)
        raise HTTPException(status_code=502, detail="Structure annotations are temporarily unavailable from RCSB.")
    except (httpx.RequestError, ValueError):
        logger.warning("RCSB structure context unavailable: upstream_request_failed")
        raise HTTPException(status_code=502, detail="Structure annotations are temporarily unavailable from RCSB.")


# Mount built frontend dist for production static serving
frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")

