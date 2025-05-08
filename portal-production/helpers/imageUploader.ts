import { request } from "./request";
import { v4 as uuidv4 } from "uuid";

export function generateShortName() {
  const uuid = uuidv4();
  // Take the first 8 characters of the UUID to form a shorter name
  return uuid.replace(/-/g, "").substring(0, 8);
}

function getFileExtensionFromBlob(blob: Blob | { data: Blob }) {
  const actualBlob = blob instanceof Blob ? blob : blob.data;

  if (!(actualBlob instanceof Blob)) {
    return "unknown";
  }

  const mimeToExt: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  };

  const mimeType = actualBlob.type;

  return mimeToExt[mimeType] || "unknown";
}

export const uploadImage = async ({ blob, folderName, fileName, token }: { blob: Blob | { data: Blob }; folderName: string; fileName?: string; token: string }) => {
  try {
    const actualBlob = blob instanceof Blob ? blob : blob.data;

    if (!(actualBlob instanceof Blob)) {
      throw new Error("Invalid blob structure received.");
    }

    const imageExtension = getFileExtensionFromBlob(actualBlob);
    const finalFileName = `${folderName}/${fileName || generateShortName()}.${imageExtension}`;

    const formData = new FormData();
    formData.append("file", actualBlob, finalFileName);
    formData.append("key", finalFileName);

    const {
      data: { Key },
    } = await request(UPLOAD_IMAGE, formData, token, true, true);

    return Key;
  } catch {
    return "";
  }
};

const UPLOAD_IMAGE = {
  path: "/uploads/image",
  method: "POST",
};
