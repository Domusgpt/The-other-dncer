/**
 * ORBITAL DEMO PAGE
 *
 * A complete demonstration of the Orbital Commerce Engine.
 * Upload a product image → Generate 360° views → Interactive viewer
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  Upload,
  Package,
  Loader2,
  RotateCw,
  Zap,
  ArrowLeft,
  Settings,
  CheckCircle,
  AlertCircle,
  Image as ImageIcon,
  Sparkles
} from 'lucide-react';
import { OrbitalFrame, OrbitalConfig, DEFAULT_ORBITAL_CONFIG } from '../types';
import { generateOrbitalFrames, fileToGenericBase64 } from '../services/gemini';
import { OrbitalViewer } from './OrbitalViewer';

interface OrbitalDemoProps {
  onBack?: () => void;
}

type DemoStep = 'upload' | 'configure' | 'generating' | 'viewer';

export const OrbitalDemo: React.FC<OrbitalDemoProps> = ({ onBack }) => {
  const [step, setStep] = useState<DemoStep>('upload');
  const [frames, setFrames] = useState<OrbitalFrame[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState<string>('');

  // Front and Back image state
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);

  // Configuration state
  const [config, setConfig] = useState<OrbitalConfig>({
    ...DEFAULT_ORBITAL_CONFIG,
    productName: 'Product',
    enableHemisphereCompletion: true,
    enableMacroLens: true,
  });

  const frontInputRef = useRef<HTMLInputElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);

  const handleFrontSelect = useCallback(async (file: File) => {
    try {
      setError(null);
      const base64 = await fileToGenericBase64(file);
      setFrontImage(base64);
      // Auto-advance to configure if we have at least front image
      if (base64) setStep('configure');
    } catch (e: any) {
      setError(`Failed to load front image: ${e.message}`);
    }
  }, []);

  const handleBackSelect = useCallback(async (file: File) => {
    try {
      setError(null);
      const base64 = await fileToGenericBase64(file);
      setBackImage(base64);
    } catch (e: any) {
      setError(`Failed to load back image: ${e.message}`);
    }
  }, []);

  const handleFrontDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleFrontSelect(file);
    }
  }, [handleFrontSelect]);

  const handleBackDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleBackSelect(file);
    }
  }, [handleBackSelect]);

  const handleGenerate = useCallback(async () => {
    if (!frontImage) return;

    setStep('generating');
    setError(null);
    setGenerationProgress('Initializing Orbital Engine...');

    // Build config with images
    const fullConfig: OrbitalConfig = {
      ...config,
      frontImageBase64: frontImage,
      backImageBase64: backImage || undefined,
    };

    try {
      const result = await generateOrbitalFrames(
        frontImage,
        fullConfig,
        (partialFrames) => {
          setFrames(partialFrames);
          const rotationFrames = partialFrames.filter(f => f.role === 'orbital').length;
          const mirroredFrames = partialFrames.filter(f => f.isMirrored).length;
          const macroFrames = partialFrames.filter(f => f.isMacro).length;
          setGenerationProgress(
            `Generated ${rotationFrames} rotation frames, ${mirroredFrames} mirrored, ${macroFrames} macro details`
          );
        }
      );

      setFrames(result.frames);
      setStep('viewer');
    } catch (e: any) {
      console.error('Generation failed:', e);
      setError(e.message || 'Generation failed');
      setStep('configure');
    }
  }, [frontImage, backImage, config]);

  const resetDemo = useCallback(() => {
    setStep('upload');
    setFrontImage(null);
    setBackImage(null);
    setFrames([]);
    setError(null);
    setGenerationProgress('');
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {onBack && (
              <button
                onClick={onBack}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
            )}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center">
                <RotateCw size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">ORBITAL</h1>
                <p className="text-xs text-gray-400">360° Commerce Engine</p>
              </div>
            </div>
          </div>

          {step !== 'upload' && (
            <button
              onClick={resetDemo}
              className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
            >
              Start Over
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-12">

        {/* STEP 1: Upload */}
        {step === 'upload' && (
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold mb-4">
                Upload Your Product
              </h2>
              <p className="text-gray-400 text-lg">
                Upload FRONT and BACK views for best results
              </p>
            </div>

            {/* Two-image upload grid */}
            <div className="grid grid-cols-2 gap-6 mb-8">
              {/* FRONT Image Upload */}
              <div
                onDrop={handleFrontDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => frontInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all group
                  ${frontImage
                    ? 'border-green-500/50 bg-green-500/5'
                    : 'border-white/20 hover:border-cyan-500/50 hover:bg-white/5'}`}
              >
                {frontImage ? (
                  <div>
                    <img src={frontImage} alt="Front view" className="w-full aspect-square object-contain rounded-xl bg-white mb-4" />
                    <p className="text-green-400 font-medium flex items-center justify-center gap-2">
                      <CheckCircle size={16} /> Front View (0°)
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-cyan-500/20 to-blue-600/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                      <ImageIcon size={28} className="text-cyan-400" />
                    </div>
                    <p className="text-lg font-medium mb-1">FRONT View (0°)</p>
                    <p className="text-sm text-gray-500">Required • Primary reference</p>
                  </>
                )}
              </div>

              {/* BACK Image Upload */}
              <div
                onDrop={handleBackDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => backInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all group
                  ${backImage
                    ? 'border-green-500/50 bg-green-500/5'
                    : 'border-white/20 hover:border-purple-500/50 hover:bg-white/5'}`}
              >
                {backImage ? (
                  <div>
                    <img src={backImage} alt="Back view" className="w-full aspect-square object-contain rounded-xl bg-white mb-4" />
                    <p className="text-green-400 font-medium flex items-center justify-center gap-2">
                      <CheckCircle size={16} /> Back View (180°)
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-purple-500/20 to-pink-600/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                      <ImageIcon size={28} className="text-purple-400" />
                    </div>
                    <p className="text-lg font-medium mb-1">BACK View (180°)</p>
                    <p className="text-sm text-gray-500">Optional • Improves accuracy</p>
                  </>
                )}
              </div>
            </div>

            <input
              ref={frontInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && handleFrontSelect(e.target.files[0])}
              className="hidden"
            />
            <input
              ref={backInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && handleBackSelect(e.target.files[0])}
              className="hidden"
            />

            {/* Proceed button */}
            {frontImage && (
              <button
                onClick={() => setStep('configure')}
                className="w-full py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold rounded-xl flex items-center justify-center gap-3 transition-all hover:scale-[1.02] shadow-lg shadow-cyan-500/25 mb-8"
              >
                Continue to Configure
                {!backImage && <span className="text-cyan-200 text-sm">(Back image optional)</span>}
              </button>
            )}

            {error && (
              <div className="mt-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-3">
                <AlertCircle className="text-red-400 flex-shrink-0" />
                <p className="text-red-300">{error}</p>
              </div>
            )}

            {/* Visual explanation */}
            <div className="mt-8 p-6 bg-white/5 rounded-2xl">
              <h3 className="font-bold text-lg mb-4 text-center">How It Works</h3>
              <div className="flex items-center justify-center gap-4 text-center">
                <div className="flex-1">
                  <div className="text-4xl mb-2">📷</div>
                  <p className="text-sm text-gray-400">FRONT (0°)</p>
                </div>
                <div className="text-2xl text-gray-600">→</div>
                <div className="flex-1">
                  <div className="text-4xl mb-2">🔄</div>
                  <p className="text-sm text-gray-400">AI generates 16 angles</p>
                </div>
                <div className="text-2xl text-gray-600">←</div>
                <div className="flex-1">
                  <div className="text-4xl mb-2">📷</div>
                  <p className="text-sm text-gray-400">BACK (180°)</p>
                </div>
              </div>
            </div>

            {/* Features */}
            <div className="mt-8 grid grid-cols-3 gap-6">
              {[
                { icon: RotateCw, title: '360° Rotation', desc: 'Full turntable views' },
                { icon: Sparkles, title: 'AI Generated', desc: 'Gemini 2.5 Flash' },
                { icon: Zap, title: 'Instant Deploy', desc: 'No 3D skills needed' },
              ].map((feature, i) => (
                <div key={i} className="text-center p-6 bg-white/5 rounded-xl">
                  <feature.icon className="w-8 h-8 mx-auto mb-3 text-cyan-400" />
                  <h3 className="font-semibold mb-1">{feature.title}</h3>
                  <p className="text-sm text-gray-500">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 2: Configure */}
        {step === 'configure' && (
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold mb-4">Configure Generation</h2>
              <p className="text-gray-400">Customize your 360° product view</p>
            </div>

            <div className="grid grid-cols-2 gap-8">
              {/* Preview - Front and Back */}
              <div className="space-y-4">
                <div className="bg-white/5 rounded-2xl p-4">
                  <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-3">
                    Front View (0°)
                  </h3>
                  {frontImage && (
                    <img
                      src={frontImage}
                      alt="Front view"
                      className="w-full aspect-square object-contain rounded-xl bg-white"
                    />
                  )}
                </div>
                {backImage ? (
                  <div className="bg-white/5 rounded-2xl p-4">
                    <h3 className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-3">
                      Back View (180°)
                    </h3>
                    <img
                      src={backImage}
                      alt="Back view"
                      className="w-full aspect-square object-contain rounded-xl bg-white"
                    />
                  </div>
                ) : (
                  <div
                    onClick={() => backInputRef.current?.click()}
                    className="bg-white/5 rounded-2xl p-4 border-2 border-dashed border-white/10 hover:border-purple-500/50 cursor-pointer transition-colors"
                  >
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
                      Back View (Optional)
                    </h3>
                    <div className="aspect-square flex items-center justify-center">
                      <p className="text-gray-500 text-sm">+ Add back image for better accuracy</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Settings */}
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Product Name
                  </label>
                  <input
                    type="text"
                    value={config.productName}
                    onChange={(e) => setConfig(prev => ({ ...prev, productName: e.target.value }))}
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl focus:border-cyan-500 focus:outline-none transition-colors"
                    placeholder="e.g., Nike Air Max 90"
                  />
                </div>

                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
                    Generation Options
                  </h3>

                  {/* Pro Model Toggle - Separate for visibility */}
                  <label className="flex items-start gap-4 p-4 bg-gradient-to-r from-purple-500/10 to-cyan-500/10 border border-purple-500/30 rounded-xl cursor-pointer hover:border-purple-500/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={config.useProModel}
                      onChange={(e) => setConfig(prev => ({ ...prev, useProModel: e.target.checked }))}
                      className="mt-1 w-5 h-5 rounded border-purple-500/50 bg-white/10 text-purple-500 focus:ring-purple-500"
                    />
                    <div>
                      <p className="font-medium text-purple-300">Use Pro Model (Gemini 3 Pro)</p>
                      <p className="text-sm text-gray-500">Better spatial accuracy & angle consistency. Higher cost - use to test quality.</p>
                    </div>
                  </label>

                  {[
                    { key: 'enableHemisphereCompletion', label: 'Hemisphere Completion', desc: 'Mirror frames for full 360° (saves 50% API cost)' },
                    { key: 'enableMacroLens', label: 'Macro Detail Views', desc: 'Generate zoom views of product details' },
                    { key: 'enablePitchViews', label: 'Pitch/Elevation Views', desc: 'Top-down and low angle shots' },
                    { key: 'enableFunctionalStates', label: 'Functional States', desc: 'Open/closed/exploded views' },
                  ].map((option) => (
                    <label
                      key={option.key}
                      className="flex items-start gap-4 p-4 bg-white/5 rounded-xl cursor-pointer hover:bg-white/10 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={config[option.key as keyof OrbitalConfig] as boolean}
                        onChange={(e) => setConfig(prev => ({ ...prev, [option.key]: e.target.checked }))}
                        className="mt-1 w-5 h-5 rounded border-white/30 bg-white/10 text-cyan-500 focus:ring-cyan-500"
                      />
                      <div>
                        <p className="font-medium">{option.label}</p>
                        <p className="text-sm text-gray-500">{option.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>

                {error && (
                  <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-3">
                    <AlertCircle className="text-red-400 flex-shrink-0" />
                    <p className="text-red-300 text-sm">{error}</p>
                  </div>
                )}

                <button
                  onClick={handleGenerate}
                  className="w-full py-4 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold rounded-xl flex items-center justify-center gap-3 transition-all hover:scale-[1.02] shadow-lg shadow-cyan-500/25"
                >
                  <Zap size={20} />
                  Generate 360° View
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Generating */}
        {step === 'generating' && (
          <div className="max-w-2xl mx-auto text-center py-20">
            <div className="w-24 h-24 mx-auto mb-8 relative">
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full animate-ping opacity-25" />
              <div className="relative w-full h-full bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full flex items-center justify-center">
                <Loader2 size={40} className="text-white animate-spin" />
              </div>
            </div>

            <h2 className="text-3xl font-bold mb-4">Generating 360° View</h2>
            <p className="text-gray-400 mb-8">{generationProgress}</p>

            {frames.length > 0 && (
              <div className="bg-white/5 rounded-2xl p-6">
                <div className="flex items-center justify-center gap-2 mb-4">
                  <CheckCircle className="text-green-400" size={20} />
                  <span className="font-medium">{frames.length} frames generated</span>
                </div>

                <div className="grid grid-cols-8 gap-2">
                  {frames.slice(0, 16).map((frame, i) => (
                    <img
                      key={i}
                      src={frame.url}
                      alt={`Frame ${i}`}
                      className="w-full aspect-square object-cover rounded-lg bg-white/10"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 4: Viewer */}
        {step === 'viewer' && frames.length > 0 && (
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold mb-2">Your 360° Product View</h2>
              <p className="text-gray-400">
                Drag to rotate • Scroll to spin • {frames.length} frames generated
              </p>
            </div>

            <div className="bg-white rounded-2xl overflow-hidden shadow-2xl" style={{ height: '600px' }}>
              <OrbitalViewer
                frames={frames}
                config={config}
                showControls={true}
                enableInterpolation={true}
              />
            </div>

            {/* Frame Stats */}
            <div className="mt-8 grid grid-cols-4 gap-4">
              {[
                { label: 'Rotation Frames', value: frames.filter(f => f.role === 'orbital' && !f.isMirrored).length },
                { label: 'Mirrored Frames', value: frames.filter(f => f.isMirrored).length },
                { label: 'Macro Details', value: frames.filter(f => f.isMacro).length },
                { label: 'Total Frames', value: frames.length },
              ].map((stat, i) => (
                <div key={i} className="bg-white/5 rounded-xl p-4 text-center">
                  <p className="text-2xl font-bold text-cyan-400">{stat.value}</p>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default OrbitalDemo;
