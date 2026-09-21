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
