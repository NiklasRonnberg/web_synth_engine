export function parseMidi(arrayBuffer) {
  const data = new DataView(arrayBuffer);
  let offset = 0;

  // Basic Readers
  function readString(length) {
    let result = "";
    for (let i = 0; i < length; i++) result += String.fromCharCode(data.getUint8(offset++));
    return result;
  }

  function readUint16() {
    const val = data.getUint16(offset);
    offset += 2;
    return val;
  }

  function readUint32() {
    const val = data.getUint32(offset);
    offset += 4;
    return val;
  }

  function readVarLen() {
    let value = 0;
    while (true) {
      const b = data.getUint8(offset++);
      value = (value << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    return value;
  }

  // Header
  if (readString(4) !== "MThd") throw new Error("Invalid MIDI header");
  const headerLength = readUint32();
  const format = readUint16();
  const numTracks = readUint16();
  const division = readUint16(); // ticks per quarter note
  if (headerLength > 6) offset += (headerLength - 6);

  // Parse Tracks
  const rawEvents = [];
  const tempoChanges = [{ ticks: 0, bpm: 120 }]; // default tempo

  for (let t = 0; t < numTracks; t++) {
    if (readString(4) !== "MTrk") throw new Error("Invalid track chunk");
    const trackLength = readUint32();
    const trackEnd = offset + trackLength;

    let currentTicks = 0;
    let runningStatus = null;

    while (offset < trackEnd) {
      const deltaTicks = readVarLen();
      currentTicks += deltaTicks;

      let statusByte = data.getUint8(offset);

      // Running status
      if (statusByte < 0x80) {
        if (runningStatus === null) throw new Error("Running status without previous status");
        statusByte = runningStatus;
      } else {
        offset++;
        runningStatus = statusByte;
      }

      const eventType = statusByte & 0xf0;
      const channel = (statusByte & 0x0f) + 1;

      // Note Events
      if (eventType === 0x90 || eventType === 0x80) {
        const note = data.getUint8(offset++);
        const velocity = data.getUint8(offset++);
        const isNoteOn = (eventType === 0x90 && velocity > 0);

        rawEvents.push({
          type: isNoteOn ? "noteOn" : "noteOff",
          note,
          velocity,
          channel,
          ticks: currentTicks
        });
        continue;
      }

      // CC events
      if (eventType === 0xB0) {
        const controller = data.getUint8(offset++);
        const value = data.getUint8(offset++);
        rawEvents.push({
          type: "cc",
          controller,
          value,
          channel,
          ticks: currentTicks
        });
        continue;
      }

      // Meta Events
      else if (statusByte === 0xff) {
        const metaType = data.getUint8(offset++);
        const length = readVarLen();

        // Tempo event
        if (metaType === 0x51 && length === 3) {
          const usPerQuarter =
            (data.getUint8(offset) << 16) |
            (data.getUint8(offset + 1) << 8) |
            data.getUint8(offset + 2);
          const bpm = 60000000 / usPerQuarter;
          tempoChanges.push({ ticks: currentTicks, bpm });
        }

        offset += length;
        continue;
      }

      // Other MIDI Events
      const dataLength = (eventType === 0xc0 || eventType === 0xd0) ? 1 : 2;
      offset += dataLength;
    }
    
  }

  // Convert Ticks -> Seconds (with tempo)
  const parsedEvents = rawEvents.map(e => {
    let time = 0;
    let lastTicks = 0;
    let lastBpm = 120;

    for (let i = 0; i < tempoChanges.length; i++) {
      const t = tempoChanges[i];
      if (e.ticks < t.ticks) break;

      const delta = t.ticks - lastTicks;
      time += delta * (60 / lastBpm) / division;
      lastTicks = t.ticks;
      lastBpm = t.bpm;
    }

    // Remaining ticks after last tempo change
    const deltaTicks = e.ticks - lastTicks;
    time += deltaTicks * (60 / lastBpm) / division;

    return { ...e, time: parseFloat(time.toFixed(4)) };
  });

  return {
    format,
    numTracks,
    division,
    events: parsedEvents
  };
}