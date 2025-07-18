import React, { useRef, useState } from "react";
import RecordRTC from "recordrtc";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { decodeAudioData } from "./utils";
import { FaMicrophone, FaStop } from "react-icons/fa";

const MercuryBlob = ({ active }) => {
  const mesh = useRef();
  const material = useRef();
  const hue = useRef(0);

  useFrame(() => {
    if (!active) {
      mesh.current.rotation.set(0, 0, 0);
      mesh.current.scale.set(1, 1, 1);
      material.current.color.setStyle("#1b1b1b"); // dark static
      return;
    }

    // Active: spin, pulse, color shift
    mesh.current.rotation.y += 0.03;
    mesh.current.rotation.x += 0.01;

    hue.current = (hue.current + 3) % 360;
    const color = `hsl(${hue.current}, 90%, 60%)`;
    material.current.color.setStyle(color);

    const pulse = 1 + 0.2 * Math.sin(Date.now() * 0.01);
    mesh.current.scale.set(pulse, pulse, pulse);
  });

  return (
    <mesh ref={mesh}>
      <sphereGeometry args={[1, 64, 64]} />
      <meshStandardMaterial ref={material} metalness={1} roughness={0.15} />
    </mesh>
  );
};

const AudioVisualizer3D = ({ active }) => (
  <Canvas style={{ height: 300, width: 300 }} camera={{ position: [0, 0, 3] }}>
    <ambientLight intensity={0.5} />
    <directionalLight position={[5, 5, 5]} intensity={1} />
    <MercuryBlob active={active} />
    <Environment preset="sunset" />
  </Canvas>
);

