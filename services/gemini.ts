
import { GoogleGenAI } from "@google/genai";
import { GeneratedFrame, PoseType, EnergyLevel, SubjectCategory, FrameType, SheetRole, MoveDirection, OrbitalFrame, OrbitalConfig, OrbitalProductState, DEFAULT_ORBITAL_CONFIG } from "../types";

// Use Vite environment variable (VITE_ prefix required for client-side access)
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

// Validate API key is present
const validateApiKey = () => {
  if (!API_KEY || API_KEY.trim() === '') {
    throw new Error('GEMINI_API_KEY is not configured. Please set VITE_GEMINI_API_KEY in your environment or GitHub Secrets.');
  }
};

// --- UTILITIES ---

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to wrap image loading in a timeout to prevent hanging
const loadImageWithTimeout = (src: string, timeoutMs: number = 5000): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        const timer = setTimeout(() => {
            img.onload = null;
            img.onerror = null;
            reject(new Error("Image load timed out"));
        }, timeoutMs);

        img.onload = () => {
            clearTimeout(timer);
            resolve(img);
        };
        img.onerror = (e) => {
            clearTimeout(timer);
            reject(new Error("Image load failed"));
        };
        img.src = src;
    });
};

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error("FileReader result was not a string"));
            }
        };
        reader.onerror = (error) => reject(new Error("File reading failed: " + (error.target?.error?.message || "Unknown error")));
    });
};

const resizeImage = (file: File, maxDim: number = 384): Promise<string> => {
    return new Promise((resolve, reject) => {
        if (!file || !(file instanceof File)) return reject(new Error("Invalid file passed to resizeImage"));

        let url = '';
        try { url = URL.createObjectURL(file); } catch (e) { 
            // Fallback immediately if createObjectURL fails
            return fileToBase64(file).then(resolve).catch(reject); 
        }

        const img = new Image();
        img.crossOrigin = "anonymous";
        
        // Safety timeout
        const timeout = setTimeout(() => {
            console.warn("Resize timed out, falling back to base64");
            URL.revokeObjectURL(url);
            fileToBase64(file).then(resolve).catch(reject);
        }, 3000);

        img.onload = () => {
            clearTimeout(timeout);
            try {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxDim) { height *= maxDim / width; width = maxDim; }
                } else {
                    if (height > maxDim) { width *= maxDim / height; height = maxDim; }
                }

                canvas.width = Math.floor(width);
                canvas.height = Math.floor(height);
                const ctx = canvas.getContext('2d');
                if (!ctx) { 
                    URL.revokeObjectURL(url); 
                    return fileToBase64(file).then(resolve).catch(reject); 
                }
                
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.6); 
                URL.revokeObjectURL(url);
                resolve(dataUrl);
            } catch (e) {
                URL.revokeObjectURL(url);
                console.warn("Canvas resize failed, falling back to original", e);
                fileToBase64(file).then(resolve).catch(reject);
            }
        };
        img.onerror = (e) => {
            clearTimeout(timeout);
            URL.revokeObjectURL(url);
            console.warn("Image load for resize failed, falling back to original");
            fileToBase64(file).then(resolve).catch(reject);
        };
        img.src = url;
    });
};

export const fileToGenericBase64 = async (file: File): Promise<string> => {
  try { 
      return await resizeImage(file); 
  } catch (e: any) { 
      try { return await fileToBase64(file); } 
      catch (e2: any) { throw new Error("Failed to process file"); }
  }
};

// --- SPRITE SHEET SLICER (MECHANICAL GRID FIX) ---
const sliceSpriteSheet = (base64Image: string, rows: number, cols: number): Promise<string[]> => {
    return new Promise(async (resolve, reject) => {
        try {
            // Use timeout wrapper to prevent hanging
            const img = await loadImageWithTimeout(base64Image, 8000);
            
            // 1. MECHANICAL ALIGNMENT
            const SHEET_SIZE = 1024;
            const normCanvas = document.createElement('canvas');
            normCanvas.width = SHEET_SIZE;
            normCanvas.height = SHEET_SIZE;
            const normCtx = normCanvas.getContext('2d');
            
            if (!normCtx) { reject("Canvas context failed"); return; }
            
            // STRETCH TO FIT (Mechanical Solution)
            normCtx.drawImage(img, 0, 0, img.width, img.height, 0, 0, SHEET_SIZE, SHEET_SIZE);

            // 2. SLICING STEP
            const cellW = SHEET_SIZE / cols; // 256
            const cellH = SHEET_SIZE / rows; // 256
            
            // CONSERVATIVE CROP
            const cropFactor = 0.10; 
            const cropX = cellW * cropFactor;
            const cropY = cellH * cropFactor;
            const sourceW = cellW * (1 - 2 * cropFactor);
            const sourceH = cellH * (1 - 2 * cropFactor);

            const frames: string[] = [];
            
            // We do this synchronously to avoid Promise overhead for 16 frames which can be buggy
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const cellCanvas = document.createElement('canvas');
                    cellCanvas.width = Math.floor(sourceW);
                    cellCanvas.height = Math.floor(sourceH);
                    const cellCtx = cellCanvas.getContext('2d');
                    
                    if(cellCtx) {
                        const cellSrcX = (c * cellW) + cropX;
                        const cellSrcY = (r * cellH) + cropY;

                        cellCtx.drawImage(
                            normCanvas, 
                            cellSrcX, cellSrcY, sourceW, sourceH, 
                            0, 0, cellCanvas.width, cellCanvas.height
                        );
                        
                        // Use dataURL instead of toBlob for better compatibility and speed in this context
                        // (Blobs are better for memory, but DataURLs are sync and safer for small batches)
                        frames.push(cellCanvas.toDataURL('image/jpeg', 0.85));
                    }
                }
            }
            resolve(frames);

        } catch (e) {
            console.error("Slice Sprite Sheet failed", e);
            reject(e);
        }
    });
};

