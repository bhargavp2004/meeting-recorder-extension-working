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
const navigateToRegisterButton = document.getElementById("navigateToRegister");
const navigateToLoginButton = document.getElementById("navigateToLogin");
const registerButton = document.getElementById("registerButton");
const registerContainer = document.getElementById("registerContainer");
const registerError = document.getElementById("registerError");
const registerUserInput = document.getElementById("reguser");
const registerEmailInput = document.getElementById("regemail");
const registerPasswordInput = document.getElementById("regpassword");
const videoTitleContainer = document.getElementById("videoTitleContainer");
const videoTitleInput = document.getElementById("videoTitleInput");
const videoTitleInputError = document.getElementById("videoTitleInputError");
const videoTitleButton = document.getElementById("videoTitleButton");
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
    registerContainer.style.display = "none";
    startButton.style.display = "block";
    videoTitleContainer.style.display = "none";
  } else {
    loginContainer.style.display = "block";
    recordingContainer.style.display = "none";
    registerContainer.style.display = "none";
    videoTitleContainer.style.display = "none";
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

  navigateToRegisterButton.addEventListener("click", () => {
    loginContainer.style.display = "none";
    recordingContainer.style.display = "none";
    registerContainer.style.display = "block";
    videoTitleContainer.style.display = "none";
  });

  navigateToLoginButton.addEventListener("click", () => {
    loginContainer.style.display = "block";
    recordingContainer.style.display = "none";
    registerContainer.style.display = "none";
    videoTitleContainer.style.display = "none";
  });

  // Register button handler
  registerButton.addEventListener("click", async () => {
    const username = registerUserInput.value;
    const email = registerEmailInput.value;
    const password = registerPasswordInput.value;

    if (!username || !email || !password) {
      registerError.textContent = "Username, Email and Password is required";
      registerError.style.display = "block";
      return;
    }

    try {
      const response = await fetch("http://localhost:3000/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, email, password }),
      });

      const data = await response.json();

      if (response.ok) {
        updateUI();
        checkRecordingState();
      } else {
        registerError.textContent = data.message;
        registerError.style.display = "block";
      }
    } catch (error) {
      registerError.textContent = "Network error, try again later";
      registerError.style.display = "block";
    }
  });

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
    try {
      await fetch("http://localhost:3000/logout", {
        method: "GET",
        credentials: "include",
      });
      updateUI();
    }
    catch (error) {
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

      const meetRegex = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
      const zoomRegex = /zoom\.us\/(j|my)\/\d+/;

      if (!tab || !meetRegex.test(tab.url) && !zoomRegex.test(tab.url)) {
        alert("Please open a Google Meet or Zoom tab to record");
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

  stopButton.addEventListener("click", () => {
    // Show video title container and hide other containers
    videoTitleContainer.style.display = "block";
    recordingContainer.style.display = "none";
    loginContainer.style.display = "none";
    registerContainer.style.display = "none";
  });

  // Video title submit button handler
  videoTitleButton.addEventListener("click", () => {
    const title = videoTitleInput.value.trim();

    if (!title) {
      videoTitleInputError.textContent = "Title is required";
      videoTitleInputError.style.display = "block";
      return;
    }
    
    setTimeout(() => {
      chrome.runtime.sendMessage({
        type: "stop-recording",
        target: "offscreen",
        data: { title: title || null }
      });
    }, 500);

    // Reset and hide video title container
    videoTitleInput.value = "";
    videoTitleContainer.style.display = "none";
    recordingContainer.style.display = "block";
    stopButton.style.display = "none";
    startButton.style.display = "block";
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