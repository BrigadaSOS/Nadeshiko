export async function executeAction(action, params = {}) {
  try {
    const response = await fetch('http://127.0.0.1:8765', {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: action,
        params: params,
        version: 6,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch ${action}.`)
    }

    return await response.json()
  } catch (error) {
    console.error(`Error while requesting ${action}:`, error)
    throw error
  }
}

export async function requestPermission() {
  let response = await executeAction('requestPermission')
  return response.result.permission
}

export async function findNotes(deck, noteType) {
  let queryParts = []
  let queryString = ''

  queryParts.push(`"deck:${deck}"`)
  queryParts.push(`"note:${noteType}"`)
  queryParts.push(`added:2`);
  queryParts.push("is:new");

  queryString = queryParts.join(" ");
  
  let response = await executeAction('findNotes', { query: queryString })
  return response.result
}

export async function notesInfo(notes) {
  let response = await executeAction('notesInfo', { notes: notes })
  return response.result
}

export async function storeMediaFile(sentenceData) {
  let result = []
  let imageResult = await executeAction('storeMediaFile', { filename: sentenceData.segment_info.uuid+'.webp', url: sentenceData.media_info.path_image })
  let audioResult = await executeAction('storeMediaFile', { filename: sentenceData.segment_info.uuid+'.mp3', url: sentenceData.media_info.path_audio })

  result.push(imageResult)
  result.push(audioResult)

  return result
}