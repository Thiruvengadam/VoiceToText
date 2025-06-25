// src/components/AudioVisualizer.jsx
import React, { useEffect, useRef } from 'react';

const AudioVisualizer = ({ isRecording }) => {
  const canvasRef = useRef(null);
  let animationFrameId;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = canvas.width = 300;
    const height = canvas.height = 300;
    let time = 0;

    const drawBlob = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2, height / 2);

      const baseRadius = 70;
      const blobScale = isRecording ? 1 + Math.sin(time * 4) * 0.1 : 1;
      const depthWarp = (angle) =>
        isRecording ? 8 * Math.sin(angle * 4 + time * 5) : 0;

      const points = 100;
      ctx.beginPath();
      for (let i = 0; i <= points; i++) {
        const angle = (Math.PI * 2 * i) / points;
        const r = baseRadius + depthWarp(angle);
        const x = r * Math.cos(angle) * blobScale;
        const y = r * Math.sin(angle) * blobScale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      // Mercury-like gradient
      const gradient = ctx.createRadialGradient(0, 0, 20, 0, 0, 120);
      gradient.addColorStop(0, '#eeeeee');
      gradient.addColorStop(0.5, '#aaaaaa');
      gradient.addColorStop(1, '#222222');
      ctx.fillStyle = gradient;

      // Optional reflection highlight
      ctx.shadowColor = 'rgba(255, 255, 255, 0.3)';
      ctx.shadowBlur = 35;

      ctx.fill();
      ctx.restore();
    };

    const animate = () => {
      drawBlob();
      time += 0.03;
      animationFrameId = requestAnimationFrame(animate);
    };

    animate();
    return () => cancelAnimationFrame(animationFrameId);
  }, [isRecording]);

  return <canvas ref={canvasRef} className="visualizer" />;
};

export default AudioVisualizer;
