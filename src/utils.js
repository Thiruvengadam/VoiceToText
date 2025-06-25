// utils.js

/**
 * Decode base64 string to ArrayBuffer
 */
export function decode(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Decode binary WAV/PCM data to AudioBuffer
 */
export async function decodeAudioData(buffer, audioContext, sampleRate = 24000, channels = 1) {
  if (audioContext.decodeAudioData.length === 1) {
    // Modern promise-based API
    return await audioContext.decodeAudioData(buffer);
  }

  // Fallback to callback-style decodeAudioData
  return new Promise((resolve, reject) => {
    audioContext.decodeAudioData(
      buffer,
      decoded => resolve(decoded),
      error => reject(error)
    );
  });
}

/**
 * Convert Float32 PCM samples to Blob (for upstream streaming)
 */
export function createBlob(float32Array) {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    int16Array[i] = Math.max(-1, Math.min(1, float32Array[i])) * 0x7fff;
  }
  return new Blob([int16Array], { type: 'application/octet-stream' });
}
