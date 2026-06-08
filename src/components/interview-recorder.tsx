"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Camera,
  Download,
  Play,
  Square,
  Timer,
  Video,
} from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Slider,
  Tab,
  Tabs,
  TextArea,
} from "@heroui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { recordingFilename, splitScriptIntoParagraphs } from "@/lib/teleprompter";

type PromptMode = "paragraph" | "autoscroll";
type RecorderStatus = "idle" | "ready" | "recording" | "reviewing";

type Tone = {
  id: string;
  label: string;
  filter: string;
  className: string;
};

const tones: Tone[] = [
  { id: "natural", label: "Natural", filter: "none", className: "tone-natural" },
  {
    id: "warm",
    label: "Warm",
    filter: "sepia(0.18) saturate(1.18) contrast(1.03) brightness(1.03)",
    className: "tone-warm",
  },
  {
    id: "crisp",
    label: "Crisp",
    filter: "saturate(0.96) contrast(1.14) brightness(1.04)",
    className: "tone-crisp",
  },
  {
    id: "mono",
    label: "Mono",
    filter: "grayscale(1) contrast(1.08) brightness(1.04)",
    className: "tone-mono",
  },
  {
    id: "studio",
    label: "Studio",
    filter: "saturate(1.08) contrast(1.08) brightness(0.98) hue-rotate(-5deg)",
    className: "tone-studio",
  },
];

