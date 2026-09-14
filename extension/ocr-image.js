function canvasToBlob(canvas, type = "image/png") {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob && blob.size) resolve(blob);
      else reject(new Error(`Canvas could not encode ${type}`));
    }, type);
  });
}

async function decodeWithImageElement(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    if (typeof image.decode === "function") await image.decode();
    else await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("HTMLImageElement could not decode image"));
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("Decoded image has zero dimensions");
    return image;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function thresholdCanvas(sourceCanvas, threshold = 190) {
  const out = document.createElement("canvas");
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const context = out.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) return null;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, out.width, out.height);
  context.drawImage(sourceCanvas, 0, 0);
  const image = context.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < image.data.length; i += 4) {
    const r = image.data[i];
    const g = image.data[i + 1];
    const b = image.data[i + 2];
    const luminance = (r * 299 + g * 587 + b * 114) / 1000;
    const value = luminance < threshold ? 0 : 255;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return out;
}

async function rightCodeCrop(sourceCanvas, ratio = 0.30) {
  const cropWidth = Math.max(120, Math.round(sourceCanvas.width * ratio));
  const x = Math.max(0, sourceCanvas.width - cropWidth);
  const pad = Math.max(14, Math.round(sourceCanvas.height * 0.12));
  const canvas = document.createElement("canvas");
  canvas.width = cropWidth + pad * 2;
  canvas.height = sourceCanvas.height + pad * 2;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return { normal: null, threshold: null };
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(sourceCanvas, x, 0, cropWidth, sourceCanvas.height, pad, pad, cropWidth, sourceCanvas.height);
  const binary = thresholdCanvas(canvas, 188);
  return {
    normal: await canvasToBlob(canvas, "image/png"),
    threshold: binary ? await canvasToBlob(binary, "image/png") : null
  };
}

