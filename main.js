import { initiateAudio, handleMidiEvent, resetVoices, voices, audioCtx } from "./synthEngine.js";
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

  if (!midi.events.length) return;

  // Track when the last event should happen
  const lastEventTime = Math.max(...midi.events.map(e => e.time));

  // Schedule MIDI events
  midi.events.forEach(event => {
    const id = setTimeout(() => handleMidiEvent(event), event.time * 1000);
    scheduledEvents.push(id);
  });

  isPlaying = true;

  // Disable play button while playing
  const startBtn = document.getElementById("startBtn");
  if (startBtn) startBtn.disabled = true;

  // Schedule automatic reset when last MIDI event has finished
  const resetId = setTimeout(() => {
    stopPlayback();
  }, lastEventTime * 1000 + 100); // small buffer of 100ms
  scheduledEvents.push(resetId);
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


// --------------------------------------
// Image slider
// --------------------------------------
const images = [
  "images/2a03_0.png",
  "images/2a03_1.png",
  "images/2a03_2.png",
  "images/2a03_3.png"
];

let current = 0;

const slideA = document.getElementById("slideA");
const slideB = document.getElementById("slideB");

if (slideA && slideB) {
  let showingA = true;

  // initial image
  slideA.src = images[0];
  slideA.classList.add("active");

  function changeImage() {
    current = (current + 1) % images.length;
    const nextImage = images[current];

    if (showingA) {
      slideB.src = nextImage;
      slideB.classList.add("active");
      slideA.classList.remove("active");
    } else {
      slideA.src = nextImage;
      slideA.classList.add("active");
      slideB.classList.remove("active");
    }

    showingA = !showingA;
  }

  // every 30 seconds
  setInterval(changeImage, 30000);
}