const mirrorFrame = (frameUrl: string): Promise<string> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            } else {
                resolve(frameUrl);
            }
        };
        img.onerror = () => resolve(frameUrl); // Fail gracefull
        img.src = frameUrl;
    });
};

const generateWithRetry = async (ai: GoogleGenAI, params: any, retries = 3) => {
    let lastError: any;
    for (let i = 0; i < retries; i++) {
        try {
            return await ai.models.generateContent(params);
        } catch (e: any) {
            console.warn(`Gemini generation attempt ${i + 1} failed:`, e);
            lastError = e;
            await delay(1000 * Math.pow(2, i)); 
        }
    }
    throw lastError;
};

const generateSingleSheet = async (
    ai: GoogleGenAI,
    role: SheetRole,
    imageBase64: string,
    stylePrompt: string,
    motionPrompt: string,
    category: SubjectCategory,
    seed: number, 
    contextImageBase64?: string
): Promise<{ frames: GeneratedFrame[], rawSheetBase64?: string }> => {
    
    const rows = 4;
    const cols = 4;
    const isTextOrSymbol = category === 'TEXT' || category === 'SYMBOL';
    
    // Inject Motion Prompt explicitly so "Charleston" is respected
    const danceStyle = motionPrompt ? `Specific Dance Style: ${motionPrompt}.` : "Style: Rhythmic, energetic dance loop.";

    // MECHANICAL PROMPT: STRICT GRID & CENTERING WITH VISUAL SPECS
    let systemPrompt = `TASK: Generate a strict 4x4 Grid Sprite Sheet (16 frames).

═══════════════════════════════════════════════════════════════════
OUTPUT SPECIFICATION
═══════════════════════════════════════════════════════════════════
• OUTPUT: 1024×1024px image containing 4×4 grid (16 cells, 256×256px each)
• QUALITY: Clean, consistent animation frames

GRID LAYOUT (Reading Order: Left→Right, Top→Bottom):
┌─────────┬─────────┬─────────┬─────────┐
│ Frame 0 │ Frame 1 │ Frame 2 │ Frame 3 │  ← Row 1
├─────────┼─────────┼─────────┼─────────┤
│ Frame 4 │ Frame 5 │ Frame 6 │ Frame 7 │  ← Row 2
├─────────┼─────────┼─────────┼─────────┤
│ Frame 8 │ Frame 9 │Frame 10 │Frame 11 │  ← Row 3
├─────────┼─────────┼─────────┼─────────┤
│Frame 12 │Frame 13 │Frame 14 │Frame 15 │  ← Row 4
└─────────┴─────────┴─────────┴─────────┘

MECHANICAL RULES (CRITICAL):
1. GRID: Exactly 4 columns × 4 rows = 16 frames total
2. CELL SIZE: Each frame occupies exactly 256×256px
3. CENTERING: Character centered in MIDDLE of each cell
4. SCALE: Character fills 80% of cell height, consistent across all frames
5. PADDING: Small gap between character and cell edge (no clipping)
6. IDENTITY: Maintain EXACT character consistency from Input Image
7. BACKGROUND: Consistent background across all frames

Visual Style: ${stylePrompt}
${danceStyle}
`;

    if (isTextOrSymbol) {
         systemPrompt += `
         SUBJECT: TEXT/LOGO.
         Action: Dynamic Motion/Pulsing.
         Keep content centered in each cell.
         `;
    } else {
        if (role === 'base') {
            systemPrompt += `
            SHEET 1 (BASE LOOP):
            Row 1: Idle / Groove (Center) - Establishing the character.
            Row 2: ${motionPrompt ? 'Signature Move Part A' : 'Step Left'} - ${danceStyle}
            Row 3: ${motionPrompt ? 'Signature Move Part B' : 'Step Right'} - ${danceStyle}
            Row 4: Power Pose / Freeze Frame
            Ensure feet are visible. Center of mass in middle of cell.
            `;
        } else if (role === 'alt') {
            // ALT IS NOW "BASE EXTENSION" - MORE MOVES
            systemPrompt += `
            SHEET 2 (VARIATIONS):
            Generate 16 NEW frames extending the dance.
            Row 1: Dynamic Jump or Hop
            Row 2: Low movement / Crouch / Floor work
            Row 3: Spin / Rotation frames
            Row 4: Expressive Extension / Kick
            Keep action contained within cell boundaries.
            MUST MATCH CHARACTER FROM SHEET 1 EXACTLY.
            `;
        } else if (role === 'flourish') {
            systemPrompt += `
            SHEET 3 (DETAILS & FX):
            Row 1: Hand Movements / Gestures
            Row 2: Fast Motion Blur / Smears
            Row 3: Face Closeup (Neutral)
            Row 4: Face Closeup (Expressive/Singing)
            `;
        } else if (role === 'smooth') {
             systemPrompt += `
             SHEET 4 (INTERPOLATION):
             Generate in-between poses that connect the previous movements.
             Focus on smooth transitions and weight shifting.
             `;
        }
    }

    console.log(`[Gemini] Generating Sheet: ${role} (${category})...`);

    const cleanBase64 = imageBase64.includes('base64,') ? imageBase64.split('base64,')[1] : imageBase64;
    const cleanContext = contextImageBase64 && contextImageBase64.includes('base64,') ? contextImageBase64.split('base64,')[1] : contextImageBase64;

    const parts: any[] = [
        { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } }
    ];

    if (cleanContext) {
        parts.push({ inlineData: { mimeType: 'image/jpeg', data: cleanContext } });
        systemPrompt += "\nREFERENCE: Use the second image (previous sprite sheet) as the MASTER REFERENCE for spatial alignment and character consistency.";
    }

    parts.push({ text: systemPrompt });

    try {
        const response = await generateWithRetry(ai, {
            model: 'gemini-2.5-flash-image',
            contents: { parts },
            config: {
                imageConfig: { aspectRatio: "1:1" },
                seed: seed
            }
        });

        const candidate = response.candidates?.[0];
        if (!candidate) throw new Error("API returned no candidates.");
        
        let spriteSheetBase64: string | undefined = undefined;
        if (candidate.content && candidate.content.parts) {
            for (const part of candidate.content.parts) {
                if (part.inlineData && part.inlineData.data) {
                    spriteSheetBase64 = part.inlineData.data;
                    break;
                }
            }
        }

        if (!spriteSheetBase64) {
             console.warn(`[Gemini] Sheet ${role} yielded no image data.`);
             return { frames: [] };
        }

        const rawFrames = await sliceSpriteSheet(`data:image/jpeg;base64,${spriteSheetBase64}`, rows, cols);
        const finalFrames: GeneratedFrame[] = [];

        for (let i = 0; i < rawFrames.length; i++) {
            let energy: EnergyLevel = 'mid';
            let type: FrameType = 'body';
            let direction: MoveDirection = 'center';
            let poseName = `${role}_${i}`;

            if (role === 'base') {
                if (i < 4) { energy = 'low'; direction = 'center'; }
                else if (i >= 4 && i < 8) { energy = 'mid'; direction = 'left'; }
                else if (i >= 8 && i < 12) { energy = 'mid'; direction = 'right'; }
                else if (i >= 12) { energy = 'high'; direction = 'center'; }
            } 
            else if (role === 'alt') {
                energy = 'high';
                if (i < 4) direction = 'center'; 
                else if (i >= 4 && i < 8) direction = 'center'; 
            }
            else if (role === 'flourish') {
                energy = 'high';
                if (i >= 8) type = 'closeup';
            }

            finalFrames.push({
                url: rawFrames[i],
                pose: poseName,
                energy,
                type,
                role,
                direction
            });
            
            // Mirror logic 
            const shouldMirror = !isTextOrSymbol && type === 'body' && role !== 'flourish';
            
            if (shouldMirror) {
                 const mirrored = await mirrorFrame(rawFrames[i]);
                 let mirrorDir: MoveDirection = direction;
                 if (direction === 'left') mirrorDir = 'right';
                 else if (direction === 'right') mirrorDir = 'left';
                 
                 finalFrames.push({
                    url: mirrored,
                    pose: poseName + '_mirror',
                    energy,
                    type,
                    role,
                    direction: mirrorDir
                 });
            }
        }
        
        return { frames: finalFrames, rawSheetBase64: spriteSheetBase64 };

    } catch (e: any) {
        console.error(`Failed to generate sheet ${role}:`, e);
        // Propagate error with details instead of swallowing it
        const errorMsg = e?.message || e?.toString() || 'Unknown error';
        throw new Error(`Dance sheet ${role} failed: ${errorMsg}`);
    }
};

