

import { GoogleGenAI } from "@google/genai";
import { GeneratedFrame, PoseType, EnergyLevel, SubjectCategory, FrameType, SheetRole, MoveDirection } from "../types";

// Use environment variable as per strict guidelines. 
// Fallback included only for local dev convenience if env is missing.
const API_KEY = process.env.API_KEY || 'AIzaSyDFjSQY6Ne38gtzEd6Q_5zyyW65ah5_anw';

// --- UTILITIES ---

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

// Optimized resize for Gemini 384px Input cost saving
const resizeImage = (file: File, maxDim: number = 384): Promise<string> => {
    return new Promise((resolve, reject) => {
        if (!file || !(file instanceof File)) return reject(new Error("Invalid file passed to resizeImage"));

        let url = '';
        try { url = URL.createObjectURL(file); } catch (e) { 
            return fileToBase64(file).then(resolve).catch(reject); 
        }

        const img = new Image();
        img.crossOrigin = "anonymous";
        
        img.onload = () => {
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
                // Lower quality slightly to prevent Payload Too Large / XHR errors
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

// --- SPRITE SHEET SLICER (NORMALIZED 1024x1024) ---
const sliceSpriteSheet = (base64Image: string, rows: number, cols: number): Promise<string[]> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = async () => {
            // 1. STANDARDIZATION STEP
            const SHEET_SIZE = 1024;
            const normCanvas = document.createElement('canvas');
            normCanvas.width = SHEET_SIZE;
            normCanvas.height = SHEET_SIZE;
            const normCtx = normCanvas.getContext('2d');
            
            if (!normCtx) { reject("Canvas context failed"); return; }
            
            // SMART CROP LOGIC:
            // Crop the CENTER SQUARE from the source image.
            let srcX = 0, srcY = 0, srcW = img.width, srcH = img.height;
            if (img.width !== img.height) {
                const minDim = Math.min(img.width, img.height);
                srcX = (img.width - minDim) / 2;
                srcY = (img.height - minDim) / 2;
                srcW = minDim;
                srcH = minDim;
            }
            
            // Draw cropped square scaled to 1024x1024
            normCtx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, SHEET_SIZE, SHEET_SIZE);

            // 2. SLICING STEP
            const cellW = SHEET_SIZE / cols; // 256
            const cellH = SHEET_SIZE / rows; // 256
            
            // SAFETY CROP: Increased to 10% to aggressively remove cut-off limbs and grid lines
            const cropFactor = 0.10; 
            const cropX = cellW * cropFactor;
            const cropY = cellH * cropFactor;
            const sourceW = cellW * (1 - 2 * cropFactor);
            const sourceH = cellH * (1 - 2 * cropFactor);

            const frames: string[] = [];
            const promises: Promise<void>[] = [];

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
                            cellSrcX, cellSrcY, sourceW, sourceH, // Source from Norm Canvas
                            0, 0, cellCanvas.width, cellCanvas.height
                        );
                        
                        // Convert to Blob URL (JPEG 0.8 for speed)
                        const p = new Promise<void>(resolveBlob => {
                            cellCanvas.toBlob(blob => {
                                if (blob) frames.push(URL.createObjectURL(blob));
                                resolveBlob();
                            }, 'image/jpeg', 0.8);
                        });
                        promises.push(p);
                    }
                }
            }
            
            await Promise.all(promises);
            resolve(frames);
        };
        img.onerror = reject;
        img.src = base64Image;
    });
};

// --- MIRRORING UTILITY (Blob Optimized) ---
const mirrorFrame = (frameUrl: string): Promise<string> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1);
                ctx.drawImage(img, 0, 0);
                canvas.toBlob(blob => {
                    if (blob) resolve(URL.createObjectURL(blob));
                    else resolve(frameUrl);
                }, 'image/jpeg', 0.8);
            } else {
                resolve(frameUrl);
            }
        };
        img.src = frameUrl;
    });
};