export async function normaliseImageBlob(blob) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error("Image response was empty");

  let source;
  let width = 0;
  let height = 0;
  let close = () => {};
  let bitmapError = "";

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      source = bitmap;
      width = bitmap.width;
      height = bitmap.height;
      close = () => bitmap.close?.();
    } catch (error) {
      bitmapError = error instanceof Error ? error.message : String(error);
    }
  }

  if (!source) {
    try {
      const image = await decodeWithImageElement(blob);
      source = image;
      width = image.naturalWidth;
      height = image.naturalHeight;
    } catch (error) {
      const fallbackError = error instanceof Error ? error.message : String(error);
      throw new Error(`Browser could not decode image${bitmapError ? ` (ImageBitmap: ${bitmapError}; Image: ${fallbackError})` : ` (${fallbackError})`}`);
    }
  }

  try {
    if (!width || !height) throw new Error("Decoded image has zero dimensions");
    // Attendance-code screenshots are often small exports. A special case matters here:
    // Ed sometimes publishes one session as an extremely wide, very short strip. Scaling
    // only by width leaves the glyphs ~80px tall and Tesseract can return nothing at all.
    // For those one-row strips, scale primarily by height (while capping total width).
    const wideShort = width / Math.max(1, height) >= 4 && height <= 160;
    const scale = wideShort
      ? Math.max(1, Math.min(6, 280 / Math.max(1, height), 5200 / Math.max(1, width)))
      : (width < 1800 ? Math.min(2.4, 2200 / width, 2600 / height) : 1);
    const outWidth = Math.max(1, Math.round(width * scale));
    const outHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = outWidth;
    canvas.height = outHeight;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas 2D context is unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, outWidth, outHeight);
    if ("filter" in context) context.filter = "grayscale(1) contrast(1.35)";
    context.drawImage(source, 0, 0, outWidth, outHeight);
    const png = await canvasToBlob(canvas, "image/png");

    // Keep a dedicated crop of the rightmost column. In the real FIT2102 Ed post the
    // Workshop row is a short, wide image and page-level OCR repeatedly reads the row
    // metadata while dropping only the far-right JY4H6. Isolating the code column and
    // applying a whitelist gives Tesseract a much easier recognition task.
    const codeZone = outWidth / Math.max(1, outHeight) >= 2.2
      ? await rightCodeCrop(canvas, 0.22)
      : { normal: null, threshold: null };

    let topBlob = null;
    let topCodeBlob = null;
    let topCodeThresholdBlob = null;
    const rowBlobs = [];
    const rowCodeBlobs = [];
    const rowCodeThresholdBlobs = [];
    if (outHeight >= 180) {
      const topHeight = Math.min(outHeight, Math.max(120, Math.round(outHeight * 0.42)));
      const topCanvas = document.createElement("canvas");
      topCanvas.width = outWidth;
      topCanvas.height = topHeight;
      const topContext = topCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
      if (topContext) {
        topContext.fillStyle = "#fff";
        topContext.fillRect(0, 0, outWidth, topHeight);
        topContext.drawImage(canvas, 0, 0, outWidth, topHeight, 0, 0, outWidth, topHeight);
        topBlob = await canvasToBlob(topCanvas, "image/png");
        const topCode = await rightCodeCrop(topCanvas, 0.22);
        topCodeBlob = topCode.normal;
        topCodeThresholdBlob = topCode.threshold;

        try {
          const imageData = topContext.getImageData(0, 0, outWidth, topHeight).data;
          const sampleStep = 2;
          const minInk = Math.max(6, Math.round(outWidth / 180));
          const active = new Array(topHeight).fill(false);
          for (let y = 0; y < topHeight; y += 1) {
            let ink = 0;
            for (let x = 0; x < outWidth; x += sampleStep) {
              const offset = (y * outWidth + x) * 4;
              const r = imageData[offset];
              const g = imageData[offset + 1];
              const b = imageData[offset + 2];
              const luminance = (r * 299 + g * 587 + b * 114) / 1000;
              if (luminance < 185) ink += 1;
            }
            active[y] = ink >= minInk;
          }

          const maxGap = Math.max(4, Math.round(outHeight / 260));
          let lastActive = -Infinity;
          for (let y = 0; y < active.length; y += 1) {
            if (!active[y]) continue;
            if (y - lastActive > 1 && y - lastActive <= maxGap + 1) {
              for (let fill = lastActive + 1; fill < y; fill += 1) active[fill] = true;
            }
            lastActive = y;
          }

          const bands = [];
          let start = -1;
          for (let y = 0; y <= active.length; y += 1) {
            const on = y < active.length && active[y];
            if (on && start < 0) start = y;
            if ((!on || y === active.length) && start >= 0) {
              const end = y - 1;
              if (end - start + 1 >= 5) bands.push([start, end]);
              start = -1;
            }
          }

          const padY = Math.max(8, Math.round(outHeight / 150));
          for (const [rawStart, rawEnd] of bands.slice(0, 6)) {
            const cropY = Math.max(0, rawStart - padY);
            const cropEnd = Math.min(topHeight, rawEnd + padY + 1);
            const cropHeight = cropEnd - cropY;
            if (cropHeight < 18) continue;
            const rowCanvas = document.createElement("canvas");
            rowCanvas.width = outWidth;
            rowCanvas.height = cropHeight;
            const rowContext = rowCanvas.getContext("2d", { alpha: false });
            if (!rowContext) continue;
            rowContext.fillStyle = "#fff";
            rowContext.fillRect(0, 0, outWidth, cropHeight);
            rowContext.drawImage(topCanvas, 0, cropY, outWidth, cropHeight, 0, 0, outWidth, cropHeight);
            rowBlobs.push(await canvasToBlob(rowCanvas, "image/png"));
            const rowCode = await rightCodeCrop(rowCanvas, 0.22);
            rowCodeBlobs.push(rowCode.normal);
            rowCodeThresholdBlobs.push(rowCode.threshold);
          }
        } catch {
          // Projection/cropping are rescue paths only. Full-image OCR still runs.
        }
      }
    }

    return {
      blob: png,
      topBlob,
      codeBlob: codeZone.normal,
      codeThresholdBlob: codeZone.threshold,
      topCodeBlob,
      topCodeThresholdBlob,
      rowBlobs,
      rowCodeBlobs,
      rowCodeThresholdBlobs,
      width: outWidth,
      height: outHeight,
      originalWidth: width,
      originalHeight: height,
      originalType: blob.type || "unknown",
      wideShort
    };
  } finally {
    close();
  }
}

function hex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(" ");
}

export async function describeImageBlob(blob, contentType = "") {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  let preview = "";
  const type = String(contentType || blob.type || "").toLowerCase();
  if (/text|html|json|xml/.test(type)) {
    preview = (await blob.slice(0, 160).text()).replace(/\s+/g, " ").trim().slice(0, 120);
  }
  return [
    `content-type=${contentType || blob.type || "unknown"}`,
    `size=${blob.size}`,
    `magic=${hex(bytes) || "empty"}`,
    preview ? `preview=${JSON.stringify(preview)}` : ""
  ].filter(Boolean).join(", ");
}