export const generateDanceFrames = async (
  imageBase64: string,
  stylePrompt: string,
  motionPrompt: string,
  useTurbo: boolean,
  superMode: boolean,
  onFrameUpdate: (frames: GeneratedFrame[]) => void
): Promise<{ frames: GeneratedFrame[], category: SubjectCategory }> => {

  // Validate API key before attempting generation
  validateApiKey();

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const masterSeed = Math.floor(Math.random() * 2147483647);
  console.log("Master Seed for Consistency:", masterSeed);

  let category: SubjectCategory = 'CHARACTER';
  if (/logo|text|word|letter|font|typography/i.test(motionPrompt)) category = 'TEXT';
  
  let allFrames: GeneratedFrame[] = [];
  let baseSheetBase64: string | undefined = undefined;

  // 1. GENERATE BASE (The Foundation)
  const baseResult = await generateSingleSheet(ai, 'base', imageBase64, stylePrompt, motionPrompt, category, masterSeed);
  
  if (baseResult.frames.length > 0) {
      allFrames = [...allFrames, ...baseResult.frames];
      onFrameUpdate(allFrames); // FAST UI UPDATE
      baseSheetBase64 = baseResult.rawSheetBase64; 
  } else {
      throw new Error("Base generation failed. Aborting.");
  }

  // 2. GENERATE EXTENSIONS (Using Base as Reference)
  // We pass baseSheetBase64 as 'contextImage' to ensure style/pose consistency
  const altPromise = (async () => {
     if (!useTurbo || superMode) {
         await delay(100); 
         try {
             // Alt is now Base-Extension
             const result = await generateSingleSheet(ai, 'alt', imageBase64, stylePrompt, motionPrompt, category, masterSeed, baseSheetBase64);
             if(result.frames.length > 0) {
                 allFrames = [...allFrames, ...result.frames];
                 onFrameUpdate(allFrames);
             }
         } catch(e) { console.warn("Alt sheet failed", e); }
     }
  })();

  const flourishPromise = (async () => {
      if (superMode) {
          await delay(200); 
          try {
              const result = await generateSingleSheet(ai, 'flourish', imageBase64, stylePrompt, motionPrompt, category, masterSeed, baseSheetBase64);
              if(result.frames.length > 0) {
                  allFrames = [...allFrames, ...result.frames];
                  onFrameUpdate(allFrames);
              }
          } catch(e) { console.warn("Flourish sheet failed", e); }
      }
  })();

  const smoothPromise = (async () => {
      if (superMode) {
          await delay(300); 
          try {
              // Smooth frames also use base reference
              const result = await generateSingleSheet(ai, 'smooth', imageBase64, stylePrompt, motionPrompt, category, masterSeed, baseSheetBase64);
              if(result.frames.length > 0) {
                  allFrames = [...allFrames, ...result.frames];
                  onFrameUpdate(allFrames);
              }
          } catch(e) { console.warn("Smooth sheet failed", e); }
      }
  })();

  await Promise.allSettled([altPromise, flourishPromise, smoothPromise]);

  if (allFrames.length === 0) {
      throw new Error("Generation failed: No frames produced.");
  }

  return { frames: allFrames, category };
};

