# Voice Assistant PWA

A modern, hands-free, streaming voice assistant web app built with React, WebSockets, and 3D visualization.

## Features
- **Hands-free voice interaction**: Speak to the assistant, get real-time streaming responses.
- **Session management**: Maintains conversation context using session IDs.
- **WebSocket communication**: Low-latency audio streaming to/from a Python backend.
- **3D audio visualizer**: Animated Mercury-like blob visualizes mic activity and TTS playback.
- **Timeout handling**: Automatically closes idle connections to save backend resources.
- **TTS and STT**: Supports both text-to-speech and speech-to-text with streaming.

## Prerequisites
- **Node.js** (v16+ recommended)
- **npm** or **yarn**
- **Python backend** (see below)

## Getting Started

### 1. Clone the repository
```bash
git clone <your-repo-url>
cd voice-assistant-pwa
```

### 2. Install dependencies
```bash
npm install
# or
yarn install
```

### 3. Configure the development port (optional)
To run the app on a custom port (default is 3000), create a `.env` file:
```
PORT=6000
```

### 4. Start the React app
```bash
npm start
# or
yarn start
```

The app will be available at [http://localhost:3000](http://localhost:3000) (or your chosen port).

### 5. Backend Setup
- You need a Python backend with a WebSocket endpoint at `ws://localhost:8000/ws/voice`.
- The backend should:
  - Accept audio blobs (WAV, 16kHz, mono)
  - Handle session IDs (sent as `__session__:<id>`)
  - Stream responses (text, transcript, TTS audio as base64)
- Example backend stack: FastAPI, Gemini, gTTS, or your own TTS/STT solution.

## Usage
- Click the microphone button to start/stop recording.
- Speak your query; the assistant will transcribe, process, and respond with both text and audio.
- The 3D blob animates to show activity.
- The session is maintained as long as the tab is active and not idle for 2 minutes.

## Configuration
- **WebSocket URL**: Change in `src/App.js` if your backend runs elsewhere.
- **Session Timeout**: Adjust `INACTIVITY_TIMEOUT_MS` in `src/App.js` as needed.
- **Audio Sample Rate**: Ensure backend and frontend agree (default: 16kHz for input, 24kHz for output).

## Troubleshooting
- **No audio playback?**
  - Check browser console for decoding errors.
  - Ensure backend sends valid WAV/MP3 audio as base64.
- **WebSocket disconnects?**
  - Make sure backend is running and accessible at the correct port.
  - Check for session ID handling in both frontend and backend.
- **Mic not working?**
  - Allow microphone access in your browser.

## License
MIT

---

**Happy hacking!**
