# Orbital Frame Aspect Ratio Decision

## The Problem

When generating 8 rotation frames, should we:
1. Force square frames (1:1)
2. Let the product dictate frame shape
3. Use a standard aspect ratio (4:3, 16:9, etc.)

## Current Approach

- Request 2:1 grid from Gemini (4 columns × 2 rows)
- Slice into 8 cells
- Currently forcing 256×256 square cells in code

## The Red Bull Result

The AI generated portrait-oriented cells naturally (tall can = tall frames). This looked correct. But our slicer forces them into squares, which could:
- Crop the top/bottom of tall products
- Add unnecessary padding to wide products

---

## Options

### Option A: Force Square (1:1) Cells

**How:** Keep current 256×256 slicing

**Pros:**
- Consistent viewer behavior
- Simple rotation math
- Works with any product shape (letterboxed)
- Predictable UI layout

**Cons:**
- Tall products get cropped or letterboxed
- Wide products have wasted space
- May lose detail at top/bottom of cans, bottles, etc.
- "Lowest common denominator" approach

**Best for:** Mixed product catalogs, simplicity

---

### Option B: Let Product Dictate Shape

**How:** Detect input image aspect ratio, generate matching cells

**Pros:**
- Maximum detail retention
- Natural-looking frames
- AI can use full cell for the product
- More accurate to real product photography

**Cons:**
- Variable cell sizes complicate viewer
- Different products = different frame dimensions
- Harder to build consistent UI
- Rotation animation may look inconsistent

**Best for:** Single-product focus, quality over consistency

---

### Option C: Standard Aspect Ratios (4:3 or 3:4)

**How:** Offer portrait (3:4) and landscape (4:3) presets

**Pros:**
- Balance between flexibility and consistency
- Covers most product shapes well
- Standard ratios = predictable behavior
- User can choose based on product

**Cons:**
- Still some mismatch for unusual shapes
- Requires user decision or auto-detection
- Two code paths to maintain

**Best for:** Semi-automated with user input

---

### Option D: Smart Detection + Padding

**How:** Analyze input image, generate natural shape, then pad to square for viewer

**Pros:**
- AI generates optimal frames
- Viewer gets consistent squares
- Product stays centered with transparent/white padding
- Best of both worlds?

**Cons:**
- Extra processing step
- Padding may look awkward
- More complex pipeline

**Best for:** Automation with quality focus

---

## Key Questions

1. **Who is the user?**
   - If diverse products → need flexibility
   - If specific category (e.g., cans, shoes) → can optimize for that

2. **What's the viewer experience?**
   - Drag-to-spin needs consistent frame sizes
   - Or does it? Could interpolate between different sizes

3. **What does Gemini do naturally?**
   - The Red Bull test suggests it respects product shape
   - Forcing different AR might fight the AI

4. **Cost vs quality?**
   - More pixels = more tokens = more cost
   - But better quality = better product

---

## Recommendation Candidates

### For MVP / Simplicity:
**Option A (Square)** - Just works, ship it, iterate later

### For Quality Focus:
**Option D (Smart Detection + Padding)** - Best results, more work

### For Balance:
**Option C (Standard ARs)** - Let user pick portrait/landscape/square

---

## Test Plan

1. Run same product through each approach
2. Compare:
   - Visual quality
   - Rotation smoothness
   - Edge cases (very tall, very wide products)
3. Measure token cost difference

---

## Decision

**[ ] Option A - Square (simple)**
**[ ] Option B - Product-dictated (flexible)**
**[ ] Option C - Standard presets (balanced)**
**[ ] Option D - Smart + padding (quality)**

Notes:
_____________________________________________
_____________________________________________
_____________________________________________
