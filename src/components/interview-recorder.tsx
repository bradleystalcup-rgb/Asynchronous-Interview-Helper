"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Info,
  RotateCcw,
  Square,
  Video,
  X,
} from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  ColorField,
  ColorSwatch,
  Link,
  Modal,
  parseColor,
  Slider,
  Tab,
  Tabs,
  TextArea,
  useOverlayState,
} from "@heroui/react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { recordingFilename, splitScriptIntoParagraphs } from "@/lib/teleprompter";

type AppMode = "prep" | "countdown" | "record" | "review";
type PromptMode = "paragraph" | "autoscroll";
type TimerMode = "elapsed" | "countdown";
type TimerProgressStyle = "circle" | "bar";
type QualityPreset = "standard" | "high";
type CameraPosition = "bottom-center" | "bottom-left" | "bottom-right";
type CameraAccess = "idle" | "requesting" | "granted" | "denied" | "unsupported";

type Tone = {
  id: string;
  label: string;
  filter: string;
  className: string;
};

type PrepSection = {
  id: "video" | "script" | "timer" | "misc";
  label: string;
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

const prepSections: PrepSection[] = [
  { id: "video", label: "Video" },
  { id: "script", label: "Script" },
  { id: "timer", label: "Timer" },
  { id: "misc", label: "Misc" },
];

const backgroundPresets = [
  { label: "Neutral", color: "#1f2328" },
  { label: "Warm", color: "#3a2419" },
  { label: "Cool", color: "#172d3a" },
  { label: "Soft", color: "#2d3142" },
  { label: "Bright", color: "#f1eee7" },
];

const defaultScript =
  "Thank you for considering my application. I am excited about this role because it connects directly with the kind of focused, practical work I enjoy most.\n\n" +
  "In my recent work, I have been responsible for taking ambiguous problems, organizing the requirements, and shipping clear solutions that other people can rely on.\n\n" +
  "What I would bring to this team is steady execution, strong communication, and a habit of making tradeoffs explicit before they become expensive.";

function formatTime(totalSeconds: number) {
  const safeSeconds = Math.max(totalSeconds, 0);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
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

function colorWithBrightness(color: string, brightness: number) {
  const normalized = color.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const factor = brightness / 100;

  return `rgb(${Math.round(red * factor)}, ${Math.round(green * factor)}, ${Math.round(blue * factor)})`;
}

function getCameraConstraints(quality: QualityPreset): MediaStreamConstraints {
  const idealWidth = quality === "high" ? 1920 : 1280;
  const idealHeight = quality === "high" ? 1080 : 720;

  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
    },
    video: {
      width: { ideal: idealWidth },
      height: { ideal: idealHeight },
      facingMode: "user",
    },
  };
}

