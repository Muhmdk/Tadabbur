"""Clause assembly.

Speechmatics finalizes transcripts granularly: each final covers the audio since
the previous one, usually one to a few words. We must not translate per ASR
final; that's low quality and burns API calls. This buffers finalized words into
clauses and emits one when a word ends a sentence or the clause reaches a max
length, so translation runs on coherent units. Latency is priority #1
(CLAUDE.md §1), hence the word cap that bounds how long we wait.
"""

# Sentence-ending punctuation (ASCII + Arabic question mark / full stop).
_SENTENCE_ENDERS = ".!?؟۔…"
# Force a flush after this many words even without punctuation, so a run-on
# sentence can't stall translation indefinitely.
_MAX_WORDS = 15


class ClauseAssembler:
    """Accumulates finalized ASR words into translation-ready clauses."""

    def __init__(self, max_words: int = _MAX_WORDS) -> None:
        self._words: list[str] = []
        self._max_words = max_words

    @property
    def current(self) -> str:
        """The clause accumulated so far."""
        return " ".join(self._words)

    def add_final(self, transcript: str) -> list[str]:
        """Add a finalized transcript of one or more words.

        Returns the clauses it completed, in order: none, or several when one
        final holds a sentence end followed by more speech. Words after the
        last boundary stay buffered.
        """
        clauses: list[str] = []
        for word in transcript.split():
            self._words.append(word)
            if len(self._words) >= self._max_words or word[-1] in _SENTENCE_ENDERS:
                clauses.append(self._take())
        return clauses

    def flush(self) -> str | None:
        """Emit whatever remains (e.g. at end of stream), or None if empty."""
        return self._take() if self._words else None

    def _take(self) -> str:
        clause = " ".join(self._words)
        self._words = []
        return clause
