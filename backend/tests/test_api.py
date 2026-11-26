import pytest
from fastapi.testclient import TestClient

from app import main
from app.main import app, ip_request_timestamps
from app.properties import analyze

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_rate_limits():
    """Reset rate limiter state before each test."""
    ip_request_timestamps.clear()


def labels(seq: str) -> str:
    r = client.post("/api/predict", json={"sequence": seq})
    assert r.status_code == 200
    return "".join(x["label"] for x in r.json()["residues"])


def test_health_endpoint():
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert "model" in data
    assert data["version"] == "1.0.0"


def test_railway_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_production_health_headers(monkeypatch):
    monkeypatch.setattr(main, "ENVIRONMENT", "production")
    response = client.get("/health")
    assert response.status_code == 200
    assert response.headers["Strict-Transport-Security"] == "max-age=31536000; includeSubDomains"
    assert "script-src 'self'" in response.headers["Content-Security-Policy"]


def test_unhandled_exception_returns_clean_error(monkeypatch):
    def fail_prediction(sequence, predictor):
        raise RuntimeError("sensitive internal detail")

    monkeypatch.setattr(main, "predict", fail_prediction)
    response = client.post(
        "/api/predict",
        json={"sequence": "AAAA"},
        headers={"X-Request-ID": "test-request-123"},
    )

    assert response.status_code == 500
    assert response.json() == {
        "error": "InternalServerError",
        "detail": "An unexpected server error occurred.",
        "request_id": "test-request-123",
    }
    assert "sensitive internal detail" not in response.text


def test_poly_ala_is_helix():
    assert set(labels("A" * 20)) == {"H"}


def test_poly_val_is_strand():
    assert set(labels("V" * 20)) == {"E"}


def test_gly_pro_is_coil():
    assert set(labels("GPNGPNGPNGPN")) == {"C"}


def test_fasta_and_confidence_range():
    r = client.post("/api/predict", json={"sequence": ">header_comment\nmkvl\nAAEE"})
    assert r.status_code == 200
    body = r.json()
    assert len(body["residues"]) == 8
    assert all(0 <= x["confidence"] <= 1 for x in body["residues"])
    assert sum(body["counts"].values()) == 8


def test_v1_alias_endpoint():
    r = client.post("/api/v1/predict", json={"sequence": "AAAA"})
    assert r.status_code == 200
    assert len(r.json()["residues"]) == 4


def test_rejects_bad_characters_and_empty():
    r_bad = client.post("/api/predict", json={"sequence": "AB1"})
    assert r_bad.status_code == 422
    assert r_bad.json()["error"] == "ValidationError"

    r_empty = client.post("/api/predict", json={"sequence": "  "})
    assert r_empty.status_code == 422
    assert r_empty.json()["error"] == "ValidationError"


def test_rejects_forbidden_extra_fields():
    r = client.post("/api/predict", json={"sequence": "AAAA", "malicious_extra": "hack"})
    assert r.status_code == 422
    assert r.json()["error"] == "ValidationError"


def test_rejects_sequences_over_max_length():
    r = client.post("/api/predict", json={"sequence": "A" * 5001})
    assert r.status_code == 422
    assert r.json()["error"] == "ValidationError"


def test_cors_rejects_unknown_origin():
    r = client.post(
        "/api/predict",
        json={"sequence": "AAAA"},
        headers={"Origin": "https://untrusted.example"},
    )
    assert r.status_code == 200
    assert "Access-Control-Allow-Origin" not in r.headers


def test_security_headers_present():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["Referrer-Policy"] == "no-referrer"
    assert r.headers["X-Frame-Options"] == "DENY"
    csp = r.headers["Content-Security-Policy"]
    assert "default-src 'self'" in csp
    assert "script-src 'self'" in csp
    assert "style-src 'self' 'unsafe-inline'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "connect-src 'self'" in csp
    assert "files.rcsb.org" not in csp
    assert "X-Request-ID" in r.headers


