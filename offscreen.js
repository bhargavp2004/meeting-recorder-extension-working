let recorder;
let data = [];
let activeStreams = [];
let meetingId;
let videoTitle;

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.target === "offscreen") {
    switch (message.type) {
      case "start-recording":
        startRecording(message.options);
        break;
      case "stop-recording":
        stopRecording(message.data?.title);
        break;
      default:
        console.error("Unrecognized message:", message.type);
    }
  }
});

async function startRecording(options = {}) {
  if (recorder?.state === "recording") {
    console.error("Called startRecording while recording is in progress.");
    return;
  }

  await stopAllStreams();
  data = []; // Clear previous recording data

  try {
    // Get screen stream
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always" },
      audio: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
      },
    });

    activeStreams.push(screenStream);

    let micStream = null;
    let combinedStream;

    // Only get microphone if enabled
    if (options?.microphone !== false) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        activeStreams.push(micStream);
      } catch (err) {
        console.warn("Could not get microphone access:", err);
      }
    }

    // If we have both screen and mic audio, combine them
    if (micStream && screenStream.getAudioTracks().length > 0) {
      const audioContext = new AudioContext();
      const systemAudio = audioContext.createMediaStreamSource(screenStream);
      const micAudio = audioContext.createMediaStreamSource(micStream);
      const destination = audioContext.createMediaStreamDestination();

      systemAudio.connect(destination);
      micAudio.connect(destination);

      combinedStream = new MediaStream([
        ...screenStream.getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ]);
    }
    // If we only have mic audio
    else if (micStream) {
      combinedStream = new MediaStream([
        ...screenStream.getVideoTracks(),
        ...micStream.getAudioTracks(),
      ]);
    }
    // If we only have system audio or no audio
    else {
      combinedStream = screenStream;
    }

    // Create and start the recorder
    recorder = new MediaRecorder(combinedStream, {
      mimeType: "video/webm",
    });

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        data.push(event.data);
      }
    };

    recorder.onstop = async () => {
      // Update status
      chrome.runtime.sendMessage({
        type: 'transcription-status',
        target: 'service-worker',
        status: 'Processing recording...'
      });

      // Create blob and file from recorded data
      const blob = new Blob(data, { type: "video/webm" });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${videoTitle}.webm`;
      const file = new File([blob], fileName, { type: "video/webm" });

      // Upload the video file to backend
      const videoUrl = URL.createObjectURL(blob);
      try {
        await uploadVideo(file);
      } catch (error) {
        console.error("Error uploading video:", error);
      }

      // Update status
      chrome.runtime.sendMessage({
        type: 'transcription-status',
        target: 'service-worker',
        status: 'Generating transcript...'
      });

      // Transcribe the video
      try {
        const transcriptResponse = await transcribeVideo(file);
        const transcript = transcriptResponse.text;
        const summary = transcriptResponse.summary;
        console.log("Transcript:", transcript);
        if (transcript) {
          console.log("Transcription completed");

          // Upload the transcript to backend
          try {
            const transcriptionFileName = `recording_${videoTitle}.txt`;
            const transcriptionFile = new Blob([transcript], { type: "text/plain" });
            const transcriptionFileObject = new File([transcriptionFile], transcriptionFileName, { type: "text/plain" });
            await uploadTranscription(transcriptionFileObject, meetingId);
            const summaryFileName = `summary_${videoTitle}.txt`;
            const summaryFile = new File([summary], summaryFileName, { type: "text/plain" });
            const summaryFileObject = new File([summaryFile], summaryFileName, { type: "text/plain" });
            await uploadSummarization(summaryFileObject, meetingId);
          } catch (error) {
            console.error("Error uploading transcription:", error);
          }

          // Update status
          chrome.runtime.sendMessage({
            type: 'transcription-status',
            target: 'service-worker',
            status: 'Transcription completed and uploaded'
          });
        } else {
          console.error("Transcription failed or returned empty text");
          chrome.runtime.sendMessage({
            type: 'transcription-status',
            target: 'service-worker',
            status: 'Transcription failed'
          });
        }
      } catch (error) {
        console.error("Error in transcription:", error);
        chrome.runtime.sendMessage({
          type: 'transcription-status',
          target: 'service-worker',
          status: `Transcription error: ${error.message}`
        });
      }

      // Clean up
      URL.revokeObjectURL(videoUrl);
      recorder = undefined;
      data = [];
      videoTitle = undefined;

      // Notify that recording has stopped
      chrome.runtime.sendMessage({
        type: "recording-stopped",
        target: "service-worker",
      });
    };

    // Start recording with 1-second chunks
    recorder.start(1000);

    // Update hash to indicate recording state
    window.location.hash = "recording";

    // Update icon
    chrome.runtime.sendMessage({
      type: "update-icon",
      target: "service-worker",
      recording: true,
    });
  } catch (error) {
    console.error("Error starting recording:", error);
    chrome.runtime.sendMessage({
      type: "recording-error",
      target: "service-worker",
      error: error.message,
    });

    await stopAllStreams();
  }
}

async function stopRecording(title) {
  videoTitle = title;
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
  for (const stream of activeStreams) {
    stream.getTracks().forEach((track) => {
      track.stop();
    });
  }

  activeStreams = [];
  await new Promise((resolve) => setTimeout(resolve, 100));
}

// Function to upload video to AssemblyAI and fetch transcript
async function transcribeVideo(file) {
  const apiKey = "2213644e87ed41239eaa2a4ad8824bd4"; // Replace with your API Key

  try {
    // Update status
    chrome.runtime.sendMessage({
      type: 'transcription-status',
      target: 'service-worker',
      status: 'Uploading recording for transcription...'
    });

    // Upload the file to AssemblyAI
    const uploadResponse = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { Authorization: apiKey },
      body: file,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed with status: ${uploadResponse.status}`);
    }

    const uploadResult = await uploadResponse.json();
    const audioUrl = uploadResult.upload_url;

    console.log("File uploaded, URL:", audioUrl);

    // Update status
    chrome.runtime.sendMessage({
      type: 'transcription-status',
      target: 'service-worker',
      status: 'Starting transcription process...'
    });

    // Request transcription
    const transcriptResponse = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        summarization: true, // Enable summarization
        summary_model: "informative", // Options: "informative", "conversational", "catchy"
        summary_type: "bullets"
      }),
    });

    console.log("Transcript response : ", transcriptResponse);

    if (!transcriptResponse.ok) {
      throw new Error(`Transcription request failed with status: ${transcriptResponse.status}`);
    }

    const transcriptResult = await transcriptResponse.json();
    const transcriptId = transcriptResult.id;

    console.log("Transcription started, ID:", transcriptId);

    // Wait for transcription to complete
    let transcriptData;
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max (with 5-second intervals)

    while (attempts < maxAttempts) {
      attempts++;

      // Update status with progress
      chrome.runtime.sendMessage({
        type: 'transcription-status',
        target: 'service-worker',
        status: `Transcribing... (attempt ${attempts}/${maxAttempts})`
      });

      const checkResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { Authorization: apiKey },
      });

      if (!checkResponse.ok) {
        throw new Error(`Transcription status check failed with status: ${checkResponse.status}`);
      }

      transcriptData = await checkResponse.json();
      console.log("Transcript data : ", transcriptData);
      console.log("Checking transcription status:", transcriptData.status);

      if (transcriptData.status === "completed") break;
      if (transcriptData.status === "error") throw new Error(`Transcription failed: ${transcriptData.error}`);

      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds before checking again
    }

    if (attempts >= maxAttempts) {
      throw new Error("Transcription timed out after 5 minutes");
    }

    console.log("Transcription completed successfully!");

    return {
      text: transcriptData.text,
      summary: transcriptData.summary // Returns summary as per the requested type
    };
  } catch (error) {
    console.error("Error during transcription:", error);
    throw error; // Re-throw to handle in the calling function
  }
}

async function uploadVideo(content) {
  meetingId = undefined;
  const formData = new FormData();
  formData.append("video", content);
  formData.append("title", videoTitle);
  const response = await fetch('http://localhost:3000/media/upload-video', {
    method: 'POST',
    credentials: "include",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Failed to upload video with status: ${response.status}`);
  }

  const result = await response.json();
  meetingId = result.meetingId;
  console.log("Video uploaded successfully, meetingId:", meetingId);
}

async function uploadTranscription(content, meetingId) {
  if (meetingId != undefined) {
    const formData = new FormData();
    formData.append("transcription", content);
    const response = await fetch(`http://localhost:3000/media/upload-transcription/${meetingId}`, {
      method: 'POST',
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload transcription with status: ${response.status}`);
    }

    console.log("Transcription uploaded successfully");
    meetingId = undefined;
  }
}

async function uploadSummarization(content, meetingId) {
  if (meetingId != undefined) {
    const formData = new FormData();
    formData.append("summarization", content);
    const response = await fetch(`http://localhost:3000/media/upload-summarization/${meetingId}`, {
      method: 'POST',
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload transcription with status: ${response.status}`);
    }

    console.log("Transcription uploaded successfully");
    meetingId = undefined;
  }
}