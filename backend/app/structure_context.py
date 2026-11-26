import asyncio
import json
import math
import re
from typing import Any

import httpx


RCSB_DATA = "https://data.rcsb.org/rest/v1/core"
RCSB_SEARCH = "https://search.rcsb.org/rcsbsearch/v2/query"
UNIPROT = "https://rest.uniprot.org/uniprotkb"
MAX_REMOTE_JSON_BYTES = 2_000_000
UNIPROT_ACCESSION = re.compile(r"^[A-Z0-9]{6,10}(?:-\d+)?$")


async def _request_json(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    async with client.stream(method, url, json=payload) as response:
        response.raise_for_status()
        content_length = response.headers.get("content-length")
        if content_length and content_length.isdigit() and int(content_length) > MAX_REMOTE_JSON_BYTES:
            raise ValueError("Remote annotation response exceeded the size limit.")
        body = bytearray()
        async for chunk in response.aiter_bytes():
            if len(body) + len(chunk) > MAX_REMOTE_JSON_BYTES:
                raise ValueError("Remote annotation response exceeded the size limit.")
            body.extend(chunk)
    data = json.loads(body)
    if not isinstance(data, dict):
        raise ValueError("Remote annotation response was not a JSON object.")
    return data


async def _get_json(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
    return await _request_json(client, "GET", url)


def _text(value: Any, fallback: str = "") -> str:
    return value.strip()[:500] if isinstance(value, str) and value.strip() else fallback


def _extract_function(data: dict[str, Any]) -> str | None:
    comments = data.get("comments")
    if not isinstance(comments, list):
        return None
    for comment in comments:
        if not isinstance(comment, dict) or comment.get("commentType") != "FUNCTION":
            continue
        texts = comment.get("texts")
        if isinstance(texts, list):
            for item in texts:
                if isinstance(item, dict):
                    value = _text(item.get("value"))
                    if value:
                        return value[:700]
    return None


async def _find_similar(
    client: httpx.AsyncClient,
    pdb_id: str,
    sequence: str,
) -> list[dict[str, Any]]:
    request = {
        "query": {
            "type": "terminal",
            "service": "sequence",
            "parameters": {
                "evalue_cutoff": 1,
                "identity_cutoff": 0.9,
                "target": "pdb_protein_sequence",
                "value": sequence,
            },
        },
        "return_type": "entry",
        "request_options": {
            "paginate": {"start": 0, "rows": 8},
            "results_content_type": ["experimental"],
        },
    }
    data = await _request_json(client, "POST", RCSB_SEARCH, request)
    result_set = data.get("result_set", []) if isinstance(data, dict) else []
    matches: list[tuple[str, float]] = []
    for item in result_set:
        if not isinstance(item, dict):
            continue
        identifier = item.get("identifier")
        score = item.get("score")
        if not isinstance(identifier, str) or not re.fullmatch(r"[0-9][A-Z0-9]{3}", identifier):
            continue
        if identifier == pdb_id:
            continue
        if isinstance(score, (int, float)) and math.isfinite(score):
            matches.append((identifier, max(0.0, min(1.0, float(score)))))
        else:
            matches.append((identifier, 0.0))
        if len(matches) == 3:
            break

    async def entry_title(identifier: str) -> str:
        try:
            entry = await _get_json(client, f"{RCSB_DATA}/entry/{identifier}")
            struct = entry.get("struct")
            return _text(struct.get("title"), identifier) if isinstance(struct, dict) else identifier
        except (httpx.HTTPError, ValueError):
            return identifier

    titles = await asyncio.gather(*(entry_title(identifier) for identifier, _ in matches))
    return [
        {"pdb_id": identifier, "title": title, "score": score}
        for (identifier, score), title in zip(matches, titles)
    ]


async def get_structure_context(
    client: httpx.AsyncClient,
    pdb_id: str,
    chain: str,
    sequence: str,
) -> dict[str, Any]:
    entry = await _get_json(client, f"{RCSB_DATA}/entry/{pdb_id}")
    warnings: list[str] = []
    entry_ids = entry.get("rcsb_entry_container_identifiers", {})
    entity_ids = entry_ids.get("polymer_entity_ids", []) if isinstance(entry_ids, dict) else []
    if not isinstance(entity_ids, list):
        entity_ids = []
    entity_ids = [str(value) for value in entity_ids[:40] if str(value).isdigit()]

    async def get_entity(entity_id: str) -> dict[str, Any] | None:
        try:
            return await _get_json(client, f"{RCSB_DATA}/polymer_entity/{pdb_id}/{entity_id}")
        except (httpx.HTTPError, ValueError):
            return None

    entities = await asyncio.gather(*(get_entity(entity_id) for entity_id in entity_ids))
    matched_entity: dict[str, Any] | None = None
    for entity in entities:
        if not isinstance(entity, dict):
            continue
        poly = entity.get("entity_poly")
        if not isinstance(poly, dict):
            continue
        strand_ids = _text(poly.get("pdbx_strand_id"))
        if chain in {part.strip() for part in strand_ids.split(",")}:
            matched_entity = entity
            break
    if matched_entity is None:
        matched_entity = next((entity for entity in entities if isinstance(entity, dict)), None)
        if matched_entity is not None:
            warnings.append("The selected chain could not be matched to an RCSB polymer entity; protein annotations may refer to another chain.")
    if entity_ids and matched_entity is None:
        warnings.append("Chain-level protein annotations are unavailable from RCSB.")

    polymer = matched_entity.get("rcsb_polymer_entity", {}) if matched_entity else {}
    source_organisms = matched_entity.get("rcsb_entity_source_organism", []) if matched_entity else []
    organism = None
    if isinstance(source_organisms, list) and source_organisms and isinstance(source_organisms[0], dict):
        organism = _text(source_organisms[0].get("scientific_name")) or _text(source_organisms[0].get("common_name")) or None
    if organism is None and matched_entity:
        generated_sources = matched_entity.get("entity_src_gen", [])
        if isinstance(generated_sources, list) and generated_sources and isinstance(generated_sources[0], dict):
            organism = _text(generated_sources[0].get("pdbx_gene_src_scientific_name")) or None

    annotations = matched_entity.get("rcsb_polymer_entity_annotation", []) if matched_entity else []
    families: list[str] = []
    accession = None
    if isinstance(annotations, list):
        for annotation in annotations:
            if not isinstance(annotation, dict):
                continue
            if annotation.get("type") in {"Pfam", "InterPro"}:
                name = _text(annotation.get("name"))
                if name and name not in families:
                    families.append(name)
        families = families[:4]

    alignments = matched_entity.get("rcsb_polymer_entity_align", []) if matched_entity else []
    if isinstance(alignments, list):
        accession = next(
            (
                alignment.get("reference_database_accession")
                for alignment in alignments
                if isinstance(alignment, dict)
                and alignment.get("reference_database_name") == "UniProt"
                and isinstance(alignment.get("reference_database_accession"), str)
                and UNIPROT_ACCESSION.fullmatch(alignment["reference_database_accession"])
            ),
            None,
        )

    function = None
    if accession:
        try:
            function = _extract_function(await _get_json(client, f"{UNIPROT}/{accession}.json"))
        except (httpx.HTTPError, ValueError):
            warnings.append("UniProt function annotation is temporarily unavailable.")

    try:
        similar = await _find_similar(client, pdb_id, sequence)
    except (httpx.HTTPError, ValueError):
        similar = []
        warnings.append("Sequence-similar structures are temporarily unavailable.")

    experiments = entry.get("exptl", [])
    method = None
    if isinstance(experiments, list):
        method = next(
            (_text(item.get("method")) for item in experiments if isinstance(item, dict) and _text(item.get("method"))),
            None,
        )
    entry_info = entry.get("rcsb_entry_info", {})
    resolutions = entry_info.get("resolution_combined", []) if isinstance(entry_info, dict) else []
    resolution = next((value for value in resolutions if isinstance(value, (int, float))), None) if isinstance(resolutions, list) else None
    keywords = entry.get("struct_keywords", {})
    struct = entry.get("struct", {})
    title = _text(struct.get("title"), pdb_id) if isinstance(struct, dict) else pdb_id
    protein_name = _text(polymer.get("pdbx_description")) or None if isinstance(polymer, dict) else None
    classification = (
        _text(keywords.get("text")) or _text(keywords.get("pdbx_keywords")) or None
        if isinstance(keywords, dict)
        else None
    )
    source = f"https://www.rcsb.org/structure/{pdb_id}"

    return {
        "pdb_id": pdb_id,
        "chain": chain,
        "title": title,
        "protein_name": protein_name,
        "organism": organism,
        "method": method,
        "resolution_angstrom": resolution,
        "classification": classification,
        "function": function,
        "uniprot_id": accession,
        "families": families,
        "similar": similar,
        "sources": {
            "rcsb": source,
            "uniprot": f"https://www.uniprot.org/uniprotkb/{accession}" if accession else None,
        },
        "warnings": warnings,
    }
