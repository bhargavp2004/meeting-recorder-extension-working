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
      // Update status
      chrome.runtime.sendMessage({
        type: 'transcription-status',
        target: 'service-worker',
        status: 'Generating transcript...'
      });

      // Transcribe the video
      try {
        const transcript = transcribeVideo(file);
        if (transcript) {
          console.log("Transcription completed");
          
          // // Download the transcript
          // const transcriptBlob = new Blob([transcript], { type: "text/plain" });
          // const transcriptUrl = URL.createObjectURL(transcriptBlob);
          // downloadFile(transcriptUrl, `transcript-${timestamp}.txt`);
          // URL.revokeObjectURL(transcriptUrl);

          // Download the transcript file
          const transcriptBlob = new Blob([transcript.text], { type: "text/plain" });
          const transcriptUrl = URL.createObjectURL(transcriptBlob);
          downloadFile(transcriptUrl, `transcript-${timestamp}.txt`);
          URL.revokeObjectURL(transcriptUrl);

          // Download the summarization file
          const summaryBlob = new Blob([transcript.summary], { type: "text/plain" });
          const summaryUrl = URL.createObjectURL(summaryBlob);
          downloadFile(summaryUrl, `summary-${timestamp}.txt`);
          URL.revokeObjectURL(summaryUrl);
          
          // Update status
          chrome.runtime.sendMessage({
            type: 'transcription-status',
            target: 'service-worker',
            status: 'Transcription completed and downloaded'
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

// // Function to upload video to AssemblyAI and fetch transcript
// async function transcribeVideo(file) {
//   const apiKey = "2213644e87ed41239eaa2a4ad8824bd4"; // Replace with your API Key

//   try {
//     // Update status
//     chrome.runtime.sendMessage({
//       type: 'transcription-status',
//       target: 'service-worker',
//       status: 'Uploading recording for transcription...'
//     });

//     // Upload the file to AssemblyAI
//     const uploadResponse = await fetch("https://api.assemblyai.com/v2/upload", {
//       method: "POST",
//       headers: { Authorization: apiKey },
//       body: file,
//     });

//     if (!uploadResponse.ok) {
//       throw new Error(`Upload failed with status: ${uploadResponse.status}`);
//     }

//     const uploadResult = await uploadResponse.json();
//     const audioUrl = uploadResult.upload_url;

//     console.log("File uploaded, URL:", audioUrl);
    
//     // Update status
//     chrome.runtime.sendMessage({
//       type: 'transcription-status',
//       target: 'service-worker',
//       status: 'Starting transcription process...'
//     });

//     // Request transcription
//     const transcriptResponse = await fetch("https://api.assemblyai.com/v2/transcript", {
//       method: "POST",
//       headers: {
//         Authorization: apiKey,
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({ audio_url: audioUrl }),
//     });

//     if (!transcriptResponse.ok) {
//       throw new Error(`Transcription request failed with status: ${transcriptResponse.status}`);
//     }

//     const transcriptResult = await transcriptResponse.json();
//     const transcriptId = transcriptResult.id;

//     console.log("Transcription started, ID:", transcriptId);

//     // Wait for transcription to complete
//     let transcriptData;
//     let attempts = 0;
//     const maxAttempts = 60; // 5 minutes max (with 5-second intervals)
    
//     while (attempts < maxAttempts) {
//       attempts++;
      
//       // Update status with progress
//       chrome.runtime.sendMessage({
//         type: 'transcription-status',
//         target: 'service-worker',
//         status: `Transcribing... (attempt ${attempts}/${maxAttempts})`
//       });
      
//       const checkResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
//         headers: { Authorization: apiKey },
//       });

//       if (!checkResponse.ok) {
//         throw new Error(`Transcription status check failed with status: ${checkResponse.status}`);
//       }

//       transcriptData = await checkResponse.json();
//       console.log("Checking transcription status:", transcriptData.status);

//       if (transcriptData.status === "completed") break;
//       if (transcriptData.status === "error") throw new Error(`Transcription failed: ${transcriptData.error}`);

//       await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds before checking again
//     }
    
//     if (attempts >= maxAttempts) {
//       throw new Error("Transcription timed out after 5 minutes");
//     }
    
//     console.log("Transcription completed successfully!");
//     return transcriptData.text;
//   } catch (error) {
//     console.error("Error during transcription:", error);
//     throw error; // Re-throw to handle in the calling function
//   }
// }

// Function to upload video to AssemblyAI, transcribe it, and get summary
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

    // Request transcription with summarization
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
        summary_type: "bullets" // Options: "gist", "bullets", "headline", "paragraph"
      }),
    });

    if (!transcriptResponse.ok) {
      throw new Error(`Transcription request failed with status: ${transcriptResponse.status}`);
    }

    const transcriptResult = await transcriptResponse.json();
    const transcriptId = transcriptResult.id;

    console.log("Transcription started, ID:", transcriptId);

    // Wait for transcription to complete
    let transcript;
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
      console.log("Checking transcription status:", transcriptData.status);

      if (transcriptData.status === "completed") break;
      if (transcriptData.status === "error") throw new Error(`Transcription failed: ${transcriptData.error}`);

      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds before checking again
    }
    
    if (attempts >= maxAttempts) {
      throw new Error("Transcription timed out after 5 minutes");
    }
    
    console.log("Transcription completed successfully!");
    
    // Return both transcript text and summary
    return {
      text: transcriptData.text,
      summary: transcriptData.summary // Returns summary as per the requested type
    };

  } catch (error) {
    console.error("Error during transcription:", error);
    throw error; // Re-throw to handle in the calling function
  }
}

// Function to download files
function downloadFile(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  
  // Small delay before removing the link
  setTimeout(() => {
    document.body.removeChild(link);
  }, 100);
}