// --- RETRY WRAPPER ---
const generateWithRetry = async (ai: GoogleGenAI, params: any, retries = 3) => {
    let lastError: any;
    for (let i = 0; i < retries; i++) {
        try {
            return await ai.models.generateContent(params);
        } catch (e: any) {
            console.warn(`Gemini generation attempt ${i + 1} failed:`, e);
            lastError = e;
            // Exponential backoff
            await delay(1000 * Math.pow(2, i)); 
        }
    }
    throw lastError;
};

// --- SINGLE SHEET GENERATOR (Atomic Unit) ---
const generateSingleSheet = async (
    ai: GoogleGenAI,
    role: SheetRole,
    imageBase64: string,
    stylePrompt: string,
    motionPrompt: string,
    category: SubjectCategory,
    seed: number // CONSISTENCY LOCK
): Promise<GeneratedFrame[]> => {
    
    const rows = 4;
    const cols = 4;
    const isTextOrSymbol = category === 'TEXT' || category === 'SYMBOL';
    const actionDesc = motionPrompt ? `Performing: ${motionPrompt}` : "";

    // PROMPT ENGINEERING: STRICT IDENTITY LOCK & GRID ALIGNMENT
    let systemPrompt = `TASK: Generate a 4x4 Sprite Sheet (16 frames) based on the input image.
    
    CRITICAL: IDENTITY LOCK.
    You MUST preserve the EXACT face, hair, clothing, and body type from the input image.
    All frames must look like the EXACT SAME character.
    Do NOT generate a random person. 
    Use the input image as the absolute ground truth.
    
    GRID SPECIFICATION (CRITICAL FOR SLICING):
    1. Strictly 4 rows, 4 columns. 
    2. Output must be a PERFECT SQUARE image.
    3. ZERO PADDING between cells. Frames must be edge-to-edge.
    4. SAFETY MARGIN: Keep the character SCALED TO 80% within each cell to ensure NO LIMBS ARE CUT OFF.
       - The head, feet, and hands MUST NOT touch the grid lines.
       - Center the character in every cell.
    
    Style Hint: ${stylePrompt} (Use for lighting/mood ONLY. Do NOT change subject appearance).
    `;

    // --- BRANCHING LOGIC BASED ON SUBJECT TYPE ---
    
    if (isTextOrSymbol) {
        // === LOGO / TEXT PATH ===
        const userAction = motionPrompt ? `Action: ${motionPrompt}` : "Action: Dynamic Pulsing";
        
        if (role === 'base') {
            systemPrompt += `
            SUBJECT: LOGO/TEXT/SYMBOL (Kinetic Typography).
            ${userAction}.
            Row 1: 3D Extrusion / Pulse (Forward/Back)
            Row 2: Rotation Left (Y-Axis Spin)
            Row 3: Rotation Right (Y-Axis Spin)
            Row 4: Heavy Impact / Scale Up
            Focus: Bold lines, 3D depth, metallic sheen.
            `;
        } else if (role === 'alt') {
            systemPrompt += `
            SUBJECT: LOGO/TEXT/SYMBOL (Variations).
            Row 1: Vertical Flip / Tumble
            Row 2: Squash and Stretch (Elastic Physics)
            Row 3: Liquid Melt / Chrome Reflection
            Row 4: Diagonal Tilt / Shear
            Focus: Elasticity, Material properties.
            `;
        } else if (role === 'flourish') {
            systemPrompt += `
            SUBJECT: LOGO/TEXT/SYMBOL (Glitch/FX).
            Row 1: ZERO-POINT ANCHOR (Clean, Static, Centered)
            Row 2: Fragment / Explode outward (Debris)
            Row 3: RGB Split / Chromatic Aberration (Glitch)
            Row 4: Neon Glow Surge / Over-exposure
            Focus: High energy visual effects.
            `;
        }

    } else {
        // === CHARACTER PATH ===
        const userStyle = motionPrompt ? `Dance Style: ${motionPrompt}` : "Dance Style: Rhythmic Groove";

        if (role === 'base') {
            systemPrompt += `
            SUBJECT: CHARACTER (Base Rhythm) - KEEP IDENTITY.
            ${userStyle}.
            Row 1: Idle Groove (Center). Grounded. Micro-movements, breathing, slight weight shift.
            Row 2: Step Left / Lean Left. Character physically moves to their LEFT.
            Row 3: Step Right / Lean Right. Character physically moves to their RIGHT.
            Row 4: Power Pose / Freeze (Center). Strong silhouette, arms defined.
            Focus: Stability, Rhythm, Center-weighted. Ensure feet are visible.
            `;
        } else if (role === 'alt') {
            systemPrompt += `
            SUBJECT: CHARACTER (Dynamic Moves) - KEEP IDENTITY.
            Row 1: JUMP / Air Pose. Character mid-air, knees tucked or legs extended.
            Row 2: Floor Work / Crouch. Character drops low, hand on floor or kneeling.
            Row 3: Spin Initiation. Character turning, body twisted, dynamic fabric motion.
            Row 4: Dynamic Side Lean / Off-balance. Extreme angle, energetic.
            Focus: Athletics, Fluidity, Alternative Angles.
            `;
        } else if (role === 'flourish') {
            systemPrompt += `
            SUBJECT: CHARACTER (Special FX & Lip Sync) - KEEP IDENTITY.
            Row 1: Hand Tutting / shapes. Complex arm movements, framing the body.
            Row 2: Stutter / Glitch Pose. Sharp, angular, high-tension pose.
            Row 3: MACRO FACE (Neutral). Extreme Close-up on face (neck up). Mouth CLOSED or Neutral.
            Row 4: MACRO FACE (Singing). Extreme Close-up on face (neck up). Mouth WIDE OPEN singing/shouting.
            Focus: Facial expressions, Lip sync capability, High Energy.
            `;
        }
    }

    console.log(`[Gemini] Generating Sheet: ${role} (${category})...`);

    // Ensure we strip the Data URL prefix if it exists, API expects pure base64
    const cleanBase64 = imageBase64.includes('base64,') ? imageBase64.split('base64,')[1] : imageBase64;

    try {
        const response = await generateWithRetry(ai, {
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [
                    { 
                        inlineData: { 
                            mimeType: 'image/jpeg', 
                            data: cleanBase64
                        } 
                    },
                    { text: systemPrompt }
                ]
            },
            config: {
                imageConfig: { aspectRatio: "1:1" },
                seed: seed // USE THE SAME SEED FOR CONSISTENCY
            }
        });

        const candidate = response.candidates?.[0];
        if (!candidate) throw new Error("API returned no candidates.");
        
        // Log Safety and Finish Reason for debugging
        if (candidate.finishReason !== 'STOP') {
            console.warn(`[Gemini] Sheet ${role} finish reason: ${candidate.finishReason}. Check safety settings.`);
        }

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
             console.warn(`[Gemini] Sheet ${role} yielded no image data. Full candidate:`, candidate);
             return [];
        }

        // Slice (Normalized to 1024x1024)
        const rawFrames = await sliceSpriteSheet(`data:image/jpeg;base64,${spriteSheetBase64}`, rows, cols);
        const finalFrames: GeneratedFrame[] = [];

        // Map
        for (let i = 0; i < rawFrames.length; i++) {
            let energy: EnergyLevel = 'mid';
            let type: FrameType = 'body';
            let direction: MoveDirection = 'center';
            let poseName = `${role}_${i}`;

            if (role === 'base') {
                if (i < 4) {
                    energy = 'low'; // Row 1: Idle (Center)
                    direction = 'center';
                }
                else if (i >= 4 && i < 8) {
                    energy = 'mid'; // Row 2: Left
                    direction = 'left';
                }
                else if (i >= 8 && i < 12) {
                    energy = 'mid'; // Row 3: Right
                    direction = 'right';
                }
                else if (i >= 12) {
                    energy = 'high'; // Row 4: Power Pose (Center)
                    direction = 'center';
                }
            } 
            else if (role === 'alt') {
                energy = 'high'; // Alt is generally higher energy now
                if (i < 4) { poseName += '_jump'; direction = 'center'; } // Row 1: Jump
                else if (i >= 4 && i < 8) { poseName += '_floor'; direction = 'center'; } // Row 2: Floor
                else { direction = 'center'; } // Spins
            }
            else if (role === 'flourish') {
                // FLOURISH MAPPING
                energy = 'high';
                direction = 'center';
                if (!isTextOrSymbol) {
                    if (i < 4) {
                        // Row 1: Hands
                        poseName = `flourish_hands_${i}`;
                        energy = 'mid';
                    } else if (i >= 4 && i < 8) {
                        // Row 2: Stutter
                        poseName = `flourish_stutter_${i}`;
                        energy = 'high';
                    } else if (i >= 8 && i < 12) {
                        // Row 3: Closeup Neutral
                        poseName = `closeup_neutral_${i}`;
                        type = 'closeup';
                        energy = 'mid';
                    } else if (i >= 12) {
                        // Row 4: Closeup Open (Lip Sync)
                        poseName = `closeup_open_${i}`;
                        type = 'closeup';
                        energy = 'high';
                    }
                } else {
                    // Text flourish logic
                    if (i < 4) energy = 'low'; // Anchor
                    else energy = 'high';
                }
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
            // We want to create "Fake Right" from "Real Left" and vice versa for max coverage
            const shouldMirror = !isTextOrSymbol && type === 'body' && role !== 'flourish';
            
            if (shouldMirror) {
                 const mirrored = await mirrorFrame(rawFrames[i]);
                 // Swap direction for the mirror
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
        
        return finalFrames;

    } catch (e: any) {
        console.error(`Failed to generate sheet ${role}:`, e);
        // Don't kill whole process if one sheet fails
        return [];
    }
};


// --- MAIN GENERATION ORCHESTRATOR (STREAMING) ---
export const generateDanceFrames = async (
  imageBase64: string,
  stylePrompt: string,
  motionPrompt: string,
  useTurbo: boolean,
  superMode: boolean,
  onFrameUpdate: (frames: GeneratedFrame[]) => void // NEW CALLBACK
): Promise<{ frames: GeneratedFrame[], category: SubjectCategory }> => {

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  // GENERATE A MASTER SEED FOR CONSISTENCY
  // All parallel requests will use this same seed.
  const masterSeed = Math.floor(Math.random() * 2147483647);
  console.log("Master Seed for Consistency:", masterSeed);

  // In a real app, we might use a small vision call to detect category first.
  // For now, default to CHARACTER unless prompt suggests otherwise.
  let category: SubjectCategory = 'CHARACTER';
  if (/logo|text|word|letter|font|typography/i.test(motionPrompt)) category = 'TEXT';
  
  // We will accumulate frames here and emit updates
  let allFrames: GeneratedFrame[] = [];

  // 1. Launch BASE Sheet IMMEDIATELY
  const basePromise = generateSingleSheet(ai, 'base', imageBase64, stylePrompt, motionPrompt, category, masterSeed)
    .then(frames => {
        allFrames = [...allFrames, ...frames];
        onFrameUpdate(allFrames); // EMIT IMMEDIATELY
        return frames;
    });

  // 2. Launch ALT Sheet (Non-blocking, parallel but staggered)
  const altPromise = (async () => {
     if (!useTurbo || superMode) {
         // Reduced staggering for faster perceived speed
         await delay(200); 
         try {
             const frames = await generateSingleSheet(ai, 'alt', imageBase64, stylePrompt, motionPrompt, category, masterSeed);
             allFrames = [...allFrames, ...frames];
             onFrameUpdate(allFrames); // EMIT UPDATE
             return frames;
         } catch(e) { console.warn("Alt sheet failed", e); return []; }
     }
     return [];
  })();

  // 3. Launch FLOURISH Sheet
  const flourishPromise = (async () => {
      if (superMode) {
          await delay(400); // Reduced stagger
          try {
              const frames = await generateSingleSheet(ai, 'flourish', imageBase64, stylePrompt, motionPrompt, category, masterSeed);
              allFrames = [...allFrames, ...frames];
              onFrameUpdate(allFrames); // EMIT UPDATE
              return frames;
          } catch(e) { console.warn("Flourish sheet failed", e); return []; }
      }
      return [];
  })();

  // Wait for all to finish (or fail) before final return
  await Promise.allSettled([basePromise, altPromise, flourishPromise]);

  if (allFrames.length === 0) {
      throw new Error("Generation failed: No frames produced.");
  }

  return { frames: allFrames, category };
};
