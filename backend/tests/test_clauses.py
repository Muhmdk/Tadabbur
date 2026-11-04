"""Clause boundaries count words, not ASR messages."""

from app.pipeline.clauses import ClauseAssembler


def test_word_cap_counts_words_inside_multi_word_finals() -> None:
    assembler = ClauseAssembler(max_words=5)
    assert assembler.add_final("واحد اثنان ثلاثة") == []
    # The cap is reached in the middle of this final; the rest stays buffered.
    assert assembler.add_final("أربعة خمسة ستة") == ["واحد اثنان ثلاثة أربعة خمسة"]
    assert assembler.current == "ستة"


def test_sentence_end_inside_a_final_closes_the_clause_there() -> None:
    assembler = ClauseAssembler()
    assert assembler.add_final("اتقوا الله. وأحسنوا إلى") == ["اتقوا الله."]
    assert assembler.add_final("جيرانكم؟ ثم") == ["وأحسنوا إلى جيرانكم؟"]
    assert assembler.flush() == "ثم"


def test_one_final_can_complete_several_clauses() -> None:
    assembler = ClauseAssembler()
    assert assembler.add_final("نعم. لا. ربما") == ["نعم.", "لا."]
    assert assembler.current == "ربما"


def test_empty_final_changes_nothing() -> None:
    assembler = ClauseAssembler()
    assert assembler.add_final("  ") == []
    assert assembler.flush() is None
