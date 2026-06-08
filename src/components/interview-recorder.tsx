"use client";

import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Download,
  Maximize2,
  Minimize2,
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
  parseColor,
  Slider,
  Tab,
  Tabs,
  TextArea,
} from "@heroui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { recordingFilename, splitScriptIntoParagraphs } from "@/lib/teleprompter";

type AppMode = "home" | "prep" | "countdown" | "record" | "review";
type PromptMode = "paragraph" | "autoscroll";
type TimerMode = "elapsed" | "countdown";
type TimerProgressStyle = "circle" | "bar";
type QualityPreset = "standard" | "high";
type CameraPosition = "bottom-center" | "bottom-left" | "bottom-right";

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
  const [appMode, setAppMode] = useState<AppMode>("home");
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeSection, setActiveSection] = useState<PrepSection["id"]>("video");
  const [recordElapsedSeconds, setRecordElapsedSeconds] = useState(0);
  const [countdownValue, setCountdownValue] = useState(3);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prompterRef = useRef<HTMLDivElement | null>(null);
  const prepScrollRef = useRef<HTMLDivElement | null>(null);
  const prepRootRef = useRef<HTMLDivElement | null>(null);
  const drawFrameRef = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const elapsedTimerRef = useRef<number | null>(null);

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

  const stopCamera = useCallback(() => {
    stopDrawing();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stopDrawing]);

  const startCamera = useCallback(
    async (quality = qualityPreset) => {
      setError(null);

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("This browser does not support camera recording.");
        }

        stopCamera();

        const stream = await navigator.mediaDevices.getUserMedia(getCameraConstraints(quality));
        mediaStreamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (cameraError) {
        setError(cameraError instanceof Error ? cameraError.message : "Camera permission failed.");
      }
    },
    [qualityPreset, stopCamera],
  );

  const enterFullscreen = useCallback(async () => {
    try {
      await prepRootRef.current?.requestFullscreen?.();
    } catch {
      setIsFullscreen(false);
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  }, []);

  const enterPrep = useCallback(async () => {
    setAppMode("prep");
    setActiveSection("video");
    await startCamera();
    await enterFullscreen();
  }, [enterFullscreen, startCamera]);

  const exitPrep = useCallback(async () => {
    await exitFullscreen();
    stopCamera();
    setAppMode("home");
  }, [exitFullscreen, stopCamera]);

  const toggleFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await exitFullscreen();
      return;
    }

    await enterFullscreen();
  }, [enterFullscreen, exitFullscreen]);

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
    setCountdownValue(3);
    setAppMode("countdown");
  }, []);

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
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
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
    if (appMode === "prep" || appMode === "countdown" || appMode === "record") {
      const loop = () => {
        drawToCanvas();
        drawFrameRef.current = requestAnimationFrame(loop);
      };

      stopDrawing();
      loop();
    }

    return stopDrawing;
  }, [appMode, drawToCanvas, stopDrawing]);

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
      void startRecording();
    }, 1000);

    return () => window.clearInterval(timer);
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

  useEffect(() => {
    if (appMode !== "prep" || !prepScrollRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visibleEntry?.target.id) {
          setActiveSection(visibleEntry.target.id as PrepSection["id"]);
        }
      },
      {
        root: prepScrollRef.current,
        threshold: [0.32, 0.5, 0.68],
      },
    );

    prepSections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [appMode]);

  const timerControl = timerVisible ? (
    <div className="flex items-center gap-3 rounded-medium border border-white/15 bg-black/25 px-3 py-2 text-white backdrop-blur">
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

  const homeScreen = (
    <main className="mx-auto grid min-h-screen w-full max-w-5xl place-items-center px-4 py-8">
      <section className="w-full rounded-large border border-[var(--line)] bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--accent-strong)]">
          Local recorder
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-[var(--foreground)] sm:text-5xl">
          Asynchronous Interview Helper
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--ink-muted)]">
          Prepare your script, tune screen lighting, record locally, and download a clean WebM response.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={enterPrep}
            className="inline-flex items-center gap-2 rounded-medium bg-[var(--accent)] px-5 py-3 font-semibold text-white hover:bg-[var(--accent-strong)]"
          >
            <Camera aria-hidden="true" className="h-4 w-4" />
            Enter prep mode
          </Button>
          {recordingUrl ? (
            <Link
              href={recordingUrl}
              download={recordingFilename()}
              className="inline-flex items-center gap-2 rounded-medium border border-[var(--line)] bg-white px-5 py-3 font-semibold text-[var(--foreground)] hover:bg-[var(--panel-muted)]"
            >
              <Download aria-hidden="true" className="h-4 w-4" />
              Download last take
            </Link>
          ) : null}
        </div>
      </section>
    </main>
  );

  const prepScreen = (
    <main
      ref={prepRootRef}
      className="fixed inset-0 z-10 overflow-hidden text-[var(--foreground)]"
      style={{ backgroundColor: lightingBackground }}
    >
      <video ref={videoRef} muted playsInline className="hidden" />

      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between border-b border-white/15 bg-black/25 px-4 py-3 text-white backdrop-blur">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/70">Prep mode</p>
          <p className="text-sm font-semibold">Set up the take before recording</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={toggleFullscreen}
            variant="outline"
            className="inline-flex items-center gap-2 rounded-medium border border-white/25 bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20"
          >
            {isFullscreen ? <Minimize2 aria-hidden="true" className="h-4 w-4" /> : <Maximize2 aria-hidden="true" className="h-4 w-4" />}
            {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          </Button>
          <Button
            type="button"
            onClick={exitPrep}
            className="grid h-10 w-10 place-items-center rounded-full bg-white text-black hover:bg-white/85"
            aria-label="Exit prep mode"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {error ? (
        <div className="absolute left-1/2 top-20 z-30 w-[min(680px,calc(100%-2rem))] -translate-x-1/2 rounded-medium border border-red-200 bg-red-50 px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <div className="grid h-full grid-cols-[156px_minmax(0,1fr)] gap-4 px-4 pb-24 pt-24 max-md:grid-cols-1">
        <nav className="sticky top-24 h-fit rounded-medium border border-white/15 bg-black/25 p-2 text-white backdrop-blur max-md:hidden">
          {prepSections.map((section) => (
            <Link
              key={section.id}
              href={`#${section.id}`}
              className={`block rounded px-3 py-2 text-sm font-semibold ${
                activeSection === section.id ? "bg-white text-black" : "text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              {section.label}
            </Link>
          ))}
        </nav>

        <div ref={prepScrollRef} className="h-full overflow-y-auto pr-2">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 pb-8">
            <Card id="video" className="scroll-mt-24 rounded-medium border border-white/20 bg-white/95 shadow-sm">
              <CardHeader>
                <h2 className="text-xl font-semibold">Video</h2>
              </CardHeader>
              <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
                <div className="overflow-hidden rounded-medium bg-black">
                  <canvas className="aspect-video w-full object-cover" ref={canvasRef} />
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
                          className={`h-auto justify-start rounded-medium p-2 text-left ${
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
                          className={`inline-flex items-center gap-2 rounded-medium border px-3 py-2 text-sm font-semibold ${
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
                        <ColorField.Group className="flex h-11 items-center gap-2 rounded-medium border border-[var(--line)] bg-white px-3">
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
                </div>
              </CardContent>
            </Card>

            <Card id="script" className="scroll-mt-24 rounded-medium border border-white/20 bg-white/95 shadow-sm">
              <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">Script</h2>
                <Tabs selectedKey={promptMode} onSelectionChange={(key) => setPromptMode(key as PromptMode)}>
                  <Tabs.List aria-label="Prompt mode">
                    <Tab id="paragraph" key="paragraph">Paragraph</Tab>
                    <Tab id="autoscroll" key="autoscroll">Autoscroll</Tab>
                  </Tabs.List>
                </Tabs>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-2">
                <TextArea
                  value={script}
                  onChange={(event) => handleScriptChange(event.target.value)}
                  className="min-h-[280px] w-full resize-y rounded-medium border border-[var(--line)] bg-white p-3 text-sm leading-6"
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

            <Card id="timer" className="scroll-mt-24 rounded-medium border border-white/20 bg-white/95 shadow-sm">
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

            <Card id="misc" className="scroll-mt-24 rounded-medium border border-white/20 bg-white/95 shadow-sm">
              <CardHeader>
                <h2 className="text-xl font-semibold">Misc</h2>
              </CardHeader>
              <CardContent className="grid gap-5 md:grid-cols-2">
                <div className="space-y-4">
                  <Button
                    type="button"
                    onClick={toggleFullscreen}
                    variant="outline"
                    className="inline-flex items-center gap-2 rounded-medium border border-[var(--line)] bg-white px-4 py-2 font-semibold"
                  >
                    {isFullscreen ? <Minimize2 aria-hidden="true" className="h-4 w-4" /> : <Maximize2 aria-hidden="true" className="h-4 w-4" />}
                    {isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                  </Button>
                  <SettingChoice
                    label="Quality"
                    options={[
                      { label: "Standard", value: "standard" },
                      { label: "High", value: "high" },
                    ]}
                    value={qualityPreset}
                    onChange={(value) => void updateQuality(value as QualityPreset)}
                  />
                </div>
                <SettingChoice
                  label="Camera preview position"
                  options={[
                    { label: "Bottom center", value: "bottom-center" },
                    { label: "Bottom left", value: "bottom-left" },
                    { label: "Bottom right", value: "bottom-right" },
                  ]}
                  value={cameraPosition}
                  onChange={(value) => setCameraPosition(value as CameraPosition)}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Button
        type="button"
        onClick={startCountdown}
        className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 rounded-full bg-[#a93434] px-6 py-4 text-base font-semibold text-white shadow-xl hover:bg-[#842727]"
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
      <canvas ref={canvasRef} className={`absolute w-[min(320px,34vw)] rounded-large border border-white/20 bg-black shadow-2xl ${cameraPreviewClass}`} />

      <div className="absolute left-1/2 top-8 w-[min(920px,calc(100%-2rem))] -translate-x-1/2">
        <div
          ref={prompterRef}
          className="max-h-[38vh] overflow-hidden rounded-large border border-white/15 bg-black/28 p-5 text-center text-white shadow-xl backdrop-blur"
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
        className="absolute right-6 top-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-semibold text-black shadow-lg hover:bg-white/85"
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
          className="inline-flex items-center gap-2 rounded-medium border border-[var(--line)] bg-white px-4 py-2 font-semibold"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Back to prep
        </Button>
      </header>
      {recordingUrl ? (
        <video src={recordingUrl} controls className="max-h-[70vh] w-full rounded-large border border-[var(--line)] bg-black" />
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {recordingUrl ? (
          <Link
            href={recordingUrl}
            download={recordingFilename()}
            className="inline-flex items-center gap-2 rounded-medium bg-[var(--accent)] px-5 py-3 font-semibold text-white hover:bg-[var(--accent-strong)]"
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            Download WebM
          </Link>
        ) : null}
        <Button
          type="button"
          onClick={retake}
          variant="outline"
          className="inline-flex items-center gap-2 rounded-medium border border-[var(--line)] bg-white px-5 py-3 font-semibold"
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

  return homeScreen;
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
    <div className="max-h-[290px] overflow-auto rounded-medium border border-[var(--line)] bg-[#fbfaf7] p-4">
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
