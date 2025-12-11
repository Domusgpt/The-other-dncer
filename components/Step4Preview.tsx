
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, Video, Settings, Mic, MicOff, Maximize2, Minimize2, Upload, X, Loader2, Sliders, Package, Music, ChevronDown, ChevronUp, Activity, Download, FileVideo, Radio, Star, Camera, Volume2, VolumeX, Sparkles, CircleDot, Monitor, Smartphone, Square } from 'lucide-react';
import { AppState, EnergyLevel, MoveDirection } from '../types';
import { QuantumVisualizer } from './Visualizer/HolographicVisualizer';
import { generatePlayerHTML } from '../services/playerExport';
import { STYLE_PRESETS } from '../constants';

interface Step4Props {
  state: AppState;
  onGenerateMore: () => void;
  onSpendCredit: (amount: number) => boolean;
  onUploadAudio: (file: File) => void;
  onSaveProject: () => void;
}

type AspectRatio = '9:16' | '1:1' | '16:9';
type Resolution = '720p' | '1080p' | '4K';

type RhythmPhase = 'WARMUP' | 'SWING_LEFT' | 'SWING_RIGHT' | 'DROP' | 'CHAOS';

interface FrameData {
    url: string;
    pose: string;
    energy: EnergyLevel;
    direction?: MoveDirection;
    isVirtual?: boolean;
    virtualZoom?: number; 
    virtualOffsetY?: number;
}

