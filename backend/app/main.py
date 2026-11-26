import asyncio
import os
import re
import time
import uuid
import logging
from pathlib import Path
from collections import Counter, OrderedDict
from typing import Literal
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, Request, Response, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ConfigDict, field_validator
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .predictor import ChouFasmanBaseline, Predictor, predict
from .properties import analyze
from .structure_context import get_structure_context

ENVIRONMENT = os.environ.get("ENVIRONMENT", "development").strip().lower()
LOG_LEVEL_NAME = os.environ.get("LOG_LEVEL", "INFO").strip().upper()
if LOG_LEVEL_NAME not in {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}:
    raise RuntimeError("LOG_LEVEL must be one of CRITICAL, ERROR, WARNING, INFO, or DEBUG.")
if ENVIRONMENT == "production" and LOG_LEVEL_NAME == "DEBUG":
    LOG_LEVEL_NAME = "INFO"

# Never log sequences or request bodies; production logging is never set to DEBUG.
logging.basicConfig(level=getattr(logging, LOG_LEVEL_NAME), format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("api")

PREDICTOR: Predictor = ChouFasmanBaseline()  # Pluggable Predictor interface
MAX_LEN = 5000
ALLOWED = set("ACDEFGHIKLMNPQRSTVWYX")


def _positive_int_setting(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a positive integer.") from exc
    if parsed <= 0:
        raise RuntimeError(f"{name} must be a positive integer.")
    return parsed


MAX_BODY_BYTES = _positive_int_setting("MAX_REQUEST_BYTES", 65536)
RATE_LIMIT_MAX = _positive_int_setting("RATE_LIMIT_PER_MINUTE", 60)
if MAX_BODY_BYTES > 1_048_576:
    raise RuntimeError("MAX_REQUEST_BYTES cannot exceed 1048576 bytes.")
MAX_RATE_LIMIT_CLIENTS = 10000
RATE_LIMIT_WINDOW = 60
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; "
    "frame-ancestors 'none'; script-src 'self' 'unsafe-eval'; "
    "style-src 'self' 'unsafe-inline'; font-src 'self' data:; "
    "connect-src 'self'; "
    "img-src 'self' data: blob:; worker-src 'self' blob:"
)


def _security_headers(req_id: str) -> dict[str, str]:
    headers = {
        "X-Request-ID": req_id,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store, max-age=0",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": CONTENT_SECURITY_POLICY,
        "Permissions-Policy": (
            "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), "
            "microphone=(), payment=(), usb=()"
        ),
    }
    if ENVIRONMENT == "production":
        headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return headers


app = FastAPI(
    title="Secondary Structure API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

def _cors_origins() -> list[str]:
    configured = os.environ.get("CORS_ORIGINS")
    origins = (
        [origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()]
        if configured is not None
        else (
            []
            if ENVIRONMENT == "production"
            else ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173"]
        )
    )
    railway_domain = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "").strip()
    if railway_domain:
        railway_origin = railway_domain.rstrip("/")
        if "://" not in railway_origin:
            railway_origin = f"https://{railway_origin}"
        origins.append(railway_origin)

    for origin in origins:
        parsed = urlsplit(origin)
        if (
            origin == "*"
            or parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            raise RuntimeError("CORS_ORIGINS must contain only explicit HTTP(S) origins.")
    return list(dict.fromkeys(origins))


allowed_origins = _cors_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)

ip_request_timestamps: OrderedDict[str, list[float]] = OrderedDict()


# --- Middlewares ---

@app.middleware("http")
async def security_and_tracing_middleware(request: Request, call_next):
    req_id = getattr(request.state, "request_id", request.headers.get("X-Request-ID", ""))
    if not REQUEST_ID_PATTERN.fullmatch(req_id):
        req_id = str(uuid.uuid4())
    request.state.request_id = req_id
    start_time = time.perf_counter()

    def secure(response: Response) -> Response:
        response.headers.update(_security_headers(req_id))
        return response

    path = request.url.path
    rate_limited = (
        (path in {"/api/predict", "/api/v1/predict"} and request.method == "POST")
        or (path == "/api/structure/context" and request.method == "POST")
        or (path.startswith("/api/pdb/") and request.method == "GET")
    )
    if rate_limited:
        client_ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        window_start = now - RATE_LIMIT_WINDOW
        timestamps = [ts for ts in ip_request_timestamps.get(client_ip, []) if ts > window_start]
        if len(timestamps) >= RATE_LIMIT_MAX:
            ip_request_timestamps[client_ip] = timestamps
            ip_request_timestamps.move_to_end(client_ip)
            return secure(JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "error": "TooManyRequests",
                    "detail": f"Rate limit exceeded. Maximum {RATE_LIMIT_MAX} requests per minute.",
                    "request_id": req_id,
                },
                headers={"Retry-After": "60"},
            ))
        timestamps.append(now)
        if client_ip not in ip_request_timestamps and len(ip_request_timestamps) >= MAX_RATE_LIMIT_CLIENTS:
            ip_request_timestamps.popitem(last=False)
        ip_request_timestamps[client_ip] = timestamps
        ip_request_timestamps.move_to_end(client_ip)

    try:
        response: Response = await call_next(request)
    except Exception as exc:
        response = await unhandled_exception_handler(request, exc)
    duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
    logger.info(
        "req_id=%s method=%s path=%s status=%s duration_ms=%s",
        req_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return secure(response)


# --- Exception Handlers for Uniform Error Shape ---

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    msg = errors[0].get("msg", "Invalid request input.") if errors else "Validation error."
    msg = re.sub(r"^Value error, ", "", msg)
    return JSONResponse(
        status_code=getattr(status, "HTTP_422_UNPROCESSABLE_CONTENT", 422),
        content={
            "error": "ValidationError",
            "detail": msg,
            "request_id": getattr(request.state, "request_id", ""),
        },
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": "HTTPException",
            "detail": exc.detail,
            "request_id": getattr(request.state, "request_id", ""),
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    req_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    logger.error(
        "req_id=%s method=%s path=%s error=UnhandledException exception_type=%s",
        req_id,
        request.method,
        request.url.path,
        type(exc).__name__,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "InternalServerError",
            "detail": "An unexpected server error occurred.",
            "request_id": req_id,
        },
        headers={"X-Request-ID": req_id},
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


@app.get("/health")
def railway_health() -> dict:
    return {"status": "ok"}


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
MAX_PDB_FILE_BYTES = 10_000_000


def _read_cached_pdb(path: Path) -> str:
    with path.open("rb") as cached_file:
        content = cached_file.read(MAX_PDB_FILE_BYTES + 1)
    if len(content) > MAX_PDB_FILE_BYTES:
        raise ValueError("Cached structure file exceeds the size limit.")
    return content.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")


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

    try:
        await asyncio.to_thread(PDB_CACHE_DIR.mkdir, parents=True, exist_ok=True)
    except OSError:
        logger.warning("PDB cache directory is unavailable")
    cache_file = PDB_CACHE_DIR / f"{clean_id}.{file_format}"
    try:
        cached_content = await asyncio.to_thread(_read_cached_pdb, cache_file)
    except FileNotFoundError:
        cached_content = None
    except (OSError, UnicodeDecodeError, ValueError):
        logger.warning("PDB cache read failed for pdb_id=%s", clean_id)
        cached_content = None
    if cached_content is not None:
        return PlainTextResponse(
            content=cached_content,
            media_type="chemical/x-pdb" if file_format == "pdb" else "chemical/x-cif",
            headers={"Content-Disposition": f'attachment; filename="{clean_id}.{file_format}"'},
        )

    rcsb_url = f"https://files.rcsb.org/download/{clean_id}.{file_format}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=3.0)) as client:
            async with client.stream("GET", rcsb_url) as resp:
                if resp.status_code == 404:
                    raise HTTPException(status_code=404, detail=f"PDB structure '{clean_id}' was not found on RCSB.")
                resp.raise_for_status()
                chunks: list[bytes] = []
                body_size = 0
                async for chunk in resp.aiter_bytes():
                    body_size += len(chunk)
                    if body_size > MAX_PDB_FILE_BYTES:
                        raise HTTPException(status_code=413, detail="Structure file exceeds 10 MB limit.")
                    chunks.append(chunk)
                pdb_content = b"".join(chunks).decode("utf-8")
        try:
            await asyncio.to_thread(cache_file.write_text, pdb_content, encoding="utf-8")
        except OSError:
            logger.warning("PDB cache write failed for pdb_id=%s", clean_id)
        return PlainTextResponse(
            content=pdb_content,
            media_type="chemical/x-pdb" if file_format == "pdb" else "chemical/x-cif",
            headers={"Content-Disposition": f'attachment; filename="{clean_id}.{file_format}"'},
        )
    except httpx.HTTPStatusError as exc:
        logger.warning("RCSB structure request failed: upstream_status=%s", exc.response.status_code)
        raise HTTPException(status_code=502, detail="RCSB could not provide this structure right now.") from exc
    except (httpx.RequestError, UnicodeDecodeError) as exc:
        logger.warning("RCSB structure request failed: request_error=%s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="The structure service is temporarily unavailable.") from exc


@app.post("/api/structure/context")
async def structure_context(req: StructureContextRequest) -> dict:
    try:
        async with asyncio.timeout(10.0):
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(10.0, connect=3.0),
                follow_redirects=False,
            ) as client:
                return await get_structure_context(client, req.pdb_id, req.chain, req.sequence)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail=f"RCSB metadata for '{req.pdb_id}' was not found.")
        logger.warning("RCSB structure context unavailable: upstream_status=%s", exc.response.status_code)
        raise HTTPException(status_code=502, detail="Structure annotations are temporarily unavailable from RCSB.")
    except (httpx.RequestError, ValueError, TimeoutError):
        logger.warning("RCSB structure context unavailable: upstream_request_failed")
        raise HTTPException(status_code=502, detail="Structure annotations are temporarily unavailable from RCSB.")


class RequestSizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        req_id = headers.get(b"x-request-id", b"").decode("latin-1")
        if not REQUEST_ID_PATTERN.fullmatch(req_id):
            req_id = str(uuid.uuid4())
        scope.setdefault("state", {})["request_id"] = req_id

        async def reject(status_code: int, error: str, detail: str) -> None:
            response = JSONResponse(
                status_code=status_code,
                content={"error": error, "detail": detail, "request_id": req_id},
                headers=_security_headers(req_id),
            )
            await response(scope, receive, send)

        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                declared_length = int(content_length)
            except ValueError:
                await reject(status.HTTP_400_BAD_REQUEST, "InvalidContentLength", "Content-Length must be a non-negative integer.")
                return
            if declared_length < 0:
                await reject(status.HTTP_400_BAD_REQUEST, "InvalidContentLength", "Content-Length must be a non-negative integer.")
                return
            if declared_length > self.max_body_bytes:
                await reject(
                    getattr(status, "HTTP_413_CONTENT_TOO_LARGE", 413),
                    "PayloadTooLarge",
                    f"Request body exceeds {self.max_body_bytes} bytes.",
                )
                return

        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] != "http.request":
                continue
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > self.max_body_bytes:
                await reject(
                    getattr(status, "HTTP_413_CONTENT_TOO_LARGE", 413),
                    "PayloadTooLarge",
                    f"Request body exceeds {self.max_body_bytes} bytes.",
                )
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break

        replayed = False

        async def replay_body() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay_body, send)


# Mount built frontend dist for production static serving
frontend_dist = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")

app.add_middleware(RequestSizeLimitMiddleware, max_body_bytes=MAX_BODY_BYTES)

