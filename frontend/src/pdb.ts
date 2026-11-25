import type { ChainInfo, LigandSummary, PdbData, SS, AgreementStats, Residue } from './types';

const THREE_TO_ONE: Record<string, string> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C',
  GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P',
  SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
  MSE: 'M', SEC: 'U', PYL: 'O',
};

export function isValidPdbId(id: string): boolean {
  return /^[0-9][0-9A-Za-z]{3}$/.test(id.trim());
}

/** Fetches PDB text from RCSB with local session caching and AbortSignal support. */
export async function fetchPdb(id: string, signal?: AbortSignal): Promise<string> {
  const cleanId = id.trim().toUpperCase();
  if (!isValidPdbId(cleanId)) {
    throw new Error(`"${cleanId}" is not a valid 4-character PDB ID (e.g. 1UBQ, 1MBN).`);
  }

  const cacheKey = `ssp:v1:pdb:${cleanId}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached && cached.length > 50 && cached.length <= 10_000_000 && cached.includes('\nATOM')) {
      return cached;
    }
    if (cached) sessionStorage.removeItem(cacheKey);
  } catch {
    // SessionStorage may be restricted; proceed with network fetch
  }

  let res: Response | null = null;
  try {
    res = await fetch(`https://files.rcsb.org/download/${cleanId}.pdb`, { signal });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // Fallback to backend proxy if direct RCSB fails
    try {
      res = await fetch(`/api/pdb/${cleanId}`, { signal });
    } catch {
      throw new Error(`Network error while downloading PDB entry ${cleanId}. Check your connection.`);
    }
  }

  if (!res || !res.ok) {
    // If direct returned error, attempt backend proxy
    try {
      const proxyRes = await fetch(`/api/pdb/${cleanId}`, { signal });
      if (proxyRes.ok) {
        res = proxyRes;
      }
    } catch {
      // ignore proxy fallback error
    }
  }

  if (!res || !res.ok) {
    if (res?.status === 404) {
      throw new Error(`PDB entry "${cleanId}" was not found on RCSB (HTTP 404). Check the accession ID.`);
    }
    throw new Error(`RCSB download failed for ${cleanId} (HTTP ${res?.status ?? 'Unknown'}).`);
  }

  const text = await res.text();
  try {
    sessionStorage.setItem(cacheKey, text);
  } catch {
    // Storage quota exceeded or disabled
  }
  return text;
}

interface ExperimentalRange {
  type: SS;
  chain: string;
  start: number;
  end: number;
}

/** Parses HELIX and SHEET header records from a PDB file to determine experimental secondary structure. */
function parseExperimentalRanges(lines: string[]): ExperimentalRange[] {
  const ranges: ExperimentalRange[] = [];

  for (const line of lines) {
    if (line.startsWith('HELIX')) {
      // Standard PDB HELIX format:
      // Init chain: col 19 (index 19)
      // Init seq num: cols 21-25 (indices 21-25)
      // End chain: col 31 (index 31)
      // End seq num: cols 33-37 (indices 33-37)
      try {
        const chain = line.length > 19 ? line[19].trim() : '';
        const start = parseInt(line.slice(21, 25).trim(), 10);
        const end = parseInt(line.slice(33, 37).trim(), 10);
        if (chain && !isNaN(start) && !isNaN(end)) {
          ranges.push({ type: 'H', chain, start, end });
        }
      } catch {
        // ignore malformed line
      }
    } else if (line.startsWith('SHEET')) {
      // Standard PDB SHEET format:
      // Init chain: col 21 (index 21)
      // Init seq num: cols 22-26 (indices 22-26)
      // End chain: col 32 (index 32)
      // End seq num: cols 33-37 (indices 33-37)
      try {
        const chain = line.length > 21 ? line[21].trim() : '';
        const start = parseInt(line.slice(22, 26).trim(), 10);
        const end = parseInt(line.slice(33, 37).trim(), 10);
        if (chain && !isNaN(start) && !isNaN(end)) {
          ranges.push({ type: 'E', chain, start, end });
        }
      } catch {
        // ignore malformed line
      }
    } else if (line.startsWith('ATOM')) {
      // Header lines appear before ATOM records
      break;
    }
  }

  return ranges;
}

