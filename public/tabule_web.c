/* ============================================================================
 *  TABULE_WEB.C  ·  3D tabule "Havířov" — C99 dvojce programu tabule.cpp
 * ----------------------------------------------------------------------------
 *  Identicky raytracer jako tabule.cpp, ale bez C++ standardni knihovny,
 *  aby ho spolehlive prelozil vestaveny browser-kompilator (clang → WASM,
 *  Wasmer SDK). Vysledek (PPM) zapisuje do souboru A ZAROVEN na stdout mezi
 *  znacky PPMBEGIN / PPMEND — tak ho webova aplikace zachyti a zobrazi.
 *
 *  PREKLAD (natívne):   cc -O2 -std=c99 tabule_web.c -o tabule_web -lm
 *  SPUSTENI:            ./tabule_web --web --phase 2.4
 * ============================================================================ */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

/* ---------------------------------------------------------------------------
 *  Vektorova matematika
 * ------------------------------------------------------------------------- */
typedef struct { double x, y, z; } V3;
static V3 v3(double x, double y, double z) { V3 r; r.x = x; r.y = y; r.z = z; return r; }
static V3 vadd(V3 a, V3 b) { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
static V3 vsub(V3 a, V3 b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
static V3 vsmul(V3 a, double s) { return v3(a.x * s, a.y * s, a.z * s); }
static V3 vmul(V3 a, V3 b) { return v3(a.x * b.x, a.y * b.y, a.z * b.z); }
static V3 vdiv(V3 a, double s) { return v3(a.x / s, a.y / s, a.z / s); }
static double vdot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static V3 vcross(V3 a, V3 b) {
    return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}
static double vlen(V3 a) { return sqrt(vdot(a, a)); }
static V3 vnorm(V3 a) { double l = vlen(a); return l > 1e-12 ? vdiv(a, l) : v3(0, 0, 0); }

/* ---------------------------------------------------------------------------
 *  Parametry sceny (shodne s webovou verzi)
 * ------------------------------------------------------------------------- */
static const double BOARD_H = 4.0;
static const double BOARD_Y = 2.9;
static double g_boardW = 6.4;
static double g_amp    = 0.07;
static double g_freq   = 1.25;
static double g_time   = 0.0;
static int g_steps       = 160;
static int g_shadowSteps = 40;

/* Vlnici funkce povrchu — identicka s Three.js verzi i s tabule.cpp */
static double wave(double x, double y) {
    double t = g_time;
    return sin(x * g_freq + t * 1.25) * 0.55 +
           sin(y * g_freq * 1.65 - t * 0.85) * 0.30 +
           sin((x + y) * g_freq * 0.62 + t * 0.60) * 0.15;
}

/* ---------------------------------------------------------------------------
 *  SDF geometrie (sphere tracing)
 * ------------------------------------------------------------------------- */
static double sdBox(V3 p, V3 b) {
    V3 q = v3(fabs(p.x) - b.x, fabs(p.y) - b.y, fabs(p.z) - b.z);
    double ox = q.x > 0 ? q.x : 0, oy = q.y > 0 ? q.y : 0, oz = q.z > 0 ? q.z : 0;
    double outside = sqrt(ox * ox + oy * oy + oz * oz);
    double m = q.x > q.y ? q.x : q.y; if (q.z > m) m = q.z;
    double inside = m < 0 ? m : 0;
    return outside + inside;
}

typedef struct { double d; int id; } Hit;

/* materialy: 0 podlaha · 1 povrch tabule · 2 tmava ocel · 3 ram · 4 lampa */
static Hit sceneMap(V3 p) {
    double w2 = g_boardW * 0.5, h2 = BOARD_H * 0.5;
    double best = p.y; int id = 0;

    V3 q = v3(p.x, p.y - BOARD_Y, p.z);
    double boxD  = sdBox(q, v3(w2, h2, 0.14));
    double front = q.z - (0.14 + g_amp * wave(q.x, q.y));
    double d = boxD > front ? boxD : front;
    if (d < best) { best = d; id = 1; }

    const double t2 = 0.12, fd = 0.13;
    d = sdBox(vsub(q, v3(0,  (h2 + t2), -0.02)), v3(w2 + 2.0 * t2, t2, fd));
    if (d < best) { best = d; id = 3; }
    d = sdBox(vsub(q, v3(0, -(h2 + t2), -0.02)), v3(w2 + 2.0 * t2, t2, fd));
    if (d < best) { best = d; id = 3; }
    d = sdBox(vsub(q, v3( (w2 + t2), 0, -0.02)), v3(t2, h2, fd));
    if (d < best) { best = d; id = 3; }
    d = sdBox(vsub(q, v3(-(w2 + t2), 0, -0.02)), v3(t2, h2, fd));
    if (d < best) { best = d; id = 3; }

    d = sdBox(vsub(q, v3(0, 0, -0.08)), v3(w2 + 0.02, h2 + 0.02, 0.08));
    if (d < best) { best = d; id = 2; }
    double legX = g_boardW * 0.33;
    d = sdBox(vsub(p, v3( legX, 0.27, -0.19)), v3(0.075, 0.39, 0.075));
    if (d < best) { best = d; id = 2; }
    d = sdBox(vsub(p, v3(-legX, 0.27, -0.19)), v3(0.075, 0.39, 0.075));
    if (d < best) { best = d; id = 2; }
    d = sdBox(vsub(p, v3( legX, 0.03, -0.19)), v3(0.26, 0.03, 0.17));
    if (d < best) { best = d; id = 2; }
    d = sdBox(vsub(p, v3(-legX, 0.03, -0.19)), v3(0.26, 0.03, 0.17));
    if (d < best) { best = d; id = 2; }
    d = sdBox(vsub(p, v3(0, 0.24, -0.19)), v3(legX + 0.075, 0.045, 0.06));
    if (d < best) { best = d; id = 2; }

    d = sdBox(vsub(p, v3(0, 0.57, 0.14)), v3(g_boardW * 0.41, 0.025, 0.025));
    if (d < best) { best = d; id = 4; }

    Hit h; h.d = best; h.id = id;
    return h;
}

static V3 sceneNormal(V3 p) {
    const double e = 0.002;
    double d0 = sceneMap(p).d;
    return vnorm(v3(sceneMap(vadd(p, v3(e, 0, 0))).d - d0,
                    sceneMap(vadd(p, v3(0, e, 0))).d - d0,
                    sceneMap(vadd(p, v3(0, 0, e))).d - d0));
}

static Hit rayMarch(V3 ro, V3 rd, double* tOut) {
    double t = 0.02;
    for (int i = 0; i < g_steps; ++i) {
        Hit h = sceneMap(vadd(ro, vsmul(rd, t)));
        if (h.d < 0.0012) { *tOut = t; return h; }
        t += h.d * 0.85;
        if (t > 60.0) break;
    }
    *tOut = -1.0;
    Hit miss; miss.d = -1.0; miss.id = -1;
    return miss;
}

static double shadowMarch(V3 p, V3 L) {
    double t = 0.03;
    for (int i = 0; i < g_shadowSteps; ++i) {
        double d = sceneMap(vadd(p, vsmul(L, t))).d;
        if (d < 0.0015) return 0.0;
        double s = d * 0.9; if (s < 0.02) s = 0.02;
        t += s;
        if (t > 25.0) break;
    }
    return 1.0;
}

static double ambientOcclusion(V3 p, V3 n) {
    double occ = 0.0, sca = 1.0;
    for (int i = 1; i <= 5; ++i) {
        double hstep = 0.03 * i;
        occ += (hstep - sceneMap(vadd(p, vsmul(n, hstep))).d) * sca;
        sca *= 0.72;
    }
    double r = 1.0 - 1.6 * occ;
    return r > 0.0 ? r : 0.0;
}

/* ---------------------------------------------------------------------------
 *  Textury: havirov.ppm (P6), jinak proceduralni uhli
 * ------------------------------------------------------------------------- */
static int g_tw = 0, g_th = 0;
static unsigned char* g_tpx = 0;

static int loadPPM(const char* path) {
    FILE* f = fopen(path, "rb");
    if (!f) return 0;
    char magic[3]; magic[0] = magic[1] = magic[2] = 0;
    int w = 0, h = 0, maxv = 0;
    if (fscanf(f, "%2s", magic) != 1 || strcmp(magic, "P6") != 0 ||
        fscanf(f, "%d %d %d", &w, &h, &maxv) != 3 ||
        w < 1 || h < 1 || maxv <= 0 || maxv > 255) {
        fclose(f);
        return 0;
    }
    fgetc(f);
    size_t n = (size_t)w * (size_t)h * 3;
    unsigned char* px = (unsigned char*)malloc(n);
    if (!px) { fclose(f); return 0; }
    size_t got = fread(px, 1, n, f);
    fclose(f);
    if (got != n) { free(px); return 0; }
    g_tw = w; g_th = h; g_tpx = px;
    return 1;
}

static double hash2(double x, double y) {
    double s = sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - floor(s);
}
static double vnoise(double x, double y) {
    double xi = floor(x), yi = floor(y);
    double xf = x - xi, yf = y - yi;
    double u = xf * xf * (3.0 - 2.0 * xf);
    double v = yf * yf * (3.0 - 2.0 * yf);
    double a = hash2(xi, yi),     b = hash2(xi + 1, yi);
    double c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
static double fbm(double x, double y) {
    double s = 0.0, amp = 0.5, f = 1.0;
    for (int i = 0; i < 5; ++i) { s += amp * vnoise(x * f, y * f); f *= 2.03; amp *= 0.5; }
    return s;
}
static double smooth01(double x) {
    double c = x < 0 ? 0 : (x > 1 ? 1 : x);
    return c * c * (3.0 - 2.0 * c);
}

static V3 proceduralCoal(double u, double v) {
    double n      = fbm(u * 6.0, v * 6.0);
    double strata = fbm(u * 3.0 + 11.7, v * 14.0);
    double veins  = pow(1.0 - fabs(fbm(u * 5.0 + 3.1, v * 5.0 - 2.2) - 0.5) * 4.0 > 0 ?
                        1.0 - fabs(fbm(u * 5.0 + 3.1, v * 5.0 - 2.2) - 0.5) * 4.0 : 0.0, 3.0);
    double base = 0.10 + 0.16 * n + 0.06 * strata;
    V3 col = v3(base, base * 0.96, base * 0.92);
    col = vadd(col, vsmul(v3(0.95, 0.62, 0.22), veins * 0.55));
    double gx = fabs(fmod(u * 4.0 + 0.5, 1.0) - 0.5);
    double gy = fabs(fmod(v * 2.5 + 0.5, 1.0) - 0.5);
    double gm = gx < gy ? gx : gy;
    col = vsmul(col, 0.55 + 0.45 * smooth01(gm * 24.0));
    double e1 = u < 1.0 - u ? u : 1.0 - u;
    double e2 = v < 1.0 - v ? v : 1.0 - v;
    double edge = e1 < e2 ? e1 : e2;
    col = vsmul(col, 0.72 + 0.28 * smooth01(edge * 8.0));
    return col;
}

static V3 sampleTex(double u, double v) {
    if (g_tw > 0 && g_th > 0) {
        u = u - floor(u);
        v = v - floor(v);
        int x = (int)(u * g_tw);
        if (x < 0) x = 0; if (x > g_tw - 1) x = g_tw - 1;
        int y = (int)((1.0 - v) * g_th);
        if (y < 0) y = 0; if (y > g_th - 1) y = g_th - 1;
        const unsigned char* p = &g_tpx[((size_t)y * (size_t)g_tw + (size_t)x) * 3];
        return v3(p[0] / 255.0, p[1] / 255.0, p[2] / 255.0);
    }
    return proceduralCoal(u, v);
}

/* ---------------------------------------------------------------------------
 *  Svetla a stinovani
 * ------------------------------------------------------------------------- */
static V3 background(V3 rd) {
    double h = rd.y * 0.5 + 0.5; if (h < 0) h = 0;
    V3 col = vadd(vsmul(v3(0.052, 0.042, 0.038), h), vsmul(v3(0.016, 0.012, 0.011), 1.0 - h));
    double dy = (rd.y - 0.08) * 4.5;
    double glow  = exp(-dy * dy);
    double behind = -rd.z > 0 ? -rd.z : 0;
    col = vadd(col, vsmul(v3(0.30, 0.17, 0.06), glow * (0.25 + 0.75 * behind)));
    double side = -rd.x > 0 ? -rd.x : 0;
    col = vadd(col, vsmul(v3(0.05, 0.08, 0.11), glow * side));
    return col;
}

static V3 shade(V3 p, V3 rd, int id) {
    if (id == 4) {
        double fl = 0.85 + 0.15 * sin(g_time * 6.3) + 0.06 * sin(g_time * 17.7);
        return vsmul(v3(3.0, 1.85, 0.70), fl);
    }

    V3 n = sceneNormal(p);
    V3 q = v3(p.x, p.y - BOARD_Y, p.z);
    double w2 = g_boardW * 0.5, h2 = BOARD_H * 0.5;

    V3 alb = v3(0.13, 0.10, 0.085);
    double spec = 0.7, gloss = 46.0, metal = 0.55;
    V3 emis = v3(0, 0, 0);

    if (id == 1) {
        double u = q.x / (2.0 * w2) + 0.5;
        double v = q.y / (2.0 * h2) + 0.5;
        alb = sampleTex(u, v);
        spec = 0.5; gloss = 42.0; metal = 0.14;
    } else if (id == 3) {
        alb = v3(0.16, 0.135, 0.12);
        spec = 1.0; gloss = 60.0; metal = 1.0;
    } else if (id == 2) {
        alb = v3(0.11, 0.095, 0.085);
        spec = 0.6; gloss = 30.0; metal = 0.7;
    } else {
        double r = sqrt(p.x * p.x + p.z * p.z);
        if (r < 5.4) alb = vsmul(alb, 1.28);
        if (fabs(r - 5.46) < 0.06) emis = vsmul(v3(0.55, 0.34, 0.11), 0.22);
    }

    double ao = ambientOcclusion(p, n);

    V3 L1 = vnorm(v3(4.6, 6.4, 5.2));
    V3 C1 = v3(1.0, 0.83, 0.60);  double I1 = 2.6;
    V3 L2 = vnorm(v3(-6.5, 4.6, -5.0));
    V3 C2 = v3(0.38, 0.55, 0.72); double I2 = 1.5;
    V3 lampPos = v3(0.0, 0.72, 1.1);
    V3 C3 = v3(0.95, 0.60, 0.23);

    double sh   = shadowMarch(vadd(p, vsmul(n, 0.012)), L1);
    double dif1 = (vdot(n, L1) > 0 ? vdot(n, L1) : 0) * sh * I1;
    double dif2 = (vdot(n, L2) > 0 ? vdot(n, L2) : 0) * I2;

    V3 toLamp = vsub(lampPos, p);
    double dL = vlen(toLamp);
    toLamp = vdiv(toLamp, dL);
    double dif3 = (vdot(n, toLamp) > 0 ? vdot(n, toLamp) : 0) * 6.0 / (1.0 + 0.5 * dL * dL);

    V3 H1 = vnorm(vsub(L1, rd));
    V3 H3 = vnorm(vsub(toLamp, rd));
    double dnh1 = vdot(n, H1); if (dnh1 < 0) dnh1 = 0;
    double dnh3 = vdot(n, H3); if (dnh3 < 0) dnh3 = 0;
    double sp = pow(dnh1, gloss) * spec * sh * I1 * 0.5 +
                pow(dnh3, gloss) * spec * dif3 * 0.6;

    double ny = n.y > 0 ? n.y : 0;
    V3 amb   = vsmul(v3(0.16, 0.13, 0.11), (0.55 + 0.45 * ny) * ao);
    V3 spCol = vadd(vsmul(alb, metal), vsmul(v3(0.25, 0.24, 0.22), 1.0 - metal));

    V3 light = vadd(vadd(vsmul(C1, dif1), vsmul(C2, dif2)), vadd(vsmul(C3, dif3), amb));
    return vadd(vadd(vmul(alb, light), vsmul(spCol, sp)), emis);
}

/* ACES tonemap (aproximace Narkowicz) + gamma */
static double acesCh(double v) {
    if (v < 0) v = 0;
    return (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
}
static unsigned char tonemap(double c) {
    double a = acesCh(c * 1.12);
    if (a < 0) a = 0; if (a > 1) a = 1;
    double v = pow(a, 1.0 / 2.2);
    return (unsigned char)(255.99 * v);
}

/* ---------------------------------------------------------------------------
 *  Prach — 2D projekce castic do hotoveho obrazku (aditivni)
 * ------------------------------------------------------------------------- */
static unsigned char add8(unsigned char a, double b) {
    double s = (double)a + b;
    return (unsigned char)(s > 255.0 ? 255.0 : s);
}
static void dustOverlay(unsigned char* buf, int W, int H,
                        V3 ro, V3 right, V3 up, V3 fwd, double fl, double timeAnim) {
    const int N = 110;
    for (int i = 0; i < N; ++i) {
        double bx = (hash2((double)i, 7.3) - 0.5) * 19.0;
        double bz = (hash2((double)i, 3.1) - 0.5) * 13.0;
        double vy = 0.06 + 0.22 * hash2((double)i, 9.7);
        double y  = fmod(hash2((double)i, 5.9) * 7.5 + timeAnim * vy * 4.0, 7.5);
        V3 p = v3(bx + sin(timeAnim * 0.35 + (double)i) * 0.5, y, bz);
        V3 rel = vsub(p, ro);
        double zc = vdot(rel, fwd);
        if (zc < 0.3) continue;
        double sx = (vdot(rel, right) * fl / zc) * (W * 0.5) + W * 0.5;
        double sy = H * 0.5 - (vdot(rel, up) * fl / zc) * (H * 0.5);
        double df = 3.0 / zc; if (df > 1.0) df = 1.0;
        for (int dy = -1; dy <= 1; ++dy) {
            for (int dx = -1; dx <= 1; ++dx) {
                int ix = (int)sx + dx, iy = (int)sy + dy;
                if (ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
                double fall = ((dx == 0 && dy == 0) ? 0.5 : 0.16) * df;
                size_t o = ((size_t)iy * (size_t)W + (size_t)ix) * 3;
                buf[o]     = add8(buf[o],     244.0 * fall);
                buf[o + 1] = add8(buf[o + 1], 195.0 * fall);
                buf[o + 2] = add8(buf[o + 2], 122.0 * fall);
            }
        }
    }
}

/* ---------------------------------------------------------------------------
 *  Render jednoho snimku
 * ------------------------------------------------------------------------- */
static void renderFrame(int W, int H, double timeAnim, unsigned char* buf) {
    g_time = timeAnim;

    double az   = 0.55 + 0.10 * sin(timeAnim * 0.25);
    double pol  = 1.22;
    double dist = 9.6;
    V3 target = v3(0, 2.65, 0);
    V3 ro = v3(target.x + dist * sin(pol) * sin(az),
               target.y + dist * cos(pol),
               target.z + dist * sin(pol) * cos(az));
    V3 fwd   = vnorm(vsub(target, ro));
    V3 right = vnorm(vcross(fwd, v3(0, 1, 0)));
    V3 up    = vcross(right, fwd);
    double fl = 1.9;

    for (int y = 0; y < H; ++y) {
        for (int x = 0; x < W; ++x) {
            double u = (2.0 * (x + 0.5) / W - 1.0) * (double)W / (double)H;
            double v = 1.0 - 2.0 * (y + 0.5) / H;
            V3 rd = vnorm(vadd(vadd(vsmul(fwd, fl), vsmul(right, u)), vsmul(up, v)));
            double t = 0.0;
            Hit h = rayMarch(ro, rd, &t);
            V3 col;
            if (h.id >= 0) {
                V3 p = vadd(ro, vsmul(rd, t));
                col = shade(p, rd, h.id);
                double fog = 1.0 - exp(-t * 0.042);
                col = vadd(vsmul(col, 1.0 - fog), vsmul(background(rd), fog));
            } else {
                col = background(rd);
            }
            size_t o = ((size_t)y * (size_t)W + (size_t)x) * 3;
            buf[o]     = tonemap(col.x);
            buf[o + 1] = tonemap(col.y);
            buf[o + 2] = tonemap(col.z);
        }
    }
    dustOverlay(buf, W, H, ro, right, up, fwd, fl, timeAnim);
}

/* ---------------------------------------------------------------------------
 *  main
 * ------------------------------------------------------------------------- */
int main(int argc, char** argv) {
    int frames = 1, W = 960, H = 600, web = 0;
    double basePhase = 2.4;

    for (int i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--web") == 0) {
            web = 1; W = 320; H = 200;
            g_steps = 96; g_shadowSteps = 24;
        } else if (strcmp(argv[i], "--phase") == 0 && i + 1 < argc) {
            basePhase = atof(argv[++i]);
        } else if (argv[i][0] != '-') {
            frames = atoi(argv[i]); if (frames < 1) frames = 1;
        }
    }
    if (const char* e = getenv("TABULE_W"))      { W = atoi(e); if (W < 64) W = 64; }
    if (const char* e = getenv("TABULE_H"))      { H = atoi(e); if (H < 64) H = 64; }
    if (const char* e = getenv("TABULE_FRAMES")) { frames = atoi(e); if (frames < 1) frames = 1; }
    if (const char* e = getenv("TABULE_PHASE"))  basePhase = atof(e);

    if (loadPPM("havirov.ppm")) {
        double aspect = (double)g_tw / (double)g_th;
        g_boardW = BOARD_H * aspect;
        if (g_boardW > 9.6) g_boardW = 9.6;
        if (g_boardW < 3.2) g_boardW = 3.2;
        printf("[tabule] textura havirov.ppm (%dx%d) nactena — sirka tabule %.2f m\n",
               g_tw, g_th, g_boardW);
    } else {
        printf("[tabule] havirov.ppm nenalezen -> proceduralni uhelny povrch\n");
    }

    printf("[tabule] render: %d snimek/snimku @ %dx%d (%s)\n",
           frames, W, H, web ? "rychly rezim WASM" : "raymarching, CPU");
    fflush(stdout);

    size_t sz = (size_t)W * (size_t)H * 3;
    unsigned char* buf = (unsigned char*)malloc(sz);
    if (!buf) { printf("[tabule] CHYBA: malloc selhal\n"); return 1; }

    for (int i = 0; i < frames; ++i) {
        double t = basePhase + (frames > 1 ? (double)i / 30.0 : 0.0);
        renderFrame(W, H, t, buf);

        char name[64];
        if (frames == 1) snprintf(name, sizeof(name), "tabule.ppm");
        else             snprintf(name, sizeof(name), "tabule_%03d.ppm", i);
        FILE* f = fopen(name, "wb");
        if (f) {
            fprintf(f, "P6\n%d %d\n255\n", W, H);
            fwrite(buf, 1, sz, f);
            fclose(f);
        }

        /* vystup i na stdout — zachyti ho webova aplikace (PPMBEGIN…PPMEND) */
        printf("\nPPMBEGIN\nP6\n%d %d\n255\n", W, H);
        fwrite(buf, 1, sz, stdout);
        printf("\nPPMEND\n");
        fflush(stdout);

        fprintf(stderr, "\r[tabule] hotovo %d/%d", i + 1, frames);
    }
    fprintf(stderr, "\n[tabule] dokonceno\n");
    free(buf);
    free(g_tpx);
    return 0;
}
