// ----------------Checking authentication using httponly cookie----------------

// Get button elements
const startButton = document.getElementById("startRecord");
const stopButton = document.getElementById("stopRecord");
const loginContainer = document.getElementById("loginContainer");
const recordingContainer = document.getElementById("recordingContainer");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("loginButton");
const loginError = document.getElementById("loginError");
const logoutButton = document.getElementById("logoutButton");
let permissionStatus = document.getElementById("permissionStatus");

async function checkAuth() {
  try {
    const response = await fetch("http://localhost:3000/authenticate", {
      method: "GET",
      credentials: "include",
    });

    const data = await response.json();
    return response.ok && data.isAuthenticated;
  } catch (error) {
    return false;
  }
}

async function updateUI() {
  const isAuthenticated = await checkAuth();
  if (isAuthenticated) {
    loginContainer.style.display = "none";
    recordingContainer.style.display = "block";
    startButton.style.display = "block";
  } else {
    loginContainer.style.display = "block";
    recordingContainer.style.display = "none";
  }
}

function showError(message) {
  permissionStatus.textContent = message;
  permissionStatus.style.display = "block";
}

function hideError() {
  permissionStatus.style.display = "none";
}

async function checkMicrophonePermission() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    return true;
  } catch (error) {
    return false;
  }
}

// Check recording state when popup opens
async function checkRecordingState() {
  await updateUI();

  const hasPermission = await checkMicrophonePermission();
  if (!hasPermission) {
    chrome.tabs.create({ url: "permission.html" });
    return;
  }

  const contexts = await chrome.runtime.getContexts({});
  const offscreenDocument = contexts.find(
    (c) => c.contextType === "OFFSCREEN_DOCUMENT"
  );

  if (
    offscreenDocument &&
    offscreenDocument.documentUrl.endsWith("#recording")
  ) {
    stopButton.style.display = "block";
    startButton.style.display = "none";
  } else {
    startButton.style.display = "block";
    stopButton.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await checkRecordingState();

  // Login button handler
  loginButton.addEventListener("click", async () => {
    const email = emailInput.value;
    const password = passwordInput.value;

    if (!email || !password) {
      loginError.textContent = "Please enter both email and password";
      loginError.style.display = "block";
      return;
    }

    try {
      const response = await fetch("http://localhost:3000/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      console.log("Response : ", response);

      const data = await response.json();

      if (response.ok) {
        updateUI();
        checkRecordingState();
      } else {
        loginError.textContent = "Invalid email or password";
        loginError.style.display = "block";
      }
    } catch (error) {
      loginError.textContent = "Network error, try again later";
      loginError.style.display = "block";
    }
  });

  // Logout button handler
  logoutButton.addEventListener("click", async () => {
    try{
      await fetch("http://localhost:3000/logout", {
        method: "POST",
        credentials: "include",
      });
      updateUI();
    }
    catch(error){
      console.log(error);
    }
  });

  // Start recording button handler
  startButton.addEventListener("click", async () => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (
        !tab ||
        tab.url.startsWith("chrome://") ||
        tab.url.startsWith("chrome-extension://")
      ) {
        alert(
          "Cannot record Chrome system pages. Please try on a regular webpage."
        );
        return;
      }

      const contexts = await chrome.runtime.getContexts({});
      const offscreenDocument = contexts.find(
        (c) => c.contextType === "OFFSCREEN_DOCUMENT"
      );

      if (!offscreenDocument) {
        await chrome.offscreen.createDocument({
          url: "offscreen.html",
          reasons: ["USER_MEDIA"],
          justification: "Recording from chrome.tabCapture API",
        });
      }

      const streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tab.id,
      });

      chrome.runtime.sendMessage({
        type: "start-recording",
        target: "offscreen",
        data: streamId,
      });

      setTimeout(() => {
        startButton.style.display = "none";
        stopButton.style.display = "block";
      }, 300);
    } catch (error) {
      alert("Failed to start recording: " + error.message);
    }
  });

  // Stop recording button handler
  stopButton.addEventListener("click", () => {
    setTimeout(() => {
      chrome.runtime.sendMessage({
        type: "stop-recording",
        target: "offscreen",
      });
    }, 500);

    setTimeout(() => {
      stopButton.style.display = "none";
      startButton.style.display = "block";
    }, 300);
  });

  // Message listener
  chrome.runtime.onMessage.addListener((message) => {
    if (message.target === "popup") {
      switch (message.type) {
        case "recording-error":
          alert(message.error);
          startButton.style.display = "block";
          stopButton.style.display = "none";
          break;
        case "recording-stopped":
          startButton.style.display = "block";
          stopButton.style.display = "none";
          break;
      }
    }
  });
});