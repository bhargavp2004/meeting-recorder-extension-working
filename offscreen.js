let recorder;
let data = [];
let activeStreams = [];

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.target === "offscreen") {
    switch (message.type) {
      case "start-recording":
        startRecording();
        break;
      case "stop-recording":
        stopRecording();
        break;
      default:
        throw new Error("Unrecognized message:", message.type);
    }
  }
});

async function startRecording() {
  if (recorder?.state === "recording") {
    throw new Error("Called startRecording while recording is in progress.");
  }

  await stopAllStreams();

  try {
    // Get screen video + system audio stream
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" }, // Capture screen video
      audio: {
        // Force system audio capture
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
      },
    });

    // Get microphone audio stream separately
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    activeStreams.push(screenStream, micStream);

    // Combine system audio + microphone audio using AudioContext
    const audioContext = new AudioContext();
    const systemAudio = audioContext.createMediaStreamSource(screenStream);
    const micAudio = audioContext.createMediaStreamSource(micStream);
    const destination = audioContext.createMediaStreamDestination();

    systemAudio.connect(destination);
    micAudio.connect(destination);

    // Merge all streams (video + system audio + microphone)
    const combinedStream = new MediaStream([
      ...screenStream.getVideoTracks(),  // Add screen video track
      ...destination.stream.getAudioTracks(), // Add combined system + mic audio track
    ]);

    // Start recording
    recorder = new MediaRecorder(combinedStream, {
      mimeType: "video/webm",
    });

    recorder.ondataavailable = (event) => data.push(event.data);
    recorder.onstop = () => {
      const blob = new Blob(data, { type: "video/webm" });
      const url = URL.createObjectURL(blob);

      // Create temporary link element to trigger download
      const downloadLink = document.createElement("a");
      downloadLink.href = url;
      downloadLink.download = `recording-${new Date().toISOString()}.webm`;
      downloadLink.click();

      // Cleanup
      URL.revokeObjectURL(url);
      recorder = undefined;
      data = [];

      chrome.runtime.sendMessage({
        type: "recording-stopped",
        target: "service-worker",
      });
    };

    recorder.start();
    window.location.hash = "recording";

    chrome.runtime.sendMessage({
      type: "update-icon",
      target: "service-worker",
      recording: true,
    });
  } catch (error) {
    console.error("Error starting recording:", error);
    chrome.runtime.sendMessage({
      type: "recording-error",
      target: "popup",
      error: error.message,
    });
  }
}

async function stopRecording() {
  if (recorder && recorder.state === "recording") {
    recorder.stop();
  }

  await stopAllStreams();
  window.location.hash = "";

  chrome.runtime.sendMessage({
    type: "update-icon",
    target: "service-worker",
    recording: false,
  });
}

async function stopAllStreams() {
  activeStreams.forEach((stream) => {
    stream.getTracks().forEach((track) => {
      track.stop();
    });
  });

  activeStreams = [];
  await new Promise((resolve) => setTimeout(resolve, 100));
}
