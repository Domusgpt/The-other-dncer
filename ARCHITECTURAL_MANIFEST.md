
# jusDNCE // ARCHITECTURAL MANIFEST & SOURCE OF TRUTH

> **VERSION:** 2.1 (Mechanical Grid + Hard Cut Revision)
> **CORE PHILOSOPHY:** "Perfect Alignment over Soft Blends."
> **STATUS:** Production Ready

This document serves as the absolute source of truth for the jusDNCE architecture. It details how the disparate systems (AI, Rendering, Physics, Audio) bind together, specifically addressing the recent pivot from "Smooth/Mushy" logic to "Mechanical/Snappy" logic.

---

## 1. THE RIG: AI Generation Pipeline (`services/gemini.ts`)

The "Rig" is responsible for converting a static image into a 4x4 Sprite Sheet.

### The "Drift" Problem (Deprecated)
Previously, we used smart-cropping and "smooth" style prompts.
*   **Issue:** The AI drifted off-center.
*   **Issue:** Cropping logic guessed coordinates, slicing off limbs.
*   **Result:** The character jumped around the frame like a glitch.

### The "Mechanical Grid" Solution (Current)
We now enforce strict mathematical rigidity over AI creativity.

#### A. Input Normalization
1.  **Downscale:** All inputs are resized to **384px**. This is the cost-efficiency sweet spot (~200 tokens).
2.  **Prompt Engineering:** We explicitly demand a **Strict 4x4 Grid**.
    *   **Centroid Alignment:** "Center of mass in middle of cell."
    *   **Scale Constraint:** "Scale to 75%." This leaves a 12.5% safety buffer on all sides so limbs never touch grid lines.

#### B. The Slicer (`sliceSpriteSheet`)
We abandoned dynamic cropping for **Stretch-to-Fit** logic.
1.  **Normalization:** The raw base64 output from Gemini is drawn onto a `1024x1024` canvas.
2.  **Mechanical Cuts:** We slice at exactly 25% intervals (0, 256, 512, 768).
3.  **Crop Factor:** A conservative `0.10` (10%) inner crop is applied to remove grid lines, but because the prompt enforces 75% scale, the character is safe.

#### C. Mirroring
To save tokens, we generate *one* side of a movement (e.g., "Step Left") and flip it locally using `mirrorFrame`. This effectively generates 8 frames for the price of 4.

---

## 2. THE BRAIN: Choreography Engine (`components/Step4Preview.tsx`)

The "Brain" runs inside the `loop()` function. It listens to audio and decides which frame to show.

### The "Mushy" Problem (Deprecated)
Previously, we used `SLIDE` and `MORPH` interpolation for everything.
*   **Issue:** Fast beats turned into a blur.
*   **Issue:** Misaligned frames looked like warping slime.

### The "Hard Cut" Solution (Current)
We returned to traditional 2D animation rules.

#### A. Rhythm Gating
We analyze audio frequency bands (`analyserRef`):
*   **Bass (0-5):** Triggers **Kick/Beat** events.
*   **Mid (5-30):** Triggers **Snare/Stutter** events.
*   **High (30-100):** Triggers **Vocal/Closeup** events.

#### B. The State Machine
The brain buckets frames by energy:
*   `framesByEnergy.low`: Idle / Breathing.
*   `framesByEnergy.mid`: Standard Step (Left/Right).
*   `framesByEnergy.high`: Power Poses / Drops.
*   `framesByEnergy.closeup`: Face shots.

#### C. Transition Logic (`triggerTransition`)
*   **Default Mode:** `CUT`. Speed = `1000.0` (Instant). This creates the "Snappy" feel.
*   **Exception:** If the target frame is a `closeup` (Face), we switch to `MORPH` (Speed 5.0). This allows the face to "melt" into view for a dramatic effect, but keeps the body rhythm tight.

---

## 3. THE BODY: Physics & Rendering Layer

Even though the sprites are 2D, they feel 3D because of the Physics Layer.

#### A. Spring Solver
We simulate a spring mass system for the Camera and Character.
*   **Inputs:** Bass (Kick) applies a force to `masterRotX` (Pitch) and `camZoom`.
*   **Outputs:** The camera "bangs" its head on the beat.
*   **Damping:** High stiffness (140), medium damping (8). This creates a "punchy" return to center.

#### B. The 2.5D Composite
In `renderCharacterCanvas`, we fake 3D depth:
1.  **Page Turn Effect:** instead of skewing, we scale `X` or `Y` based on `cos(rotation)`. This looks like a rigid card turning in 3D space.
2.  **Bounce:** `charBounceY` is driven by Bass.
3.  **Squash & Stretch:** On impact, we scale Y down and X up (`1/squash`, `squash`) to simulate elasticity.

---

## 4. THE WORLD: Holographic Visualizer (`Visualizer/HolographicVisualizer.ts`)

The background is a custom WebGL Raymarcher.

#### A. Reactivity
It is **not** a video. It is a live shader.
*   **Audio:** `u_audioBass` distorts the geometry (Sine wave ripple).
*   **Mouse:** `u_mouse` rotates the entire fractal universe.

#### B. Integration
The `GlobalBackground` component bridges React state to WebGL.
*   When `Step4Preview` calculates physics (`masterRot`), it passes those values to the Visualizer instance.
*   **Result:** When the character headbangs, the entire universe rotates with them.

---

## 5. DEPENDENCY GRAPH

```
[Audio File] 
    │
    ▼
[Web Audio API (Analyser)] 
    │
    ├──► [Band Splitter (Bass/Mid/High)]
    │       │
    │       ▼
    │    [The Brain (Step4Preview)]
    │       │
    │       ├──► IF Bass > 0.6: Trigger "Hard Cut" to Next Pose
    │       ├──► IF High > 0.6: Trigger "Morph" to Closeup
    │       │
    │       ▼
    │    [Physics Engine]
    │       │
    │       ├──► Apply Impulse to Camera Zoom
    │       ├──► Apply Impulse to World Rotation
    │
    ▼
[Render Loop]
    │
    ├──► [WebGL Background] (Receives World Rotation)
    │
    └──► [Canvas Compositor] (Receives Pose + Zoom + Squash)
            │
            └──► Draws Scaled/Rotated Sprite
```

## 6. CHANGE LOG: THE PIVOT

**Why did we change?**
Users reported the AI generation looked "broken" because limbs were missing, and the animation felt "lazy" because of the morphing.

**The Fixes:**
1.  **Crop Factor:** Changed from `0.15` -> `0.10` (Reveals more image).
2.  **Scale:** Enforced `75%` inside Gemini Prompt (Centers subject).
3.  **Slice:** Moved to Percentage-based slicing (Fixes grid drift).
4.  **Interpolation:** Disabled `SLIDE` for body moves (Restores rhythm).

This architecture ensures reliability (`Mechanical Grid`) and musicality (`Hard Cuts`) take precedence over "AI Smoothness."
