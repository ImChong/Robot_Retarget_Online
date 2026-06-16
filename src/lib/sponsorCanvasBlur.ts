/**
 * WebGL canvases sit on a separate compositor layer, so CSS backdrop-filter cannot
 * blur them. Snapshot each visible canvas and show a blurred copy while a modal
 * is open (same workaround pattern as frosted overlays over three.js viewports).
 */

const BLUR_PX = 16;

export function mountSponsorCanvasBlurs(host: HTMLElement): () => void {
  const layers: HTMLElement[] = [];

  for (const canvas of document.querySelectorAll('canvas')) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;

    const style = getComputedStyle(canvas);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

    let dataUrl: string;
    try {
      dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    } catch {
      continue;
    }

    const layer = document.createElement('div');
    layer.className = 'sponsor-canvas-blur';
    layer.style.left = `${rect.left}px`;
    layer.style.top = `${rect.top}px`;
    layer.style.width = `${rect.width}px`;
    layer.style.height = `${rect.height}px`;

    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = '';
    img.decoding = 'sync';
    layer.appendChild(img);

    host.appendChild(layer);
    layers.push(layer);
  }

  return () => {
    for (const layer of layers) layer.remove();
  };
}

export const SPONSOR_BLUR_PX = BLUR_PX;
