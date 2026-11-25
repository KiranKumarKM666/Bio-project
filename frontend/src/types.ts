export type SS = 'H' | 'E' | 'C';

export interface Residue {
  index: number;
  aa: string;
  label: SS;
  confidence: number;
  probs: Record<SS, number>;
}

export interface Properties {
  length: number;
  unknown: number;
  formula: string | null;
  atoms: Record<string, number>;
  mass: number | null;
  composition: Record<string, number>;
}

export interface PredictResponse {
  model: string;
  residues: Residue[];
  counts: Record<SS, number>;
  properties: Properties;
}

export interface ChainInfo {
  chain: string;
  sequence: string;
  resNums: number[];
  expSS: (SS | null)[];
}

export interface PdbData {
  id: string;
  rawText: string;
  chains: Record<string, ChainInfo>;
  chainList: string[];
  ligands: LigandSummary[];
}

export interface LigandSummary {
  id: string;
  name: string;
  chain: string;
  residue: string;
  atomCount: number;
}

export interface SimilarStructure {
  pdb_id: string;
  title: string;
  score: number;
}

export interface StructureContext {
  pdb_id: string;
  chain: string;
  title: string;
  protein_name: string | null;
  organism: string | null;
  method: string | null;
  resolution_angstrom: number | null;
  classification: string | null;
  function: string | null;
  uniprot_id: string | null;
  families: string[];
  similar: SimilarStructure[];
  sources: {
    rcsb: string;
    uniprot: string | null;
  };
  warnings: string[];
}

export interface RecentStructure {
  pdbId: string;
  chain: string;
  title: string;
  visitedAt: string;
}

export interface AgreementStats {
  matched: number;
  totalWithExp: number;
  totalResidues: number;
  percentage: number;
}

export const SS_NAME: Record<SS, string> = {
  H: 'Helix',
  E: 'Beta-strand',
  C: 'Coil',
};

// Accessible colors with high contrast against light/dark elements
export const SS_COLOR: Record<SS, string> = {
  H: '#C8374B', // Crimson red for Alpha-Helix
  E: '#D9822B', // Amber for Beta-Strand
  C: '#6B7A88', // Slate grey for Coil
};

export const SS_BG_LIGHT: Record<SS, string> = {
  H: '#FDE8EB',
  E: '#FEF3E2',
  C: '#EEF1F4',
};
