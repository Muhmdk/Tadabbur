"""Clause assembly.

Speechmatics finalizes transcripts very granularly (≈ one word per final). We
must not translate per ASR-final — that's low quality and burns API calls. This
buffers finalized tokens into clauses and emits one when it hits sentence
punctuation or a max length, so translation runs on coherent units. Latency is
priority #1 (CLAUDE.md §1), hence the word cap that bounds how long we wait.
"""

# Sentence-ending punctuation (ASCII + Arabic question mark / full stop).
_SENTENCE_ENDERS = ".!?؟۔…"
# Force a flush after this many words even without punctuation, so a run-on
# sentence can't stall translation indefinitely.
_MAX_WORDS = 15


class ClauseAssembler:
    """Accumulates finalized ASR tokens into translation-ready clauses."""

    def __init__(self, max_words: int = _MAX_WORDS) -> None:
        self._words: list[str] = []
        self._max_words = max_words

    @property
    def current(self) -> str:
        """The clause accumulated so far."""
        return " ".join(self._words)

    def add_final(self, token: str) -> str | None:
        """Add a finalized token. Return the completed clause if a boundary is
        reached, else None."""
        tok = token.strip()
        if not tok:
            return None
        self._words.append(tok)
        if len(self._words) >= self._max_words or tok[-1] in _SENTENCE_ENDERS:
            return self._take()
        return None

    def flush(self) -> str | None:
        """Emit whatever remains (e.g. at end of stream), or None if empty."""
        return self._take() if self._words else None

    def _take(self) -> str:
        clause = " ".join(self._words)
        self._words = []
        return clause
