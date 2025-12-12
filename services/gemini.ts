
import { GoogleGenAI } from "@google/genai";
import { GeneratedFrame, PoseType, EnergyLevel, SubjectCategory, FrameType, SheetRole, MoveDirection } from "../types";

// Use environment variable as per strict guidelines. 
const API_KEY = process.env.API_KEY || 'AIzaSyDFjSQY6Ne38gtzEd6Q_5zyyW65ah5_anw';

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

    // MECHANICAL PROMPT: STRICT GRID & CENTERING
    let systemPrompt = `TASK: Generate a strict 4x4 Grid Sprite Sheet (16 frames).
    
    MECHANICAL RULES:
    1. GRID: Exactly 4 columns, 4 rows.
    2. SPACING: Use the FULL CELL for each frame.
    3. CENTERING: The character must be centered in the MIDDLE of each grid cell.
    4. PADDING: Leave a small gap between the character and the cell edge to prevent clipping.
    5. IDENTITY: Maintain exact character consistency from Input Image.
    
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
        return { frames: [] };
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
