export interface WindowRectangle { x: number; y: number; width: number; height: number }

/** Electron display bounds and BrowserWindow bounds both use device-independent pixels. */
export function fitWindowToWorkArea(
  bounds: WindowRectangle,
  workArea: WindowRectangle,
  preferredMinimum: { width: number; height: number },
): { bounds: WindowRectangle; minimumWidth: number; minimumHeight: number } {
  const availableWidth = Math.max(1, Math.floor(workArea.width));
  const availableHeight = Math.max(1, Math.floor(workArea.height));
  const minimumWidth = Math.min(availableWidth, Math.max(1, Math.round(preferredMinimum.width)));
  const minimumHeight = Math.min(availableHeight, Math.max(1, Math.round(preferredMinimum.height)));
  const width = Math.min(availableWidth, Math.max(minimumWidth, Math.round(bounds.width)));
  const height = Math.min(availableHeight, Math.max(minimumHeight, Math.round(bounds.height)));
  return {
    bounds: {
      x: Math.max(workArea.x, Math.min(Math.round(bounds.x), workArea.x + availableWidth - width)),
      y: Math.max(workArea.y, Math.min(Math.round(bounds.y), workArea.y + availableHeight - height)),
      width,
      height,
    },
    minimumWidth,
    minimumHeight,
  };
}