export const Step4Preview: React.FC<Step4Props> = ({ state, onGenerateMore, onSpendCredit, onUploadAudio, onSaveProject }) => {
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const charCanvasRef = useRef<HTMLCanvasElement>(null); 
  const containerRef = useRef<HTMLDivElement>(null);
  const audioElementRef = useRef<HTMLAudioElement>(null);
  
  const [isRecording, setIsRecording] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportRatio, setExportRatio] = useState<AspectRatio>('9:16');
  const [exportRes, setExportRes] = useState<Resolution>('1080p');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordCanvasRef = useRef<HTMLCanvasElement>(null); 
  const [recordingTime, setRecordingTime] = useState(0);

  const hologramRef = useRef<QuantumVisualizer | null>(null);
  
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | MediaStreamAudioSourceNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null); 
  
  const requestRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0); 
  const lastBeatTimeRef = useRef<number>(0);
  const lastSnareTimeRef = useRef<number>(0);
  const lastStutterTimeRef = useRef<number>(0);
  
  const [brainState, setBrainState] = useState({ activePoseName: 'BASE', fps: 0 });

  const targetPoseRef = useRef<string>('base'); 
  const prevPoseRef = useRef<string>('base'); 
  const beatCounterRef = useRef<number>(0); 
  
  const BASE_ZOOM = 1.15;
  const camZoomRef = useRef<number>(BASE_ZOOM);
  
  // Physics
  const charSquashRef = useRef<number>(1.0); 
  const charSkewRef = useRef<number>(0.0);   
  const charTiltRef = useRef<number>(0.0);   
  const targetTiltRef = useRef<number>(0.0); 

  const masterRotXRef = useRef<number>(0); 
  const masterVelXRef = useRef<number>(0); 
  const masterRotYRef = useRef<number>(0); 
  const masterVelYRef = useRef<number>(0); 
  const masterRotZRef = useRef<number>(0); 
  const masterVelZRef = useRef<number>(0); 
  
  // FX
  const ghostAmountRef = useRef<number>(0); 
  const echoTrailRef = useRef<number>(0); 
  const fluidStutterRef = useRef<number>(0); 
  const scratchModeRef = useRef<boolean>(false);
  
  const [framesByEnergy, setFramesByEnergy] = useState<Record<EnergyLevel, FrameData[]>>({ low: [], mid: [], high: [] });
  const [closeupFrames, setCloseupFrames] = useState<FrameData[]>([]); 
  const [frameCount, setFrameCount] = useState(0);

  const poseImagesRef = useRef<Record<string, HTMLImageElement>>({}); 
  const [imagesReady, setImagesReady] = useState(false);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [superCamActive, setSuperCamActive] = useState(true);

  // 1. Initialize Hologram
  useEffect(() => {
    if (bgCanvasRef.current && !hologramRef.current) {
        try {
            hologramRef.current = new QuantumVisualizer(bgCanvasRef.current);
            const style = STYLE_PRESETS.find(s => s.id === state.selectedStyleId);
            if(style && style.hologramParams) {
                hologramRef.current.params = {...style.hologramParams};
            }
        } catch (e) { console.error("Failed to init hologram:", e); }
    }
    if (containerRef.current && hologramRef.current) {
        const resizeObserver = new ResizeObserver(() => {
            if (hologramRef.current) hologramRef.current.resize();
            if (charCanvasRef.current && containerRef.current) {
                charCanvasRef.current.width = containerRef.current.clientWidth;
                charCanvasRef.current.height = containerRef.current.clientHeight;
            }
        });
        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }
  }, [state.selectedStyleId]);

  // Sort Frames
  useEffect(() => {
    const sorted: Record<EnergyLevel, FrameData[]> = { low: [], mid: [], high: [] };
    const closeups: FrameData[] = [];
    const framesToLoad = state.generatedFrames.length > 0 
      ? state.generatedFrames 
      : (state.imagePreviewUrl ? [{ url: state.imagePreviewUrl, pose: 'base', energy: 'low' as EnergyLevel, type: 'body', direction: 'center' as MoveDirection }] : []);

    setFrameCount(framesToLoad.length);

    framesToLoad.forEach(f => {
        const frameData: FrameData = { url: f.url, pose: f.pose, energy: f.energy, direction: f.direction };
        if (f.type === 'closeup') closeups.push(frameData);
        else {
            if (sorted[f.energy]) sorted[f.energy].push(frameData);
            if (f.energy === 'high' && f.type === 'body') {
                closeups.push({
                    url: f.url,
                    pose: f.pose + '_virtual_zoom',
                    energy: 'high',
                    direction: f.direction,
                    isVirtual: true,
                    virtualZoom: 1.6,
                    virtualOffsetY: 0.2
                });
            }
        }
    });
    
    if (sorted.low.length === 0 && framesToLoad.length > 0 && framesToLoad[0].type === 'body') {
        sorted.low.push({ url: framesToLoad[0].url, pose: framesToLoad[0].pose, energy: 'low', direction: 'center' });
    }
    if (sorted.mid.length === 0) sorted.mid = [...sorted.low]; 
    if (sorted.high.length === 0) sorted.high = [...sorted.mid];

    setFramesByEnergy(sorted);
    setCloseupFrames(closeups);

    let loadedCount = 0;
    const images: Record<string, HTMLImageElement> = {};
    const totalToLoad = framesToLoad.length;
    if (totalToLoad === 0) { setImagesReady(true); return; }
    
    framesToLoad.forEach(frame => {
       if(poseImagesRef.current[frame.pose]) {
           images[frame.pose] = poseImagesRef.current[frame.pose];
           loadedCount++;
           if(loadedCount >= totalToLoad) setImagesReady(true);
           return;
       }
       const img = new Image();
       img.crossOrigin = "anonymous"; 
       img.src = frame.url;
       img.onload = () => { loadedCount++; if (loadedCount >= totalToLoad) setImagesReady(true); };
       img.onerror = () => { loadedCount++; if (loadedCount >= totalToLoad) setImagesReady(true); };
       images[frame.pose] = img;
       if (frame.energy === 'high' && frame.type === 'body') images[frame.pose + '_virtual_zoom'] = img; 
    });
    poseImagesRef.current = { ...poseImagesRef.current, ...images };
  }, [state.generatedFrames, state.imagePreviewUrl]);

  // Audio Engine
  const initAudio = () => {
      if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          analyserRef.current = audioCtxRef.current.createAnalyser();
          analyserRef.current.fftSize = 256; 
          audioDestRef.current = audioCtxRef.current.createMediaStreamDestination();
      }
      return audioCtxRef.current;
  };

  const connectFileAudio = () => {
      const ctx = initAudio();
      if (ctx.state === 'suspended') ctx.resume();
      if (audioElementRef.current && analyserRef.current && audioDestRef.current) {
          try {
             if (!sourceNodeRef.current) { 
                 const src = ctx.createMediaElementSource(audioElementRef.current);
                 src.connect(analyserRef.current);
                 src.connect(ctx.destination);
                 src.connect(audioDestRef.current);
                 sourceNodeRef.current = src;
             }
          } catch(e) {}
      }
  };

  const connectMicAudio = async () => {
      const ctx = initAudio();
      if (ctx.state === 'suspended') ctx.resume();
      try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micStreamRef.current = stream;
          if (analyserRef.current && audioDestRef.current) {
              if (audioElementRef.current) audioElementRef.current.pause();
              setIsPlaying(false);
              const src = ctx.createMediaStreamSource(stream);
              src.connect(analyserRef.current);
              src.connect(audioDestRef.current); 
          }
          setIsMicActive(true);
      } catch (e) { alert("Microphone access denied."); }
  };

  const toggleMic = () => {
      if (isMicActive) {
          if (micStreamRef.current) { micStreamRef.current.getTracks().forEach(t => t.stop()); micStreamRef.current = null; }
          setIsMicActive(false);
      } else { connectMicAudio(); }
  };

  // 3. Animation Loop
  const loop = useCallback((time: number) => {
    if (!lastFrameTimeRef.current) lastFrameTimeRef.current = time;
    const deltaTime = Math.min((time - lastFrameTimeRef.current) / 1000, 0.1); 
    lastFrameTimeRef.current = time;

    requestRef.current = requestAnimationFrame(loop);
    
    let bass = 0, mid = 0, high = 0, energy = 0;
    
    if (analyserRef.current) {
        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserRef.current.getByteFrequencyData(dataArray);

        const bassRange = dataArray.slice(0, 5); 
        const midRange = dataArray.slice(5, 30); 
        const highRange = dataArray.slice(30, 100); 
        
        bass = bassRange.reduce((a, b) => a + b, 0) / (bassRange.length * 255);
        mid = midRange.reduce((a, b) => a + b, 0) / (midRange.length * 255);
        high = highRange.reduce((a, b) => a + b, 0) / (highRange.length * 255);
        energy = (bass * 0.5 + mid * 0.3 + high * 0.2);
    }

    // --- PHYSICS TUNING (REDUCED SENSITIVITY) ---
    const stiffness = 120;
    const damping = 10;
    
    // REDUCED MULTIPLIERS to fix "overtuned" complaint
    const targetRotX = bass * 6.0;  // Was 15
    const targetRotY = mid * 6.0 * Math.sin(time * 0.003); // Was 15
    const targetRotZ = high * 2.0; // Was 5

    // Spring Solver
    const forceX = (targetRotX - masterRotXRef.current) * stiffness - (masterVelXRef.current * damping);
    masterVelXRef.current += forceX * deltaTime;
    masterRotXRef.current += masterVelXRef.current * deltaTime;

    const forceY = (targetRotY - masterRotYRef.current) * (stiffness * 0.5) - (masterVelYRef.current * (damping * 0.8));
    masterVelYRef.current += forceY * deltaTime;
    masterRotYRef.current += masterVelYRef.current * deltaTime;

    const forceZ = (targetRotZ - masterRotZRef.current) * stiffness - (masterVelZRef.current * damping);
    masterVelZRef.current += forceZ * deltaTime;
    masterRotZRef.current += masterVelZRef.current * deltaTime;

    if (hologramRef.current) {
        // We pass raw data here, but the Visualizer class now does internal Smoothing
        hologramRef.current.updateAudio({ bass, mid, high, energy });
        const rx = superCamActive ? masterRotXRef.current : 0;
        const ry = superCamActive ? masterRotYRef.current : 0;
        const rz = superCamActive ? masterRotZRef.current : 0;
        hologramRef.current.render(0, { x: rx * 0.5, y: ry * 0.3, z: rz * 0.1 }); 
    }

    const now = Date.now();
    
    // --- STUTTER & SCRATCH ENGINE ---
    // Detect high frequency chaos (Snare Rolls, Hi-Hats)
    const isStuttering = mid > 0.6 || high > 0.5;
    
    // Stutter Check (Runs faster than beat check)
    if (isStuttering && (now - lastStutterTimeRef.current) > 60) { // 60ms = ~15fps scratch
        lastStutterTimeRef.current = now;
        
        // "Scratch" Logic: Ping pong between prev and target
        if (Math.random() < 0.4) {
             const swap = targetPoseRef.current;
             targetPoseRef.current = prevPoseRef.current;
             prevPoseRef.current = swap;
             
             // Visual Glitch
             charSkewRef.current = (Math.random() - 0.5) * 1.5;
             fluidStutterRef.current = 1.0; // Max blur
             scratchModeRef.current = true;
        } else {
             // Force random high energy frame
             const pool = [...framesByEnergy.high, ...closeupFrames];
             if(pool.length > 0) {
                 prevPoseRef.current = targetPoseRef.current;
                 targetPoseRef.current = pool[Math.floor(Math.random() * pool.length)].pose;
             }
             scratchModeRef.current = false;
        }
    }

    // --- MAIN GROOVE ENGINE ---
    // Only trigger if we aren't mid-scratch
    if (!scratchModeRef.current && bass > 0.6 && (now - lastBeatTimeRef.current) > 350) {
        lastBeatTimeRef.current = now;
        beatCounterRef.current = (beatCounterRef.current + 1) % 16; 

        const beat = beatCounterRef.current;
        let phase: RhythmPhase = 'WARMUP';
        if (beat >= 4 && beat < 8) phase = 'SWING_LEFT';
        else if (beat >= 8 && beat < 12) phase = 'SWING_RIGHT';
        else if (beat === 12 || beat === 13) phase = 'DROP'; 
        else if (beat >= 14) phase = 'CHAOS'; 

        // Physics Impulse - REDUCED for less "Heartbeat" look
        camZoomRef.current = BASE_ZOOM + (bass * 0.15); // Less aggressive zoom
        charSquashRef.current = 0.95; // Much subtler squash (was 0.92)

        if (phase === 'SWING_LEFT') targetTiltRef.current = -3; // Reduced from 5
        else if (phase === 'SWING_RIGHT') targetTiltRef.current = 3;
        else if (phase === 'CHAOS') targetTiltRef.current = (Math.random() - 0.5) * 10; 
        else targetTiltRef.current = 0; 

        let pool: FrameData[] = [];
        if (phase === 'WARMUP') pool = framesByEnergy.low; 
        else if (phase === 'SWING_LEFT') {
            const leftFrames = framesByEnergy.mid.filter(f => f.direction === 'left');
            pool = leftFrames.length > 0 ? leftFrames : framesByEnergy.mid;
        } else if (phase === 'SWING_RIGHT') {
            const rightFrames = framesByEnergy.mid.filter(f => f.direction === 'right');
            pool = rightFrames.length > 0 ? rightFrames : framesByEnergy.mid;
        } else if (phase === 'DROP') pool = framesByEnergy.high;
        else if (phase === 'CHAOS') pool = [...framesByEnergy.high, ...closeupFrames];

        if (pool.length === 0) pool = framesByEnergy.mid;
        if (pool.length === 0) pool = framesByEnergy.low;
        
        if (pool.length > 0) {
            prevPoseRef.current = targetPoseRef.current;
            let nextFrame = pool[Math.floor(Math.random() * pool.length)];
            let attempts = 0;
            while (nextFrame.pose === targetPoseRef.current && attempts < 3 && phase !== 'CHAOS') {
                 nextFrame = pool[Math.floor(Math.random() * pool.length)];
                 attempts++;
            }
            targetPoseRef.current = nextFrame.pose;
        }
    }
    
    // Vocal Gate
    if (high > 0.6 && mid > 0.4 && bass < 0.5) {
        const singers = closeupFrames.filter(f => f.pose.includes('open'));
        if (singers.length > 0 && Math.random() < 0.3) {
            targetPoseRef.current = singers[Math.floor(Math.random() * singers.length)].pose;
        }
    }

    // Physics Decay
    charSquashRef.current += (1.0 - charSquashRef.current) * (10 * deltaTime); // Slower return
    charSkewRef.current += (0.0 - charSkewRef.current) * (15 * deltaTime);
    fluidStutterRef.current *= Math.exp(-8 * deltaTime); 
    charTiltRef.current += (targetTiltRef.current - charTiltRef.current) * (5 * deltaTime);

    const decay = 1 - Math.exp(-6 * deltaTime);
    camZoomRef.current += (BASE_ZOOM - camZoomRef.current) * decay;
    ghostAmountRef.current *= Math.exp(-8 * deltaTime); 
    echoTrailRef.current *= Math.exp(-4 * deltaTime);

    const rotX = superCamActive ? masterRotXRef.current : 0;
    const rotY = superCamActive ? masterRotYRef.current : 0;
    const rotZ = superCamActive ? masterRotZRef.current : 0;
    
    const renderCharacterCanvas = (ctx: CanvasRenderingContext2D, w: number, h: number, fitMode: 'contain' | 'cover' = 'contain') => {
        const cx = w/2;
        const cy = h/2;
        ctx.clearRect(0, 0, w, h);
        
        const activeFrame = [...framesByEnergy.low, ...framesByEnergy.mid, ...framesByEnergy.high, ...closeupFrames].find(f => f.pose === targetPoseRef.current);
        const img = poseImagesRef.current[targetPoseRef.current];
        const ghostImg = poseImagesRef.current[prevPoseRef.current];

        if (img) {
            const aspect = img.width / img.height;
            let dw = w;
            let dh = w / aspect;
            
            if (fitMode === 'contain') {
                dw = w * 0.9;
                dh = dw / aspect;
                if (dh > h * 0.9) { dh = h * 0.9; dw = dh * aspect; }
            } else {
                if (dh < h) { dh = h; dw = dh * aspect; }
            }
            
            const renderFrame = (image: HTMLImageElement, zoom: number, opacity: number, composite: GlobalCompositeOperation = 'source-over', offsetY: number = 0) => {
                ctx.save();
                ctx.translate(cx, cy);
                
                const tiltX = (rotX * 1.0) * (Math.PI/180);
                const tiltY = (-rotY * 1.5) * (Math.PI/180); 
                const tiltZ = (rotZ * 0.8) * (Math.PI/180);
                
                ctx.rotate(tiltZ + (charTiltRef.current * Math.PI / 180));
                ctx.transform(1, tiltX * 0.5, tiltY * 0.5, 1, -rotY * 0.8, -rotX * 0.8);
                ctx.scale(1/charSquashRef.current, charSquashRef.current); 
                ctx.transform(1, 0, charSkewRef.current, 1, 0, 0);

                ctx.scale(zoom, zoom);
                ctx.translate(0, offsetY * dh); 
                
                ctx.globalAlpha = opacity;
                ctx.globalCompositeOperation = composite;
                
                ctx.drawImage(image, -dw/2, -dh/2, dw, dh);
                ctx.restore();
            }

            let effectiveZoom = camZoomRef.current;
            let effectiveOffsetY = 0;
            
            if (activeFrame && activeFrame.isVirtual && activeFrame.virtualZoom) {
                effectiveZoom *= activeFrame.virtualZoom;
                effectiveOffsetY = activeFrame.virtualOffsetY || 0;
            }

            if (ghostAmountRef.current > 0.05 && ghostImg) {
                renderFrame(ghostImg, effectiveZoom * 1.2, ghostAmountRef.current * 0.4, 'screen', effectiveOffsetY);
            }

            // Fluid Stutter: Triggered heavily by scratch engine
            if (fluidStutterRef.current > 0.1 && ghostImg) {
                renderFrame(ghostImg, effectiveZoom, fluidStutterRef.current * 0.6, 'source-over', effectiveOffsetY);
            }

            if (echoTrailRef.current > 0.05) {
                renderFrame(img, effectiveZoom * 1.02, echoTrailRef.current * 0.3, 'source-over', effectiveOffsetY);
            }

            renderFrame(img, effectiveZoom, 1.0, 'source-over', effectiveOffsetY);
            
            if (ghostAmountRef.current > 0.2) {
                 renderFrame(img, effectiveZoom, ghostAmountRef.current * 0.2, 'overlay', effectiveOffsetY);
            }
        }
    };

    if (charCanvasRef.current && imagesReady) {
        const ctx = charCanvasRef.current.getContext('2d');
        if (ctx) renderCharacterCanvas(ctx, charCanvasRef.current.width, charCanvasRef.current.height);
    }
    
    if (isRecording && recordCanvasRef.current && bgCanvasRef.current) {
        const ctx = recordCanvasRef.current.getContext('2d');
        if (ctx) {
            const w = recordCanvasRef.current.width;
            const h = recordCanvasRef.current.height;
            const bgAspect = bgCanvasRef.current.width / bgCanvasRef.current.height;
            let bgW = w;
            let bgH = w / bgAspect;
            if (bgH < h) { bgH = h; bgW = bgH * bgAspect; }
            
            ctx.drawImage(bgCanvasRef.current, (w-bgW)/2, (h-bgH)/2, bgW, bgH);
            renderCharacterCanvas(ctx, w, h, 'contain');
        }
    }
    
    setBrainState({
        activePoseName: targetPoseRef.current,
        fps: Math.round(1/deltaTime)
    });

  }, [imagesReady, superCamActive, framesByEnergy, closeupFrames, isRecording]);


  useEffect(() => {
    if (imagesReady) {
        requestRef.current = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [loop, imagesReady]);

  useEffect(() => {
      if(audioElementRef.current && isPlaying) {
          connectFileAudio();
          audioElementRef.current.play();
      } else if(audioElementRef.current) {
          audioElementRef.current.pause();
      }
  }, [isPlaying]);


  const handleExportWidget = () => {
      if(!hologramRef.current) return;
      const html = generatePlayerHTML(state.generatedFrames, hologramRef.current.params, state.subjectCategory);
      const blob = new Blob([html], {type: 'text/html'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jusdnce_rig_${Date.now()}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
  };

  const startRecording = () => {
      if (!recordCanvasRef.current) return;
      
      let w = 1080;
      let h = 1920;
      
      const resMult = exportRes === '4K' ? 2 : (exportRes === '720p' ? 0.66 : 1);
      const baseDim = 1080 * resMult;
      
      if (exportRatio === '9:16') { w = baseDim; h = baseDim * (16/9); }
      else if (exportRatio === '16:9') { w = baseDim * (16/9); h = baseDim; }
      else if (exportRatio === '1:1') { w = baseDim; h = baseDim; }
      
      recordCanvasRef.current.width = Math.floor(w);
      recordCanvasRef.current.height = Math.floor(h);

      const stream = recordCanvasRef.current.captureStream(60);
      
      if (audioDestRef.current) {
          const audioTracks = audioDestRef.current.stream.getAudioTracks();
          if (audioTracks.length > 0) {
              stream.addTrack(audioTracks[0]);
          }
      }

      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 8000000 });
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];
      
      recorder.ondataavailable = (e) => {
          if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      
      recorder.onstop = () => {
          const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `jusdnce_${exportRatio.replace(':','x')}_${Date.now()}.webm`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
      };
      
      recorder.start();
      setIsRecording(true);
      setShowExportMenu(false); 
      
      const startTime = Date.now();
      const interval = setInterval(() => {
          setRecordingTime(Date.now() - startTime);
      }, 100);
      (mediaRecorderRef.current as any).timerInterval = interval;
  };

  const stopRecording = () => {
      if (mediaRecorderRef.current && isRecording) {
          mediaRecorderRef.current.stop();
          clearInterval((mediaRecorderRef.current as any).timerInterval);
          setIsRecording(false);
          setRecordingTime(0);
      }
  };


  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center overflow-hidden bg-black/90">
      
      <canvas ref={recordCanvasRef} className="hidden pointer-events-none fixed -top-[9999px]" />

      <div className="absolute inset-0 w-full h-full overflow-hidden flex items-center justify-center perspective-1000">
           <canvas 
              ref={bgCanvasRef} 
              className="absolute inset-0 w-full h-full object-cover opacity-80 transition-transform duration-75 ease-linear will-change-transform" 
           />
           <canvas 
              ref={charCanvasRef} 
              className="absolute inset-0 w-full h-full object-contain z-10 transition-transform duration-75 ease-linear will-change-transform" 
           />
      </div>

      {showExportMenu && (
          <div className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-md flex items-center justify-center animate-fade-in p-6">
              <div className="bg-dark-surface border border-brand-500/30 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-zoom-out relative">
                  <button onClick={() => setShowExportMenu(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white"><X size={20} /></button>
                  <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2"><FileVideo className="text-brand-400" /> EXPORT SETTINGS</h3>
                  <div className="space-y-6">
                      <div>
                          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-3">Aspect Ratio</label>
                          <div className="grid grid-cols-3 gap-3">
                              {[{ id: '9:16', icon: Smartphone, label: 'Story' }, { id: '1:1', icon: Square, label: 'Post' }, { id: '16:9', icon: Monitor, label: 'Cinema' }].map((opt) => (
                                  <button key={opt.id} onClick={() => setExportRatio(opt.id as AspectRatio)} className={`flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all ${exportRatio === opt.id ? 'bg-brand-600 border-brand-400 text-white shadow-lg' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'}`}>
                                      <opt.icon size={20} /> <span className="text-xs font-bold">{opt.label}</span>
                                  </button>
                              ))}
                          </div>
                      </div>
                      <div>
                          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest block mb-3">Resolution</label>
                          <div className="flex bg-black/40 rounded-lg p-1 border border-white/10">
                              {['720p', '1080p', '4K'].map((res) => (
                                  <button key={res} onClick={() => setExportRes(res as Resolution)} className={`flex-1 py-2 rounded-md text-xs font-bold transition-all ${exportRes === res ? 'bg-brand-500 text-white shadow-md' : 'text-gray-500 hover:text-white'}`}>{res}</button>
                              ))}
                          </div>
                      </div>
                      <button onClick={startRecording} className="w-full py-4 bg-red-600 hover:bg-red-500 text-white font-black tracking-widest rounded-xl flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(220,38,38,0.4)] transition-all hover:scale-[1.02]"><CircleDot size={20} /> START RECORDING</button>
                  </div>
              </div>
          </div>
      )}

      {!imagesReady && (
         <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-50 backdrop-blur-md">
             <Loader2 size={48} className="text-brand-500 animate-spin mb-4" />
             <p className="text-white font-mono tracking-widest animate-pulse">NEURAL RIG INITIALIZING...</p>
             <p className="text-gray-500 text-xs mt-2">Loading {frameCount} frames</p>
         </div>
      )}

      {state.audioPreviewUrl && (
          <audio ref={audioElementRef} src={state.audioPreviewUrl} loop crossOrigin="anonymous" onEnded={() => setIsPlaying(false)} />
      )}

      <div className="absolute inset-0 pointer-events-none z-30 p-6 flex flex-col justify-between">
          <div className="flex justify-between items-start">
             <div className="bg-black/40 backdrop-blur-md border border-white/10 p-3 rounded-lg pointer-events-auto">
                 <div className="flex items-center gap-2 mb-1"><Activity size={14} className="text-brand-400" /><span className="text-[10px] font-bold text-gray-300 tracking-widest">NEURAL STATUS</span></div>
                 <div className="font-mono text-xs text-brand-300">FPS: {brainState.fps}<br/>POSE: {brainState.activePoseName}<br/>FRAMES: {frameCount}</div>
             </div>
             <div className="flex gap-2 pointer-events-auto items-center">
                 {isRecording && <div className="flex items-center gap-2 bg-red-500/20 border border-red-500/50 px-3 py-1.5 rounded-full animate-pulse"><div className="w-2 h-2 bg-red-500 rounded-full" /><span className="text-red-300 font-mono text-xs">{(recordingTime / 1000).toFixed(1)}s</span></div>}
                 <button onClick={() => isRecording ? stopRecording() : setShowExportMenu(true)} className={`glass-button px-4 py-2 rounded-lg text-white flex items-center gap-2 ${isRecording ? 'bg-red-500/50 border-red-500' : ''}`}><CircleDot size={18} className={isRecording ? 'text-white' : 'text-red-400'} /><span className="text-xs font-bold">{isRecording ? 'STOP REC' : 'REC VIDEO'}</span></button>
                 <button className="glass-button p-2 rounded-lg text-white" onClick={handleExportWidget} title="Download Standalone Widget"><Download size={20} /></button>
             </div>
          </div>
          
          {state.isGenerating && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/60 backdrop-blur-xl border border-brand-500/50 p-6 rounded-2xl flex flex-col items-center gap-4 animate-in zoom-in slide-in-from-bottom-4 shadow-[0_0_50px_rgba(139,92,246,0.3)]">
                  <div className="relative"><div className="w-12 h-12 border-4 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" /><div className="absolute inset-0 flex items-center justify-center"><Sparkles size={16} className="text-white animate-pulse" /></div></div>
                  <div className="text-center"><h3 className="text-white font-bold tracking-widest mb-1">EXPANDING REALITY</h3><p className="text-brand-200 text-xs font-mono">Generating new variations...</p></div>
              </div>
          )}

          <div className="flex flex-col items-center gap-4 pointer-events-auto w-full max-w-2xl mx-auto">
              <div className="flex items-center gap-4 bg-black/60 backdrop-blur-xl border border-white/10 p-2 rounded-full shadow-2xl">
                   {state.audioPreviewUrl ? (
                       <button onClick={() => { setIsPlaying(!isPlaying); if(isMicActive) toggleMic(); }} className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${isPlaying ? 'bg-brand-500 text-white shadow-[0_0_20px_rgba(139,92,246,0.4)]' : 'bg-white/10 text-white hover:bg-white/20'}`}>{isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}</button>
                   ) : <div className="px-4 text-[10px] text-gray-400 font-mono">NO TRACK LOADED</div>}
                   <div className="h-8 w-[1px] bg-white/10" />
                   <button onClick={toggleMic} className={`px-4 py-2 rounded-full flex items-center gap-2 text-xs font-bold transition-all border ${isMicActive ? 'bg-red-500/20 border-red-500 text-red-400 animate-pulse' : 'border-transparent text-gray-400 hover:text-white'}`}>{isMicActive ? <Mic size={16} /> : <MicOff size={16} />} LIVE INPUT</button>
                   <div className="h-8 w-[1px] bg-white/10" />
                   <button onClick={() => setSuperCamActive(!superCamActive)} className={`px-4 py-2 rounded-full flex items-center gap-2 text-xs font-bold transition-all border ${superCamActive ? 'bg-blue-500/20 border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-white'}`}><Camera size={16} /> SUPER CAM</button>
              </div>
              <div className="flex gap-3">
                  <button onClick={onGenerateMore} className="glass-button px-6 py-2 rounded-full text-xs font-bold text-white flex items-center gap-2 hover:bg-white/20"><Package size={14} /> NEW VARIATIONS</button>
                  <button onClick={onSaveProject} className="glass-button px-6 py-2 rounded-full text-xs font-bold text-white flex items-center gap-2 hover:bg-white/20"><Download size={14} /> SAVE RIG</button>
              </div>
          </div>
      </div>
      
    </div>
  );
};
