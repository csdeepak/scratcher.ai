// The map registers a capture function while it is on screen; the Export dialog calls it.

type Capture = () => Promise<string>;
let capture: Capture | null = null;

export function registerMapCapture(fn: Capture | null) {
  capture = fn;
}

export function canCaptureMap() {
  return capture !== null;
}

export async function downloadMapImage(fileName: string) {
  if (!capture) throw new Error('Open the roadmap on the map first.');
  const dataUrl = await capture();
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  a.click();
}
