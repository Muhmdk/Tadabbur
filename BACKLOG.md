# Product Backlog

## Mobile attendee viewer

**Revisit after:** the projector display is connected to live captions and the
session creation workflow is stable.

Allow attendees to join an active sermon session from their phones so a mosque
does not need a projector for every listener.

### Intended flow

1. Mosque staff creates and starts a live session.
2. The control screen shows a QR code containing a direct viewer URL such as
   `/join/{sessionId}`.
3. An attendee scans the QR code and lands directly in the live caption view.
4. No account, name, email, form, or other personal information is requested.
5. The attendee may switch among the session's available target languages.
6. The phone subscribes as a read-only viewer and displays live captions.

### Architecture

- Reuse the existing `/ws/captions/{sessionId}` viewer WebSocket.
- One Speechmatics stream and one translation pipeline remain shared by every
  viewer; additional phones only add inexpensive Redis/WebSocket subscribers.
- Language selection is initially client-side because each `caption.final`
  already contains the session's target translations.

### Acceptance criteria

- Mobile-first caption view with readable Arabic source and selected translation.
- QR code opens the live read-only viewer directly, with no intermediate setup.
- Shareable links and short codes may be offered as accessibility fallbacks.
- No attendee authentication or personal-information collection.
- No microphone permission requested from attendees.
- Automatic reconnect after temporary network loss.
- Clear states for waiting, live, ended, unavailable, and connection failure.
- A newly joined viewer receives current session state and recent caption context.
- Session IDs are unguessable and expire after the sermon; viewers cannot send
  audio, stop the shared session, or access control actions.

### Related deferred work

- Quranic/hadith detection must use verified source matching and established
  published translations; uncertain matches must suppress machine translation.
- Redis pub/sub has no replay, so recent-caption recovery needs a small retained
  history or Redis Streams.
