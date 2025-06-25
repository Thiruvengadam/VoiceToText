import React, { useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Html } from "@react-three/drei";
import { decodeAudioData } from "./utils";
import { FaMicrophone, FaMicrophoneSlash, FaStopCircle ,FaStop} from 'react-icons/fa';


const MercuryBlob = ({ scaleValue, statusLabel }) => {
  const mesh = useRef();
  const material = useRef();

  useFrame(() => {
    const scale = 1 + scaleValue.current * 0.6;
    mesh.current.scale.lerp({ x: scale, y: scale, z: scale }, 0.15);

    const intensity = Math.min(scaleValue.current * 2, 1);
    material.current.color.setRGB(0.1 + intensity * 0.6, 0.15, 0.2 + intensity * 0.6);
  });

  return (
    <mesh ref={mesh}>
      <sphereGeometry args={[1, 64, 64]} />
      <meshStandardMaterial ref={material} color="#1b2735" metalness={1} roughness={0.15} />
      {statusLabel && (
        <Html center>
          <div style={{
            color: "white",
            fontSize: "18px",
            animation: "pulse 1.5s infinite",
            fontWeight: "bold"
          }}>
            {statusLabel}
          </div>
        </Html>
      )}
    </mesh>
  );
};

const AudioVisualizer3D = ({ scaleValue, statusLabel }) => (
  <Canvas style={{ height: 300, width: 300 }} camera={{ position: [0, 0, 3] }}>
    <ambientLight intensity={0.5} />
    <directionalLight position={[5, 5, 5]} intensity={1} />
    <MercuryBlob scaleValue={scaleValue} statusLabel={statusLabel} />
    <Environment preset="sunset" />
  </Canvas>
);

