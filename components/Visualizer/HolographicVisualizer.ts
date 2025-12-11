

/**
 * QUANTUM FLUX VISUALIZER ENGINE (v5.0 - Mellow & Sophisticated)
 * 
 * Advanced KIFS (Kaleidoscopic Iterated Function System) Renderer.
 * Features:
 * - Smooth Lerping (No jitter/strobing)
 * - Phase-Shifting Geometry (Movement over scaling)
 * - Inverse Density Reactivity (Interaction clears the chaos)
 * - Interactive 4D Rotation via Mouse/Touch
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
    
    // Audio (Smoothed)
    uniform float u_audioBass;
    uniform float u_audioMid;
    uniform float u_audioHigh;
    
    #define MAX_STEPS 60
    #define MAX_DIST 12.0
    #define SURF_DIST 0.002

    // --- MATH UTILS ---
    mat2 rot(float a) {
        float s = sin(a);
        float c = cos(a);
        return mat2(c, -s, s, c);
    }
    
    float hash(vec3 p) {
        p  = fract( p*0.3183099+.1 );
        p *= 17.0;
        return fract( p.x*p.y*p.z*(p.x+p.y+p.z) );
    }

    // --- KIFS FRACTAL (Restored Classic) ---
    float sdQuantumFractal(vec3 p) {
        float s = 1.0;
        
        // REACTIVITY: Restored Breathing but CLAMPED
        // We use a base scale + mild audio influence to prevent "pumping" artifacts
        float breathing = 0.9 + (u_audioBass * 0.2); 
        
        // Offset logic
        vec3 offset = vec3(1.0, 1.0, 1.0) * (0.6 + u_morph + (u_audioMid * 0.1));
        
        // Gentle Rotation
        p.xz *= rot(u_time * 0.1 + u_mouse.x * 1.0);
        p.yz *= rot(u_mouse.y * 1.0);

        // Fold Iterations
        for(int i=0; i<5; i++) {
            p = abs(p); 
            if(p.x < p.y) p.xy = p.yx;
            if(p.x < p.z) p.xz = p.zx;
            if(p.y < p.z) p.yz = p.zy;
            
            p.z -= offset.z * 0.4;
            p.z = -abs(p.z);
            p.z += offset.z * 0.4;
            
            p = p * breathing - offset * (breathing - 1.0);
            s *= breathing;
            
            // Twist
            if (i > 3) {
                p.xy *= rot(u_chaos * 0.8);
            }
        }
        
        return length(p) / s;
    }

    // --- SCENE MAP ---
    float GetDist(vec3 p) {
        // Subtle wave
        float wave = sin(p.y * 2.0 + u_time * 0.5) * (u_audioBass * 0.15);
        p.z += wave;
        
        float d = sdQuantumFractal(p);
        return d;
    }

    // --- RAYMARCHER ---
    float RayMarch(vec3 ro, vec3 rd) {
        float dO = 0.0;
        for(int i=0; i<MAX_STEPS; i++) {
            vec3 p = ro + rd*dO;
            float dS = GetDist(p);
            dO += dS * 0.6; // Softer steps for fluffier clouds
            if(dO>MAX_DIST || abs(dS)<SURF_DIST) break;
        }
        return dO;
    }

    void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
        
        // MOVED CLOSER (-3.0) to fill screen better
        float baseZ = -3.0; 
        vec3 ro = vec3(0.0, 0.0, baseZ + u_cameraZ); 
        vec3 rd = normalize(vec3(uv, 1.0));
        
        // Camera Rotation
        if (length(u_cameraRot) > 0.0) {
            mat2 rx = rot(u_cameraRot.x * 0.5); // Dampen rotation inputs
            mat2 ry = rot(u_cameraRot.y * 0.5);
            mat2 rz = rot(u_cameraRot.z * 0.5);
            ro.yz *= rx; rd.yz *= rx;
            ro.xz *= ry; rd.xz *= ry;
            ro.xy *= rz; rd.xy *= rz;
        }

        float d = RayMarch(ro, rd);
        vec3 col = vec3(0.0);
        
        if(d < MAX_DIST) {
            vec3 p = ro + rd * d;
            
            vec2 e = vec2(0.01, 0.0);
            vec3 n = normalize(vec3(
                GetDist(p+e.xyy)-GetDist(p-e.xyy),
                GetDist(p+e.yxy)-GetDist(p-e.yxy),
                GetDist(p+e.yyx)-GetDist(p-e.yyx)
            ));
            
            float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
            
            vec3 tint = u_color + (vec3(u_audioHigh) * 0.2); 
            col = tint * 0.5 + (n * 0.05); 
            
            float shine = 1.0 + (u_audioBass * 1.5);
            col += vec3(0.9, 0.95, 1.0) * fresnel * shine * 0.5;
            
            float edge = smoothstep(0.1, 0.0, GetDist(p + n*0.05));
            col += u_color * edge * 2.0;
        }
        
        float glow = 0.0;
        float s = 0.0;
        for(int i=0; i<4; i++) {
            vec3 p = ro + rd * (s + 1.0);
            float dist = GetDist(p);
            float fog = 1.0 / (1.0 + abs(dist) * 15.0);
            glow += fog;
            s += 0.8;
        }
        
        float audioClear = u_audioMid * 0.8;
        float finalDensity = max(0.2, u_density - audioClear);
        
        glow *= finalDensity * 0.25; 
        col += u_color * glow * u_intensity;
        col *= 1.0 - length(uv) * 0.6;
        
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
    
    // SMOOTHING STATE
    smoothAudio = { bass: 0, mid: 0, high: 0 };

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
    
    audioData: AudioData = { bass: 0, mid: 0, high: 0, energy: 0 };

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const gl = this.canvas.getContext('webgl', { 
            preserveDrawingBuffer: true,
            alpha: false, // Opaque for background
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
        window.addEventListener('mousemove', (e) => updateMouse(e.clientX, e.clientY));
        window.addEventListener('touchmove', (e) => {
            if(e.touches[0]) updateMouse(e.touches[0].clientX, e.touches[0].clientY);
        });
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
        this.audioData = data;
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
        
        // Mouse Smoothing
        this.mouse.x += (this.targetMouse.x - this.mouse.x) * 0.05;
        this.mouse.y += (this.targetMouse.y - this.mouse.y) * 0.05;
        
        // AUDIO SMOOTHING (The Mellowing Factor)
        // We LERP the values so they don't snap instantly
        const lerpFactor = 0.1;
        this.smoothAudio.bass += (this.audioData.bass - this.smoothAudio.bass) * lerpFactor;
        this.smoothAudio.mid += (this.audioData.mid - this.smoothAudio.mid) * lerpFactor;
        this.smoothAudio.high += (this.audioData.high - this.smoothAudio.high) * lerpFactor;

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
        
        // Pass SMOOTHED audio
        this.gl.uniform1f(this.uniforms.audioBass, this.smoothAudio.bass);
        this.gl.uniform1f(this.uniforms.audioMid, this.smoothAudio.mid);
        this.gl.uniform1f(this.uniforms.audioHigh, this.smoothAudio.high);
        
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }
}
