# Reused measurement code and media

The startup harness (`harness/startup/`), QPC/FILETIME bridge in
`native/windows-helper.cc`, environment rules, quantile convention, and
parent-before-spawn timing are adapted from the user's existing
`electron-windows-runtime-benchmark/code/` experiment associated with Electron
PR [#54205](https://github.com/electron/electron/pull/54205).

The prior benchmark's newly authored code did not specify a standalone license.
It is reused here at its owner's request. This repository has not selected a
distribution license for that code; do not infer an upstream Electron license.

`harness/startup/local-video.mp4` is Chromium's
`media/test/data/bear-1280x720.mp4`, unchanged, from revision
`8e2a2b41b398770e21040625a2748c6533c23933`.
SHA-256: `bcb75d3db0a1a5056f4cd5c770ceccdb4cae920f21abb8139b29cd9ad39e3857`.
Its Chromium license is preserved in `harness/CHROMIUM-LICENSE`.
See `harness/MEDIA.md` for provenance.

Historical results, hardware-specific speedups, raw account information, and
old diagnostic traces have not been copied into this implementation.