// ============================================================================
// ORBITAL COMMERCE ENGINE - Kinetic Sprite Architecture for Product Visualization
// ============================================================================

/**
 * THE TURN-TABLE MANIFEST
 * Constructs a strict 4x4 grid prompt for 360-degree product visualization.
 * Key constraints:
 * - Maintain constant lighting environment
 * - Volumetric consistency across rotation
 * - Fixed Y-axis rotation (turntable style)
 */
const constructOrbitalPrompt = (
  productName: string,
  role: SheetRole,
  macroRegions?: string[]
): string => {
  let prompt = `TASK: Generate a strict 4x4 Turn-Table Sprite Sheet for e-commerce product visualization.

SUBJECT: ${productName}

═══════════════════════════════════════════════════════════════════
OUTPUT SPECIFICATION
═══════════════════════════════════════════════════════════════════
• OUTPUT: 1024×1024px image containing 4×4 grid (16 cells, 256×256px each)
• QUALITY: Product photography style - sharp focus, professional presentation

MECHANICAL RULES (CRITICAL):
1. GRID: Exactly 4 columns × 4 rows = 16 frames total
2. CELL SIZE: Each frame occupies exactly 256×256px
3. LIGHTING: CONSTANT soft-box lighting across ALL frames (no shadows)
4. SCALE: Object fills 80% of each cell, perfectly centered
5. BACKGROUND: Pure white (#FFFFFF) - NO gradients, NO shadows
6. CAMERA: Fixed position, eye-level, equal distance from subject

`;

  if (role === 'orbital') {
    // Primary Y-axis rotation sheet - FULL 360° revolution
    prompt += `═══════════════════════════════════════════════════════════════════
🚨 CRITICAL REQUIREMENT: 16 VISUALLY DISTINCT ROTATION FRAMES 🚨
═══════════════════════════════════════════════════════════════════

You MUST generate ONE FULL ORBITAL REVOLUTION of this object.
Each of the 16 grid cells shows the SAME object from a DIFFERENT angle.
Think of it like a turntable spinning: the object rotates, camera stays fixed.

⚠️ DO NOT generate 16 copies of the same view!
⚠️ EVERY CELL must show the object rotated to a NEW angle!
⚠️ The viewer will animate through these frames - they MUST be different!

GRID LAYOUT - 16 FRAMES, 16 DIFFERENT ANGLES:
┌─────────┬─────────┬─────────┬─────────┐
│   0°    │   22°   │   45°   │   67°   │  ← Row 1: FRONT rotating to RIGHT
│ (FRONT) │(turn 1) │(turn 2) │(turn 3) │
├─────────┼─────────┼─────────┼─────────┤
│   90°   │  112°   │  135°   │  157°   │  ← Row 2: RIGHT rotating to BACK
│ (RIGHT) │(turn 4) │(turn 5) │(turn 6) │
├─────────┼─────────┼─────────┼─────────┤
│  180°   │  202°   │  225°   │  247°   │  ← Row 3: BACK rotating to LEFT
│ (BACK)  │(turn 7) │(turn 8) │(turn 9) │
├─────────┼─────────┼─────────┼─────────┤
│  270°   │  292°   │  315°   │  337°   │  ← Row 4: LEFT rotating to FRONT
│ (LEFT)  │(turn10) │(turn11) │(turn12) │
└─────────┴─────────┴─────────┴─────────┘

WHAT EACH FRAME MUST SHOW:
• Frame 0 (0°):   FRONT - You see the FRONT of the object
• Frame 1 (22°):  Front rotated slightly right
• Frame 2 (45°):  Halfway between front and right side
• Frame 3 (67°):  Almost right side, front corner visible
• Frame 4 (90°):  RIGHT SIDE - Perfect profile view
• Frame 5 (112°): Right side with back corner appearing
• Frame 6 (135°): Halfway between right and back
• Frame 7 (157°): Almost back view, right corner visible
• Frame 8 (180°): BACK - You see the BACK of the object
• Frame 9 (202°): Back rotated slightly showing left
• Frame 10 (225°): Halfway between back and left
• Frame 11 (247°): Almost left side, back corner visible
• Frame 12 (270°): LEFT SIDE - Perfect profile view
• Frame 13 (292°): Left side with front corner appearing
• Frame 14 (315°): Halfway between left and front
• Frame 15 (337°): Almost front view, left corner visible

TURNTABLE VISUALIZATION:
         CAMERA (fixed position)
              │
              │
              ▼
    ┌─────────────────────┐
    │    TURNTABLE        │
    │         ↻           │  Object spins clockwise
    │    [OBJECT]         │  Camera watches from one spot
    │                     │
    └─────────────────────┘

The object makes ONE COMPLETE 360° ROTATION.
You capture 16 snapshots at equal intervals (every 22.5°).
When played back, it creates a smooth spinning animation.

TECHNICAL REQUIREMENTS:
• Camera: Fixed position, eye-level, same distance for all frames
• Lighting: Soft-box, consistent across ALL frames
• Background: Pure white (#FFFFFF)
• Scale: Object fills 80% of cell, perfectly centered
• NO shadows, NO reflections on background
`;
  } else if (role === 'orbital_pitch') {
    // Elevation/pitch views
    prompt += `═══════════════════════════════════════════════════════════════════
PITCH/ELEVATION VIEWS (The Inspection Angles)
═══════════════════════════════════════════════════════════════════
Generate 16 frames showing the subject from various vertical angles.

GRID LAYOUT WITH PITCH ANGLES:
┌─────────┬─────────┬─────────┬─────────┐
│  0° EL  │  15° DN │  30° DN │  45° DN │  ← Row 1 (Looking Down)
│ (LEVEL) │         │         │         │
├─────────┼─────────┼─────────┼─────────┤
│  60° DN │  90° DN │  15° UP │  30° UP │  ← Row 2 (Extreme Angles)
│         │ (TOP)   │         │         │
├─────────┼─────────┼─────────┼─────────┤
│ FRONT@  │ FRONT@  │ FRONT@  │ FRONT@  │  ← Row 3 (Front View + Pitch)
│ 0° EL   │ 30° DN  │ 60° DN  │ 30° UP  │
├─────────┼─────────┼─────────┼─────────┤
│ SIDE@   │ SIDE@   │ SIDE@   │ SIDE@   │  ← Row 4 (Side View + Pitch)
│ 0° EL   │ 30° DN  │ 60° DN  │ 30° UP  │
└─────────┴─────────┴─────────┴─────────┘

ELEVATION DIAGRAM:
                    90° DOWN (Bird's Eye)
                          ↑
                    ┌─────┴─────┐
                    │   TOP     │
              45°   │           │
                ↘   │           │
          0° ───────┤  SUBJECT  ├─────── 0° (Eye Level)
                ↗   │           │
              45°   │           │
                    │  BOTTOM   │
                    └─────┬─────┘
                          ↓
                    90° UP (Worm's Eye)

DN = Looking Down (camera above subject)
UP = Looking Up (camera below subject)
EL = Elevation angle from eye-level
`;
  } else if (role === 'orbital_states') {
    // Functional states
    prompt += `═══════════════════════════════════════════════════════════════════
FUNCTIONAL STATES (Product Configurations)
═══════════════════════════════════════════════════════════════════
Generate 16 frames showing the subject in various functional states.

GRID LAYOUT WITH STATES:
┌─────────┬─────────┬─────────┬─────────┐
│ CLOSED  │  OPEN   │ TRANSIT │  ALT    │  ← Row 1 (Primary States)
│(Default)│(Active) │(Between)│ (Mode)  │
├─────────┼─────────┼─────────┼─────────┤
│EXPLODED │ASSEMBLED│PACKAGED │UNBOXING │  ← Row 2 (Detail States)
│         │         │         │         │
├─────────┼─────────┼─────────┼─────────┤
│ IN-HAND │ON-SURF  │W/ACCESS │ STYLED  │  ← Row 3 (Lifestyle)
│         │         │         │         │
├─────────┼─────────┼─────────┼─────────┤
│VARIANT 1│VARIANT 2│VARIANT 3│VARIANT 4│  ← Row 4 (Color/Size Variants)
└─────────┴─────────┴─────────┴─────────┘

FRAME BREAKDOWN:
Row 1 (Primary States):
  • Frame 0:  CLOSED/INACTIVE - Default product appearance
  • Frame 1:  OPEN/ACTIVE - Product in use position
  • Frame 2:  TRANSITIONAL - Between open and closed
  • Frame 3:  ALTERNATE CONFIG - Different usage mode

Row 2 (Detail States):
  • Frame 4:  EXPLODED VIEW - Components separated
  • Frame 5:  ASSEMBLED VIEW - All parts connected
  • Frame 6:  PACKAGING VIEW - Product in box/packaging
  • Frame 7:  UNBOXING VIEW - Partially revealed

Row 3 (Lifestyle/Context):
  • Frame 8:  IN-HAND - Human hand holding product
  • Frame 9:  ON-SURFACE - Product on clean surface
  • Frame 10: WITH-ACCESSORY - With companion item
  • Frame 11: STYLED - Lifestyle/marketing composition

Row 4 (Variants):
  • Frame 12-15: Color/size variants or additional configurations
`;
  } else if (role === 'orbital_macro') {
    // Macro/detail shots
    const regions = macroRegions?.join(', ') || 'texture, logo, key features, material';
    prompt += `═══════════════════════════════════════════════════════════════════
MACRO DETAIL VIEWS (Virtual Macro Lens)
═══════════════════════════════════════════════════════════════════
Generate 16 extreme close-up frames showing fine details.

FOCUS REGIONS: ${regions}

GRID LAYOUT WITH DETAIL TYPES:
┌─────────┬─────────┬─────────┬─────────┐
│ TEXTURE │  LOGO   │FEATURE 1│FEATURE 2│  ← Row 1 (Primary Details)
│(Surface)│(Brand)  │(Button) │(Port)   │
├─────────┼─────────┼─────────┼─────────┤
│STITCHING│HARDWARE │ INNER   │  EDGE   │  ← Row 2 (Craftsmanship)
│ (Seams) │(Metal)  │(Lining) │(Corners)│
├─────────┼─────────┼─────────┼─────────┤
│TEXTURE  │ LOGO    │FEATURE 1│FEATURE 2│  ← Row 3 (Alt Angles)
│  @45°   │  @45°   │  @45°   │  @45°   │
├─────────┼─────────┼─────────┼─────────┤
│STITCHING│HARDWARE │ INNER   │  EDGE   │  ← Row 4 (Alt Angles)
│  @45°   │  @45°   │  @45°   │  @45°   │
└─────────┴─────────┴─────────┴─────────┘

MACRO REQUIREMENTS:
• Fill 90% of frame with detail area
• Sharp focus on surface texture/material
• Visible material grain, stitching, finish quality
• Professional product photography lighting
`;
  }

  return prompt;
};

