
/**
 * QUANTUM FLUX VISUALIZER ENGINE (v7.0 - INTERACTIVITY RESTORED)
 * 
 * High-Fidelity KIFS (Kaleidoscopic Iterated Function System) Renderer.
 * Fixed:
 * - TOUCH/MOUSE Reactivity restored in Shader
 * - Audio Smoothing re-enabled (lightly) for cleaner pulses
 * - Geometry Folding preserved
 */

export interface HolographicParams {
    geometryType?: number; // 0=Tetra, 1=Box, 2=Sponge
    density?: number;
    speed?: number;
    chaos?: number;
    morph?: number;
    hue?: number;
    saturation?: number;
    intensity?: number;
    gridOpacity?: number; 
}

export interface AudioData {
    bass: number;
    mid: number;
    high: number;
    energy: number;
}

export const VERTEX_SHADER = `
    attribute vec2 a_position;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
    }
`;

export const FRAGMENT_SHADER = `
    precision highp float;
    
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec2 u_mouse;
    
    // Params
    uniform float u_geometryType;
    uniform float u_density;
    uniform float u_speed;
    uniform vec3 u_color;
    uniform float u_intensity;
    uniform float u_chaos;
    uniform float u_morph;
    uniform float u_cameraZ; 
    uniform vec3 u_cameraRot;
    
    // Audio
    uniform float u_audioBass;
    uniform float u_audioMid;
    uniform float u_audioHigh;
    
    #define MAX_STEPS 80
    #define MAX_DIST 20.0
    #define SURF_DIST 0.001

    // --- MATH UTILS ---
    mat2 rot(float a) {
        float s = sin(a);
        float c = cos(a);
        return mat2(c, -s, s, c);
    }

    // --- ORIGINAL KIFS FRACTAL ---
    float sdQuantumFractal(vec3 p) {
        float s = 1.0;
        
        // HEARTBEAT / BREATHING
        float breathing = 1.0 + (u_audioBass * 0.4); 
        
        // ROTATION (INTERACTIVITY RESTORED)
        // We mix Auto-Rotation (Time) with User-Rotation (Mouse)
        float autoRot = u_time * 0.15 * u_speed;
        p.xz *= rot(autoRot + u_mouse.x * 3.0); 
        p.xy *= rot(autoRot * 0.5 + u_mouse.y * 3.0);
        
        // Complex Offset based on Mid/Highs
        vec3 offset = vec3(1.0, 1.2, 0.8) * (0.8 + u_morph + (u_audioMid * 0.3));

        // THE FOLDING LOOP
        for(int i=0; i<6; i++) {
            p = abs(p); // Fold space
            
            // Tetrahedral symmetries
            if(p.x < p.y) p.xy = p.yx;
            if(p.x < p.z) p.xz = p.zx;
            if(p.y < p.z) p.yz = p.zy;
            
            // Shift and Fold
            p.z -= offset.z * 0.5;
            p.z = -abs(p.z);
            p.z += offset.z * 0.5;
            
            // Scale step (Fractal growth)
            p = p * 1.5 * breathing - offset * (1.5 * breathing - 1.0);
            s *= 1.5 * breathing;
            
            // Twist based on Highs (Sparkle)
            if (i > 2) {
                p.xy *= rot(u_chaos * 2.0 + (u_audioHigh * 0.8));
            }
        }
        
        // Distance field
        return length(p) / s;
    }

    // --- SCENE MAP ---
    float GetDist(vec3 p) {
        // Subtle wave distortion based on bass
        float wave = sin(p.y * 3.0 + u_time) * (u_audioBass * 0.2);
        p.x += wave;
        
        float d = sdQuantumFractal(p);
        return d;
    }

    // --- RAYMARCHER ---
    float RayMarch(vec3 ro, vec3 rd) {
        float dO = 0.0;
        for(int i=0; i<MAX_STEPS; i++) {
            vec3 p = ro + rd*dO;
            float dS = GetDist(p);
            dO += dS * 0.5; // Precision
            if(dO>MAX_DIST || abs(dS)<SURF_DIST) break;
        }
        return dO;
    }

    void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
        
        // Camera Position
        float baseZ = -4.5; 
        vec3 ro = vec3(0.0, 0.0, baseZ + u_cameraZ); 
        vec3 rd = normalize(vec3(uv, 1.0));
        
        // External Camera Rotation (From Physics Engine)
        if (length(u_cameraRot) > 0.0) {
            mat2 rx = rot(u_cameraRot.x); 
            mat2 ry = rot(u_cameraRot.y);
            mat2 rz = rot(u_cameraRot.z);
            ro.yz *= rx; rd.yz *= rx;
            ro.xz *= ry; rd.xz *= ry;
            ro.xy *= rz; rd.xy *= rz;
        }

        float d = RayMarch(ro, rd);
        vec3 col = vec3(0.0);
        
        // --- LIGHTING & COLOR ---
        if(d < MAX_DIST) {
            vec3 p = ro + rd * d;
            
            vec2 e = vec2(0.005, 0.0);
            vec3 n = normalize(vec3(
                GetDist(p+e.xyy)-GetDist(p-e.xyy),
                GetDist(p+e.yxy)-GetDist(p-e.yxy),
                GetDist(p+e.yyx)-GetDist(p-e.yyx)
            ));
            
            // Fresnel
            float fresnel = pow(1.0 + dot(rd, n), 3.0);
            
            vec3 baseColor = u_color;
            baseColor += vec3(0.1, 0.0, 0.2) * (length(p)*0.2);
            
            vec3 ref = reflect(rd, n);
            float spec = pow(max(dot(ref, vec3(0,0,-1)), 0.0), 16.0);
            
            col = baseColor * 0.2; // Ambient
            col += baseColor * fresnel * 2.0; // Rim Light
            col += vec3(1.0) * spec * (0.5 + u_audioHigh); // Specular
        }
        
        // --- VOLUMETRIC GLOW ---
        float glow = 0.0;
        float s = 0.0;
        for(int i=0; i<6; i++) {
            vec3 p = ro + rd * (s + 2.0);
            float dist = GetDist(p);
            float fog = 1.0 / (1.0 + abs(dist) * 20.0);
            glow += fog;
            s += 0.5;
        }
        
        float audioClear = u_audioMid * 1.5;
        float finalDensity = max(0.1, u_density - audioClear);
        
        glow *= finalDensity * 0.4;
        
        col += u_color * glow * u_intensity;
        col *= 1.2 - length(uv) * 0.8; // Vignette
        col = pow(col, vec3(0.4545)); // Gamma
        
        gl_FragColor = vec4(col, 1.0);
    }
`;

