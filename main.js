import { initiateAudio, handleMidiEvent, resetVoices } from "./synthEngine.js";
import { parseMidi } from "./parseMidi.js";

let scheduledEvents = [];
let isPlaying = false;

// --------------------------------------
// Stop / Reset playback
// --------------------------------------
function stopPlayback() {
  // Clear all scheduled MIDI events
  scheduledEvents.forEach(id => clearTimeout(id));
  scheduledEvents = [];

  // Send noteOff (panic) to all voices
  for (let ch = 1; ch <= 4; ch++) {
    handleMidiEvent({ type: "noteOff", channel: ch });
  }

  // Reset all voice parameters to default
  resetVoices();

  isPlaying = false;

  // Re-enable play button
  const startBtn = document.getElementById("startBtn");
  if (startBtn) startBtn.disabled = false;
}

// --------------------------------------
// Play a MIDI file
// --------------------------------------
async function playMidi(fileName) {
  // Ensure audio context is ready
  await initiateAudio();

  // Stop anything already playing & reset
  stopPlayback();

  // Fetch and parse MIDI
  const response = await fetch(fileName);
  const arrayBuffer = await response.arrayBuffer();
  const midi = parseMidi(arrayBuffer);

  // Schedule MIDI events
  midi.events.forEach(event => {
    const id = setTimeout(() => handleMidiEvent(event), event.time * 1000);
    scheduledEvents.push(id);
  });

  isPlaying = true;

  // Disable play button while playing
  const startBtn = document.getElementById("startBtn");
  if (startBtn) startBtn.disabled = true;
}

// --------------------------------------
// Event Listeners
// --------------------------------------

// Play selected song
document.getElementById("startBtn")?.addEventListener("click", async () => {
  const select = document.getElementById("midiSelect");
  const fileName = select?.value || "0.mid";
  await playMidi(fileName);
});

// Stop / reset when dropdown changes
document.getElementById("midiSelect")?.addEventListener("change", () => {
  if (isPlaying) stopPlayback();
});