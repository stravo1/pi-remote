/** The largest side of an attached image after downscaling. */
const maxDimension = 1568;

export interface AttachedImage {
  /** Base64 without the data URL prefix, as the prompt command expects. */
  data: string;
  mimeType: string;
  /** Data URL for an <img> preview. */
  preview: string;
}

/**
 * Reads an image file and downscales it to fit within `maxDimension`, so a
 * phone photo does not arrive at the server as megabytes of base64.
 */
export async function readImageFile(file: File): Promise<AttachedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  let mimeType = ["image/png", "image/jpeg", "image/webp"].includes(file.type) ? file.type : "image/png";
  let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType));
  // PNG screenshots of photos can balloon; fall back to JPEG when it helps.
  if (mimeType === "image/png" && blob && blob.size > 1024 * 1024) {
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (jpeg && jpeg.size < blob.size) {
      blob = jpeg;
      mimeType = "image/jpeg";
    }
  }
  if (!blob) throw new Error("The image could not be read.");
  return { data: await blobToBase64(blob), mimeType, preview: URL.createObjectURL(blob) };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
