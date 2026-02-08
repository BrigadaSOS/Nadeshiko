type ConcatenatedAudio = {
  blob: Blob;
  blob_url: string;
};

let audioContext: AudioContext | null;
export async function concatenateAudios(urls: string[]): Promise<ConcatenatedAudio> {
  // https://ccrma.stanford.edu/courses/422-winter-2014/projects/WaveFormat/
  function encodeWAV(samples: Float32Array, channels: number, sampleRate: number): DataView {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    function writeString(view: DataView, offset: number, string: string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    // ChunkID: Contains the letters "RIFF" in ASCII form
    writeString(view, 0, 'RIFF');

    // ChunkSize: 36 + SubChunk2Size
    view.setUint32(4, 36 + samples.length * 2, true);

    // Format: Contains the letters "WAVE"
    writeString(view, 8, 'WAVE');

    // Subchunk1ID: the letters "fmt "
    writeString(view, 12, 'fmt ');

    // Subchunk1Size: 16 for PCM.
    view.setUint32(16, 16, true);

    // AudioFormat: PCM = 1 (i.e. Linear quantization)
    // Values other than 1 indicate some form of compression.
    view.setUint16(20, 1, true);

    // NumChannels: Mono = 1, Stereo = 2, etc
    view.setUint16(22, channels, true);

    // SampleRate: 8000, 44100
    view.setUint32(24, sampleRate, true);

    // ByteRate: == SampleRate * NumChannels * BitsPerSample/8
    view.setUint32(28, sampleRate * channels * 2, true);

    // BlockAlign: == NumChannels * BitsPerSample/8
    view.setUint16(32, channels * 2, true);

    // BitsPerSample: 8 bits = 8, 16 bits = 16, etc.
    view.setUint16(34, 16, true);

    // The "data" subchunk contains the size of the data and the actual sound:

    // Subchunk2ID: Contains the letters "data"
    writeString(view, 36, 'data');

    // Subchunk2Size: == NumSamples * NumChannels * BitsPerSample/8
    view.setUint32(40, samples.length * 2, true);

    // Data: The actual sound data.
    floatTo16BitPCM(view, 44, samples);

    return view;
  }

  function floatTo16BitPCM(view: DataView, offset: number, input: Float32Array) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, input[i] ?? 0));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }

  const audioBuffers = [];
  if (!audioContext) {
    audioContext = new AudioContext();
    console.log(`[Creation] AudioContext with Sample Rate of ${audioContext.sampleRate}`);
  }

  const audioRes = await Promise.all(urls.map((url) => fetch(url)));
  for (const res of audioRes) {
    audioBuffers.push(await audioContext.decodeAudioData(await res.arrayBuffer()));
  }

  // Should always be 2, but just in case
  const channels = Math.max(...audioBuffers.map((b) => b.numberOfChannels));
  const length = audioBuffers.map((b) => b.length).reduce((a, c) => a + c, 0);
  const firstBuffer = audioBuffers[0];
  if (!firstBuffer) {
    throw new Error('No audio buffers to concatenate');
  }
  const sampleRate = firstBuffer.sampleRate;

  const output = audioContext.createBuffer(channels, length, sampleRate);
  console.log(`AudioContext Sample Rate: ${audioContext.sampleRate}`);
  console.log(`Output Sample Rate: ${sampleRate}`);

  let offset = 0;

  audioBuffers.forEach((buffer) => {
    for (let channelNumber = 0; channelNumber < buffer.numberOfChannels; channelNumber++) {
      output.getChannelData(channelNumber).set(buffer.getChannelData(channelNumber), offset);
    }

    offset += buffer.length;
  });

  // AudioArray/Audiobuffer -> wav
  const interleaved = new Float32Array(length * channels);
  for (let channel = 0; channel < channels; channel++) {
    const channelData = output.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      interleaved[i * channels + channel] = channelData[i] ?? 0;
    }
  }

  const wav = encodeWAV(interleaved, channels, sampleRate);
  const wavArrayBuffer = new ArrayBuffer(wav.byteLength);
  new Uint8Array(wavArrayBuffer).set(new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength));
  const blob = new Blob([wavArrayBuffer], { type: 'audio/wav' });
  const blobUrl = window.URL.createObjectURL(blob);

  return {
    blob: blob,
    blob_url: blobUrl,
  };
}

export function downloadAudioOrImage(url: string | URL | Request, filename: string, isBlobUrl = false) {
  if (isBlobUrl) {
    const a = document.createElement('a');
    a.href = url as string;
    a.download = filename.replace('mp3', 'wav');
    a.click();
    return;
  }

  fetch(url)
    .then((response) => response.blob())
    .then((blob) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = filename;
      a.href = url;
      a.click();
      window.URL.revokeObjectURL(url);
    });
}

export function zoomImage(url: string) {
  const ampliada = document.createElement('div');
  ampliada.className = 'ampliada';
  const imgAmpliada = document.createElement('img');
  imgAmpliada.src = url;
  ampliada.appendChild(imgAmpliada);
  document.body.appendChild(ampliada);
  ampliada.onclick = () => {
    document.body.removeChild(ampliada);
  };
}

const stripHTMLTags = (html: string): string => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
};

export async function copyToClipboard(item: string) {
  const { $i18n } = useNuxtApp();
  const message = $i18n.t('searchpage.main.labels.copiedcontent');
  await navigator.clipboard.writeText(stripHTMLTags(item));
  useToastSuccess(message);
}

export async function getSharingURL(uuid: string) {
  const { $i18n } = useNuxtApp();
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/search/sentence?uuid=${uuid}`);
    const message = $i18n.t('searchpage.main.labels.copiedsharingurl');
    useToastSuccess(message);
  } catch (_error) {
    const message = $i18n.t('searchpage.main.labels.errorcopiedsharingurl');
    useToastError(message);
  }
}
