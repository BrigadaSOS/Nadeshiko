import { ref } from 'vue'

let currentAudio: HTMLAudioElement | null = null;
export const isAudioPlaying: Record<string, boolean> = reactive({});

export async function playAudio(url: string, uuid: string, nextUrl?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    
    // Detener el audio actual si se está reproduciendo
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      const playingUuid = Object.keys(isAudioPlaying).find(key => isAudioPlaying[key]);
      if (playingUuid) {
        delete isAudioPlaying[playingUuid]; // Limpiar el estado del audio que se detuvo
      }
    }

    console.log(uuid)

    currentAudio = new Audio(url);
    currentAudio.play();
    isAudioPlaying[uuid] = true;

    // Precargar el siguiente audio si está disponible
    if (nextUrl) {
      const nextAudio = new Audio(nextUrl);
      nextAudio.preload = 'auto';
    }

    currentAudio.onended = () => {
      currentAudio = null;
      isAudioPlaying[uuid] = false;
      delete isAudioPlaying[uuid]; 
      resolve();
    };

    currentAudio.onerror = (error) => {
      currentAudio = null;
      isAudioPlaying[uuid] = false;
      delete isAudioPlaying[uuid]; 
      reject(error);
    };
  });
}


export async function playSequentialAudio(audioUrls: string[], sentenceUuid: string) {
  for (let i = 0; i < audioUrls.length; i++) {
    const currentUrl = audioUrls[i];
    const nextUrl = audioUrls[i + 1]; // Precarga el siguiente si existe
    await playAudio(currentUrl, sentenceUuid, nextUrl);
  }
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

export function zoomImage(url: string) {
  var ampliada = document.createElement('div')
  ampliada.className = 'ampliada'
  var imgAmpliada = document.createElement('img')
  imgAmpliada.src = url
  ampliada.appendChild(imgAmpliada)
  document.body.appendChild(ampliada)
  ampliada.onclick = function () {
    document.body.removeChild(ampliada)
  }
}

const stripHTMLTags = (html: string): string => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
};

export async function copyToClipboard(item: any) {
  const { $i18n } = useNuxtApp()
  const message = $i18n.t('searchpage.main.labels.copiedcontent')
  await navigator.clipboard.writeText(stripHTMLTags(item))
  useToastSuccess(message)
}

export async function getSharingURL(uuid: any){
  const { $i18n } = useNuxtApp()
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/search/sentence?uuid=${uuid}`)
    const message = $i18n.t('searchpage.main.labels.copiedsharingurl')
    useToastSuccess(message)
  } catch (error) {
    const message = $i18n.t('searchpage.main.labels.errorcopiedsharingurl')
    useToastError(message)
  }
}

