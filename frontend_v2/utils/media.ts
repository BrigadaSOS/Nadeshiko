let currentAudio = ref<HTMLAudioElement | null>(null);

export async function playAudio(sound: string) {
  // If there is an audio currently playing, it stops
  if (currentAudio.value) {
    currentAudio.value.pause();
    currentAudio.value.currentTime = 0;
  }

  const audio = new Audio(sound);
  currentAudio.value = audio;

  await audio.play();
}

export async function downloadAudioOrImage(url: string | URL | Request, filename: string) {
  fetch(url)
    .then((response) => response.blob())
    .then((blob) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
    });
}
