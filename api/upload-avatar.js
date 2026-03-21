import Busboy from "busboy";
import { put } from "@vercel/blob";
import sharp from "sharp";

const MAX_DIMENSION = 256; 
const WEBP_QUALITY = 80; 
const WEBP_EFFORT = 6; 
const ALPHA_QUALITY = 80; 
const MAX_INPUT_MB = 10;
const MAX_INPUT_BYTES = MAX_INPUT_MB * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg", 
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
]);

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "10mb",
  },
};

function parseBusboy(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: req.headers,
      limits: {
        fileSize: MAX_INPUT_BYTES,
        files: 1,
        fields: 1, // Changed to 1 to allow our new imageUrl field
      },
    });

    let fileBuffer = null;
    let filename = "avatar";
    let mimetype = "application/octet-stream";
    let fileTooLarge = false;
    let imageUrl = null; // Track the pasted URL

    bb.on("file", (fieldname, stream, info) => {
      filename = info.filename || "avatar";
      mimetype = info.mimeType || "application/octet-stream";

      const chunks = [];

      stream.on("data", (chunk) => {
        chunks.push(chunk);
      });

      stream.on("limit", () => {
        fileTooLarge = true;
        stream.resume();
      });

      stream.on("end", () => {
        if (!fileTooLarge) {
          fileBuffer = Buffer.concat(chunks);
        }
      });

      stream.on("error", reject); 
    });

    // Capture the pasted URL from the form data
    bb.on("field", (fieldname, val) => {
      if (fieldname === "imageUrl") {
        imageUrl = val;
      }
    });

    bb.on("close", () => {
      if (fileTooLarge) {
        reject(new RangeError(`FILE_TOO_LARGE`));
        return;
      }
      // Require either a physical file OR a pasted URL
      if (!fileBuffer && !imageUrl) {
        reject(new TypeError("NO_FILE_FOUND"));
        return;
      }
      resolve({ fileBuffer, filename, mimetype, imageUrl });
    });

    bb.on("error", reject); 
    req.pipe(bb);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    let fileBuffer, filename, mimetype, imageUrl;

    try {
      ({ fileBuffer, filename, mimetype, imageUrl } = await parseBusboy(req));
    } catch (parseErr) {
      if (
        parseErr instanceof RangeError &&
        parseErr.message.startsWith("FILE_TOO_LARGE")
      ) {
        return res.status(413).json({
          error: `File too large. Maximum allowed size is 10 MB.`,
        });
      }
      if (
        parseErr instanceof TypeError &&
        parseErr.message === "NO_FILE_FOUND"
      ) {
        return res.status(400).json({
          error:
            'No file or URL received. Send an image file or a valid URL.',
        });
      }
      throw parseErr;
    }

    // If a URL was provided, download it on the server before compressing
    if (imageUrl) {
      try {
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) {
           return res.status(400).json({ error: `Could not fetch image from URL. Server responded with ${imgRes.status}.` });
        }
        const arrayBuffer = await imgRes.arrayBuffer();
        fileBuffer = Buffer.from(arrayBuffer);
        
        const urlPath = new URL(imageUrl).pathname;
        filename = urlPath.split('/').pop() || 'avatar_from_url';
        mimetype = imgRes.headers.get('content-type') || 'application/octet-stream';
      } catch (err) {
        return res.status(400).json({ error: "Invalid URL or the image could not be downloaded." });
      }
    }

    if (!ALLOWED_TYPES.has(mimetype)) {
      return res.status(415).json({
        error: `Unsupported file type "${mimetype}". Allowed: JPEG, PNG, GIF, WebP, BMP, TIFF.`,
      });
    }

    const processedBuffer = await sharp(fileBuffer)
      .rotate()
      .resize(MAX_DIMENSION, MAX_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({
        quality: WEBP_QUALITY,
        effort: WEBP_EFFORT,
        alphaQuality: ALPHA_QUALITY,
      })
      .toBuffer();

    const rawBase = (filename || "avatar").replace(/\.[^.]+$/, ""); 
    const safeName =
      rawBase
        .replace(/\s+/g, "_") 
        .replace(/[^a-zA-Z0-9_-]/g, "") 
        .slice(0, 60) || 
      "avatar"; 

    const uniqueSuffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
    const blobPath = `avatars/${safeName}_${uniqueSuffix}.webp`;

    const blob = await put(blobPath, processedBuffer, {
      access: "public",
      contentType: "image/webp",
      addRandomSuffix: false,
    });

    const inputKB = (fileBuffer.byteLength / 1024).toFixed(1);
    const outputKB = (processedBuffer.byteLength / 1024).toFixed(1);
    console.log(
      `[upload-avatar] ${filename} | ${inputKB} KB → ${outputKB} KB (WebP) | ${blob.url}`,
    );

    return res.status(200).json({
      url: blob.url,
      sizeKB: Number(outputKB),
      message: "Avatar processed successfully.",
    });
  } catch (err) {
    console.error("[upload-avatar] Unexpected error:", err);
    const detail =
      process.env.NODE_ENV === "development" ? err.message : undefined;

    return res.status(500).json({
      error: "Server error while processing the upload.",
      details: detail,
    });
  }
}