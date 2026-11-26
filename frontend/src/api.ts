import type { PredictResponse, StructureContext } from './types';

const REQUEST_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout<T>(
  signal: AbortSignal | undefined,
  request: (requestSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    abortFromCaller();
  } else {
    signal?.addEventListener('abort', abortFromCaller, { once: true });
  }
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await request(controller.signal);
  } catch (error: unknown) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error('The request timed out after 10 seconds. Please try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

/** Computes a simple fast hash for sequence caching without external crypto libraries. */
function hashString(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function isPredictResponse(value: unknown): value is PredictResponse {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<PredictResponse>;
  if (typeof data.model !== 'string') return false;
  if (!Array.isArray(data.residues) || data.residues.length === 0) return false;
  if (!data.counts || typeof data.counts !== 'object') return false;
  if (!data.properties || typeof data.properties !== 'object') return false;
  return data.residues.every((residue) => {
    if (!residue || typeof residue !== 'object') return false;
    if (!Number.isInteger(residue.index) || typeof residue.aa !== 'string') return false;
    if (!['H', 'E', 'C'].includes(residue.label)) return false;
    if (typeof residue.confidence !== 'number') return false;
    if (!residue.probs || typeof residue.probs !== 'object') return false;
    return ['H', 'E', 'C'].every((label) =>
      typeof residue.probs[label as 'H' | 'E' | 'C'] === 'number'
    );
  });
}

function isStructureContext(value: unknown): value is StructureContext {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<StructureContext>;
  const sources = context.sources as Partial<StructureContext['sources']> | undefined;
  const isNullableString = (item: unknown) => item === null || typeof item === 'string';
  return typeof context.pdb_id === 'string'
    && /^[0-9][0-9A-Z]{3}$/.test(context.pdb_id)
    && typeof context.chain === 'string'
    && typeof context.title === 'string'
    && isNullableString(context.protein_name)
    && isNullableString(context.organism)
    && isNullableString(context.method)
    && (context.resolution_angstrom === null || (typeof context.resolution_angstrom === 'number' && Number.isFinite(context.resolution_angstrom)))
    && isNullableString(context.classification)
    && isNullableString(context.function)
    && isNullableString(context.uniprot_id)
    && Array.isArray(context.families)
    && context.families.every((family) => typeof family === 'string')
    && Array.isArray(context.similar)
    && context.similar.every((match) => Boolean(match)
      && typeof match.pdb_id === 'string'
      && /^[0-9][0-9A-Z]{3}$/.test(match.pdb_id)
      && typeof match.title === 'string'
      && typeof match.score === 'number'
      && Number.isFinite(match.score))
    && Array.isArray(context.warnings)
    && context.warnings.every((warning) => typeof warning === 'string')
    && typeof sources?.rcsb === 'string'
    && isNullableString(sources.uniprot);
}

async function getApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body.detail === 'string') return body.detail;
    if (typeof body.message === 'string') return body.message;
  } catch {
    // Keep the explicit caller-provided message when the server does not return JSON.
  }
  return fallback;
}

/** Calls the prediction API with session caching and AbortSignal support. */
export async function predict(sequence: string, signal?: AbortSignal): Promise<PredictResponse> {
  const cleanSeq = sequence.trim();
  if (!cleanSeq) {
    throw new Error('Please enter or paste an amino-acid sequence.');
  }

  const cacheKey = `ssp:v1:pred:chou-fasman:${hashString(cleanSeq)}:${cleanSeq.length}`;

  // Check sessionStorage cache to prevent duplicate computation on page refresh
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed: unknown = JSON.parse(cached);
      if (isPredictResponse(parsed)) return parsed;
      sessionStorage.removeItem(cacheKey);
    }
  } catch {
    // Storage restricted or corrupt; proceed with network request
  }

  return fetchWithTimeout(signal, async (requestSignal) => {
    let res: Response;
    try {
      res = await fetch('/api/predict', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ sequence: cleanSeq }),
        signal: requestSignal,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      throw new Error('Cannot connect to the prediction server. Please verify the FastAPI backend is running on port 8000.');
    }

    if (!res.ok) {
      let msg = `Prediction failed with status ${res.status}.`;
      try {
        const body = await res.json();
        if (typeof body.detail === 'string') {
          msg = body.detail;
        } else if (Array.isArray(body.detail) && body.detail[0]?.msg) {
          msg = String(body.detail[0].msg).replace(/^Value error, /, '');
        } else if (typeof body.message === 'string') {
          msg = body.message;
        }
      } catch {
        // Keep the status-based message when the server does not return JSON.
      }
      throw new Error(msg);
    }

    const data: PredictResponse = await res.json();

    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(data));
    } catch {
      // Storage full or unavailable
    }

    return data;
  });
}

export async function fetchStructureContext(
  pdbId: string,
  chain: string,
  sequence: string,
  signal?: AbortSignal,
): Promise<StructureContext> {
  const cleanId = pdbId.trim().toUpperCase();
  const cacheKey = `ssp:v1:structure-context:${cleanId}:${chain}:${hashString(sequence)}`;

  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed: unknown = JSON.parse(cached);
      if (isStructureContext(parsed) && parsed.pdb_id === cleanId && parsed.chain === chain) return parsed;
      sessionStorage.removeItem(cacheKey);
    }
  } catch {
    // Storage restrictions or corrupt cache do not block RCSB lookups.
  }

  return fetchWithTimeout(signal, async (requestSignal) => {
    let response: Response;
    try {
      response = await fetch('/api/structure/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ pdb_id: cleanId, chain, sequence }),
        signal: requestSignal,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new Error('Could not reach the structure-annotation service. The PDB viewer is still available.');
    }

    if (!response.ok) {
      throw new Error(await getApiError(response, `Structure annotations failed (${response.status}).`));
    }
    const data: unknown = await response.json();
    if (!isStructureContext(data)) {
      throw new Error('The structure-annotation service returned an unexpected response.');
    }
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(data));
    } catch {
      // Storage quota or privacy settings do not block the current context.
    }
    return data;
  });
}

export async function fetchStructureFile(
  pdbId: string,
  format: 'pdb' | 'cif',
  signal?: AbortSignal,
): Promise<Blob> {
  const cleanId = pdbId.trim().toUpperCase();
  if (!/^[0-9][0-9A-Z]{3}$/.test(cleanId)) {
    throw new Error('A valid four-character PDB ID is required for structure download.');
  }

  return fetchWithTimeout(signal, async (requestSignal) => {
    let response: Response;
    try {
      response = await fetch(`/api/pdb/${cleanId}?format=${format}`, { signal: requestSignal });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new Error(`Could not download the ${format === 'cif' ? 'mmCIF' : 'PDB'} structure. Check the connection and try again.`);
    }
    if (!response.ok) {
      throw new Error(await getApiError(response, `Structure download failed (${response.status}).`));
    }
    return response.blob();
  });
}
