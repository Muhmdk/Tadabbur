"""Conservative Quran quotation detection against a local verified Arabic corpus.

The source file is the unmodified Tanzil Simple Clean 1.1 text. We normalize
only in memory to compare ordinary ASR spelling with the corpus; the stored
text and its copyright block remain verbatim.
"""

import re
import unicodedata
from functools import lru_cache
from pathlib import Path

_CORPUS = Path(__file__).with_name("quran-simple-clean.txt")
_ARABIC_WORD = re.compile(r"[\u0621-\u064a]+")
_MIN_MATCH_WORDS = 6
_SPELLING = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ؤ": "و", "ئ": "ي"})
_INTRO_CUES = {
    ("قال", "الله"),
    ("يقول", "الله"),
    ("قال", "تعالي"),
    ("في", "القران"),
    ("من", "القران"),
}


def _words(text: str) -> tuple[str, ...]:
    text = unicodedata.normalize("NFKC", text)
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return tuple(_ARABIC_WORD.findall(text.translate(_SPELLING)))


@lru_cache(maxsize=1)
def _quran_index() -> tuple[set[tuple[str, ...]], set[tuple[str, ...]]]:
    """Index long sequences and complete short ayat without editing the source."""
    chapters: dict[int, list[str]] = {}
    verse_count = 0
    for line in _CORPUS.read_text(encoding="utf-8-sig").splitlines():
        parts = line.split("|", 2)
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            chapters.setdefault(int(parts[0]), []).append(parts[2])
            verse_count += 1
    if len(chapters) != 114 or verse_count != 6236:
        raise RuntimeError("Quran reference corpus is missing or incomplete")

    windows: set[tuple[str, ...]] = set()
    short_ayat: set[tuple[str, ...]] = set()
    for ayat in chapters.values():
        for verse in ayat:
            verse_words = _words(verse)
            if 3 <= len(verse_words) < _MIN_MATCH_WORDS:
                short_ayat.add(verse_words)
            # Tanzil attaches the basmala to the first ayah of many surahs.
            # Recognize a short ayah recited without that prefix as well.
            if verse_words[:4] == ("بسم", "الله", "الرحمن", "الرحيم"):
                rest = verse_words[4:]
                if 3 <= len(rest) < _MIN_MATCH_WORDS:
                    short_ayat.add(rest)
        words = _words(" ".join(ayat))
        windows.update(
            tuple(words[i : i + _MIN_MATCH_WORDS]) for i in range(len(words) - _MIN_MATCH_WORDS + 1)
        )
    return windows, short_ayat


def is_quranic_candidate(text: str) -> bool:
    """Return true for a six-word match or complete short ayah quotation.

    Short recitations and ASR mistakes can be missed. A match also cannot tell
    live recitation from a sermon quotation; both are withheld from translation.
    """
    words = _words(text)
    windows, short_ayat = _quran_index()
    if words in short_ayat:
        return True
    for size in range(3, min(5, len(words)) + 1):
        for i in range(len(words) - size + 1):
            if tuple(words[i : i + size]) not in short_ayat:
                continue
            prefix = words[max(0, i - 8) : i]
            if any(tuple(prefix[j : j + 2]) in _INTRO_CUES for j in range(len(prefix) - 1)):
                return True
    if len(words) < _MIN_MATCH_WORDS:
        return False
    return any(
        tuple(words[i : i + _MIN_MATCH_WORDS]) in windows
        for i in range(len(words) - _MIN_MATCH_WORDS + 1)
    )