export function InterviewRecorder() {
  const [appMode, setAppMode] = useState<AppMode>("prep");
  const [script, setScript] = useState(defaultScript);
  const [promptMode, setPromptMode] = useState<PromptMode>("paragraph");
  const [activeParagraph, setActiveParagraph] = useState(0);
  const [autoscrollSpeed, setAutoscrollSpeed] = useState(42);
  const [selectedToneId, setSelectedToneId] = useState("natural");
  const [backgroundColor, setBackgroundColor] = useState("#1f2328");
  const [backgroundBrightness, setBackgroundBrightness] = useState(100);
  const [timerMode, setTimerMode] = useState<TimerMode>("elapsed");
  const [timerVisible, setTimerVisible] = useState(true);
  const [timerProgressStyle, setTimerProgressStyle] = useState<TimerProgressStyle>("circle");
  const [timerDuration, setTimerDuration] = useState(120);
  const [qualityPreset, setQualityPreset] = useState<QualityPreset>("standard");
  const [cameraPosition, setCameraPosition] = useState<CameraPosition>("bottom-center");
  const [activeSection, setActiveSection] = useState<PrepSection["id"]>("video");
  const [recordElapsedSeconds, setRecordElapsedSeconds] = useState(0);
  const [countdownValue, setCountdownValue] = useState(3);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraAccess, setCameraAccess] = useState<CameraAccess>("idle");
  const introModal = useOverlayState({ defaultOpen: true });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prompterRef = useRef<HTMLDivElement | null>(null);
  const prepRootRef = useRef<HTMLDivElement | null>(null);
  const drawFrameRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const elapsedTimerRef = useRef<number | null>(null);
  const shouldStartRecordingRef = useRef(false);

  const paragraphs = useMemo(() => splitScriptIntoParagraphs(script), [script]);
  const selectedTone = tones.find((tone) => tone.id === selectedToneId) ?? tones[0];
  const lightingBackground = colorWithBrightness(backgroundColor, backgroundBrightness);
  const timerRemaining = timerDuration - recordElapsedSeconds;
  const timerDisplaySeconds = timerMode === "countdown" ? Math.abs(timerRemaining) : recordElapsedSeconds;
  const timerProgress =
    timerMode === "countdown"
      ? Math.min(recordElapsedSeconds / timerDuration, 1)
      : Math.min((recordElapsedSeconds % 60) / 60, 1);
  const isOvertime = timerMode === "countdown" && timerRemaining < 0;

  const advanceParagraph = useCallback(() => {
    setActiveParagraph((current) => Math.min(current + 1, Math.max(paragraphs.length - 1, 0)));
  }, [paragraphs.length]);

  const retreatParagraph = useCallback(() => {
    setActiveParagraph((current) => Math.max(current - 1, 0));
  }, []);

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

    const width = video.videoWidth || (qualityPreset === "high" ? 1920 : 1280);
    const height = video.videoHeight || (qualityPreset === "high" ? 1080 : 720);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    context.clearRect(0, 0, width, height);
    context.save();
    context.filter = selectedTone.filter;
    context.drawImage(video, 0, 0, width, height);
    context.restore();
  }, [qualityPreset, selectedTone.filter]);

  const startDrawing = useCallback(() => {
    const loop = () => {
      drawToCanvas();
      drawFrameRef.current = requestAnimationFrame(loop);
    };

    stopDrawing();
    loop();
  }, [drawToCanvas, stopDrawing]);

  const stopCamera = useCallback(() => {
    stopDrawing();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraAccess((current) => (current === "unsupported" ? "unsupported" : "idle"));
  }, [stopDrawing]);

  const startCamera = useCallback(
    async (quality = qualityPreset) => {
      setError(null);
      setCameraAccess("requesting");

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraAccess("unsupported");
          throw new Error("This browser does not support camera recording.");
        }

        stopCamera();

        const stream = await navigator.mediaDevices.getUserMedia(getCameraConstraints(quality));
        mediaStreamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        startDrawing();
        setCameraAccess("granted");
      } catch (cameraError) {
        setCameraAccess(cameraError instanceof Error && cameraError.message.includes("support") ? "unsupported" : "denied");
        setError(cameraError instanceof Error ? cameraError.message : "Camera permission failed.");
      }
    },
    [qualityPreset, startDrawing, stopCamera],
  );

  const enterFullscreen = useCallback(async () => {
    try {
      await prepRootRef.current?.requestFullscreen?.();
    } catch {
      // Browser fullscreen can be blocked; record mode still fills the viewport.
    }
  }, []);

  const handleScriptChange = useCallback((value: string) => {
    const nextParagraphCount = splitScriptIntoParagraphs(value).length;

    setScript(value);
    setActiveParagraph((current) => Math.min(current, Math.max(nextParagraphCount - 1, 0)));
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);

    if (!mediaStreamRef.current) {
      await startCamera();
    }

    const mediaStream = mediaStreamRef.current;
    const canvas = canvasRef.current;

    if (!mediaStream || !canvas) {
      setError("Start the camera before recording.");
      setAppMode("prep");
      return;
    }

    if (!("captureStream" in canvas)) {
      setError("This browser cannot record processed canvas video.");
      setAppMode("prep");
      return;
    }

    if (recordingUrl) {
      URL.revokeObjectURL(recordingUrl);
      setRecordingUrl(null);
    }

    drawToCanvas();
    chunksRef.current = [];
    setRecordElapsedSeconds(0);
    setActiveParagraph(0);
    prompterRef.current?.scrollTo({ top: 0 });

    const canvasStream = canvas.captureStream(qualityPreset === "high" ? 30 : 24);
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
      stopCamera();
      setAppMode("review");
    };

    recorderRef.current = recorder;
    recorder.start(250);
    setAppMode("record");
  }, [drawToCanvas, qualityPreset, recordingUrl, startCamera, stopCamera]);

  const startCountdown = useCallback(() => {
    void enterFullscreen();
    setCountdownValue(3);
    setAppMode("countdown");
  }, [enterFullscreen]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const retake = useCallback(() => {
    if (recordingUrl) {
      URL.revokeObjectURL(recordingUrl);
    }

    setRecordingUrl(null);
    setRecordElapsedSeconds(0);
    setAppMode("prep");
  }, [recordingUrl]);

  const updateQuality = useCallback(
    async (quality: QualityPreset) => {
      setQualityPreset(quality);

      if (mediaStreamRef.current && (appMode === "prep" || appMode === "review")) {
        await startCamera(quality);
      }
    },
    [appMode, startCamera],
  );

  useEffect(() => {
    const stream = mediaStreamRef.current;
    const video = videoRef.current;

    if (!stream || !video || video.srcObject === stream) {
      return;
    }

    video.srcObject = stream;
    void video.play();
  }, [appMode]);

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
    if (appMode === "prep" || appMode === "countdown" || appMode === "record") {
      startDrawing();
    }

    return stopDrawing;
  }, [appMode, startDrawing, stopDrawing]);

  useEffect(() => {
    if (appMode !== "record") {
      if (elapsedTimerRef.current !== null) {
        window.clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
      return;
    }

    elapsedTimerRef.current = window.setInterval(() => {
      setRecordElapsedSeconds((seconds) => seconds + 1);
    }, 1000);

    return () => {
      if (elapsedTimerRef.current !== null) {
        window.clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, [appMode]);

  useEffect(() => {
    if (appMode !== "countdown") {
      return;
    }

    let remaining = 3;

    const timer = window.setInterval(() => {
      remaining -= 1;

      if (remaining > 0) {
        setCountdownValue(remaining);
        return;
      }

      window.clearInterval(timer);
      shouldStartRecordingRef.current = true;
      setAppMode("record");
    }, 1000);

    return () => window.clearInterval(timer);
  }, [appMode]);

  useEffect(() => {
    if (appMode !== "record" || !shouldStartRecordingRef.current) {
      return;
    }

    shouldStartRecordingRef.current = false;
    void startRecording();
  }, [appMode, startRecording]);

  useEffect(() => {
    if (promptMode !== "paragraph" || (appMode !== "prep" && appMode !== "record")) {
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
        advanceParagraph();
      }

      if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        retreatParagraph();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [advanceParagraph, appMode, promptMode, retreatParagraph]);

  useEffect(() => {
    if (promptMode !== "autoscroll" || appMode !== "record") {
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
  }, [appMode, autoscrollSpeed, promptMode]);

  const timerControl = timerVisible ? (
    <div className="record-glass flex items-center gap-3 rounded-medium px-3 py-2 text-white">
      {timerProgressStyle === "circle" ? (
        <div
          className="grid h-12 w-12 place-items-center rounded-full text-xs font-semibold"
          style={{
            background: `conic-gradient(${isOvertime ? "#f87171" : "#f7f0dc"} ${timerProgress * 360}deg, rgba(255,255,255,0.18) 0deg)`,
          }}
        >
          <span className="grid h-9 w-9 place-items-center rounded-full bg-black/55">
            {isOvertime ? "+" : ""}
            {formatTime(timerDisplaySeconds)}
          </span>
        </div>
      ) : (
        <div className="w-44">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span>{timerMode === "countdown" ? "Remaining" : "Elapsed"}</span>
            <span>
              {isOvertime ? "+" : ""}
              {formatTime(timerDisplaySeconds)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/20">
            <div
              className={`h-full rounded-full ${isOvertime ? "bg-red-300" : "bg-[#f7f0dc]"}`}
              style={{ width: `${timerProgress * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  ) : null;

  const cameraPreviewClass =
    cameraPosition === "bottom-left"
      ? "left-6 bottom-6"
      : cameraPosition === "bottom-right"
        ? "right-6 bottom-6"
        : "left-1/2 bottom-6 -translate-x-1/2";

  const prepScreen = (
    <main
      ref={prepRootRef}
      className="studio-shell fixed inset-0 z-10 overflow-hidden text-[var(--foreground)]"
      style={{ "--lighting-background": lightingBackground } as CSSProperties}
    >
      <video ref={videoRef} muted playsInline className="hidden" />

      <Modal state={introModal}>
        <Modal.Backdrop className="bg-black/55 backdrop-blur-sm">
          <Modal.Container placement="center" size="lg">
            <Modal.Dialog className="studio-card rounded-large p-0 text-[var(--foreground)]">
              <Modal.Header className="border-b border-[var(--line)] px-6 py-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)]">
                    Interview recording helper
                  </p>
                  <Modal.Heading className="mt-1 text-2xl font-semibold">
                    Rehearse, record, and download a clean response.
                  </Modal.Heading>
                </div>
                <Modal.CloseTrigger
                  className="quiet-action absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full"
                  aria-label="Close introduction"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </Modal.CloseTrigger>
              </Modal.Header>
              <Modal.Body className="space-y-4 px-6 py-5 text-sm leading-6 text-[var(--ink-muted)]">
                <p>
                  This app gives you a local teleprompter, camera preview, screen-lighting controls,
                  timer options, and a simple recording flow for asynchronous job interview answers.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-medium border border-[var(--line)] bg-white/80 p-3">
                    <p className="font-semibold text-[var(--foreground)]">1. Prep</p>
                    <p className="mt-1">Choose video, script, timer, and quality settings.</p>
                  </div>
                  <div className="rounded-medium border border-[var(--line)] bg-white/80 p-3">
                    <p className="font-semibold text-[var(--foreground)]">2. Record</p>
                    <p className="mt-1">Read from the top script while the camera stays in view.</p>
                  </div>
                  <div className="rounded-medium border border-[var(--line)] bg-white/80 p-3">
                    <p className="font-semibold text-[var(--foreground)]">3. Download</p>
                    <p className="mt-1">Save a local WebM file. Nothing is uploaded.</p>
                  </div>
                </div>
              </Modal.Body>
              <Modal.Footer className="flex justify-end border-t border-[var(--line)] px-6 py-4">
                <Button
                  type="button"
                  onClick={introModal.close}
                  className="primary-action rounded-medium px-5 py-3 font-semibold"
                >
                  Get started
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Button
        type="button"
        onClick={introModal.open}
        className="quiet-action fixed left-5 top-5 z-30 inline-flex h-10 w-10 items-center justify-center rounded-full"
        aria-label="Open app information"
      >
        <Info aria-hidden="true" className="h-5 w-5" />
      </Button>

      {error ? (
        <div className="absolute left-1/2 top-20 z-30 w-[min(680px,calc(100%-2rem))] -translate-x-1/2 rounded-medium border border-red-200 bg-red-50 px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <div className="h-full px-4 pb-16 pt-5">
        <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4">
          <Tabs
            selectedKey={activeSection}
            onSelectionChange={(key) => setActiveSection(key as PrepSection["id"])}
            className="mx-auto w-fit"
          >
            <Tabs.ListContainer className="rounded-full bg-[var(--panel)]/90 p-1 shadow-lg shadow-blue-950/10 backdrop-blur">
              <Tabs.List
                aria-label="Prep sections"
                className="w-fit *:h-9 *:min-w-24 *:rounded-full *:px-5 *:text-sm *:font-semibold *:text-[var(--accent-strong)] *:transition *:data-[selected=true]:text-white"
              >
                {prepSections.map((section) => (
                  <Tab id={section.id} key={section.id}>
                    {section.label}
                    <Tabs.Indicator className="rounded-full bg-[var(--accent)] shadow-md shadow-blue-900/20" />
                  </Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>

          <div className="min-h-0 flex-1 overflow-y-auto pr-2">
            {activeSection === "video" ? (
              <Card className="studio-card rounded-large">
              <CardHeader>
                <h2 className="text-xl font-semibold">Video</h2>
              </CardHeader>
              <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
                <div className="relative aspect-video overflow-hidden rounded-large bg-black shadow-inner">
                  <canvas className="h-full w-full object-cover" ref={canvasRef} />
                  {cameraAccess !== "granted" ? (
                    <div className="absolute inset-0 grid place-items-center bg-[#101827] px-6 text-center text-white">
                      <div className="max-w-sm">
                        <p className="text-lg font-semibold">
                          {cameraAccess === "denied"
                            ? "Camera access was blocked"
                            : cameraAccess === "unsupported"
                              ? "Camera is not supported"
                              : "Camera preview is off"}
                        </p>
                        <p className="mt-2 text-sm text-white/70">
                          {cameraAccess === "denied"
                            ? "Allow camera and microphone access in your browser, then try again."
                            : "Enable camera access to preview framing and filters before recording."}
                        </p>
                        {cameraAccess !== "unsupported" ? (
                          <Button
                            type="button"
                            onClick={() => void startCamera()}
                            isDisabled={cameraAccess === "requesting"}
                            className="primary-action mt-4 rounded-medium px-4 py-2 font-semibold"
                          >
                            {cameraAccess === "requesting" ? "Requesting access..." : "Enable camera access"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold">Camera filter</h3>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {tones.map((tone) => (
                        <Button
                          key={tone.id}
                          type="button"
                          onClick={() => setSelectedToneId(tone.id)}
                          variant={selectedToneId === tone.id ? "primary" : "outline"}
                          className={`h-auto justify-start rounded-medium p-2 text-left transition ${
                            selectedToneId === tone.id ? "bg-[var(--accent-soft)]" : "bg-white"
                          }`}
                        >
                          <span className="block w-full">
                            <span className={`block h-10 rounded bg-gradient-to-br from-[#d8c1a7] to-[#46676c] ${tone.className}`} />
                            <span className="mt-2 block text-sm font-semibold">{tone.label}</span>
                          </span>
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold">Screen lighting</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {backgroundPresets.map((preset) => (
                        <Button
                          key={preset.label}
                          type="button"
                          onClick={() => setBackgroundColor(preset.color)}
                          variant={backgroundColor === preset.color ? "primary" : "outline"}
                          className={`inline-flex items-center gap-2 rounded-medium border px-3 py-2 text-sm font-semibold transition ${
                            backgroundColor === preset.color ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-white"
                          }`}
                        >
                          <ColorSwatch
                            color={preset.color}
                            className="h-4 w-4 rounded-full border border-black/10"
                          />
                          {preset.label}
                        </Button>
                      ))}
                    </div>
                    <div className="mt-3">
                      <p className="mb-2 text-sm font-medium text-[var(--ink-muted)]">Custom color</p>
                      <ColorField
                        value={parseColor(backgroundColor)}
                        onChange={(color) => {
                          if (color) {
                            setBackgroundColor(color.toString("hex"));
                          }
                        }}
                      >
                        <ColorField.Group className="quiet-action flex h-11 items-center gap-2 rounded-medium px-3">
                          <ColorSwatch color={backgroundColor} className="h-6 w-6 rounded-full border border-black/10" />
                          <ColorField.Input className="min-w-0 flex-1 bg-transparent text-sm font-semibold uppercase text-[var(--foreground)] outline-none" />
                        </ColorField.Group>
                      </ColorField>
                    </div>
                    <label className="mt-3 block text-sm font-medium text-[var(--ink-muted)]">
                      Brightness
                      <Slider
                        aria-label="Background brightness"
                        minValue={35}
                        maxValue={140}
                        value={backgroundBrightness}
                        onChange={(value) => setBackgroundBrightness(Array.isArray(value) ? value[0] : value)}
                        className="mt-2"
                      />
                    </label>
                  </div>

                  <SettingChoice
                    label="Camera quality"
                    options={[
                      { label: "Standard", value: "standard" },
                      { label: "High", value: "high" },
                    ]}
                    value={qualityPreset}
                    onChange={(value) => void updateQuality(value as QualityPreset)}
                  />

                  <SettingChoice
                    label="Camera position"
                    options={[
                      { label: "Bottom center", value: "bottom-center" },
                      { label: "Bottom left", value: "bottom-left" },
                      { label: "Bottom right", value: "bottom-right" },
                    ]}
                    value={cameraPosition}
                    onChange={(value) => setCameraPosition(value as CameraPosition)}
                  />
                </div>
              </CardContent>
            </Card>
            ) : null}

            {activeSection === "script" ? (
              <Card className="studio-card rounded-large">
              <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">Script</h2>
                <Tabs
                  selectedKey={promptMode}
                  onSelectionChange={(key) => setPromptMode(key as PromptMode)}
                  className="w-fit"
                >
                  <Tabs.ListContainer className="rounded-full bg-[var(--accent-soft)] p-1">
                    <Tabs.List
                      aria-label="Prompt mode"
                      className="w-fit *:h-9 *:min-w-28 *:rounded-full *:px-4 *:text-sm *:font-semibold *:text-[var(--accent-strong)] *:transition *:data-[selected=true]:text-white"
                    >
                      <Tab id="paragraph" key="paragraph">
                        Paragraph
                        <Tabs.Indicator className="rounded-full bg-[var(--accent)] shadow-md shadow-blue-900/20" />
                      </Tab>
                      <Tab id="autoscroll" key="autoscroll">
                        Autoscroll
                        <Tabs.Indicator className="rounded-full bg-[var(--accent)] shadow-md shadow-blue-900/20" />
                      </Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>
                </Tabs>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-2">
                <TextArea
                  value={script}
                  onChange={(event) => handleScriptChange(event.target.value)}
                  className="min-h-[280px] w-full resize-y rounded-medium border border-[var(--line)] bg-white/95 p-3 text-sm leading-6 shadow-inner"
                  aria-label="Script"
                />
                <div>
                  {promptMode === "autoscroll" ? (
                    <label className="mb-3 block text-sm font-medium text-[var(--ink-muted)]">
                      Autoscroll speed
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
                      <Button type="button" onClick={retreatParagraph} variant="outline" size="sm">
                        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                        Back
                      </Button>
                      <Button type="button" onClick={advanceParagraph} variant="outline" size="sm">
                        Next
                        <ArrowRight aria-hidden="true" className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                  <TeleprompterPreview
                    paragraphs={paragraphs}
                    promptMode={promptMode}
                    activeParagraph={activeParagraph}
                  />
                </div>
              </CardContent>
            </Card>
            ) : null}

            {activeSection === "timer" ? (
              <Card className="studio-card rounded-large">
              <CardHeader>
                <h2 className="text-xl font-semibold">Timer</h2>
              </CardHeader>
              <CardContent className="grid gap-5 md:grid-cols-2">
                <div className="space-y-4">
                  <SettingChoice
                    label="Timer visibility"
                    options={[
                      { label: "Show", value: "show" },
                      { label: "Hide", value: "hide" },
                    ]}
                    value={timerVisible ? "show" : "hide"}
                    onChange={(value) => setTimerVisible(value === "show")}
                  />
                  <SettingChoice
                    label="Timer mode"
                    options={[
                      { label: "Elapsed", value: "elapsed" },
                      { label: "Countdown", value: "countdown" },
                    ]}
                    value={timerMode}
                    onChange={(value) => setTimerMode(value as TimerMode)}
                  />
                  <SettingChoice
                    label="Progress style"
                    options={[
                      { label: "Circle", value: "circle" },
                      { label: "Bar", value: "bar" },
                    ]}
                    value={timerProgressStyle}
                    onChange={(value) => setTimerProgressStyle(value as TimerProgressStyle)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ink-muted)]">
                    Countdown length
                    <Slider
                      aria-label="Countdown length"
                      minValue={30}
                      maxValue={300}
                      step={30}
                      value={timerDuration}
                      onChange={(value) => setTimerDuration(Array.isArray(value) ? value[0] : value)}
                      className="mt-3"
                    />
                  </label>
                  <p className="mt-2 text-sm font-semibold">{formatTime(timerDuration)}</p>
                </div>
              </CardContent>
            </Card>
            ) : null}

            {activeSection === "misc" ? (
              <Card className="studio-card rounded-large">
              <CardHeader>
                <h2 className="text-xl font-semibold">Misc</h2>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-medium border border-[var(--line)] bg-white/75 p-4 text-sm leading-6 text-[var(--ink-muted)]">
                  <p className="font-semibold text-[var(--foreground)]">Privacy</p>
                  <p className="mt-1">
                    Recording happens in your browser. Video and audio stay local unless you choose
                    to download and share the WebM file.
                  </p>
                </div>

                <div className="rounded-medium border border-[var(--line)] bg-white/75 p-4 text-sm leading-6 text-[var(--ink-muted)]">
                  <p className="font-semibold text-[var(--foreground)]">Attribution</p>
                  <p className="mt-1">
                    Built with Next.js, HeroUI, React Aria, Tailwind CSS, and lucide-react icons.
                  </p>
                  <Link
                    href="https://github.com/bradleystalcup-rgb/Asynchronous-Interview-Helper"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex font-semibold text-[var(--accent-strong)] underline-offset-4 hover:underline"
                  >
                    See this in GitHub
                  </Link>
                </div>
              </CardContent>
            </Card>
            ) : null}
          </div>
        </div>
      </div>

      <Button
        type="button"
        onClick={startCountdown}
        className="danger-action fixed bottom-8 right-8 z-50 inline-flex items-center gap-2 rounded-full px-7 py-4 text-base font-semibold transition hover:scale-[1.01]"
      >
        <Video aria-hidden="true" className="h-5 w-5" />
        Start recording
      </Button>

    </main>
  );

  const countdownScreen = (
    <main
      className="fixed inset-0 z-20 grid place-items-center text-white"
      style={{ backgroundColor: lightingBackground }}
    >
      <video ref={videoRef} muted playsInline className="hidden" />
      <canvas ref={canvasRef} className="hidden" />
      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.08em] text-white/70">Recording starts in</p>
        <p className="mt-3 text-8xl font-semibold">{countdownValue}</p>
      </div>
    </main>
  );

  const recordScreen = (
    <main
      className="fixed inset-0 z-20 overflow-hidden text-white"
      style={{ backgroundColor: lightingBackground }}
      onClick={() => {
        if (promptMode === "paragraph") {
          advanceParagraph();
        }
      }}
    >
      <video ref={videoRef} muted playsInline className="hidden" />
      <canvas ref={canvasRef} className={`absolute aspect-video w-[min(320px,34vw)] rounded-large border border-white/20 bg-black object-cover shadow-2xl ring-1 ring-black/20 ${cameraPreviewClass}`} />

      <div className="absolute left-1/2 top-8 w-[min(920px,calc(100%-2rem))] -translate-x-1/2">
        <div
          ref={prompterRef}
          className="record-glass max-h-[38vh] overflow-hidden rounded-large p-5 text-center text-white"
        >
          {paragraphs.length ? (
            promptMode === "paragraph" ? (
              <p className="text-3xl font-semibold leading-tight sm:text-5xl">
                {paragraphs[activeParagraph] ?? paragraphs[0]}
              </p>
            ) : (
              <div className="space-y-8">
                {paragraphs.map((paragraph, index) => (
                  <p key={`${paragraph.slice(0, 24)}-${index}`} className="text-3xl font-semibold leading-tight sm:text-5xl">
                    {paragraph}
                  </p>
                ))}
              </div>
            )
          ) : (
            <p className="text-2xl font-semibold">Your script will appear here.</p>
          )}
        </div>
        {promptMode === "paragraph" ? (
          <p className="mt-3 text-center text-sm font-semibold text-white/70">
            Paragraph {Math.min(activeParagraph + 1, paragraphs.length || 1)} of {paragraphs.length || 1}
          </p>
        ) : null}
      </div>

      <div className="absolute left-6 top-6 flex items-center gap-3">
        {timerControl}
      </div>

      <Button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          stopRecording();
        }}
        className="quiet-action absolute right-6 top-6 inline-flex items-center gap-2 rounded-full px-5 py-3 font-semibold"
      >
        <Square aria-hidden="true" className="h-4 w-4" />
        Stop
      </Button>
    </main>
  );

  const reviewScreen = (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-5 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--accent-strong)]">Review</p>
          <h1 className="text-3xl font-semibold">Check your take</h1>
        </div>
        <Button
          type="button"
          onClick={() => setAppMode("prep")}
          variant="outline"
          className="quiet-action inline-flex items-center gap-2 rounded-medium px-4 py-2 font-semibold"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back to prep
        </Button>
      </header>
      {recordingUrl ? (
        <video src={recordingUrl} controls className="max-h-[70vh] w-full rounded-large border border-[var(--line)] bg-black shadow-xl" />
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {recordingUrl ? (
          <Link
            href={recordingUrl}
            download={recordingFilename()}
            className="primary-action inline-flex items-center gap-2 rounded-medium px-5 py-3 font-semibold"
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            Download WebM
          </Link>
        ) : null}
        <Button
          type="button"
          onClick={retake}
          variant="outline"
          className="quiet-action inline-flex items-center gap-2 rounded-medium px-5 py-3 font-semibold"
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" />
          Retake
        </Button>
      </div>
    </main>
  );

  if (appMode === "prep") {
    return prepScreen;
  }

  if (appMode === "countdown") {
    return countdownScreen;
  }

  if (appMode === "record") {
    return recordScreen;
  }

  if (appMode === "review") {
    return reviewScreen;
  }

  return prepScreen;
}

function TeleprompterPreview({
  paragraphs,
  promptMode,
  activeParagraph,
}: {
  paragraphs: string[];
  promptMode: PromptMode;
  activeParagraph: number;
}) {
  return (
    <div className="max-h-[290px] overflow-auto rounded-medium border border-[var(--line)] bg-white/90 p-4 shadow-inner">
      {paragraphs.length ? (
        paragraphs.map((paragraph, index) => (
          <p
            key={`${paragraph.slice(0, 24)}-${index}`}
            className={`mb-4 text-xl leading-8 last:mb-0 ${
              promptMode === "paragraph" && index !== activeParagraph
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
  );
}

function SettingChoice({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-[var(--foreground)]">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            variant={value === option.value ? "primary" : "outline"}
            className={`inline-flex items-center gap-2 rounded-medium border px-3 py-2 text-sm font-semibold ${
              value === option.value
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                : "border-[var(--line)] bg-white text-[var(--foreground)] hover:bg-[var(--panel-muted)]"
            }`}
          >
            {value === option.value ? <Check aria-hidden="true" className="h-4 w-4" /> : null}
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
