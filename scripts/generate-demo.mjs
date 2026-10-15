import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

// Original procedural tones, no samples or copyrighted recordings. Mono PCM16.
export function createDemoWav({
  seconds = 24,
  root = 220,
  sampleRate = 22050,
  title,
  artist,
} = {}) {
  const frames = Math.round(seconds * sampleRate);
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(frames * 2, 40);
  const notes = [1, 1.25, 1.5, 2, 1.5, 1.25, 1.125, 1.5];
  for (let i = 0; i < frames; i++) {
    const time = i / sampleRate;
    const step = Math.floor(time * 2);
    const envelope = Math.exp(-5 * (time * 2 - step));
    const tone =
      Math.sin(2 * Math.PI * root * notes[step % notes.length] * time) *
      envelope *
      0.22;
    const pad =
      (Math.sin(((2 * Math.PI * root) / 2) * time) +
        Math.sin(2 * Math.PI * root * 0.75 * time)) *
      0.06;
    const fade = Math.min(1, time / 0.5, (seconds - time) / 1.5);
    wav.writeInt16LE(Math.round((tone + pad) * fade * 32767), 44 + i * 2);
  }
  if (!title || !artist) return wav;
  const tags = [
    ["INAM", title],
    ["IART", artist],
  ].map(([key, value]) => {
    const data = Buffer.from(`${value}\0`, "utf8");
    const chunk = Buffer.alloc(8 + data.length + (data.length % 2));
    chunk.write(key);
    chunk.writeUInt32LE(data.length, 4);
    data.copy(chunk, 8);
    return chunk;
  });
  const info = Buffer.concat([Buffer.from("INFO"), ...tags]);
  const header = Buffer.alloc(8);
  header.write("LIST");
  header.writeUInt32LE(info.length, 4);
  const result = Buffer.concat([wav, header, info]);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}

export async function generateDemos(directory) {
  await mkdir(directory, { recursive: true });
  const demos = [
    { id: "orbit", title: "Orbit", root: 220 },
    { id: "soft-focus", title: "Soft focus", root: 174.61 },
    { id: "night-drive", title: "Night drive", root: 261.63 },
  ];
  for (const demo of demos) {
    try {
      await writeFile(
        resolve(directory, `${demo.id}.wav`),
        createDemoWav({ ...demo, artist: "SYNC Originals" }),
        { flag: "wx" },
      );
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const directory = process.argv[2]
    ? resolve(process.argv[2])
    : fileURLToPath(new URL("../media", import.meta.url));
  await generateDemos(directory);
  console.info("Local demo WAVs ready (existing files preserved)");
}
