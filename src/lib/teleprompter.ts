export function splitScriptIntoParagraphs(script: string): string[] {
  return script
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function recordingFilename(date = new Date()): string {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `interview-response-${stamp}.webm`;
}
