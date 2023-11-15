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
  if (!settings.ankiPreferences.serverAddress){
    throw new Error('Could not find Anki server address. Please make sure Anki and Ankiconnect are working properly.')
  }
  if (!settings.ankiPreferences.settings.current.deck){
    throw new Error('Could not find deck to export. Please make sure you choose a deck on the NadeDB page.')
  }
  if (!settings.ankiPreferences.settings.current.model){
    throw new Error('Could not find model to export. Please make sure you choose a model on the NadeDB page.')
  }
  const allFieldsEmpty = settings.ankiPreferences.settings.current.fields.every((field: { value: any }) => !field.value);
  if (allFieldsEmpty) {
    throw new Error('All field values are empty. Please make sure you have configured the fields properly on the NadeDB page.');
  }
  
}

async function handleRequest(request: any) {
  if (crossOriginIsolated || !crossOriginIsolated) {
    if(request.action === 'updateAnkiCard'){
      await checkBasicSettings(request.settings)
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
