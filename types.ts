
import { HolographicParams } from "./components/Visualizer/HolographicVisualizer";

export enum AppStep {
  ASSETS = 1,
  DIRECTOR = 2,
  PREVIEW = 3,
}

export type StyleCategory = 'Cinematic' | 'Anime/2D' | 'Digital/Glitch' | 'Artistic';
export type SubjectCategory = 'CHARACTER' | 'TEXT' | 'SYMBOL';
export type FrameType = 'body' | 'closeup'; // Distinguish full body from facial frames
export type SheetRole = 'base' | 'alt' | 'flourish' | 'smooth' | 'orbital' | 'orbital_pitch' | 'orbital_states' | 'orbital_macro'; // Extended for Orbital commerce engine
export type MoveDirection = 'center' | 'left' | 'right'; // For choreography

// === ORBITAL COMMERCE ENGINE TYPES ===
// Kinetic Sprite Architecture for 360° product visualization

export type OrbitalViewAngle =
  | 'front' | 'front_right_30' | 'front_right_60' | 'right'
  | 'back_right' | 'back' | 'back_left' | 'left'
  | 'front_left_60' | 'front_left_30'; // Y-axis rotation angles

export type OrbitalPitchAngle =
  | 'level' | 'pitch_15' | 'pitch_30' | 'pitch_45' | 'pitch_90'
  | 'pitch_down_15' | 'pitch_down_30'; // X-axis tilt angles

export type OrbitalProductState =
  | 'closed' | 'open' | 'active' | 'inactive'
  | 'exploded' | 'packaged' | 'lifestyle'; // Functional states

export interface OrbitalFrame {
  url: string;
  angle: number;           // Continuous rotation angle (0-360)
  pitch: number;           // Elevation angle (-90 to 90)
  state: OrbitalProductState;
  isMirrored: boolean;     // If generated via hemisphere completion
  isMacro: boolean;        // If this is a detail/zoom frame
  macroRegion?: string;    // e.g., 'dial', 'texture', 'logo'
  role: SheetRole;
}

export interface OrbitalConfig {
  productName: string;
  enableHemisphereCompletion: boolean;  // Mirror 0-90° to get 270-360°
  enablePitchViews: boolean;            // Generate elevation angles
  enableFunctionalStates: boolean;      // Open/closed/exploded views
  enableMacroLens: boolean;             // Detail zoom regions
  macroRegions?: string[];              // Specific areas to macro zoom
  frictionCoefficient: number;          // Inertial rotation decay (0.9-0.99)
  springStiffness: number;              // Snap-to-angle stiffness
  snapToAngles?: number[];              // Optional snap points (e.g., [0, 90, 180, 270])
}

export const DEFAULT_ORBITAL_CONFIG: OrbitalConfig = {
  productName: 'Product',
  enableHemisphereCompletion: true,
  enablePitchViews: false,
  enableFunctionalStates: false,
  enableMacroLens: false,
  frictionCoefficient: 0.95,
  springStiffness: 0.1,
  snapToAngles: undefined,
};

// Orbital Physics State (for scroll-based interaction)
export interface OrbitalPhysicsState {
  currentAngle: number;       // Current Y rotation (0-360)
  currentPitch: number;       // Current X tilt (-90 to 90)
  angularVelocity: number;    // Rotation speed (degrees/second)
  pitchVelocity: number;      // Tilt speed
  isDragging: boolean;        // User is actively dragging
  lastInputTime: number;      // For velocity calculation
}

export interface StylePreset {
  id: string;
  name: string;
  category: StyleCategory;
  description: string;
  promptModifier: string;
  thumbnail: string;
  hologramParams: HolographicParams; // Links style to background shader
}

export type EnergyLevel = 'low' | 'mid' | 'high';
export type UserTier = 'free' | 'pro';

// Flexible pose type string
export type PoseType = string;

export interface GeneratedFrame {
  url: string;
  pose: PoseType;
  energy: EnergyLevel;
  type?: FrameType; 
  role?: SheetRole; 
  direction?: MoveDirection; // NEW
  promptUsed?: string; 
}

export interface SavedProject {
    id: string;
    name: string;
    createdAt: number;
    frames: GeneratedFrame[];
    styleId: string;
    subjectCategory: SubjectCategory;
}

export interface AuthUser {
  uid: string; // Firebase UID
  name: string;
  email: string;
  photoURL: string;
}

export interface AppState {
  step: AppStep;
  user: AuthUser | null; // Auth state
  showAuthModal: boolean;
  showPaymentModal: boolean;
  
  userTier: UserTier;
  imageFile: File | null;
  imagePreviewUrl: string | null;
  audioFile: File | null;
  audioPreviewUrl: string | null;
  selectedStyleId: string;
  
  // Advanced / Morphing State
  secondaryStyleId: string; // Target style to morph into
  morphIntensity: number;   // 0-100: Blend factor between Primary and Secondary
  reactivity: number;       // 0-100: Audio sensitivity
  
  motionPrompt: string; 
  motionPreset: string; // Added for dropdown
  useTurbo: boolean; // Toggle for speed vs quality
  superMode: boolean; // NEW: Paid 15-frame mode
  
  intensity: number; // 0-100 (Generation energy)
  duration: number; // seconds
  smoothness: number; // 0-100 (Hard cut vs Crossfade)
  stutter: number; // 0-100 (Probability of double-time moves)
  generatedFrames: GeneratedFrame[]; 
  subjectCategory: SubjectCategory; // NEW: Detected subject type
  isGenerating: boolean;
  credits: number;
}

export const DEFAULT_STATE: AppState = {
  step: AppStep.ASSETS,
  user: null,
  showAuthModal: false,
  showPaymentModal: false,
  
  userTier: 'free',
  imageFile: null,
  imagePreviewUrl: null,
  audioFile: null,
  audioPreviewUrl: null,
  selectedStyleId: 'natural', 
  
  secondaryStyleId: '',
  morphIntensity: 0,
  reactivity: 80,

  motionPrompt: '', // Default empty for auto-analysis
  motionPreset: 'auto', 
  useTurbo: true, // Default to fast
  superMode: false, // Default off
  
  intensity: 80, // High default
  duration: 30,
  smoothness: 20, // Default slight smoothing
  stutter: 50, // Moderate stutter chance
  generatedFrames: [],
  subjectCategory: 'CHARACTER',
  isGenerating: false,
  credits: 0, // Start with 0, require login to get free credit
};