export class QuantumVisualizer {
    canvas: HTMLCanvasElement;
    gl: WebGLRenderingContext;
    program: WebGLProgram | null = null;
    startTime: number;
    uniforms: any = {};
    
    mouse: { x: number, y: number } = { x: 0, y: 0 };
    targetMouse: { x: number, y: number } = { x: 0, y: 0 };
    
    // Internal state for smoothing
    currentAudio: AudioData = { bass: 0, mid: 0, high: 0, energy: 0 };
    
    params: HolographicParams = {
        geometryType: 0, 
        density: 2.0,
        speed: 0.1,
        chaos: 0.5,
        morph: 0.0,
        hue: 200, 
        saturation: 0.8,
        intensity: 0.6,
        gridOpacity: 0.0
    };
    
    targetAudio: AudioData = { bass: 0, mid: 0, high: 0, energy: 0 };

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const gl = this.canvas.getContext('webgl', { 
            preserveDrawingBuffer: true,
            alpha: false, 
            antialias: true
        });
        
        if (!gl) {
            const glExp = this.canvas.getContext('experimental-webgl') as WebGLRenderingContext;
            if(!glExp) throw new Error('WebGL not supported');
            this.gl = glExp;
        } else {
            this.gl = gl;
        }
        
        this.startTime = Date.now();
        this.initShaders();
        this.initBuffers();
        this.initInteraction();
        this.resize();
    }

    initInteraction() {
        const updateMouse = (x: number, y: number) => {
            this.targetMouse.x = (x / window.innerWidth) * 2 - 1;
            this.targetMouse.y = -(y / window.innerHeight) * 2 + 1;
        };
        
        // Listeners for both Mouse and Touch
        window.addEventListener('mousemove', (e) => updateMouse(e.clientX, e.clientY));
        window.addEventListener('touchmove', (e) => {
            if(e.touches[0]) updateMouse(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
    }

    resize() {
        if (this.canvas.clientWidth === 0 || this.canvas.clientHeight === 0) {
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            return;
        }
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5); 
        const displayWidth = Math.floor(this.canvas.clientWidth * dpr);
        const displayHeight = Math.floor(this.canvas.clientHeight * dpr);

        if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
            this.canvas.width = displayWidth;
            this.canvas.height = displayHeight;
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    updateAudio(data: AudioData) {
        this.targetAudio = data;
    }

    initShaders() {
        this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
        if (!this.program) return;

        this.uniforms = {
            resolution: this.gl.getUniformLocation(this.program, 'u_resolution'),
            time: this.gl.getUniformLocation(this.program, 'u_time'),
            mouse: this.gl.getUniformLocation(this.program, 'u_mouse'),
            
            density: this.gl.getUniformLocation(this.program, 'u_density'),
            speed: this.gl.getUniformLocation(this.program, 'u_speed'),
            color: this.gl.getUniformLocation(this.program, 'u_color'),
            intensity: this.gl.getUniformLocation(this.program, 'u_intensity'),
            chaos: this.gl.getUniformLocation(this.program, 'u_chaos'),
            morph: this.gl.getUniformLocation(this.program, 'u_morph'),
            cameraZ: this.gl.getUniformLocation(this.program, 'u_cameraZ'),
            cameraRot: this.gl.getUniformLocation(this.program, 'u_cameraRot'),
            
            audioBass: this.gl.getUniformLocation(this.program, 'u_audioBass'),
            audioMid: this.gl.getUniformLocation(this.program, 'u_audioMid'),
            audioHigh: this.gl.getUniformLocation(this.program, 'u_audioHigh'),
        };
    }
    
    createProgram(vertexSource: string, fragmentSource: string) {
        const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexSource);
        const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource);
        if (!vertexShader || !fragmentShader) return null;
        const program = this.gl.createProgram();
        if (!program) return null;
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);
        return program;
    }
    
    createShader(type: number, source: string) {
        const shader = this.gl.createShader(type);
        if (!shader) return null;
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) return null;
        return shader;
    }
    
    initBuffers() {
        if (!this.program) return;
        const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
        const buffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);
        const loc = this.gl.getAttribLocation(this.program, 'a_position');
        this.gl.enableVertexAttribArray(loc);
        this.gl.vertexAttribPointer(loc, 2, this.gl.FLOAT, false, 0, 0);
    }

    render(cameraZOffset: number = 0.0, rotation: {x:number, y:number, z:number} = {x:0, y:0, z:0}) {
        if (!this.program) return;
        this.resize();
        this.gl.useProgram(this.program);
        
        const time = (Date.now() - this.startTime) / 1000;
        
        // 1. Mouse Smoothing (Interactive Flow)
        this.mouse.x += (this.targetMouse.x - this.mouse.x) * 0.05;
        this.mouse.y += (this.targetMouse.y - this.mouse.y) * 0.05;

        // 2. Audio Smoothing (Prevents Jitter/Broken look)
        // We use a fast lerp (0.15) to keep it punchy but clean
        const smooth = 0.15;
        this.currentAudio.bass += (this.targetAudio.bass - this.currentAudio.bass) * smooth;
        this.currentAudio.mid += (this.targetAudio.mid - this.currentAudio.mid) * smooth;
        this.currentAudio.high += (this.targetAudio.high - this.currentAudio.high) * smooth;
        
        // Color Logic
        const h = (this.params.hue || 0) / 360;
        const s = this.params.saturation || 0.8;
        const l = 0.6;
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        const hue2rgb = (p: number, q: number, t: number) => {
            if(t < 0) t += 1; if(t > 1) t -= 1;
            if(t < 1/6) return p + (q - p) * 6 * t;
            if(t < 1/2) return q;
            if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        const r = hue2rgb(p, q, h + 1/3);
        const g = hue2rgb(p, q, h);
        const b = hue2rgb(p, q, h - 1/3);

        this.gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
        this.gl.uniform1f(this.uniforms.time, time);
        this.gl.uniform2f(this.uniforms.mouse, this.mouse.x, this.mouse.y);
        
        this.gl.uniform1f(this.uniforms.density, this.params.density || 2.0);
        this.gl.uniform1f(this.uniforms.speed, this.params.speed || 0.1);
        this.gl.uniform3f(this.uniforms.color, r, g, b);
        this.gl.uniform1f(this.uniforms.intensity, this.params.intensity || 0.5);
        this.gl.uniform1f(this.uniforms.chaos, this.params.chaos || 0.0);
        this.gl.uniform1f(this.uniforms.morph, this.params.morph || 0.0);
        this.gl.uniform1f(this.uniforms.cameraZ, cameraZOffset);
        this.gl.uniform3f(this.uniforms.cameraRot, rotation.x, rotation.y, rotation.z);
        
        // Use Smoothed Audio
        this.gl.uniform1f(this.uniforms.audioBass, this.currentAudio.bass);
        this.gl.uniform1f(this.uniforms.audioMid, this.currentAudio.mid);
        this.gl.uniform1f(this.uniforms.audioHigh, this.currentAudio.high);
        
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }
}