/**
 * Generates a single orbital sprite sheet
 */
const generateSingleOrbitalSheet = async (
  ai: GoogleGenAI,
  role: SheetRole,
  imageBase64: string,
  config: OrbitalConfig,
  seed: number,
  contextImageBase64?: string
): Promise<{ frames: OrbitalFrame[], rawSheetBase64?: string }> => {

  const rows = 4;
  const cols = 4;

  let systemPrompt = constructOrbitalPrompt(config.productName, role, config.macroRegions);

  console.log(`[Gemini Orbital] Generating Sheet: ${role}...`);

  const cleanFront = imageBase64.includes('base64,') ? imageBase64.split('base64,')[1] : imageBase64;
  const cleanBack = config.backImageBase64?.includes('base64,') ? config.backImageBase64.split('base64,')[1] : config.backImageBase64;
  const cleanContext = contextImageBase64?.includes('base64,') ? contextImageBase64.split('base64,')[1] : contextImageBase64;

  const parts: any[] = [];

  // Add front image (required)
  parts.push({ inlineData: { mimeType: 'image/jpeg', data: cleanFront } });

  // Add back image if provided (critical for accurate rotation)
  if (cleanBack) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: cleanBack } });
    systemPrompt += `

═══════════════════════════════════════════════════════════════════
TWO REFERENCE IMAGES PROVIDED
═══════════════════════════════════════════════════════════════════
IMAGE 1 = FRONT VIEW (0°) - This is what the subject looks like from the FRONT
IMAGE 2 = BACK VIEW (180°) - This is what the subject looks like from the BACK

Use BOTH images to accurately generate all 16 intermediate rotation angles.
The front image defines frames 0-3 (0° to 67°).
The back image defines frames 8-11 (180° to 247°).
Interpolate smoothly between them for frames 4-7 and 12-15.

CRITICAL: Every single frame MUST show a DIFFERENT angle of rotation.
Do NOT repeat the same view. Each of the 16 cells must be VISUALLY DISTINCT.
`;
  }

  // Add context image for consistency across sheets
  if (cleanContext) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: cleanContext } });
    systemPrompt += "\nCONSISTENCY REFERENCE: Match the style, lighting, and scale of the previous sheet.";
  }

  parts.push({ text: systemPrompt });

  try {
    const response = await generateWithRetry(ai, {
      model: 'gemini-2.5-flash-image',
      contents: { parts },
      config: {
        imageConfig: { aspectRatio: "1:1" },
        seed: seed
      }
    });

    const candidate = response.candidates?.[0];
    if (!candidate) throw new Error("API returned no candidates.");

    let spriteSheetBase64: string | undefined = undefined;
    if (candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData && part.inlineData.data) {
          spriteSheetBase64 = part.inlineData.data;
          break;
        }
      }
    }

    if (!spriteSheetBase64) {
      console.warn(`[Gemini Orbital] Sheet ${role} yielded no image data.`);
      return { frames: [] };
    }

    const rawFrames = await sliceSpriteSheet(`data:image/jpeg;base64,${spriteSheetBase64}`, rows, cols);
    const finalFrames: OrbitalFrame[] = [];

    // Map frame indices to angles based on sheet role
    for (let i = 0; i < rawFrames.length; i++) {
      let angle = 0;
      let pitch = 0;
      let state: OrbitalProductState = 'closed';
      const isMacro = role === 'orbital_macro';

      if (role === 'orbital') {
        // Y-axis rotation: 0-90° in first row, continuing through sheet
        // Each frame represents ~22.5° of rotation
        angle = (i % 16) * 22.5;
        if (angle >= 360) angle = angle % 360;
      } else if (role === 'orbital_pitch') {
        // Pitch sheet: rows represent different elevations
        const pitchAngles = [0, 15, 30, 45, 60, 90, -15, -30];
        pitch = pitchAngles[i % 8] || 0;
        angle = i < 8 ? 0 : 90; // Front view for first 8, side view for next 8
      } else if (role === 'orbital_states') {
        const states: OrbitalProductState[] = ['closed', 'open', 'active', 'inactive', 'exploded', 'packaged', 'lifestyle', 'lifestyle'];
        state = states[i % 8] || 'closed';
      }

      finalFrames.push({
        url: rawFrames[i],
        angle,
        pitch,
        state,
        isMirrored: false,
        isMacro,
        macroRegion: isMacro ? getMacroRegionForIndex(i, config.macroRegions) : undefined,
        role
      });
    }

    return { frames: finalFrames, rawSheetBase64: spriteSheetBase64 };

  } catch (e: any) {
    console.error(`Failed to generate orbital sheet ${role}:`, e);
    // Propagate error with details instead of swallowing it
    const errorMsg = e?.message || e?.toString() || 'Unknown error';
    throw new Error(`Orbital sheet ${role} failed: ${errorMsg}`);
  }
};

