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

      ws.current = new WebSocket("ws://127.0.0.1:8000/ws/audio");

      ws.current.onopen = () => {
        console.log("🌐 [WebSocket] Connected");
        ws.current.send(buffer);
        ws.current.send("__end__");
      };

      ws.current.onmessage = async (event) => {
        const msg = event.data;

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
            console.log("✅ [TTS] Playback done. Closing WebSocket...");
            activeSources.current.delete(source);
            setBlobActive(false); // 💤 idle after TTS
            ws.current?.close();
          };

          source.start();
          activeSources.current.add(source);
        }
      };

      ws.current.onclose = () => {
        console.log("🔁 [WebSocket] Closed. Restarting mic...");
        if (isRecordingRef.current) setTimeout(startHandsFreeLoop, 200);
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
          padding: "12px 24px",
          fontSize: "18px",
          backgroundColor: "#1e3a8a",
          color: "white",
          border: "none",
          borderRadius: "8px",
          cursor: "pointer"
        }}
        onClick={toggleRecording}
      >
        {isRecording ? <FaStop color="white" size={28} /> : <FaMicrophone color="red" size={28} />}
      </button>

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
