# Asynchronous Interview Helper

A local-only browser app for recording polished pre-recorded interview responses.

## What it does

- Enter a script.
- Choose paragraph stepping or smooth autoscroll.
- Pick a video tone/filter.
- Record camera and microphone in the browser.
- Review and download a WebM video.

Recordings are not uploaded or persisted by the app.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3003](http://localhost:3003).

## Verification

```bash
npm run lint
npm run build
```

## TODO

- Evaluate `@mediapipe/tasks-vision` for non-CSS camera effects, starting with background blur or replacement via image segmentation. Keep face landmark enhancements as a later option if the added runtime cost is acceptable.