/**
 * Helper to determine macro region based on frame index
 */
const getMacroRegionForIndex = (index: number, regions?: string[]): string => {
  const defaultRegions = ['texture', 'logo', 'feature_1', 'feature_2', 'stitching', 'hardware', 'interior', 'edge'];
  const allRegions = regions && regions.length > 0 ? regions : defaultRegions;
  return allRegions[index % allRegions.length];
};

/**
 * HEMISPHERE COMPLETION - The Mechanical Multiplier for Orbital
 * Mirrors frames from 0-90° to generate 270-360° views
 * This exploits the symmetry of most products to reduce API costs by 50%
 */
const completeHemisphere = async (frames: OrbitalFrame[]): Promise<OrbitalFrame[]> => {
  const completedFrames: OrbitalFrame[] = [...frames];

  // Only mirror frames that are in the 0-90° range
  const frontQuadrantFrames = frames.filter(f => f.angle >= 0 && f.angle <= 90 && f.role === 'orbital');

  for (const frame of frontQuadrantFrames) {
    // Mirror the frame
    const mirroredUrl = await mirrorFrame(frame.url);

    // Calculate the mirrored angle (e.g., 30° becomes 330°, 90° becomes 270°)
    const mirroredAngle = 360 - frame.angle;

    // Don't duplicate 0° and 180° (they mirror to themselves)
    if (frame.angle === 0 || frame.angle === 180) continue;

    completedFrames.push({
      url: mirroredUrl,
      angle: mirroredAngle,
      pitch: frame.pitch,
      state: frame.state,
      isMirrored: true,
      isMacro: frame.isMacro,
      macroRegion: frame.macroRegion,
      role: frame.role
    });
  }

  // Sort by angle for proper sequencing
  return completedFrames.sort((a, b) => a.angle - b.angle);
};

