// lib/converter.js
//
// Small ffmpeg-based conversion helpers for NEXUS-MD.
// Requires the `ffmpeg` binary to be installed and on PATH
// (e.g. `apt install ffmpeg` on the Railway/Debian image, or
// bundled via the `ffmpeg-static` npm package — see note at bottom).

const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Prefer the `FFMPEG_PATH` env var (handy if using ffmpeg-static),
// otherwise fall back to whatever `ffmpeg` resolves to on PATH.
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';

function tmpFile(ext) {
  return path.join(os.tmpdir(), `nexus-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext ? `.${ext}` : ''}`);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG_BIN, args);

    let stderr = '';
    ff.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ff.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`ffmpeg binary not found ("${FFMPEG_BIN}"). Install ffmpeg or set FFMPEG_PATH.`));
      } else {
        reject(new Error(`ffmpeg failed to start: ${err.message}`));
      }
    });

    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim().slice(-500)}`));
    });
  });
}

async function cleanup(paths) {
  await Promise.all(paths.map((p) => fsp.unlink(p).catch(() => {})));
}

/**
 * Run an ffmpeg conversion on an in-memory buffer by round-tripping
 * through temp files (ffmpeg needs seekable files for most containers).
 */
async function convert(inputBuffer, { inputExt = '', outputExt, args }) {
  const inputPath = tmpFile(inputExt);
  const outputPath = tmpFile(outputExt);

  await fsp.writeFile(inputPath, inputBuffer);

  try {
    await runFfmpeg(['-y', '-i', inputPath, ...args, outputPath]);
    return await fsp.readFile(outputPath);
  } finally {
    await cleanup([inputPath, outputPath]);
  }
}

/**
 * Convert any audio/video buffer to a standard MP3 buffer.
 * Used by the `play` command to normalize whatever the download
 * API returns (webm/m4a/opus/etc.) into an mp3 WhatsApp can play.
 *
 * @param {Buffer} inputBuffer
 * @param {{ bitrate?: string }} [options]
 * @returns {Promise<Buffer>}
 */
async function toAudio(inputBuffer, options = {}) {
  const { bitrate = '128k' } = options;
  return convert(inputBuffer, {
    outputExt: 'mp3',
    args: ['-vn', '-ar', '44100', '-ac', '2', '-b:a', bitrate, '-f', 'mp3'],
  });
}

/**
 * Convert audio to WhatsApp voice-note format (mono OGG/Opus).
 *
 * @param {Buffer} inputBuffer
 * @returns {Promise<Buffer>}
 */
async function toPTT(inputBuffer) {
  return convert(inputBuffer, {
    outputExt: 'ogg',
    args: ['-vn', '-ar', '48000', '-ac', '1', '-c:a', 'libopus', '-b:a', '64k', '-f', 'ogg'],
  });
}

/**
 * Normalize a video buffer to MP4 (H.264/AAC), useful if a downloader
 * API returns a container WhatsApp can't preview (mkv/avi/webm/etc.).
 *
 * @param {Buffer} inputBuffer
 * @returns {Promise<Buffer>}
 */
async function toVideo(inputBuffer) {
  return convert(inputBuffer, {
    outputExt: 'mp4',
    args: ['-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-movflags', '+faststart'],
  });
}

module.exports = { toAudio, toPTT, toVideo };
