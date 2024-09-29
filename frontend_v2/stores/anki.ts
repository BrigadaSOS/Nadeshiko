export const ankiStore = defineStore("anki", {
  state: () => ({
    ankiPreferences: {
      serverAddress: "http://127.0.0.1:8765",
      availableDecks: [],
      availableModels: [],
      // TODO: define structure type
      settings: {
        current: {
          deck: null,
          model: null,
          fields: [],
          key: null,
        },
      },
    },
  }),
  persist: {
    key: "settings",
    storage: persistedState.localStorage,
    paths: ["ankiPreferences"],
  },
  actions: {
    async executeAction(action: string, params = {}) {
      try {
        const response = await fetch(this.ankiPreferences.serverAddress, {
          method: "POST",
          mode: "cors",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: action,
            params: params,
            version: 6,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch ${action}.`);
        }

        return await response.json();
      } catch (error) {
        console.error(`Error while requesting ${action}:`, error);
        throw error;
      }
    },

    async loadAnkiData() {
      try {
        let permission = await this.requestPermission();
        let decks = await this.getAllDeckNames();
        let models = await this.getAllModels();

        if (permission !== "granted") {
          throw new Error("Permission was denied.");
        }
        if (decks && Array.isArray(decks)) {
          this.ankiPreferences.availableDecks = decks;
        }
        if (models && Array.isArray(models)) {
          this.ankiPreferences.availableModels = models;
        }
      } catch (error) {
        throw new Error(`Failed to load Anki data: ${error.message}`);
      }
    },

    async requestPermission() {
      let response = await this.executeAction("requestPermission");
      return response.result.permission;
    },

    async getAllDeckNames() {
      let response = await this.executeAction("deckNames");
      return response.result;
    },

    async getAllModels() {
      let response = await this.executeAction("modelNames");
      return response.result;
    },

    async getAllModelFieldNames(modelName: string) {
      let response = await this.executeAction("modelFieldNames", {
        modelName: modelName,
      });
      return response;
    },

    async addSentenceToAnki(sentence: Sentence, id?: number) {
      // TODO: use local store
      // como solucion temporal funciona bien.
      const localSettings = localStorage.getItem('settings');

      if (!localSettings) {
        const message = 'No se han encontrado ajustes. Por favor, vaya a la página de ajustes y configure la extensión.'
        useToastError(message);
        return;
      }

      try {
        useToastInfo("Minando la carta...");

        let cardID = id;

        // Si no hay ID, significa que actualizaremos la ultima carta
        if (!id) {
          // Buscamos las cartas mas recientes 
          let queryParts = []
          let queryString = ''
          queryParts.push(`"deck:${this.ankiPreferences.settings.current.deck}"`)
          queryParts.push(`"note:${this.ankiPreferences.settings.current.model}"`)
          queryParts.push("added:2 is:new")
          queryString = queryParts.join(' ')

          let response = await this.executeAction('findNotes', { query: queryString })
          const noteIDs = response.result

          // Seleccionamos la ultima carta

          // @ts-ignore:ignore-next-line
          const latestCard = noteIDs.reduce((a, b) => Math.max(a, b), -1)

          if (!latestCard || latestCard === -1) {
            useToastError('No anki card to export to. Please add a card first.');
            return;
          }

          cardID = latestCard;
        }

        // Extrae la información de la nota a actualizar
        let infoResponse = await this.executeAction('notesInfo', { notes: [cardID] })
        const infoCard = infoResponse.result
        console.log(infoCard)

        // Almacena el contenido multimedia en Anki
        let imageRequest = this.executeAction('storeMediaFile', {
          filename: sentence.segment_info.uuid + '.webp',
          url: sentence.media_info.path_image,
        })

        // We add blob audio if it exists (concatenated audio) otherwise, 
        // original audio


        let audioRequest;
        if (sentence.media_info.blob_audio_url && sentence.media_info.blob_audio) {
          const blob64 = await blobToBase64(sentence.media_info.blob_audio);
          // Note: The blob's result cannot be directly decoded as Base64 without 
          // first removing the Data-URL declaration preceding the Base64-encoded 
          // data. To retrieve only the Base64 encoded string, first remove 
          // data:/;base64, from the result.
          const raw = blob64.substring(blob64.indexOf(',') + 1);

          audioRequest = this.executeAction('storeMediaFile', {
            filename: sentence.segment_info.uuid + '.mp3',
            data: raw,
          });

        } else {
          audioRequest = this.executeAction('storeMediaFile', {
            filename: sentence.segment_info.uuid + '.mp3',
            url: sentence.media_info.path_audio,
          })
        }

        let [imageResult, audioResult] = await Promise.all([imageRequest, audioRequest]);

        // Realiza una busqueda en la interfaz de Anki para cambiar a una tarjeta generica
        // Y evitar problemas al actualizar
        await this.guiBrowse('nid:1 nid:2')

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

        this.ankiPreferences.settings.current.fields.forEach((field) => {
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
                    `<img src="${imageResult.result}">`
                  )
                  break
                case 'sentence-audio':
                  fieldsNew[field.key] = field.value.replace(
                    `{${key}}`,
                    `[sound:${audioResult.result}]`
                  )
                  break
              }
            }
          }
        })

        await this.executeAction('updateNoteFields', {
          note: {
            fields: fieldsNew,
            id: infoCard[0].noteId,
          },
        })

        // Busca la ultima tarjeta insertada
        await this.guiBrowse(`nid:${infoCard[0].noteId}`)

        const message = 'La tarjeta ha sido añadida en Anki exitosamente.'
        useToastSuccess(message);

      } catch (error) {
        console.log(error);
        const message = 'No se ha podido añadir la tarjeta en Anki. Error: ' + error;
        useToastError(message);
      }
    },

    async guiBrowse(query: string) {
      let response = await this.executeAction('guiBrowse', { query: query });
      return response.result
    }
  },
});

// util functions

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, _) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}