def test_payload_too_large_rejection():
    # Payload > 64 KB (65536 bytes)
    huge_body = "A" * 70000
    r = client.post(
        "/api/predict",
        headers={"Content-Length": str(len(huge_body))},
        content=huge_body,
    )
    assert r.status_code == 413
    assert r.json()["error"] == "PayloadTooLarge"


def test_payload_too_large_without_content_length():
    response = client.post(
        "/api/predict",
        headers={"Transfer-Encoding": "chunked"},
        content="A" * 70000,
    )
    assert response.status_code == 413
    assert response.json()["error"] == "PayloadTooLarge"


def test_rate_limiting():
    # 60 requests allowed, 61st triggers 429
    for _ in range(60):
        res = client.post("/api/predict", json={"sequence": "AAAA"})
        assert res.status_code == 200

    over_limit = client.post("/api/predict", json={"sequence": "AAAA"})
    assert over_limit.status_code == 429
    assert over_limit.json()["error"] == "TooManyRequests"


def test_rate_limiting_covers_external_structure_routes(monkeypatch):
    monkeypatch.setattr(main, "RATE_LIMIT_MAX", 1)

    first = client.get("/api/pdb/INVALID")
    second = client.get("/api/pdb/INVALID")

    assert first.status_code == 400
    assert second.status_code == 429
    assert second.json()["request_id"] == second.headers["X-Request-ID"]


def test_glycine_formula_and_mass():
    p = analyze("G")  # free glycine: C2H5NO2, 75.07 Da
    assert p["formula"] == "C2H5NO2"
    assert abs(p["mass"] - 75.07) < 0.01


def test_gly_gly_formula():
    assert analyze("GG")["formula"] == "C4H8N2O3"


def test_pdb_proxy_rejects_invalid_id():
    res = client.get("/api/pdb/INVALID_ID_TOO_LONG")
    assert res.status_code == 400
    assert "Invalid PDB ID format" in res.json()["detail"]


def test_pdb_proxy_rejects_numeric_start_missing():
    res = client.get("/api/pdb/UBQ1")
    assert res.status_code == 400


def test_structure_context_returns_validated_sourced_metadata(monkeypatch):
    async def fake_context(client, pdb_id, chain, sequence):
        return {
            "pdb_id": pdb_id,
            "chain": chain,
            "title": "Example structure",
            "protein_name": "Example protein",
            "organism": None,
            "method": "X-ray diffraction",
            "resolution_angstrom": 1.8,
            "classification": None,
            "function": None,
            "uniprot_id": None,
            "families": [],
            "similar": [{"pdb_id": "2XYZ", "title": "Related entry", "score": 0.9}],
            "sources": {"rcsb": "https://www.rcsb.org/structure/1ABC", "uniprot": None},
            "warnings": ["UniProt annotation unavailable."],
        }

    monkeypatch.setattr(main, "get_structure_context", fake_context)
    response = client.post(
        "/api/structure/context",
        json={"pdb_id": "1abc", "chain": "A", "sequence": "ACDE"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["pdb_id"] == "1ABC"
    assert data["chain"] == "A"
    assert data["similar"][0]["score"] == 0.9
    assert data["warnings"] == ["UniProt annotation unavailable."]


def test_structure_context_rejects_invalid_identifier_and_sequence():
    invalid_id = client.post(
        "/api/structure/context",
        json={"pdb_id": "UBQ1", "chain": "A", "sequence": "ACDE"},
    )
    invalid_sequence = client.post(
        "/api/structure/context",
        json={"pdb_id": "1ABC", "chain": "A", "sequence": "AB"},
    )

    assert invalid_id.status_code == 422
    assert invalid_sequence.status_code == 422


def test_pdb_proxy_supports_cached_mmcif_and_rejects_unknown_format(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "PDB_CACHE_DIR", tmp_path)
    (tmp_path / "1ABC.cif").write_text("data_1ABC\n", encoding="utf-8")

    response = client.get("/api/pdb/1ABC?format=cif")
    invalid_format = client.get("/api/pdb/1ABC?format=unknown")

    assert response.status_code == 200
    assert response.text == "data_1ABC\n"
    assert response.headers["Content-Disposition"] == 'attachment; filename="1ABC.cif"'
    assert invalid_format.status_code == 422