const App = () => {
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const [statusLabel, setStatusLabel] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [micTranscript, setMicTranscript] = useState("");
  const [messageHistory, setMessageHistory] = useState([]);
  const ws = useRef(null);
  const audioCtx = useRef(null);
  const outputCtx = useRef(new AudioContext({ sampleRate: 24000 }));
  const processor = useRef(null);
  const analyser = useRef(null);
  const streamRef = useRef(null);
  const silenceStart = useRef(null);
  const scaleValue = useRef(0);
  const audioPlaying = useRef(false);
  const nextStartTime = useRef(0);
  const activeSources = useRef(new Set());

  const toggleRecording = async () => {
    if (isRecordingRef.current) {
      console.log("🛑 Stopping recording...");
      isRecordingRef.current = false;
      setIsRecording(false);
      stopRecording();
    } else {
      console.log("🎙️ Starting recording...");
      isRecordingRef.current = true;
      setIsRecording(true);
      setStreamingText("");
      setMicTranscript("");
      await startRecording();
    }
  };

  const startRecording = async () => {
    try {
      audioCtx.current = new AudioContext({ sampleRate: 16000 });
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      const source = audioCtx.current.createMediaStreamSource(streamRef.current);
      processor.current = audioCtx.current.createScriptProcessor(4096, 1, 1);
      analyser.current = audioCtx.current.createAnalyser();
      analyser.current.fftSize = 2048;
      const dataArray = new Uint8Array(analyser.current.fftSize);

      console.log("🔌 Opening WebSocket...");
      ws.current = new WebSocket("ws://ec2-54-173-163-226.compute-1.amazonaws.com:8000/ws/audio");

      ws.current.onopen = () => console.log("✅ WebSocket connected.");
      ws.current.onclose = () => console.log("❌ WebSocket closed.");
      ws.current.onerror = (e) => console.error("🚨 WebSocket error:", e);

      ws.current.onmessage = async (event) => {
        const msg = event.data;

        if (msg.startsWith("__stream__:")) {
          const token = msg.replace("__stream__:", "");
          setStreamingText((prev) => prev + token);
          return;
        }

        if (msg.startsWith("__mic__:")) {
          const transcript = msg.replace("__mic__:", "");
          setMicTranscript(transcript);
          return;
        }

        const isBase64 = /^[A-Za-z0-9+/=]+$/.test(msg);
        if (!isBase64) {
          console.warn("⛔ Received non-base64 message. Skipping:", msg);
          return;
        }

        try {
          console.log("📩 Received TTS audio from server");
          const binary = atob(msg);
          const buffer = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            buffer[i] = binary.charCodeAt(i);
          }

          const audioBuffer = await decodeAudioData(
            buffer.buffer,
            outputCtx.current,
            24000,
            1
          );

          nextStartTime.current = Math.max(
            nextStartTime.current,
            outputCtx.current.currentTime
          );

          const source = outputCtx.current.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(outputCtx.current.destination);
          source.onended = () => {
            activeSources.current.delete(source);
            if (activeSources.current.size === 0) {
              console.log("✅ All TTS playback finished.");
              audioPlaying.current = false;
            }
          };

          console.log("🔊 Queueing audio playback at", nextStartTime.current);
          source.start(nextStartTime.current);
          nextStartTime.current += audioBuffer.duration;

          activeSources.current.add(source);
          audioPlaying.current = true;

          // Save last message to history
          setMessageHistory((prev) => [...prev, { role: "assistant", content: streamingText }]);
          setStreamingText("");
        } catch (err) {
          console.error("❌ Failed to decode TTS audio:", err);
        }
      };

      processor.current.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          int16[i] = input[i] * 0x7fff;
        }
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(int16.buffer);
        }
      };

      const SILENCE_THRESHOLD = 4;
      const SILENCE_DURATION_MS = 1500;
      const calcAmplitude = (avg) => (avg > SILENCE_THRESHOLD ? (avg - SILENCE_THRESHOLD) / 64 : 0);

      const detectSilence = () => {
        if (!isRecordingRef.current) {
          console.log("🛑 Recording stopped — halting silence detection.");
          return;
        }

        requestAnimationFrame(detectSilence);
        analyser.current.getByteTimeDomainData(dataArray);
        const avg = dataArray.reduce((a, b) => a + Math.abs(b - 128), 0) / dataArray.length;
        scaleValue.current = calcAmplitude(avg);
        const now = Date.now();

        if (avg < SILENCE_THRESHOLD) {
          if (!silenceStart.current) {
            silenceStart.current = now;
            console.log("🤫 Silence detected... timer started at", new Date(now).toLocaleTimeString());
          } else {
            const silentDuration = now - silenceStart.current;
            console.log(`⏱️ Silent for ${silentDuration}ms`);
            if (silentDuration > SILENCE_DURATION_MS) {
              if (ws.current?.readyState === WebSocket.OPEN) {
                console.log("📤 Silence threshold exceeded. Sending '__end__' to server.");
                ws.current.send("__end__");
                silenceStart.current = null;
              }
            }
          }
        } else {
          silenceStart.current = null;
        }
      };

      source.connect(analyser.current);
      analyser.current.connect(processor.current);
      processor.current.connect(audioCtx.current.destination);
      detectSilence();
      console.log("🎛️ Audio stream + silence detection started.");
    } catch (err) {
      console.error("❌ Failed to start recording:", err);
      setIsRecording(false);
      isRecordingRef.current = false;
    }
  };

  const stopPlayback = () => {
    for (const source of activeSources.current) {
      try {
        source.stop();
      } catch (e) {
        console.warn("⚠️ Failed to stop source", e);
      }
    }
    activeSources.current.clear();
    nextStartTime.current = 0;
    audioPlaying.current = false;
  };

  const stopRecording = () => {
    processor.current?.disconnect();
    analyser.current?.disconnect();
    audioCtx.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    stopPlayback();

    const waitAndClose = () => {
      if (!audioPlaying.current && ws.current?.readyState === WebSocket.OPEN) {
        console.log("📴 Closing WebSocket after TTS playback.");
        ws.current.close();
      } else {
        console.log("⏳ Waiting for TTS to finish before closing WebSocket...");
        setTimeout(waitAndClose, 500);
      }
    };
    waitAndClose();
  };

  return (
    <div
      style={{
        background: "linear-gradient(145deg, #0a0f1a, #12233e)",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <AudioVisualizer3D scaleValue={scaleValue} statusLabel={isRecording ? statusLabel : ""} />
      <button
        style={{
          marginTop: 30,
          padding: "12px 24px",
          fontSize: "18px",
          backgroundColor: "#1e3a8a",
          color: "white",
          border: "none",
          borderRadius: "8px",
          cursor: "pointer",
        }}
        onClick={toggleRecording}
      >
              {isRecording
          ? <FaStop color="white" size={28} />
          : <FaMicrophone color="red" size={28} />}
              
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
