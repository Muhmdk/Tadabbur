"""Protect sacred text before any machine translation request."""

import hashlib
from pathlib import Path

from app.pipeline import quran


def test_reference_is_the_unmodified_complete_tanzil_download() -> None:
    corpus = Path(quran.__file__).with_name("quran-simple-clean.txt").read_bytes()
    assert hashlib.sha256(corpus).hexdigest() == (
        "228df2a717671aeb9d2ff573002bd28d6b3f973f4bc7153554e3a81663d67610"
    )
    lines = corpus.decode("utf-8-sig").splitlines()
    verses = [line for line in lines if line.split("|", 2)[0].isdigit()]
    assert len(verses) == 6236
    assert len({int(verse.split("|", 1)[0]) for verse in verses}) == 114
    assert "Tanzil Quran Text (Simple Clean, Version 1.1)" in corpus.decode("utf-8")


def test_long_and_complete_short_ayat_are_detected() -> None:
    assert quran.is_quranic_candidate("بسم الله الرحمن الرحيم الحمد لله رب العالمين")
    assert quran.is_quranic_candidate("الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ")
    assert quran.is_quranic_candidate("قُلْ هُوَ اللَّهُ أَحَدٌ")
    assert quran.is_quranic_candidate("قال الله تعالى قل هو الله أحد")


def test_common_short_phrase_and_sermon_prose_are_not_assumed_quran() -> None:
    assert not quran.is_quranic_candidate("الرحمن الرحيم")
    assert not quran.is_quranic_candidate("موضوع اليوم أن الله غفور رحيم وعلينا العمل")
    assert not quran.is_quranic_candidate(
        "أيها الإخوة الكرام نتحدث اليوم عن مسؤولياتنا في هذا المجتمع"
    )


def _ayah(surah: int, ayah: int) -> str:
    corpus = Path(quran.__file__).with_name("quran-simple-clean.txt")
    for line in corpus.read_text(encoding="utf-8-sig").splitlines():
        parts = line.split("|", 2)
        if parts[:2] == [str(surah), str(ayah)]:
            return parts[2]
    raise AssertionError("ayah not found")


def _withheld(clauses: list[str]) -> list[bool]:
    """Classify clauses in order the way the pipeline does."""
    tail: tuple[str, ...] = ()
    results = []
    for clause in clauses:
        hit = quran.is_quranic_candidate(clause, after=tail)
        results.append(hit)
        tail = quran.continuation_tail(tail, clause) if hit else ()
    return results


def test_every_piece_of_ayat_al_kursi_is_withheld_when_cut_at_the_word_cap() -> None:
    words = _ayah(2, 255).split()
    pieces = [" ".join(words[i : i + 15]) for i in range(0, len(words), 15)]
    assert len(words[45:]) == 5  # the final piece is too short to match on its own
    assert _withheld(pieces) == [True] * len(pieces)


def test_the_end_of_an_ayah_after_a_pause_is_withheld() -> None:
    for surah, ayah in [(2, 255), (2, 286), (59, 23), (3, 26)]:
        words = _ayah(surah, ayah).split()
        for n in (1, 2, 3, 4, 5):
            assert _withheld([" ".join(words[:-n]), " ".join(words[-n:])]) == [True, True]


def test_recitation_with_asr_mistakes_is_still_withheld() -> None:
    words = _ayah(2, 255).split()[:12]
    words[5] = "كلمة"
    words[10] = "كلمة"  # no six consecutive words are exact any more
    assert quran.is_quranic_candidate(" ".join(words))


def test_sermon_prose_after_a_recitation_is_translated_again() -> None:
    tail = quran.continuation_tail((), _ayah(2, 255))
    assert not quran.is_quranic_candidate(
        "أيها الإخوة الكرام نتحدث اليوم عن مسؤولياتنا في هذا المجتمع", after=tail
    )
    assert not quran.is_quranic_candidate("الصدق خلق عظيم يحبه الله ويحبه الناس", after=tail)
