import { requestPermission, findNotes, notesInfo, storeMediaFile, updateMediaFields } from '../services/ankiService'

chrome.runtime.onInstalled.addListener(async (opt) => {
  if (opt.reason === 'install') {
    await chrome.storage.local.clear()

    chrome.tabs.create({
      active: true,
      url: chrome.runtime.getURL('./installed.html'),
    })
  }
})

async function checkBasicSettings(settings: any) {
  if (!settings.ankiPreferences.serverAddress) {
    throw new Error(
      'Could not find Anki server address. Please make sure Anki and Ankiconnect are working properly.'
    )
  }
  if (!settings.ankiPreferences.settings.current.deck) {
    throw new Error(
      'Could not find deck to export. Please make sure you choose a deck on the NadeDB page.'
    )
  }
  if (!settings.ankiPreferences.settings.current.model) {
    throw new Error(
      'Could not find model to export. Please make sure you choose a model on the NadeDB page.'
    )
  }
  const allFieldsEmpty = settings.ankiPreferences.settings.current.fields.every(
    (field: { value: any }) => !field.value
  )
  if (allFieldsEmpty) {
    throw new Error(
      'All field values are empty. Please make sure you have configured the fields properly on the NadeDB page.'
    )
  }
}

async function updateAnkiCard(settings: any, sentence: any) {

  // Obtiene la nota más reciente
  let notes = await findNotes(
    settings.ankiPreferences.settings.current.deck,
    settings.ankiPreferences.settings.current.model
  )
  console.log(notes)
  
  // Extrae la información de la nota
  let infoCard = await notesInfo(notes)
  console.log(infoCard)
  
  // Almacena el contenido multimedia en Anki
  let mediaStored = await storeMediaFile(sentence)
  console.log(mediaStored)
  
  // Actualiza la ultima tarjeta insertada
  let resultUpdate = await updateMediaFields(infoCard, mediaStored, settings.ankiPreferences.settings.current.fields, sentence)
  console.log(resultUpdate)

}

async function handleRequest(request: any) {
  try {
    if (crossOriginIsolated || !crossOriginIsolated) {
      if (request.action === 'updateAnkiCard') {
        console.log(request)
        await checkBasicSettings(request.settings)
        await updateAnkiCard(request.settings, request.sentence)
        return { status: 200, message: 'Success' }
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      return { status: 400, error: error.message }
    } else {
      return { status: 500, error: 'Internal Server Error' }
    }
  }
}

chrome.runtime.onMessageExternal.addListener(
  (request, sender, sendResponse) => {
    handleRequest(request).then((response: any) => {
      sendResponse(response)
    })
    return true
  }
)
