// Proof photo for a PHOTO_PROOF task: take a picture with the camera (expo-image-picker), upload it
// to the signed URL from POST /v1/uploads/sign, return the path for `proofPath`.
import * as ImagePicker from 'expo-image-picker';
import { childApi } from '../api.ts';
import { AppError, unwrap } from './api-error.ts';

type ProofType = 'image/jpeg' | 'image/png' | 'image/webp';

export class CameraDeniedError extends Error {}

const proofType = (mime: string | undefined): ProofType =>
  mime === 'image/png' || mime === 'image/webp' ? mime : 'image/jpeg';

/** Returns the uploaded path, or null if the child closed the camera. */
export async function takeAndUploadProof(taskId: string): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new CameraDeniedError('camera permission denied');
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 0.6,
    exif: false,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const contentType = proofType(asset.mimeType);
  const signed = await unwrap(
    childApi.POST('/api/v1/uploads/sign', {
      body: { purpose: 'TASK_PROOF', taskId, contentType },
    }),
  );
  let res: Response;
  try {
    const file = await (await fetch(asset.uri)).blob();
    res = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      body: file,
    });
  } catch {
    throw new AppError('offline', 0);
  }
  if (!res.ok) throw new AppError('api', res.status);
  return signed.path;
}
