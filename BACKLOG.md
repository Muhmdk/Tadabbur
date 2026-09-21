# Release validation still needed

The attendee viewer, shareable session links, QR code, reconnect states, and
latest-caption replay are implemented. The following work needs a real Friday
environment and must not be represented as already verified:

- Exercise Speechmatics with a real Arabic microphone feed and measure caption
  latency and word accuracy in a mosque. Verify DeepL and Google fallback with
  live credentials, including a provider outage.
- Test with a running Redis deployment and multiple backend workers and viewers
  under a Friday-sized burst. Automated tests currently use an in-memory Redis
  substitute and fake providers.
- Exercise worker-crash recovery in a real multi-worker deployment. After the
  speaker lease expires, the operator can reconnect the existing live session,
  but automatic operator reconnect and production failover timing still need
  validation.
- Review Quran detection with qualified Arabic speakers using actual khutbah
  audio. Automatic text matching can miss ASR errors and very short recitations;
  operators should arm Quran mode before a recitation. Never machine-translate
  a suspected verse. Hadith handling needs a separately reviewed policy.
- Confirm projector legibility and attendee phone access on the mosque's actual
  network, including HTTPS and microphone permissions on the operator device.

Do not add published scripture translations without selecting a licensed,
reviewed source and designing a verse-identity verification step first.
