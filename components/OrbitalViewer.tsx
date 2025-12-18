/**
 * ORBITAL VIEWER - The Kinetic Sprite Commerce Engine
 *
 * A scroll/drag-driven 360° product visualization component.
 * Replaces the audio-driven "Kinetic Brain" with physics-based rotation.
 *
 * Key Features:
 * - Inertial rotation with configurable friction
 * - Snap-to-angle support
 * - CUT vs BLEND transition modes
 * - Virtual macro lens integration
 * - Touch and mouse gesture support
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  RotateCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Package,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  Eye
} from 'lucide-react';
import {
  OrbitalFrame,
  OrbitalConfig,
  OrbitalPhysicsState,
  DEFAULT_ORBITAL_CONFIG
} from '../types';
import { quantizeAngleToFrame, getInterpolationFrames } from '../services/gemini';

interface OrbitalViewerProps {
  frames: OrbitalFrame[];
  config?: Partial<OrbitalConfig>;
  onAngleChange?: (angle: number) => void;
  onMacroSelect?: (region: string) => void;
  className?: string;
  showControls?: boolean;
  enableInterpolation?: boolean;
}

// Transition modes matching the dance engine
type TransitionMode = 'CUT' | 'BLEND';

export const OrbitalViewer: React.FC<OrbitalViewerProps> = ({
  frames,
  config = {},
  onAngleChange,
  onMacroSelect,
  className = '',
  showControls = true,
  enableInterpolation = true,
}) => {
  const fullConfig: OrbitalConfig = { ...DEFAULT_ORBITAL_CONFIG, ...config };

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);

  // Physics State
  const physicsRef = useRef<OrbitalPhysicsState>({
    currentAngle: 0,
    currentPitch: 0,
    angularVelocity: 0,
    pitchVelocity: 0,
    isDragging: false,
    lastInputTime: 0,
  });

  // Interaction tracking
  const lastPointerRef = useRef<{ x: number, y: number } | null>(null);
  const lastDragTimeRef = useRef<number>(0);
  const dragDeltaAccumRef = useRef<number>(0);

  // Image cache
  const frameImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [imagesLoaded, setImagesLoaded] = useState(false);

  // Current display state
  const [displayAngle, setDisplayAngle] = useState(0);
  const [currentFrame, setCurrentFrame] = useState<OrbitalFrame | null>(null);
  const [isAutoRotating, setIsAutoRotating] = useState(false);
  const [showMacroPanel, setShowMacroPanel] = useState(false);
  const [selectedMacro, setSelectedMacro] = useState<string | null>(null);

  // Transition state
  const transitionRef = useRef({
    sourceFrame: null as OrbitalFrame | null,
    targetFrame: null as OrbitalFrame | null,
    progress: 1.0,
    mode: 'CUT' as TransitionMode,
  });

  // Load all frame images
  useEffect(() => {
    if (frames.length === 0) return;

    let loadedCount = 0;
    const imageMap = new Map<string, HTMLImageElement>();

    console.log(`[OrbitalViewer] Loading ${frames.length} frames...`);

    // Log frame distribution for debugging
    const orbitalFrames = frames.filter(f => f.role === 'orbital' && !f.isMacro);
    console.log(`[OrbitalViewer] Orbital rotation frames: ${orbitalFrames.length}`);
    console.log(`[OrbitalViewer] Frame angles:`, orbitalFrames.map(f => f.angle).sort((a, b) => a - b));

    frames.forEach((frame, index) => {
      // Use URL as unique key - most reliable identifier
      const key = frame.url;

      if (frameImagesRef.current.has(key)) {
        imageMap.set(key, frameImagesRef.current.get(key)!);
        loadedCount++;
        if (loadedCount === frames.length) setImagesLoaded(true);
        return;
      }

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        loadedCount++;
        if (loadedCount === frames.length) {
          console.log(`[OrbitalViewer] All ${frames.length} images loaded`);
          setImagesLoaded(true);
        }
      };
      img.onerror = () => {
        console.warn(`[OrbitalViewer] Failed to load frame ${index} (angle: ${frame.angle})`);
        loadedCount++;
        if (loadedCount === frames.length) setImagesLoaded(true);
      };
      img.src = frame.url;
      imageMap.set(key, img);
    });

    frameImagesRef.current = imageMap;
  }, [frames]);

  // Get image for a frame - use URL as key for reliable matching
  const getFrameImage = useCallback((frame: OrbitalFrame): HTMLImageElement | null => {
    const img = frameImagesRef.current.get(frame.url);
    if (!img) {
      console.warn(`[OrbitalViewer] No cached image for frame at ${frame.angle}°`);
    }
    return img || null;
  }, []);

  /**
   * SCROLL-PHYSICS ENGINE
   * Replaces the audio driver with inertial rotation physics
   */
  const updatePhysics = useCallback((deltaTime: number) => {
    const physics = physicsRef.current;
    const { frictionCoefficient, springStiffness, snapToAngles } = fullConfig;

    if (!physics.isDragging) {
      // Apply friction decay
      physics.angularVelocity *= Math.pow(frictionCoefficient, deltaTime * 60);
      physics.pitchVelocity *= Math.pow(frictionCoefficient, deltaTime * 60);

      // Optional snap-to-angle behavior
      if (snapToAngles && snapToAngles.length > 0 && Math.abs(physics.angularVelocity) < 10) {
        // Find nearest snap angle
        let nearestSnap = snapToAngles[0];
        let smallestDiff = Math.abs(physics.currentAngle - nearestSnap);

        for (const snap of snapToAngles) {
          const diff = Math.abs(physics.currentAngle - snap);
          if (diff < smallestDiff) {
            smallestDiff = diff;
            nearestSnap = snap;
          }
        }

        // Apply spring force toward snap point
        const snapForce = (nearestSnap - physics.currentAngle) * springStiffness;
        physics.angularVelocity += snapForce * deltaTime * 60;
      }
    }

    // Integrate velocity
    physics.currentAngle += physics.angularVelocity * deltaTime;
    physics.currentPitch += physics.pitchVelocity * deltaTime;

    // Normalize angle to 0-360
    physics.currentAngle = ((physics.currentAngle % 360) + 360) % 360;

    // Clamp pitch to -90 to 90
    physics.currentPitch = Math.max(-90, Math.min(90, physics.currentPitch));

    // Stop tiny velocities
    if (Math.abs(physics.angularVelocity) < 0.1) physics.angularVelocity = 0;
    if (Math.abs(physics.pitchVelocity) < 0.1) physics.pitchVelocity = 0;

    return physics.currentAngle;
  }, [fullConfig]);

  /**
   * Trigger a transition between frames
   */
  const triggerTransition = useCallback((newFrame: OrbitalFrame, mode: TransitionMode = 'CUT') => {
    if (!currentFrame || newFrame === currentFrame) return;

    transitionRef.current = {
      sourceFrame: currentFrame,
      targetFrame: newFrame,
      progress: 0,
      mode,
    };
  }, [currentFrame]);

  /**
   * MAIN RENDER LOOP
   */
  const renderLoop = useCallback((time: number) => {
    if (!lastFrameTimeRef.current) lastFrameTimeRef.current = time;
    const deltaTime = Math.min((time - lastFrameTimeRef.current) / 1000, 0.1);
    lastFrameTimeRef.current = time;

    requestRef.current = requestAnimationFrame(renderLoop);

    // Auto-rotation
    if (isAutoRotating && !physicsRef.current.isDragging) {
      physicsRef.current.angularVelocity = 30; // 30 degrees per second
    }

    // Update physics
    const angle = updatePhysics(deltaTime);
    setDisplayAngle(Math.round(angle));
    onAngleChange?.(angle);

    // Update transition progress
    if (transitionRef.current.progress < 1.0) {
      const transitionSpeed = transitionRef.current.mode === 'CUT' ? 50 : 5;
      transitionRef.current.progress += transitionSpeed * deltaTime;
      if (transitionRef.current.progress > 1.0) transitionRef.current.progress = 1.0;
    }

    // Select frame based on angle
    const newFrame = selectedMacro
      ? frames.find(f => f.isMacro && f.macroRegion === selectedMacro)
      : quantizeAngleToFrame(angle, frames, { role: 'orbital' });

    if (newFrame && newFrame !== currentFrame) {
      // Log frame change for debugging
      console.log(`[OrbitalViewer] Frame change: ${currentFrame?.angle}° → ${newFrame.angle}° (display: ${Math.round(angle)}°)`);

      // Determine transition mode based on velocity
      const mode: TransitionMode = Math.abs(physicsRef.current.angularVelocity) > 50 ? 'CUT' : 'BLEND';
      triggerTransition(newFrame, mode);
      setCurrentFrame(newFrame);
    }

    // Render to canvas
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Draw background (clean white for e-commerce)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // Draw frames with interpolation
    const transition = transitionRef.current;

    if (enableInterpolation && transition.progress < 1.0 && transition.sourceFrame && transition.targetFrame) {
      const sourceImg = getFrameImage(transition.sourceFrame);
      const targetImg = getFrameImage(transition.targetFrame);

      if (sourceImg && targetImg) {
        const easeT = transition.progress * transition.progress * (3 - 2 * transition.progress);

        // Draw source (fading out)
        ctx.globalAlpha = 1 - easeT;
        drawFrame(ctx, sourceImg, w, h);

        // Draw target (fading in)
        ctx.globalAlpha = easeT;
        drawFrame(ctx, targetImg, w, h);

        ctx.globalAlpha = 1;
      }
    } else if (currentFrame) {
      const img = getFrameImage(currentFrame);
      if (img && img.complete && img.naturalWidth > 0) {
        drawFrame(ctx, img, w, h);
      }
    }

    // Draw angle indicator if dragging
    if (physicsRef.current.isDragging) {
      ctx.fillStyle = 'rgba(139, 92, 246, 0.9)';
      ctx.font = 'bold 14px Rajdhani, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(angle)}°`, w / 2, h - 20);
    }

  }, [frames, currentFrame, isAutoRotating, updatePhysics, onAngleChange, enableInterpolation, getFrameImage, triggerTransition, selectedMacro]);

  /**
   * Draw a frame centered in the canvas
   */
  const drawFrame = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) => {
    const aspect = img.width / img.height;
    let dw = w * 0.85;
    let dh = dw / aspect;

    if (dh > h * 0.85) {
      dh = h * 0.85;
      dw = dh * aspect;
    }

    const x = (w - dw) / 2;
    const y = (h - dh) / 2;

    ctx.drawImage(img, x, y, dw, dh);
  };

  // Start render loop
  useEffect(() => {
    if (imagesLoaded && frames.length > 0) {
      // Initialize with first frame
      const initialFrame = quantizeAngleToFrame(0, frames, { role: 'orbital' });
      if (initialFrame) setCurrentFrame(initialFrame);

      requestRef.current = requestAnimationFrame(renderLoop);
    }
    return () => cancelAnimationFrame(requestRef.current);
  }, [imagesLoaded, frames, renderLoop]);

  // Canvas resize handler
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resizeObserver = new ResizeObserver(() => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    });

    resizeObserver.observe(container);
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    return () => resizeObserver.disconnect();
  }, []);

  /**
   * POINTER EVENT HANDLERS
   * Translate drag gestures into angular velocity
   */
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    physicsRef.current.isDragging = true;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    lastDragTimeRef.current = performance.now();
    dragDeltaAccumRef.current = 0;
    setIsAutoRotating(false);

    // Capture pointer for drag tracking
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!physicsRef.current.isDragging || !lastPointerRef.current) return;

    const now = performance.now();
    const deltaTime = (now - lastDragTimeRef.current) / 1000;
    lastDragTimeRef.current = now;

    const deltaX = e.clientX - lastPointerRef.current.x;
    const deltaY = e.clientY - lastPointerRef.current.y;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };

    // Convert pixel delta to angular delta
    // Adjust sensitivity based on container width
    const container = containerRef.current;
    const sensitivity = container ? 360 / container.clientWidth : 1;

    // Update angle directly during drag
    physicsRef.current.currentAngle += deltaX * sensitivity * 0.5;
    physicsRef.current.currentPitch -= deltaY * sensitivity * 0.3;

    // Track velocity for release
    if (deltaTime > 0) {
      const instantVelocity = (deltaX * sensitivity * 0.5) / deltaTime;
      // Smooth velocity accumulation
      physicsRef.current.angularVelocity = instantVelocity * 0.8 + physicsRef.current.angularVelocity * 0.2;
      dragDeltaAccumRef.current += Math.abs(deltaX);
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    physicsRef.current.isDragging = false;
    lastPointerRef.current = null;

    // Release pointer capture
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);

    // If it was a tap (minimal movement), could trigger macro mode
    if (dragDeltaAccumRef.current < 5) {
      // This was a tap/click, not a drag
    }
  }, []);

  /**
   * WHEEL HANDLER
   * Scroll to rotate
   */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();

    // Convert scroll delta to angular velocity impulse
    const sensitivity = 0.5;
    physicsRef.current.angularVelocity += e.deltaY * sensitivity;

    setIsAutoRotating(false);
  }, []);

  /**
   * Manual rotation controls
   */
  const rotateBy = useCallback((degrees: number) => {
    physicsRef.current.angularVelocity += degrees;
  }, []);

  /**
   * Handle macro region selection
   */
  const handleMacroClick = useCallback((region: string) => {
    setSelectedMacro(region);
    onMacroSelect?.(region);
    setShowMacroPanel(false);
  }, [onMacroSelect]);

  const exitMacro = useCallback(() => {
    setSelectedMacro(null);
  }, []);

  // Get available macro regions
  const macroRegions = frames
    .filter(f => f.isMacro && f.macroRegion)
    .map(f => f.macroRegion!)
    .filter((v, i, a) => a.indexOf(v) === i);

  if (!imagesLoaded && frames.length > 0) {
    return (
      <div className={`flex items-center justify-center bg-white ${className}`}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
          <p className="text-sm text-gray-500 font-mono">Loading product views...</p>
        </div>
      </div>
    );
  }

  if (frames.length === 0) {
    return (
      <div className={`flex items-center justify-center bg-gray-50 ${className}`}>
        <div className="flex flex-col items-center gap-4 text-gray-400">
          <Package className="w-12 h-12" />
          <p className="text-sm">No product frames available</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full bg-white select-none ${className}`}
    >
      {/* Main Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
      />

      {/* Controls Overlay */}
      {showControls && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full">
          {/* Rotation Controls */}
          <button
            onClick={() => rotateBy(-45)}
            className="p-2 text-white/80 hover:text-white transition-colors"
            title="Rotate Left"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="px-3 py-1 bg-white/10 rounded-full">
            <span className="text-white font-mono text-sm">{displayAngle}°</span>
          </div>

          <button
            onClick={() => rotateBy(45)}
            className="p-2 text-white/80 hover:text-white transition-colors"
            title="Rotate Right"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          <div className="w-px h-6 bg-white/20" />

          {/* Auto-rotate toggle */}
          <button
            onClick={() => setIsAutoRotating(!isAutoRotating)}
            className={`p-2 rounded-full transition-colors ${
              isAutoRotating
                ? 'text-brand-400 bg-brand-500/20'
                : 'text-white/80 hover:text-white'
            }`}
            title="Auto Rotate"
          >
            <RotateCw className={`w-5 h-5 ${isAutoRotating ? 'animate-spin' : ''}`} style={{ animationDuration: '3s' }} />
          </button>

          {/* Macro lens toggle */}
          {macroRegions.length > 0 && (
            <>
              <div className="w-px h-6 bg-white/20" />

              {selectedMacro ? (
                <button
                  onClick={exitMacro}
                  className="px-3 py-1 text-xs font-bold text-white bg-brand-500 rounded-full"
                >
                  EXIT ZOOM
                </button>
              ) : (
                <button
                  onClick={() => setShowMacroPanel(!showMacroPanel)}
                  className={`p-2 rounded-full transition-colors ${
                    showMacroPanel
                      ? 'text-brand-400 bg-brand-500/20'
                      : 'text-white/80 hover:text-white'
                  }`}
                  title="Detail Views"
                >
                  <ZoomIn className="w-5 h-5" />
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Macro Selection Panel */}
      {showMacroPanel && macroRegions.length > 0 && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-md rounded-xl p-4 animate-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2 mb-3">
            <Eye className="w-4 h-4 text-brand-400" />
            <span className="text-xs font-bold text-white tracking-widest">DETAIL VIEWS</span>
          </div>
          <div className="flex gap-2">
            {macroRegions.map((region) => (
              <button
                key={region}
                onClick={() => handleMacroClick(region)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg transition-colors capitalize"
              >
                {region.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Frame indicator (mirrored badge) */}
      {currentFrame?.isMirrored && (
        <div className="absolute top-4 right-4 px-2 py-1 bg-yellow-500/20 border border-yellow-500/50 rounded text-xs text-yellow-400 font-mono">
          MIRRORED
        </div>
      )}

      {/* Instructions overlay (shows briefly on mount) */}
      <div className="absolute top-4 left-4 text-xs text-gray-400 pointer-events-none">
        <p>Drag to rotate • Scroll to spin</p>
      </div>
    </div>
  );
};

export default OrbitalViewer;
