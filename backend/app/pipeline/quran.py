"""Conservative Quran quotation detection against a local verified Arabic corpus.

The source file is the unmodified Tanzil Simple Clean 1.1 text. We normalize
only in memory to compare ordinary ASR spelling with the corpus; the stored
text and its copyright block remain verbatim.

Detection runs in three layers, any of which withholds translation:

1. Exact: six consecutive corpus words, or a complete short ayah (3-5 words)
   spoken alone or right after a Quran introduction.
2. Continuation: clauses are cut at pauses and a word cap, so the end of a long
   ayah often arrives as a short fragment of its own. A clause that continues
   the previous Quran clause in the corpus is Quran too.
3. ASR-tolerant: recitation is transcribed with errors, so a clause whose words
   mostly line up, in order, with one corpus passage counts even when no six
   consecutive words are exact.

Every layer leans toward withholding a translation: a missed verse is
machine-translated scripture, while a false match only shows "Quran being read".
"""

import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_CORPUS = Path(__file__).with_name("quran-simple-clean.txt")
_ARABIC_WORD = re.compile(r"[\u0621-\u064a]+")
_MIN_MATCH_WORDS = 6
# Words of a Quran clause carried forward to recognize its continuation.
TAIL_WORDS = _MIN_MATCH_WORDS - 1
_SPELLING = str.maketrans(
    {"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ؤ": "و", "ئ": "ي", "ة": "ه"}
)
_INTRO_CUES = {
    ("قال", "الله"),
    ("يقول", "الله"),
    ("قال", "تعالي"),
    ("في", "القران"),
    ("من", "القران"),
}
# ASR-tolerant layer: trigram seeds vote for one in-order alignment with the corpus.
_SEED = 3
_FUZZY_MIN_WORDS = 6
_FUZZY_MIN_COVERED = 5
_FUZZY_MIN_COVERAGE = 0.6


@dataclass(frozen=True)
class _Index:
    windows: frozenset[tuple[str, ...]]
    short_ayat: frozenset[tuple[str, ...]]
    seeds: dict[tuple[str, ...], tuple[int, ...]]  # trigram -> corpus word positions


def words(text: str) -> tuple[str, ...]:
    """Normalized Arabic words, comparable with the corpus."""
    text = unicodedata.normalize("NFKC", text)
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return tuple(_ARABIC_WORD.findall(text.translate(_SPELLING)))


@lru_cache(maxsize=1)
def _index() -> _Index:
    """Index the corpus without editing the source."""
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
    seeds: defaultdict[tuple[str, ...], list[int]] = defaultdict(list)
    position = 0
    for ayat in chapters.values():
        for verse in ayat:
            verse_words = words(verse)
            if 3 <= len(verse_words) < _MIN_MATCH_WORDS:
                short_ayat.add(verse_words)
            # Tanzil attaches the basmala to the first ayah of many surahs.
            # Recognize a short ayah recited without that prefix as well.
            if verse_words[:4] == ("بسم", "الله", "الرحمن", "الرحيم"):
                rest = verse_words[4:]
                if 3 <= len(rest) < _MIN_MATCH_WORDS:
                    short_ayat.add(rest)
        chapter = words(" ".join(ayat))
        windows.update(
            chapter[i : i + _MIN_MATCH_WORDS] for i in range(len(chapter) - _MIN_MATCH_WORDS + 1)
        )
        for i in range(len(chapter) - _SEED + 1):
            seeds[chapter[i : i + _SEED]].append(position + i)
        # Leave a gap so no alignment runs from one surah into the next.
        position += len(chapter) + _SEED
    return _Index(
        windows=frozenset(windows),
        short_ayat=frozenset(short_ayat),
        seeds={seed: tuple(positions) for seed, positions in seeds.items()},
    )


def warm() -> None:
    """Build the index before the first caption needs it (about half a second)."""
    _index()


def _aligned(text_words: tuple[str, ...]) -> set[int]:
    """Indices of `text_words` covered by the best in-order corpus alignment.

    Each trigram shared with the corpus votes for an offset between the clause
    and the corpus. Votes on neighbouring offsets are pooled so one dropped or
    inserted ASR word does not split the alignment.
    """
    seeds = _index().seeds
    hits: defaultdict[int, list[int]] = defaultdict(list)
    for i in range(len(text_words) - _SEED + 1):
        for position in seeds.get(text_words[i : i + _SEED], ()):
            hits[position - i].append(i)
    best: set[int] = set()
    for offset in hits:
        covered = {
            i + k
            for near in (offset - 1, offset, offset + 1)
            for i in hits.get(near, ())
            for k in range(_SEED)
        }
        if len(covered) > len(best):
            best = covered
    return best


def _exact(text_words: tuple[str, ...]) -> bool:
    index = _index()
    if text_words in index.short_ayat:
        return True
    for size in range(3, min(5, len(text_words)) + 1):
        for i in range(len(text_words) - size + 1):
            if tuple(text_words[i : i + size]) not in index.short_ayat:
                continue
            prefix = text_words[max(0, i - 8) : i]
            if any(tuple(prefix[j : j + 2]) in _INTRO_CUES for j in range(len(prefix) - 1)):
                return True
    return any(
        tuple(text_words[i : i + _MIN_MATCH_WORDS]) in index.windows
        for i in range(len(text_words) - _MIN_MATCH_WORDS + 1)
    )


def _continues(tail: tuple[str, ...], text_words: tuple[str, ...]) -> bool:
    """Whether `text_words` carry on the corpus passage that `tail` ends."""
    if not tail or not text_words:
        return False
    joined = tail + text_words
    start = len(tail)
    # Any six-word corpus window that reaches into the new clause.
    windows = _index().windows
    for i in range(max(0, start - _MIN_MATCH_WORDS + 1), len(joined) - _MIN_MATCH_WORDS + 1):
        if joined[i : i + _MIN_MATCH_WORDS] in windows:
            return True
    # ASR-tolerant: the alignment that runs through the tail covers most new words.
    covered_new = {i for i in _aligned(joined) if i >= start}
    return len(covered_new) >= min(2, len(text_words)) and len(covered_new) >= 0.5 * len(text_words)


def is_quranic_candidate(text: str, *, after: tuple[str, ...] = ()) -> bool:
    """Return true when `text` is, or continues, a Quran quotation.

    `after` is the tail of the previous clause when that clause was Quran (see
    `continuation_tail`). Very short recitations and heavy ASR errors can still
    be missed, and a match cannot tell live recitation from a sermon quotation;
    both are withheld from translation.
    """
    text_words = words(text)
    if _exact(text_words) or _continues(after, text_words):
        return True
    if len(text_words) < _FUZZY_MIN_WORDS:
        return False
    covered = _aligned(text_words)
    return len(covered) >= _FUZZY_MIN_COVERED and len(covered) >= _FUZZY_MIN_COVERAGE * len(
        text_words
    )


def continuation_tail(previous: tuple[str, ...], text: str) -> tuple[str, ...]:
    """The words to pass as `after` for the clause that follows a Quran clause."""
    return (previous + words(text))[-TAIL_WORDS:]
