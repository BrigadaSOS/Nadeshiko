// addSentenceToAnki function is used to add a sentence to Anki
// It sends a message to the background script with the sentence and the id of the note to update.
// If the id is null, it will use the id of the last note added.
export const addSentenceToAnki = (sentence: Sentence, id: number | null = null) => {

  useToastInfo("Minando la carta...");

  const localSettings = localStorage.getItem('settings');
  if (!localSettings) {
    const message = 'No se han encontrado ajustes. Por favor, vaya a la página de ajustes y configure la extensión.'
    useToastError(message);
    return;
  }

  const settings = JSON.parse(localSettings)
  const config = useRuntimeConfig();
  const extensionId = config.public.NUXT_APP_EXTENSION_KEY;
  const request = {
    action: 'updateAnkiCard',
    settings: settings,
    sentence: sentence,
    id: id,
  }

  chrome.runtime.sendMessage(extensionId, request, (response) => {
    console.log(response)
    if (response.error) {
      const message = 'No se ha podido añadir la tarjeta en Anki. Error: ' + response.error
      useToastError(message);
    } else {
      const message = 'La tarjeta ha sido añadida en Anki'
      useToastSuccess(message);
    }
  })
};