const defaultScript =
  "Thank you for considering my application. I am excited about this role because it connects directly with the kind of focused, practical work I enjoy most.\n\n" +
  "In my recent work, I have been responsible for taking ambiguous problems, organizing the requirements, and shipping clear solutions that other people can rely on.\n\n" +
  "What I would bring to this team is steady execution, strong communication, and a habit of making tradeoffs explicit before they become expensive.";

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getSupportedMimeType() {
  const options = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function InterviewRecorder() {
  const [script, setScript] = useState(defaultScript);
  const [mode, setMode] = useState<PromptMode>("paragraph");
  const [activeParagraph, setActiveParagraph] = useState(0);
  const [autoscrollSpeed, setAutoscrollSpeed] = useState(42);
  const [selectedToneId, setSelectedToneId] = useState("natural");
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prompterRef = useRef<HTMLDivElement | null>(null);
  const drawFrameRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const elapsedTimerRef = useRef<number | null>(null);

  const paragraphs = useMemo(() => splitScriptIntoParagraphs(script), [script]);
  const selectedTone = tones.find((tone) => tone.id === selectedToneId) ?? tones[0];
  const canRecord = status === "ready" || status === "reviewing";

  const stopDrawing = useCallback(() => {
    if (drawFrameRef.current !== null) {
      cancelAnimationFrame(drawFrameRef.current);
      drawFrameRef.current = null;
    }
  }, []);

  const drawToCanvas = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!video || !canvas || !context) {
      return;
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.save();
    context.filter = selectedTone.filter;
    context.drawImage(video, 0, 0, width, height);
    context.restore();
  }, [selectedTone.filter]);

  const startCamera = useCallback(async () => {
    setError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support camera recording.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
        },
      });

      mediaStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setStatus("ready");
    } catch (cameraError) {
      setError(cameraError instanceof Error ? cameraError.message : "Camera permission failed.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    stopDrawing();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setStatus((current) => (current === "recording" ? current : "idle"));
  }, [stopDrawing]);

  const startRecording = useCallback(async () => {
    setError(null);

    if (!mediaStreamRef.current) {
      await startCamera();
    }

    const mediaStream = mediaStreamRef.current;
    const canvas = canvasRef.current;

    if (!mediaStream || !canvas) {
      setError("Start the camera before recording.");
      return;
    }

    if (!("captureStream" in canvas)) {
      setError("This browser cannot record processed canvas video.");
      return;
    }

    if (recordingUrl) {
      URL.revokeObjectURL(recordingUrl);
      setRecordingUrl(null);
    }

    chunksRef.current = [];
    setElapsedSeconds(0);
    setActiveParagraph(0);
    prompterRef.current?.scrollTo({ top: 0 });

    const canvasStream = canvas.captureStream(30);
    const processedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...mediaStream.getAudioTracks(),
    ]);
    const mimeType = getSupportedMimeType();
    const recorder = new MediaRecorder(processedStream, mimeType ? { mimeType } : undefined);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType || "video/webm" });
      setRecordingUrl(URL.createObjectURL(blob));
      setStatus("reviewing");
    };

    recorderRef.current = recorder;
    recorder.start(250);
    setStatus("recording");
  }, [recordingUrl, startCamera]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const resetTake = useCallback(() => {
    if (recordingUrl) {
      URL.revokeObjectURL(recordingUrl);
    }

    setRecordingUrl(null);
    setElapsedSeconds(0);
    setStatus(mediaStreamRef.current ? "ready" : "idle");
  }, [recordingUrl]);

  const handleScriptChange = useCallback((value: string) => {
    const nextParagraphCount = splitScriptIntoParagraphs(value).length;

    setScript(value);
    setActiveParagraph((current) => Math.min(current, Math.max(nextParagraphCount - 1, 0)));
  }, []);

  useEffect(() => {
    return () => {
      stopDrawing();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (recordingUrl) {
        URL.revokeObjectURL(recordingUrl);
      }
    };
  }, [recordingUrl, stopDrawing]);

  useEffect(() => {
    if (status === "ready" || status === "recording") {
      const loop = () => {
        drawToCanvas();
        drawFrameRef.current = requestAnimationFrame(loop);
      };

      stopDrawing();
      loop();
    }

    return stopDrawing;
  }, [drawToCanvas, status, stopDrawing]);

  useEffect(() => {
    if (status !== "recording") {
      if (elapsedTimerRef.current !== null) {
        window.clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
      return;
    }

    elapsedTimerRef.current = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1);
    }, 1000);

    return () => {
      if (elapsedTimerRef.current !== null) {
        window.clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [status]);

  useEffect(() => {
    if (mode !== "paragraph") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "INPUT" ||
        target?.isContentEditable;

      if (isTyping) {
        return;
      }

      if (event.key === " " || event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        setActiveParagraph((current) => Math.min(current + 1, Math.max(paragraphs.length - 1, 0)));
      }

      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        setActiveParagraph((current) => Math.max(current - 1, 0));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, paragraphs.length]);

  useEffect(() => {
    if (mode !== "autoscroll" || status !== "recording") {
      return;
    }

    let animationFrame: number;
    let previousTime = performance.now();

    const scroll = (time: number) => {
      const elapsed = (time - previousTime) / 1000;
      previousTime = time;

      if (prompterRef.current) {
        prompterRef.current.scrollTop += autoscrollSpeed * elapsed;
      }

      animationFrame = requestAnimationFrame(scroll);
    };

    animationFrame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(animationFrame);
  }, [autoscrollSpeed, mode, status]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 border-b border-[var(--line)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--accent-strong)]">
            Local recorder
          </p>
          <h1 className="text-3xl font-semibold text-[var(--foreground)] sm:text-4xl">
            Asynchronous Interview Helper
          </h1>
        </div>
        <div className="flex items-center gap-2 rounded-medium border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink-muted)]">
          <Timer aria-hidden="true" className="h-4 w-4" />
          <span>{formatTime(elapsedSeconds)}</span>
        </div>
      </header>

      {error ? (
        <div className="rounded-medium border border-red-200 bg-red-50 px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <section className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <div className="flex min-h-[58vh] flex-col gap-4">
          <div className="relative min-h-[280px] overflow-hidden rounded-medium border border-[var(--line)] bg-black shadow-sm">
            <video ref={videoRef} muted playsInline className="hidden" />
            <canvas ref={canvasRef} className="h-full min-h-[280px] w-full object-cover" />
            {status === "idle" ? (
              <div className="absolute inset-0 grid place-items-center bg-[#141414] px-6 text-center text-white">
                <div className="max-w-sm">
                  <Camera aria-hidden="true" className="mx-auto mb-3 h-10 w-10" />
                  <p className="text-lg font-semibold">Camera preview is off</p>
                  <p className="mt-2 text-sm text-white/70">
                    Start the camera to frame your shot before recording.
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {status === "idle" ? (
              <Button
                type="button"
                onClick={startCamera}
                className="inline-flex items-center gap-2 rounded-medium bg-[var(--accent)] px-4 py-2 font-semibold text-white hover:bg-[var(--accent-strong)]"
              >
                <Camera aria-hidden="true" className="h-4 w-4" />
                Start camera
              </Button>
            ) : (
              <Button
                type="button"
                onClick={stopCamera}
                isDisabled={status === "recording"}
                variant="outline"
                className="inline-flex items-center gap-2 rounded-medium border border-[var(--line)] bg-white px-4 py-2 font-semibold text-[var(--foreground)] hover:bg-[var(--panel-muted)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Square aria-hidden="true" className="h-4 w-4" />
                Stop camera
              </Button>
            )}

            {status !== "recording" ? (
              <Button
                type="button"
                onClick={startRecording}
                isDisabled={!canRecord && status !== "idle"}
                className="inline-flex items-center gap-2 rounded-medium bg-[#a93434] px-4 py-2 font-semibold text-white hover:bg-[#842727] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Video aria-hidden="true" className="h-4 w-4" />
                Record
              </Button>
            ) : (
              <Button
                type="button"
                onClick={stopRecording}
                className="inline-flex items-center gap-2 rounded-medium bg-[#202020] px-4 py-2 font-semibold text-white hover:bg-black"
              >
                <Square aria-hidden="true" className="h-4 w-4" />
                Stop
              </Button>
            )}

            {recordingUrl ? (
              <>
                <a
                  href={recordingUrl}
                  download={recordingFilename()}
                  className="inline-flex items-center gap-2 rounded-medium bg-[var(--accent)] px-4 py-2 font-semibold text-white hover:bg-[var(--accent-strong)]"
                >
                  <Download aria-hidden="true" className="h-4 w-4" />
                  Download WebM
                </a>
                <Button
                  type="button"
                  onClick={resetTake}
                  variant="outline"
                  className="inline-flex items-center gap-2 rounded-medium border border-[var(--line)] bg-white px-4 py-2 font-semibold text-[var(--foreground)] hover:bg-[var(--panel-muted)]"
                >
                  <Play aria-hidden="true" className="h-4 w-4" />
                  New take
                </Button>
              </>
            ) : null}
          </div>

          {recordingUrl ? (
            <video
              src={recordingUrl}
              controls
              className="max-h-[320px] w-full rounded-medium border border-[var(--line)] bg-black"
            />
          ) : null}
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="rounded-medium border border-[var(--line)] bg-white shadow-sm">
            <CardContent>
              <TextArea
                id="script"
                value={script}
                onChange={(event) => handleScriptChange(event.target.value)}
                className="min-h-[180px] w-full resize-y rounded-medium border border-[var(--line)] bg-white p-3 text-sm leading-6 text-[var(--foreground)]"
                aria-label="Script"
              />
            </CardContent>
          </Card>

          <Card className="rounded-medium border border-[var(--line)] bg-white shadow-sm">
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Teleprompter</h2>
              <Tabs
                selectedKey={mode}
                onSelectionChange={(key) => setMode(key as PromptMode)}
                className="rounded-medium"
              >
                <Tabs.List aria-label="Teleprompter mode">
                  <Tab id="paragraph" key="paragraph">
                    Paragraph
                  </Tab>
                  <Tab id="autoscroll" key="autoscroll">
                    Autoscroll
                  </Tab>
                </Tabs.List>
              </Tabs>
            </CardHeader>
            <CardContent className="pt-0">
              {mode === "autoscroll" ? (
                <label className="mb-3 block text-sm font-medium text-[var(--ink-muted)]">
                  Speed
                  <Slider
                    aria-label="Autoscroll speed"
                    minValue={12}
                    maxValue={110}
                    value={autoscrollSpeed}
                    onChange={(value) => setAutoscrollSpeed(Array.isArray(value) ? value[0] : value)}
                    className="mt-2"
                  />
                </label>
              ) : (
                <div className="mb-3 flex gap-2">
                  <Button
                    type="button"
                    onClick={() => setActiveParagraph((current) => Math.max(current - 1, 0))}
                    variant="outline"
                    size="sm"
                    className="inline-flex items-center gap-2 rounded-medium border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold hover:bg-[var(--panel-muted)]"
                  >
                    <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                    Back
                  </Button>
                  <Button
                    type="button"
                    onClick={() =>
                      setActiveParagraph((current) => Math.min(current + 1, Math.max(paragraphs.length - 1, 0)))
                    }
                    variant="outline"
                    size="sm"
                    className="inline-flex items-center gap-2 rounded-medium border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold hover:bg-[var(--panel-muted)]"
                  >
                    Next
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Button>
                </div>
              )}

              <div
                ref={prompterRef}
                className="max-h-[290px] overflow-auto rounded-medium border border-[var(--line)] bg-[#fbfaf7] p-4"
              >
                {paragraphs.length ? (
                  paragraphs.map((paragraph, index) => (
                    <p
                      key={`${paragraph.slice(0, 24)}-${index}`}
                      className={`mb-4 text-xl leading-8 last:mb-0 ${
                        mode === "paragraph" && index !== activeParagraph
                          ? "text-[var(--ink-muted)] opacity-35"
                          : "font-semibold text-[var(--foreground)]"
                      }`}
                    >
                      {paragraph}
                    </p>
                  ))
                ) : (
                  <p className="text-sm text-[var(--ink-muted)]">Your script preview will appear here.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-medium border border-[var(--line)] bg-white shadow-sm">
            <CardHeader>
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Video tone</h2>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
                {tones.map((tone) => (
                  <Button
                    key={tone.id}
                    type="button"
                    onClick={() => setSelectedToneId(tone.id)}
                    variant={selectedToneId === tone.id ? "primary" : "outline"}
                    className={`h-auto justify-start p-2 text-left ${
                      selectedToneId === tone.id
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-[var(--line)] bg-white"
                    }`}
                  >
                    <span className="block w-full">
                      <span className={`block h-12 rounded bg-gradient-to-br from-[#d8c1a7] to-[#46676c] ${tone.className}`} />
                      <span className="mt-2 block text-sm font-semibold">{tone.label}</span>
                    </span>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="flex items-start gap-2 rounded-medium border border-[var(--line)] bg-[var(--panel-muted)] p-3 text-sm text-[var(--ink-muted)]">
            <ArrowDown aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Recordings stay in this browser session. Download the WebM before closing the tab.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
