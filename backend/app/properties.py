"""Chemical formula and mass for a polypeptide chain (residue formulas + one water)."""
from collections import Counter

# Elemental composition of each residue as it sits inside a chain (amino acid minus H2O).
RESIDUE_FORMULA: dict[str, dict[str, int]] = {
    "G": {"C": 2, "H": 3, "N": 1, "O": 1},
    "A": {"C": 3, "H": 5, "N": 1, "O": 1},
    "S": {"C": 3, "H": 5, "N": 1, "O": 2},
    "P": {"C": 5, "H": 7, "N": 1, "O": 1},
    "V": {"C": 5, "H": 9, "N": 1, "O": 1},
    "T": {"C": 4, "H": 7, "N": 1, "O": 2},
    "C": {"C": 3, "H": 5, "N": 1, "O": 1, "S": 1},
    "L": {"C": 6, "H": 11, "N": 1, "O": 1},
    "I": {"C": 6, "H": 11, "N": 1, "O": 1},
    "N": {"C": 4, "H": 6, "N": 2, "O": 2},
    "D": {"C": 4, "H": 5, "N": 1, "O": 3},
    "Q": {"C": 5, "H": 8, "N": 2, "O": 2},
    "K": {"C": 6, "H": 12, "N": 2, "O": 1},
    "E": {"C": 5, "H": 7, "N": 1, "O": 3},
    "M": {"C": 5, "H": 9, "N": 1, "O": 1, "S": 1},
    "H": {"C": 6, "H": 7, "N": 3, "O": 1},
    "F": {"C": 9, "H": 9, "N": 1, "O": 1},
    "R": {"C": 6, "H": 12, "N": 4, "O": 1},
    "Y": {"C": 9, "H": 9, "N": 1, "O": 2},
    "W": {"C": 11, "H": 10, "N": 2, "O": 1},
}
ATOMIC_MASS = {"C": 12.011, "H": 1.008, "N": 14.007, "O": 15.999, "S": 32.06}
ELEMENT_ORDER = ("C", "H", "N", "O", "S")


def analyze(seq: str) -> dict:
    counts = Counter(seq)
    atoms: Counter[str] = Counter()
    known = 0
    for aa, n in counts.items():
        f = RESIDUE_FORMULA.get(aa)
        if f is None:
            continue
        known += n
        for el, k in f.items():
            atoms[el] += k * n
    if known:
        atoms["H"] += 2  # terminal water
        atoms["O"] += 1
    formula = "".join(f"{e}{atoms[e] if atoms[e] > 1 else ''}" for e in ELEMENT_ORDER if atoms[e]) if known else None
    mass = round(sum(ATOMIC_MASS[e] * n for e, n in atoms.items()), 2) if known else None
    return {
        "length": len(seq),
        "unknown": counts.get("X", 0),
        "formula": formula,
        "atoms": {e: atoms[e] for e in ELEMENT_ORDER if atoms[e]},
        "mass": mass,
        "composition": {aa: counts[aa] for aa in RESIDUE_FORMULA if counts.get(aa)},
    }
