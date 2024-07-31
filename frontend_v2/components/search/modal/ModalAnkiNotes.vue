<script setup lang="ts">

type Props = {
  sentence: Sentence | null;
  onClick: (sentece: Sentence, id: number) => void;
  onClose: () => void;
}
const props = defineProps<Props>();

const keyValue = ref("Expression");
const inputVal = ref("*");
const resLength = ref(0);
const notes = ref([]);

// Try to get keyValue from localStorage
// const keyValueStorage = localStorage.getItem("keyValue");
// if (keyValueStorage) {
//   keyValue.value = keyValueStorage;
// }

const executeAction = async (action: string, params: Object) => {
  try {
    const response = await fetch("http://localhost:8765", {
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
};

const getNotesFromQuery = async () => {
  try {

    const query = keyValue.value ? `${keyValue.value}:${inputVal.value}` : inputVal.value;
    const response = await executeAction("findNotes", { query: query });

    if (response.result && response.result.length === 0) {
      notes.value = [];
      resLength.value = 0;
      return;
    }

    // Save keyValue to localStorage
    // localStorage.setItem("keyValue", keyValue.value);


    resLength.value = response.result.length;

    const notesRes = await executeAction("notesInfo", { notes: response.result.slice(0, 5) });
    const notesInfo = notesRes.result.map((note) => {
      if (!note.fields[keyValue.value]) {
        return { noteId: note.noteId, value: "None" };
      }
      return { noteId: note.noteId, value: note.fields[keyValue.value].value };
    });

    notes.value = notesInfo;

  } catch (error) {
    console.error("Error while fetching notes:", error);
  }
};

</script>


<template>
  <div
    class="p-6 sticky rounded left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[400px] dark:bg-modal-background shadow-sm text-white z-50">
    <div>
      <div class="flex justify-between mb-5">
        <h2 class="text-2xl">Search in your collection</h2>
        <button @click="onClose" class="text-white">Close</button>
      </div>

      <p>Sentence: <b>{{ sentence?.segment_info.content_jp }}</b></p>
      <br />

      <div class="flex flex-col gap-5">
        <div>
          <label class="text-white">Key</label>
          <input type="text" class="w-full p-2 bg-black text-white" placeholder="Look for key" :value="keyValue"
            @input="(e: any) => { keyValue = e.target.value; getNotesFromQuery(); }" />
        </div>


        <div>
          <label class="text-white">Anki query:</label>
          <input type="text" class="w-full p-2 bg-black text-white" placeholder="*" :value="inputVal"
            @input="(e: any) => { inputVal = e.target.value; getNotesFromQuery(); }" />
        </div>

        <div>
          <p>{{ `Matching Notes: ${notes.length} of ${resLength}` }}<small>{{ ` (${keyValue && keyValue +
            ":"}${inputVal})`}}</small></p>
        </div>

        <!-- Table with the notes -->
        <div>
          <table class="w-full">
            <thead>
              <tr>
                <th class="text-left">Note ID</th>
                <th class="text-left">{{ keyValue ? keyValue : "Key" }}</th>
              </tr>
            </thead>
            <tbody>
              <tr class="my-4" v-for="note in notes" @click="props.onClick(sentence!, note.noteId)">
                <td>{{ note.noteId }}</td>
                <td>{{ note.value }}</td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>

    </div>
  </div>
</template>
