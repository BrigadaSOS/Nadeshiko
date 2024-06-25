import {
  requestPermission,
  findNotes,
  notesInfo,
  storeMediaFile,
  updateMediaFields,
  guiBrowse,
} from '../services/ankiService'

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
      'Could not find Anki server address. Please make sure URL is properly setted.'
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

// id can be number or null
async function updateAnkiCard(settings: any, sentence: any, id: number | null = null) {

  let cardID = id;

  if (!id) {
    // Obtiene las notas más reciente
    let noteIDs = await findNotes(
      settings.ankiPreferences.settings.current.deck,
      settings.ankiPreferences.settings.current.model,
      "added:2 is:new"
    )
    const latestCard = noteIDs.reduce((a, b) => Math.max(a, b), -1)
    if (!latestCard || latestCard === -1) {
      throw new Error('No anki card to export to. Please add a card first.')
    }
    console.log(noteIDs, latestCard)
    cardID = latestCard;
  } else {
    console.log('Updating card with ID:', cardID)
    // checkear si la tarjeta con ese id existe
  }


  // Extrae la información de la nota
  let infoCard = await notesInfo([cardID])
  console.log(infoCard)

  // Almacena el contenido multimedia en Anki
  let mediaStored = await storeMediaFile(sentence)
  console.log(mediaStored)

  // Realiza una busqueda en la interfaz de Anki para cambiar a una tarjeta generica
  // Y evitar problemas al actualizar
  // TODO: manejar el error
  await guiBrowse('nid:1 nid:2')

  // Actualiza la tarjeta correspondiente
  let resultUpdate = await updateMediaFields(
    infoCard,
    mediaStored,
    settings.ankiPreferences.settings.current.fields,
    sentence
  )
  console.log(resultUpdate)

  // Busca la ultima tarjeta insertada
  await guiBrowse(`nid:${infoCard[0].noteId}`)
}

async function handleRequest(request) {
  try {
    if (request.action === 'updateAnkiCard') {
      console.log(request)
      await checkBasicSettings(request.settings)
      await updateAnkiCard(request.settings, request.sentence, request.id)
      return { status: 200, message: 'Success' }
    } else {
      return { status: 400, error: 'Unrecognized action' }
    }
  } catch (error) {
    // Maneja errores conocidos
    if (error instanceof Error) {
      console.error(error)
      return { status: 400, error: error.message }
    }
    console.error('Unhandled error:', error)
    return { status: 500, error: 'Internal Server Error' }
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