/**
 * VIRTUAL MACRO LENS - Creates zoomed detail views from existing frames
 * Uses canvas cropping to simulate macro photography without additional API calls
 */
const createVirtualMacroZoom = async (
  frameUrl: string,
  region: { x: number, y: number, width: number, height: number },
  zoomFactor: number = 2.0
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const outputSize = 512; // High quality macro output
      canvas.width = outputSize;
      canvas.height = outputSize;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve(frameUrl);
        return;
      }

      // Calculate source region based on normalized coordinates
      const srcX = region.x * img.width;
      const srcY = region.y * img.height;
      const srcW = region.width * img.width;
      const srcH = region.height * img.height;

      // Draw the cropped region, scaled up
      ctx.drawImage(
        img,
        srcX, srcY, srcW, srcH,
        0, 0, outputSize, outputSize
      );

      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => resolve(frameUrl);
    img.src = frameUrl;
  });
};

/**
 * Generates macro zoom variants for key product regions
 */
const generateVirtualMacros = async (
  baseFrames: OrbitalFrame[],
  regions: Array<{ name: string, x: number, y: number, width: number, height: number }>
): Promise<OrbitalFrame[]> => {
  const macroFrames: OrbitalFrame[] = [];

  // Use the front-facing frame (0°) as the source for macros
  const frontFrame = baseFrames.find(f => f.angle === 0 && f.role === 'orbital');
  if (!frontFrame) return macroFrames;

  for (const region of regions) {
    const macroUrl = await createVirtualMacroZoom(frontFrame.url, region, 2.5);
    macroFrames.push({
      url: macroUrl,
      angle: 0,
      pitch: 0,
      state: 'closed',
      isMirrored: false,
      isMacro: true,
      macroRegion: region.name,
      role: 'orbital_macro'
    });
  }

  return macroFrames;
};

/**
 * MAIN ORBITAL GENERATION FUNCTION
 * Orchestrates the full Turn-Table sprite sheet generation pipeline
 */
