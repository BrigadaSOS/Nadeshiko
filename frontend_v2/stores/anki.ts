// Types

interface AnkiNote {
  cards: number[];
  fields: { [key: string]: any };
  mod: number;
  modelName: string;
  noteId: number;
  profile: string;
  tags: string[];
}

interface IAnkiState {
  ankiPreferences: {
    serverAddress: string;
    availableDecks: string[];
    availableModels: string[];
    settings: IAnkiSettings;
  }
}

interface IField {
  key: string;
  value: string;
}

interface IAnkiSettings {
  current: {
    deck: string | null;
    model: string | null;
    fields: IField[];
    key: string | null;
  }
}

interface PermissionResponse {
  result: {
    permission: string;
    requireApiKey: boolean;
    version: number;
  },
  error: string;
}

interface DeckNamesResponse {
  result: string[];
  error: string;
}

interface ModelNamesResponse {
  result: string[];
  error: string;
}

interface ModelFieldNamesResponse {
  result: string[];
  error: string;
}

interface GuiBrowseResponse {
  result: number[];
  error: string;
}

interface FindNotesResponse {
  result: number[];
  error: string;
}

interface NotesInfoResponse {
  result: AnkiNote[];
  error: string;
}

export const ankiStore = defineStore("anki", {
  state: (): IAnkiState => ({
    ankiPreferences: {
      serverAddress: "http://127.0.0.1:8765",
      availableDecks: [],
      availableModels: [],
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
        // throw error;
      }
    },

    async loadAnkiData() {
      try {
        let permission = await this.requestPermission();
        let decks = await this.getAllDeckNames();
        let models = await this.getAllModels();

        if (permission && permission !== "granted") {
          console.log("Permission was denied.");
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

    async requestPermission(): Promise<string> {
      let response = await this.executeAction("requestPermission") as PermissionResponse;
      return response?.result?.permission ?? null;;
    },

    async getAllDeckNames(): Promise<string[]> {
      let response = await this.executeAction("deckNames") as DeckNamesResponse;
      return response.result;
    },

    // Gets the complete list of model names for the current user.
    async getAllModels(): Promise<string[]> {
      let response = await this.executeAction("modelNames") as ModelNamesResponse;
      return response.result;
    },

    // Gets the complete list of field names for the provided model name.
    async getAllModelFieldNames(modelName: string): Promise<string[]> {
      let response = await this.executeAction("modelFieldNames", {
        modelName: modelName,
      }) as ModelFieldNamesResponse;

      return response.result;
    },

    // Gets n notes (depends on anki) where the ankiPreferences.current.key
    // matches the query
    async getNotesWithCurrentKey(query: string, n: number = 5): Promise<Array<{ noteId: number, value: string }>> {

      try {
        const currentKey = this.ankiPreferences.settings.current.key
          ? this.ankiPreferences.settings.current.key : "";

        // TODO: Define type
        const response = await this.executeAction("findNotes", { query: query }) as FindNotesResponse;

        if (response.result && response.result.length === 0) {
          return [];
        }

        // response.result -> number[]

        const notesRes = await this.executeAction("notesInfo", {
          notes: response.result.slice(0, n),
        }) as NotesInfoResponse;

        const notesInfo = notesRes.result.map((note) => {
          if (!note.fields[currentKey]) {
            return { noteId: note.noteId, value: "None" };
          }
          return { noteId: note.noteId, value: note.fields[currentKey].value };
        });

        return notesInfo;

        // notes.value = notesInfo;
      } catch (error) {
        console.error("Error while fetching notes:", error);
      }

      return [];
    },

    async addSentenceToAnki(sentence: Sentence, id?: number) {
      // TODO: creo que podriamos usar this.$state o this.ankiPreferences (revisar)
      const localSettings = localStorage.getItem('settings');

      if (!localSettings) {
        // TODO: localizacion (idioma)
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
            filename: sentence.segment_info.uuid + '.wav',
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

        const allowedFields = [
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
              const key = match[1];

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

        // TODO: handle error
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

    async guiBrowse(query: string): Promise<number[]> {
      let response = await this.executeAction('guiBrowse', { query: query }) as GuiBrowseResponse;
      return response.result
    }
  },
}
);

// util functions

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, _) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}
