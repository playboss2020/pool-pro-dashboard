import { useEffect, useState } from "react";

/**
 * Loads an image, samples its top-left pixel as the background color, and
 * replaces all near-matching pixels with transparency. Returns a data URL
 * pointing at the cleaned image (or the original src while loading / on error).
 */
export function useTransparentImage(src: string, tolerance = 32, fade = 20) {
  const [outputSrc, setOutputSrc] = useState<string>(src);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const bgR = data[0];
        const bgG = data[1];
        const bgB = data[2];

        for (let i = 0; i < data.length; i += 4) {
          const dr = data[i] - bgR;
          const dg = data[i + 1] - bgG;
          const db = data[i + 2] - bgB;
          const dist = Math.sqrt(dr * dr + dg * dg + db * db);
          if (dist < tolerance) {
            data[i + 3] = 0;
          } else if (dist < tolerance + fade) {
            data[i + 3] = Math.round(((dist - tolerance) / fade) * 255);
          }
        }

        ctx.putImageData(imageData, 0, 0);
        const cleaned = canvas.toDataURL("image/png");
        if (!cancelled) setOutputSrc(cleaned);
      } catch {
        // CORS or canvas-tainted -- keep original src
      }
    };
    img.src = src;

    return () => {
      cancelled = true;
    };
  }, [src, tolerance, fade]);

  return outputSrc;
}