const App = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [micTranscript, setMicTranscript] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [messageHistory, setMessageHistory] = useState([]);
  const [blobActive, setBlobActive] = useState(false); // NEW
  const [sessionId, setSessionId] = useState(null); // NEW: Store session ID
  const sessionIdRef = useRef(null);
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState([]); // {role: 'user'|'assistant', content: string}
  const [chatSessionId, setChatSessionId] = useState(null);
  const chatSessionIdRef = useRef(null);
  const chatInputRef = useRef(null);

  const isRecordingRef = useRef(false);
  const ws = useRef(null);
  const recorder = useRef(null);
  const mediaStream = useRef(null);
  const audioCtx = useRef(null);
  const analyser = useRef(null);
  const silenceStart = useRef(null);
  const animationFrame = useRef(null);
  const outputCtx = useRef(new AudioContext({ sampleRate: 24000 }));
  const nextStartTime = useRef(0);
  const activeSources = useRef(new Set());

  const scaleValue = useRef(0);

  const INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
  let inactivityTimeout = null;

  const resetInactivityTimeout = () => {
    if (inactivityTimeout) clearTimeout(inactivityTimeout);
    inactivityTimeout = setTimeout(() => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        console.log("⏳ Inactivity timeout reached. Closing WebSocket.");
        ws.current.close();
      }
    }, INACTIVITY_TIMEOUT_MS);
  };

  const startHandsFreeLoop = async () => {
    console.log("🎙️ [startHandsFreeLoop] Initializing mic...");

    if (mediaStream.current) {
      mediaStream.current.getTracks().forEach(t => t.stop());
      mediaStream.current = null;
    }

    mediaStream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    setBlobActive(true); // 🎤 mic on → activate blob

    audioCtx.current = new AudioContext();
    const source = audioCtx.current.createMediaStreamSource(mediaStream.current);
    analyser.current = audioCtx.current.createAnalyser();
    analyser.current.fftSize = 2048;
    const dataArray = new Uint8Array(analyser.current.fftSize);
    source.connect(analyser.current);

    recorder.current = new RecordRTC(mediaStream.current, {
      type: "audio",
      mimeType: "audio/wav",
      desiredSampRate: 16000,
      numberOfAudioChannels: 1,
      recorderType: RecordRTC.StereoAudioRecorder
    });

    recorder.current.startRecording();
    console.log("✅ [startHandsFreeLoop] Recording started");

    const SILENCE_THRESHOLD = 4;
    const SILENCE_DURATION_MS = 1500;

    const detectSilence = () => {
      if (!isRecordingRef.current) {
        cancelAnimationFrame(animationFrame.current);
        return;
      }

      analyser.current.getByteTimeDomainData(dataArray);
      const avg = dataArray.reduce((a, b) => a + Math.abs(b - 128), 0) / dataArray.length;

      const now = Date.now();
      if (avg < SILENCE_THRESHOLD) {
        if (!silenceStart.current) {
          silenceStart.current = now;
          console.log("🤫 [silence] Silence started");
        } else if (now - silenceStart.current > SILENCE_DURATION_MS) {
          console.log("📤 [silence] Sending to backend...");
          silenceStart.current = null;
          stopAndSendRecording();
          return;
        }
      } else {
        silenceStart.current = null;
      }

      animationFrame.current = requestAnimationFrame(detectSilence);
    };

    silenceStart.current = null;
    animationFrame.current = requestAnimationFrame(detectSilence);
  };

  const stopAndSendRecording = () => {
    recorder.current.stopRecording(async () => {
      const blob = recorder.current.getBlob();
      mediaStream.current.getTracks().forEach(t => t.stop());
      mediaStream.current = null;
      recorder.current = null;
      analyser.current = null;
      await audioCtx.current.close();
      audioCtx.current = null;

      const buffer = await blob.arrayBuffer();
      console.log("📦 [WebSocket] Sending audio blob:", buffer.byteLength);

      ws.current = new WebSocket("ws://127.0.0.1:8000/ws/voice");

      ws.current.onopen = () => {
        console.log("🌐 [WebSocket] Connected");
      
        if (sessionIdRef.current) {
          console.log("🔑 [Session] Sending existing session ID from ref:", sessionIdRef.current);
          ws.current.send(`__session__:${sessionIdRef.current}`);
        }
      
        ws.current.send(buffer);
        ws.current.send("__end__");
      };
      
      
      ws.current.onmessage = async (event) => {
        resetInactivityTimeout();
        const msg = event.data;

        // Handle session ID separately (independent of other message types)
        if (msg.startsWith("__session__:")) {
          const newSessionId = msg.replace("__session__:", "");
          setSessionId(newSessionId);
          sessionIdRef.current = newSessionId;  // keep ref in sync
          console.log("🔑 [Session] Received session ID:", newSessionId);
        }

        if (msg.startsWith("__stream__:")) {
          const token = msg.replace("__stream__:", "");
          setStreamingText(prev => prev + token);
        } else if (msg.startsWith("__mic__:")) {
          const transcript = msg.replace("__mic__:", "");
          console.log("🗣️ [Transcript]", transcript);
          setMicTranscript(transcript);
        } else if (/^[A-Za-z0-9+/=]+$/.test(msg)) {
          const binary = atob(msg);
          const buf = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);

          const audioBuffer = await decodeAudioData(buf.buffer, outputCtx.current, 24000, 1);
          const source = outputCtx.current.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(outputCtx.current.destination);

          setBlobActive(true); // 🔊 TTS active → pulsate

          source.onended = () => {
            console.log("✅ [TTS] Playback done.");
            activeSources.current.delete(source);
            setBlobActive(false); // 💤 idle after TTS
            // ws.current?.close(); // No longer close here

            // Restart listening if still recording
            if (isRecordingRef.current) {
              setTimeout(() => {
                startHandsFreeLoop();
              }, 200); // small delay to avoid race conditions
            }
          };

          source.start();
          activeSources.current.add(source);
        }
      };

      ws.current.onclose = () => {
        console.log("🔁 [WebSocket] Closed. Restarting mic...");
        if (isRecordingRef.current) {
          setTimeout(() => {
            // reconnect and resume with existing sessionId
            startHandsFreeLoop();
          }, 200);
        }
      };
      

      ws.current.onerror = (e) => {
        console.error("❌ [WebSocket] Error:", e);
      };
    });
  };

  const stopAll = () => {
    console.log("🛑 [stopAll] Stopping assistant...");
    isRecordingRef.current = false;
    setIsRecording(false);
    setBlobActive(false); // 💤 dark state
    try {
      recorder.current?.stopRecording();
      mediaStream.current?.getTracks().forEach(track => track.stop());
      audioCtx.current?.close();
    } catch (e) {}
    activeSources.current.forEach(src => src.stop());
    activeSources.current.clear();
    cancelAnimationFrame(animationFrame.current);
    if (inactivityTimeout) clearTimeout(inactivityTimeout);
  };

  const toggleRecording = () => {
    if (isRecordingRef.current) {
      stopAll();
    } else {
      isRecordingRef.current = true;
      setIsRecording(true);
      setMicTranscript("");
      setStreamingText("");
      setMessageHistory([]);
      startHandsFreeLoop();
    }
  };

  // Chat with AI logic
  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    const prompt = chatInput.trim();
    setChatHistory((prev) => [...prev, { role: "user", content: prompt }]);
    setChatInput("");
    try {
      const res = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          session_id: chatSessionIdRef.current || undefined,
        }),
      });
      const data = await res.json();
      if (data.session_id) {
        setChatSessionId(data.session_id);
        chatSessionIdRef.current = data.session_id;
      }
      if (data.response) {
        setChatHistory((prev) => [...prev, { role: "assistant", content: data.response }]);
      }
    } catch (err) {
      setChatHistory((prev) => [...prev, { role: "assistant", content: "[Error: Could not reach backend]" }]);
    }
  };

  const endChat = () => {
    setChatModalOpen(false);
    setChatSessionId(null);
    chatSessionIdRef.current = null;
    setChatHistory([]);
    setChatInput("");
  };

  // Focus chat input when modal opens
  React.useEffect(() => {
    if (chatModalOpen && chatInputRef.current) {
      chatInputRef.current.focus();
    }
  }, [chatModalOpen]);

  return (
    <div
      style={{
        background: "linear-gradient(145deg, #0a0f1a, #12233e)",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center"
      }}
    >
      <AudioVisualizer3D active={blobActive} />

      <button
        style={{
          marginTop: 30,
          padding: "20px 40px",
          fontSize: "24px",
          backgroundColor: "#1e3a8a",
          color: "white",
          border: "none",
          borderRadius: "12px",
          cursor: "pointer"
        }}
        onClick={toggleRecording}
      >
        {isRecording ? <FaStop color="white" size={40} /> : <FaMicrophone color="red" size={40} />}
      </button>
      <div style={{ color: '#fff', fontSize: '20px', fontWeight: 600, marginTop: 10, marginBottom: 10, letterSpacing: 1 }}>
        Speak with AI
      </div>

      {/* Chat with AI button */}
      <button
        style={{
          marginTop: 20,
          padding: "18px 36px",
          fontSize: "22px",
          backgroundColor: "#4b5563",
          color: "white",
          border: "none",
          borderRadius: "12px",
          cursor: "pointer"
        }}
        onClick={() => setChatModalOpen(true)}
      >
        💬 Chat with AI
      </button>

      {/* Chat Modal */}
      {chatModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000
          }}
        >
          <div
            style={{
              background: "#22223b",
              borderRadius: 16,
              padding: "36px 36px 28px 36px",
              minWidth: 480,
              maxWidth: 700,
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
              display: "flex",
              flexDirection: "column",
              maxHeight: "85vh",
              position: "relative"
            }}
          >
           {/* Close (X) button */}
           <button
             onClick={endChat}
             style={{
               position: "absolute",
               top: 16,
               right: 16,
               background: "transparent",
               border: "none",
               color: "#fff",
               fontSize: 28,
               cursor: "pointer",
               fontWeight: 700,
               zIndex: 10
             }}
             aria-label="Close Chat"
           >
             ×
           </button>
            <h2 style={{ color: "#fff", marginBottom: 18, fontSize: 30 }}>AI Chat</h2>
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                background: "#282846",
                borderRadius: 10,
                padding: 18,
                marginBottom: 18,
                minHeight: 180,
                maxHeight: 400
              }}
            >
              {chatHistory.length === 0 && (
               <div style={{ color: "#fff" }}>(Start the conversation...)</div>
              )}
              {chatHistory.map((msg, idx) => (
               <div key={idx} style={{ marginBottom: 12, color: "#fff", fontSize: 18 }}>
                 <b>{msg.role === "user" ? "You" : "AI"}:</b> {msg.content}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") sendChatMessage(); }}
                style={{ flex: 1, padding: 14, borderRadius: 8, border: "1px solid #444", background: "#181826", color: "#fff", fontSize: 18 }}
                placeholder="Type your message..."
                disabled={!chatModalOpen}
                ref={chatInputRef}
              />
              <button
                onClick={sendChatMessage}
               style={{ padding: "12px 28px", borderRadius: 8, background: "#2563eb", color: "#fff", border: "none", cursor: "pointer", fontSize: 18, fontWeight: 600 }}
                disabled={!chatInput.trim()}
              >
                Send
              </button>
            </div>
            <button
              onClick={endChat}
             style={{ marginTop: 20, background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, padding: "12px 28px", cursor: "pointer", fontSize: 18, fontWeight: 600 }}
            >
              End Chat
            </button>
          </div>
        </div>
      )}

      <div style={{ color: "white", marginTop: 20, maxWidth: 500, textAlign: "center" }}>
        <h3>🎙️ Mic Transcript:</h3>
        <p>{micTranscript || "(Waiting for speech...)"}</p>
        <h3>💬 Assistant Response:</h3>
        <p>{messageHistory.length > 0 ? messageHistory[messageHistory.length - 1].content : "(Waiting for response...)"}</p>
      </div>

      <style>
        {`
          @keyframes pulse {
            0% { opacity: 0.5; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.1); }
            100% { opacity: 0.5; transform: scale(1); }
          }
        `}
      </style>
    </div>
  );
};

export default App;