export const generateOrbitalFrames = async (
  imageBase64: string,
  config: Partial<OrbitalConfig> = {},
  onFrameUpdate: (frames: OrbitalFrame[]) => void
): Promise<{ frames: OrbitalFrame[] }> => {

  // Validate API key before attempting generation
  validateApiKey();

  const fullConfig: OrbitalConfig = { ...DEFAULT_ORBITAL_CONFIG, ...config };
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const masterSeed = Math.floor(Math.random() * 2147483647);
  console.log("[Orbital] Master Seed for Consistency:", masterSeed);

  let allFrames: OrbitalFrame[] = [];
  let baseSheetBase64: string | undefined = undefined;

  // 1. GENERATE PRIMARY ROTATION SHEET (Y-Axis: 0° to 90°)
  console.log("[Orbital] Generating primary rotation sheet...");
  const baseResult = await generateSingleOrbitalSheet(
    ai,
    'orbital',
    imageBase64,
    fullConfig,
    masterSeed
  );

  if (baseResult.frames.length > 0) {
    allFrames = [...allFrames, ...baseResult.frames];
    baseSheetBase64 = baseResult.rawSheetBase64;
    onFrameUpdate(allFrames);
  } else {
    throw new Error("Primary orbital generation failed. Aborting.");
  }

  // 2. HEMISPHERE COMPLETION (Mirror 0-90° to get 270-360°)
  if (fullConfig.enableHemisphereCompletion) {
    console.log("[Orbital] Completing hemisphere via mirroring...");
    allFrames = await completeHemisphere(allFrames);
    onFrameUpdate(allFrames);
  }

  // 3. GENERATE PITCH/ELEVATION VIEWS (Optional)
  if (fullConfig.enablePitchViews) {
    console.log("[Orbital] Generating pitch/elevation views...");
    await delay(100);
    try {
      const pitchResult = await generateSingleOrbitalSheet(
        ai,
        'orbital_pitch',
        imageBase64,
        fullConfig,
        masterSeed,
        baseSheetBase64
      );
      if (pitchResult.frames.length > 0) {
        allFrames = [...allFrames, ...pitchResult.frames];
        onFrameUpdate(allFrames);
      }
    } catch (e) {
      console.warn("[Orbital] Pitch sheet generation failed:", e);
    }
  }

  // 4. GENERATE FUNCTIONAL STATES (Optional)
  if (fullConfig.enableFunctionalStates) {
    console.log("[Orbital] Generating functional states...");
    await delay(100);
    try {
      const statesResult = await generateSingleOrbitalSheet(
        ai,
        'orbital_states',
        imageBase64,
        fullConfig,
        masterSeed,
        baseSheetBase64
      );
      if (statesResult.frames.length > 0) {
        allFrames = [...allFrames, ...statesResult.frames];
        onFrameUpdate(allFrames);
      }
    } catch (e) {
      console.warn("[Orbital] States sheet generation failed:", e);
    }
  }

  // 5. GENERATE MACRO DETAILS (Optional - Can use AI or Virtual Macro)
  if (fullConfig.enableMacroLens) {
    console.log("[Orbital] Generating macro detail views...");

    // First, try virtual macros (no API cost)
    const defaultMacroRegions = [
      { name: 'center', x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      { name: 'top_detail', x: 0.2, y: 0.1, width: 0.6, height: 0.4 },
      { name: 'bottom_detail', x: 0.2, y: 0.5, width: 0.6, height: 0.4 },
    ];

    const virtualMacros = await generateVirtualMacros(allFrames, defaultMacroRegions);
    allFrames = [...allFrames, ...virtualMacros];
    onFrameUpdate(allFrames);

    // Optionally, also generate AI macro sheet for higher quality
    await delay(100);
    try {
      const macroResult = await generateSingleOrbitalSheet(
        ai,
        'orbital_macro',
        imageBase64,
        fullConfig,
        masterSeed,
        baseSheetBase64
      );
      if (macroResult.frames.length > 0) {
        allFrames = [...allFrames, ...macroResult.frames];
        onFrameUpdate(allFrames);
      }
    } catch (e) {
      console.warn("[Orbital] Macro sheet generation failed:", e);
    }
  }

  console.log(`[Orbital] Generation complete. Total frames: ${allFrames.length}`);
  return { frames: allFrames };
};

/**
 * FRAME QUANTIZER
 * Maps a continuous angle (0-360) to the nearest available frame
 * Used by the OrbitalViewer to select the correct sprite during rotation
 */
export const quantizeAngleToFrame = (
  angle: number,
  frames: OrbitalFrame[],
  options: { role?: SheetRole, pitch?: number } = {}
): OrbitalFrame | null => {
  // Normalize angle to 0-360
  let normalizedAngle = angle % 360;
  if (normalizedAngle < 0) normalizedAngle += 360;

  // Filter frames by role and pitch if specified
  let candidateFrames = frames.filter(f => {
    if (options.role && f.role !== options.role) return false;
    if (options.pitch !== undefined && Math.abs(f.pitch - options.pitch) > 5) return false;
    return !f.isMacro; // Exclude macro frames from rotation
  });

  if (candidateFrames.length === 0) return null;

  // Find the frame with the closest angle
  let closestFrame = candidateFrames[0];
  let smallestDiff = Math.abs(angleDifference(normalizedAngle, closestFrame.angle));

  for (const frame of candidateFrames) {
    const diff = Math.abs(angleDifference(normalizedAngle, frame.angle));
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closestFrame = frame;
    }
  }

  return closestFrame;
};

/**
 * Helper to calculate the shortest angular difference
 */
const angleDifference = (a: number, b: number): number => {
  const diff = ((b - a + 180) % 360) - 180;
  return diff < -180 ? diff + 360 : diff;
};

/**
 * INTERPOLATION HELPER
 * Returns two frames and a blend factor for smooth transitions
 */
export const getInterpolationFrames = (
  angle: number,
  frames: OrbitalFrame[]
): { frameA: OrbitalFrame, frameB: OrbitalFrame, blend: number } | null => {
  const rotationFrames = frames
    .filter(f => f.role === 'orbital' && !f.isMacro)
    .sort((a, b) => a.angle - b.angle);

  if (rotationFrames.length < 2) return null;

  let normalizedAngle = angle % 360;
  if (normalizedAngle < 0) normalizedAngle += 360;

  // Find the two frames that bracket the current angle
  let frameA = rotationFrames[rotationFrames.length - 1];
  let frameB = rotationFrames[0];

  for (let i = 0; i < rotationFrames.length; i++) {
    if (rotationFrames[i].angle > normalizedAngle) {
      frameB = rotationFrames[i];
      frameA = rotationFrames[i > 0 ? i - 1 : rotationFrames.length - 1];
      break;
    }
    frameA = rotationFrames[i];
    frameB = rotationFrames[(i + 1) % rotationFrames.length];
  }

  // Calculate blend factor
  const angleSpan = angleDifference(frameA.angle, frameB.angle);
  const angleFromA = angleDifference(frameA.angle, normalizedAngle);
  const blend = angleSpan !== 0 ? Math.abs(angleFromA / angleSpan) : 0;

  return { frameA, frameB, blend: Math.max(0, Math.min(1, blend)) };
};
