import { memo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ToolResultImage } from "@/types";

interface ComputerUseResultProps {
  rawText?: string | null;
  images?: ToolResultImage[];
}

/** Renderer for Cua Driver and legacy desktop Computer Use results. */
export function ComputerUseResult({ rawText, images }: ComputerUseResultProps) {
  return (
    <div className="space-y-2">
      {images && images.length > 0 && <ComputerUseImages images={images} />}
      {rawText && (
        <pre className="max-h-48 overflow-auto rounded-md bg-foreground/[0.04] px-3 py-2 text-[11px] text-foreground/50 whitespace-pre-wrap wrap-break-word">
          {rawText}
        </pre>
      )}
    </div>
  );
}

const ComputerUseImages = memo(function ComputerUseImages({ images }: { images: ToolResultImage[] }) {
  const [zoomed, setZoomed] = useState<ToolResultImage | null>(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {images.map((image, index) => (
          <button
            key={index}
            type="button"
            onClick={() => setZoomed(image)}
            className="overflow-hidden rounded-md border border-foreground/10 transition-colors hover:border-foreground/30"
          >
            <img
              src={image.src}
              alt={image.alt ?? "Computer screenshot"}
              className="max-h-60 max-w-full object-contain"
            />
          </button>
        ))}
      </div>
      <Dialog open={zoomed !== null} onOpenChange={(open) => !open && setZoomed(null)}>
        <DialogContent className="flex max-h-[90vh] max-w-[90vw] items-center justify-center border-none bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">Screenshot preview</DialogTitle>
          <DialogDescription className="sr-only">
            Full-size view of the computer-use screenshot.
          </DialogDescription>
          {zoomed && (
            <img
              src={zoomed.src}
              alt={zoomed.alt ?? "Computer screenshot"}
              className="max-h-[85vh] max-w-[88vw] rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
});
