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

// findNotes looks for notes in the deck with the given note type and query.
// The default query is 'is:new' to prevent making a big request in case is not specified.
export async function findNotes(deck, noteType, query = 'is:new') {
  let queryParts = []
  let queryString = ''

  queryParts.push(`"deck:${deck}"`)
  queryParts.push(`"note:${noteType}"`)
  queryParts.push(query)

  queryString = queryParts.join(' ')

  let response = await executeAction('findNotes', { query: queryString })
  return response.result
}

export async function notesInfo(notes) {
  let response = await executeAction('notesInfo', { notes: notes })
  return response.result
}

export async function storeMediaFile(sentenceData) {
  let result = {}

  let imageResult = await executeAction('storeMediaFile', {
    filename: sentenceData.segment_info.uuid + '.webp',
    url: sentenceData.media_info.path_image,
  })

  let audioResult = await executeAction('storeMediaFile', {
    filename: sentenceData.segment_info.uuid + '.mp3',
    url: sentenceData.media_info.path_audio,
  })

  result['image'] = imageResult
  result['audio'] = audioResult

  return result
}

export async function updateMediaFields(
  infoCard,
  mediaStored,
  fields,
  sentence
) {
  let allowedFields = [
    'sentence-jp',
    'content_jp_highlight',
    'sentence-es',
    'sentence-en',
    'image',
    'sentence-audio',
    'empty',
  ]
  let fieldsNew = {}

  fields.forEach((field) => {
    if (field.value) {
      const regex = new RegExp(`\\{(${allowedFields.join('|')})\\}`)
      const match = field.value.match(regex)

      if (match) {
        const key = match[1]

        switch (key) {
          case 'empty':
            fieldsNew[field.key] = field.value.replace(`{${key}}`, '')
            break
          case 'sentence-jp':
            fieldsNew[field.key] = field.value.replace(
              `{${key}}`,
              '<div>' + sentence.segment_info.content_jp + '</div>'
            )
            break
          case 'sentence-es':
            fieldsNew[field.key] = field.value.replace(
              `{${key}}`,
              '<div>' + sentence.segment_info.content_es + '</div>'
            )
            break
          case 'sentence-en':
            fieldsNew[field.key] = field.value.replace(
              `{${key}}`,
              '<div>' + sentence.segment_info.content_en + '</div>'
            )
            break
          case 'image':
            fieldsNew[field.key] = field.value.replace(
              `{${key}}`,
              `<img src="${mediaStored.image.result}">`
            )
            break
          case 'sentence-audio':
            fieldsNew[field.key] = field.value.replace(
              `{${key}}`,
              `[sound:${mediaStored.audio.result}]`
            )
            break
        }
      }
    }
  })

  let response = await executeAction('updateNoteFields', {
    note: {
      fields: fieldsNew,
      id: infoCard[0].noteId,
    },
  })

  return response
}

export async function guiBrowse(query) {
  let response = await executeAction('guiBrowse', { query: query })
  return response.result
}