function parseLigands(lines: string[]): LigandSummary[] {
  const waterNames = new Set(['HOH', 'DOD', 'WAT']);
  const componentNames = new Map<string, string>();
  const components = new Map<string, LigandSummary>();

  for (const line of lines) {
    if (line.startsWith('HETNAM')) {
      const id = line.slice(11, 14).trim();
      const name = line.slice(15).trim();
      if (id && name) {
        componentNames.set(id, [componentNames.get(id), name].filter(Boolean).join(' '));
      }
      continue;
    }

    if (!line.startsWith('HETATM')) continue;
    const id = line.slice(17, 20).trim();
    if (!id || waterNames.has(id) || THREE_TO_ONE[id]) continue;

    const chain = line[21]?.trim() || 'A';
    const residue = line.slice(22, 27).trim();
    const key = `${id}:${chain}:${residue}`;
    const existing = components.get(key);
    if (existing) {
      existing.atomCount++;
    } else {
      components.set(key, {
        id,
        name: componentNames.get(id) || id,
        chain,
        residue,
        atomCount: 1,
      });
    }
  }

  return [...components.values()].sort((a, b) =>
    a.id.localeCompare(b.id) || a.chain.localeCompare(b.chain) || a.residue.localeCompare(b.residue)
  );
}

/** Parses all protein chains from a PDB coordinate file. */
export function parsePdbData(pdbText: string, id: string): PdbData {
  const lines = pdbText.split('\n');
  const expRanges = parseExperimentalRanges(lines);

  // Map of chain -> { sequence, resNums, seenKeys }
  const chainMap: Record<string, { resNums: number[]; sequence: string; seenKeys: Set<string> }> = {};
  const chainOrder: string[] = [];

  for (const line of lines) {
    if (line.startsWith('ENDMDL')) {
      // Only process the first NMR/MD model to avoid duplicate residues
      break;
    }
    if (!line.startsWith('ATOM')) continue;

    // Check for alpha carbon (CA)
    const atomName = line.slice(12, 16).trim();
    if (atomName !== 'CA') continue;

    // Check alternate location indicator (cols 16-17)
    const altLoc = line[16];
    if (altLoc !== ' ' && altLoc !== 'A' && altLoc !== '1') continue;

    const chainId = line[21] ? line[21].trim() || 'A' : 'A';
    const resName = line.slice(17, 20).trim();
    const resSeqStr = line.slice(22, 26).trim();
    const insCode = line[26] || ' ';
    const resNum = parseInt(resSeqStr, 10);

    if (isNaN(resNum)) continue;

    const dedupeKey = `${resNum}${insCode}`;

    if (!chainMap[chainId]) {
      chainMap[chainId] = { resNums: [], sequence: '', seenKeys: new Set() };
      chainOrder.push(chainId);
    }

    if (chainMap[chainId].seenKeys.has(dedupeKey)) continue;
    chainMap[chainId].seenKeys.add(dedupeKey);

    const aaChar = THREE_TO_ONE[resName] || 'X';
    chainMap[chainId].sequence += aaChar;
    chainMap[chainId].resNums.push(resNum);
  }

  const chains: Record<string, ChainInfo> = {};
  const validChains: string[] = [];

  for (const c of chainOrder) {
    const raw = chainMap[c];
    if (!raw || raw.sequence.length === 0) continue;

    // Assign experimental secondary structure from parsed ranges
    const expSS: (SS | null)[] = raw.resNums.map((resNum) => {
      for (const range of expRanges) {
        if (range.chain === c && resNum >= range.start && resNum <= range.end) {
          return range.type;
        }
      }
      return 'C'; // Default to Coil if residue is in an experimental structure but outside helix/sheet
    });

    chains[c] = {
      chain: c,
      sequence: raw.sequence,
      resNums: raw.resNums,
      expSS,
    };
    validChains.push(c);
  }

  return {
    id: id.toUpperCase(),
    rawText: pdbText,
    chains,
    chainList: validChains,
    ligands: parseLigands(lines),
  };
}

/** Calculates Q3 agreement percentage between predicted and experimental secondary structures. */
export function calculateAgreement(predicted: Residue[], expSS: (SS | null)[]): AgreementStats | null {
  if (!predicted || !expSS || predicted.length === 0 || expSS.length === 0) {
    return null;
  }
  const len = Math.min(predicted.length, expSS.length);
  let matched = 0;
  let totalWithExp = 0;

  for (let i = 0; i < len; i++) {
    const exp = expSS[i];
    if (exp !== null) {
      totalWithExp++;
      if (predicted[i].label === exp) {
        matched++;
      }
    }
  }

  if (totalWithExp === 0) return null;

  return {
    matched,
    totalWithExp,
    totalResidues: len,
    percentage: Math.round((matched / totalWithExp) * 1000) / 10,
  };
}
